import fetch from 'node-fetch';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { AuthManager } from './auth-manager.js';
import { getAnalytics } from './analytics/ga4.js';

interface DeviceAuthResponse {
  deviceToken: string;
  refreshToken: string;
  userId: string;
}

interface ActionItem {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate?: string;
  tags: string[];
  category: 'work' | 'personal';
  confidence: number;
  sourceNoteId?: string;
}

// Pagination metadata for list responses
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface ConvertedTask {
  actionItemId: string;
  taskOrder: number;
  title: string;
  description: string;
  estimatedTime: number;
  energyRequired: 'low' | 'medium' | 'high';
  tags: string[];
  dependsOnTaskOrders: number[];
  taskType: 'quick_win' | 'focus_required' | 'collaborative' | 'creative' | 'administrative';
  dueDate?: string;
}

interface ScoredTask {
  id: string;
  title: string;
  score: number;
  factors: {
    urgency: number;
    importance: number;
    effort: number;
    adhd_compatibility: number;
  };
  recommendation: string;
}

// Default timeout for API calls (60 seconds - increased from 30s to handle slow backend)
const API_TIMEOUT_MS = 60000;

// Subscription tier-based batch limits (matching backend gemini-ai-service.js)
// Backend uses different models: Flash for extraction (2000 RPM), Pro for conversion/scoring (1000 RPM)
const BATCH_LIMITS = {
  FREE: {
    // Extraction (Flash model - 15 RPM for free tier)
    extractionBatchSize: 3,
    extractionConcurrent: 1,
    // Conversion (Pro model - 15 RPM for free tier)
    conversionBatchSize: 3,
    conversionConcurrent: 1,
    // Scoring (Pro model - can handle larger batches, 500 per batch on backend)
    scoringBatchSize: 50,    // Backend supports 500, but start smaller for free
    scoringConcurrent: 1,
  },
  PREMIUM: {
    // Extraction (Flash model - 2000 RPM)
    extractionBatchSize: 10,
    extractionConcurrent: 20,    // Flash: 2000 RPM / 60s = ~33/s, safe at 20
    // Conversion (Pro model - 1000 RPM)
    conversionBatchSize: 5,
    conversionConcurrent: 10,    // Pro: 1000 RPM / 60s = ~16/s, safe at 10
    // Scoring (Pro model - maximize batch size, minimize parallelism)
    scoringBatchSize: 500,       // Backend supports up to 500 per batch
    scoringConcurrent: 3,        // Only parallelize if > 500 tasks
  },
  PRO: {
    // Extraction (Flash model - 2000 RPM)
    extractionBatchSize: 10,
    extractionConcurrent: 25,    // Flash: 2000 RPM / 60s = ~33/s, safe at 25
    // Conversion (Pro model - 1000 RPM)
    conversionBatchSize: 5,
    conversionConcurrent: 15,    // Pro: 1000 RPM / 60s = ~16/s, safe at 15
    // Scoring (Pro model - maximize batch size, minimize parallelism)
    scoringBatchSize: 500,       // Backend supports up to 500 per batch
    scoringConcurrent: 5,        // Only parallelize if > 500 tasks
  },
};

export class AiDDBackendClient extends EventEmitter {
  private baseUrl = 'https://aidd-backend-prod-739193356129.us-central1.run.app';
  private apiKey = 'dev-api-key-123456';
  private deviceToken?: string;
  private refreshToken?: string;
  private userId?: string;
  private authManager: AuthManager;
  private useUserAuth: boolean = false;
  private oauthToken?: string;
  // CRITICAL: Cached device ID to ensure consistency across all API calls
  // This prevents the issue where job creation and job status checks use different device IDs
  private cachedDeviceId?: string;
  private subscriptionTier: 'FREE' | 'PREMIUM' | 'PRO' = 'FREE';

  // Helper to wrap fetch with timeout to prevent indefinite hanging
  private async fetchWithTimeout(url: string, options: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number } = {}): Promise<any> {
    const { timeout = API_TIMEOUT_MS, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      } as any);
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  constructor(oauthToken?: string) {
    super();
    this.oauthToken = oauthToken;
    this.authManager = new AuthManager();
    if (oauthToken) {
      this.useUserAuth = true;
      this.deviceToken = oauthToken;
      console.log('Using OAuth token from web connector');
    } else {
      this.checkUserAuth();
    }
  }

  private async checkUserAuth(): Promise<void> {
    this.useUserAuth = this.authManager.isSignedIn();
    if (this.useUserAuth) {
      const userInfo = this.authManager.getUserInfo();
      this.userId = userInfo.userId;
      // Get subscription tier from user info if available
      if (userInfo.subscription) {
        this.subscriptionTier = userInfo.subscription.toUpperCase() as 'FREE' | 'PREMIUM' | 'PRO';
      }
      this.emit('userAuthenticated', userInfo);
    }
  }

  // Get batch limits based on subscription tier
  private getBatchLimits(): typeof BATCH_LIMITS.FREE {
    return BATCH_LIMITS[this.subscriptionTier] || BATCH_LIMITS.FREE;
  }

  // Public getter for subscription tier - used by MCP server for auto-scoring decisions
  getSubscriptionTier(): 'FREE' | 'PREMIUM' | 'PRO' {
    return this.subscriptionTier;
  }

  // Check if user has paid subscription (PREMIUM or PRO)
  isPaidUser(): boolean {
    return this.subscriptionTier === 'PREMIUM' || this.subscriptionTier === 'PRO';
  }

  // Fetch and cache subscription tier from backend
  private async fetchSubscriptionTier(): Promise<void> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/subscription/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000, // Short timeout - don't block on this
      });
      if (response.ok) {
        const data = await response.json() as { tier?: string };
        if (data.tier) {
          const tier = data.tier.toUpperCase();
          if (tier === 'FREE' || tier === 'PREMIUM' || tier === 'PRO') {
            this.subscriptionTier = tier;
            const limits = this.getBatchLimits();
            console.log(`[MCP] Subscription tier: ${this.subscriptionTier} (extraction: ${limits.extractionConcurrent}, conversion: ${limits.conversionConcurrent}, scoring: ${limits.scoringConcurrent})`);
          }
        }
      }
    } catch (error) {
      // Silently fail - use FREE tier limits by default
      console.log('[MCP] Could not fetch subscription tier, using FREE tier limits');
    }
  }

  async authenticate(deviceId?: string): Promise<boolean> {
    try {
      await this.checkUserAuth();
      if (this.useUserAuth) {
        const token = await this.authManager.getAccessToken();
        if (token) {
          this.deviceToken = token;
          const userInfo = this.authManager.getUserInfo();
          this.userId = userInfo.userId;
          // Set subscription tier from user info
          if (userInfo.subscription) {
            this.subscriptionTier = userInfo.subscription.toUpperCase() as 'FREE' | 'PREMIUM' | 'PRO';
          }
          this.emit('authenticated', {
            userId: userInfo.userId,
            email: userInfo.email,
            subscription: userInfo.subscription,
            authType: 'user'
          });
          console.log(`Authenticated as: ${userInfo.email} (${this.subscriptionTier})`);
          // Fetch subscription tier in background to confirm
          this.fetchSubscriptionTier();
          return true;
        }
      }
      console.log('No user credentials found, using development mode with limited access');
      const devId = deviceId || this.generateDeviceId();
      const response = await fetch(`${this.baseUrl}/api/auth/device`, {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceId: devId,
          deviceName: 'AiDD MCP Client',
          platform: 'macos',
        }),
      });
      if (!response.ok) {
        throw new Error(`Authentication failed: ${response.statusText}`);
      }
      const data = (await response.json()) as DeviceAuthResponse;
      this.deviceToken = data.deviceToken;
      this.refreshToken = data.refreshToken;
      this.userId = data.userId;
      this.emit('authenticated', { userId: data.userId, authType: 'device' });
      // Fetch subscription tier for device auth too
      await this.fetchSubscriptionTier();
      return true;
    } catch (error) {
      this.emit('error', { type: 'auth', error });
      return false;
    }
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    if (this.useUserAuth) {
      if (this.oauthToken) {
        return {
          'Authorization': `Bearer ${this.oauthToken}`,
          'Content-Type': 'application/json',
        };
      }
      const token = await this.authManager.getAccessToken();
      if (token) {
        return {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        };
      }
    }
    return {
      'Authorization': `Bearer ${this.deviceToken}`,
      'X-Device-ID': this.generateDeviceId(),
      'Content-Type': 'application/json',
    };
  }

  async extractActionItems(notes: Array<{ id: string; title: string; content: string }>): Promise<ActionItem[]> {
    if (!this.deviceToken) await this.authenticate();
    const limits = this.getBatchLimits();
    const batchSize = limits.extractionBatchSize;
    const maxConcurrent = limits.extractionConcurrent;

    if (notes.length <= batchSize) return this.extractBatch(notes);

    const batches: Array<{ id: string; title: string; content: string }>[] = [];
    for (let i = 0; i < notes.length; i += batchSize) {
      batches.push(notes.slice(i, i + batchSize));
    }
    console.log(`[MCP] Extracting action items from ${notes.length} notes in ${batches.length} batches (${maxConcurrent} concurrent, tier: ${this.subscriptionTier}, Flash model)`);

    // Process batches in parallel with controlled concurrency (Flash model has higher RPM)
    const allActionItems: ActionItem[] = [];
    for (let i = 0; i < batches.length; i += maxConcurrent) {
      const concurrentBatches = batches.slice(i, i + maxConcurrent);
      console.log(`[MCP] Processing extraction batches ${i + 1}-${Math.min(i + maxConcurrent, batches.length)} of ${batches.length} in parallel`);

      const results = await Promise.allSettled(
        concurrentBatches.map((batch, idx) => {
          console.log(`[MCP] Starting extraction batch ${i + idx + 1}`);
          return this.extractBatch(batch);
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allActionItems.push(...result.value);
        } else {
          console.error(`[MCP] Extraction batch failed:`, result.reason);
        }
      }
    }
    console.log(`[MCP] Extraction batch processing complete. Total action items: ${allActionItems.length}`);
    return allActionItems;
  }

  private async extractBatch(
    notes: Array<{ id: string; title: string; content: string }>,
    onProgress?: (progress: number, message: string) => void
  ): Promise<ActionItem[]> {
    const startTime = Date.now();
    const analytics = getAnalytics();
    let success = false;
    let extractedCount = 0;

    try {
      const deviceId = this.getConsistentDeviceId();
      onProgress?.(5, 'Creating extraction job...');
      const response = await fetch(`${this.baseUrl}/api/ai/extract-action-items`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
        },
        body: JSON.stringify({
          deviceId: deviceId,
          notes: notes.map(note => ({
            id: note.id,
            content: note.content,
            metadata: { title: note.title, source: 'apple-notes' },
          })),
          extractionMode: 'comprehensive',
          includeContext: true,
        }),
      });
      if (!response.ok) throw new Error(`Extraction failed: ${response.statusText}`);
      onProgress?.(10, 'Job created, processing...');
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const result = await this.handleSSEResponse(response, 'extraction');
        extractedCount = result.length;
        success = true;
        return result;
      }
      const jobData = await response.json() as { jobId?: string; actionItems?: ActionItem[] };
      if (jobData.actionItems && jobData.actionItems.length > 0) {
        onProgress?.(100, 'Extraction complete (cached)');
        extractedCount = jobData.actionItems.length;
        success = true;
        return jobData.actionItems;
      }
      if (jobData.jobId) {
        const result = await this.pollJobWithProgress<ActionItem[]>(
          jobData.jobId, deviceId, 'extraction', onProgress, this.parseExtractionResult.bind(this)
        );
        extractedCount = result.length;
        success = true;
        return result;
      }
      success = true;
      return [];
    } catch (error) {
      this.emit('error', { type: 'extraction', error });
      throw error;
    } finally {
      // Track AI extraction analytics (matches Web/iOS ai_extraction_completed event)
      const processingTime = Date.now() - startTime;
      await analytics.trackAIExtraction({
        notes_count: notes.length,
        action_items_extracted: extractedCount,
        model: 'gemini-2.5-flash',
        processing_time: processingTime,
        success: success,
      }, { userId: this.userId });
    }
  }

  private parseExtractionResult(waitResult: any): ActionItem[] | null {
    if (waitResult.actionItems?.length > 0) return waitResult.actionItems;
    if (waitResult.result?.actionItems?.length > 0) return waitResult.result.actionItems;
    if (waitResult.extractions?.length > 0) {
      const allItems = waitResult.extractions.flatMap((e: any) => e.actionItems || []);
      console.log(`[MCP] Extracted ${allItems.length} action items from ${waitResult.extractions.length} extractions`);
      return allItems;
    }
    if (waitResult.result?.extractions?.length > 0) {
      const allItems = waitResult.result.extractions.flatMap((e: any) => e.actionItems || []);
      console.log(`[MCP] Extracted ${allItems.length} action items from ${waitResult.result.extractions.length} extractions`);
      return allItems;
    }
    if (waitResult.status === 'completed') {
      console.warn('Job completed but no actionItems found in result. Full result:', JSON.stringify(waitResult));
      return [];
    }
    return null;
  }

  private parseConversionResult(waitResult: any): ConvertedTask[] | null {
    interface WrappedTask { originalId: string; converted: boolean; task: ConvertedTask; actionItemId?: string; }
    const unwrapTasks = (tasks: Array<WrappedTask | ConvertedTask>): ConvertedTask[] => {
      return tasks.map(t => {
        if ('task' in t && t.task && typeof t.task === 'object') {
          const task = t.task as ConvertedTask;
          const wrapper = t as WrappedTask;
          // CRITICAL FIX: Backend uses 'originalId' for the action item ID, not 'actionItemId'
          // The inner task should have actionItemId, but if not, get it from wrapper's originalId
          if (!task.actionItemId) {
            const wrappedActionItemId = wrapper.actionItemId || wrapper.originalId;
            if (wrappedActionItemId && wrappedActionItemId !== 'unknown') {
              task.actionItemId = wrappedActionItemId;
              console.log(`[MCP] Fixed actionItemId from wrapper: ${wrappedActionItemId}`);
            }
          }
          console.log(`[MCP] Unwrapping task: ${task.title} (actionItemId: ${task.actionItemId || 'MISSING'})`);
          return task;
        }
        return t as ConvertedTask;
      });
    };
    if (waitResult.tasks?.length > 0) {
      const unwrapped = unwrapTasks(waitResult.tasks);
      console.log(`[MCP] Converted ${unwrapped.length} tasks`);
      return unwrapped;
    }
    if (waitResult.result?.tasks?.length > 0) {
      const unwrapped = unwrapTasks(waitResult.result.tasks);
      console.log(`[MCP] Converted ${unwrapped.length} tasks from result`);
      return unwrapped;
    }
    if (waitResult.status === 'completed') {
      console.warn('Job completed but no tasks found in result. Full result:', JSON.stringify(waitResult));
      return [];
    }
    return null;
  }

  private async pollJobWithProgress<T>(
    jobId: string, deviceId: string, operationType: string,
    onProgress?: (progress: number, message: string) => void,
    resultParser?: (result: any) => T | null
  ): Promise<T> {
    const POLL_INTERVAL_MS = 10000;
    const MAX_POLLS = 28;
    const POLL_TIMEOUT_MS = 8000;
    let pollCount = 0;
    let lastStatus = '';
    while (pollCount < MAX_POLLS) {
      pollCount++;
      const progressPercent = Math.min(10 + (pollCount * 7), 95);
      onProgress?.(progressPercent, `Processing ${operationType}... (poll ${pollCount}/${MAX_POLLS})`);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
        const pollResponse = await fetch(
          `${this.baseUrl}/api/ai/jobs/${jobId}/wait?timeout=${POLL_TIMEOUT_MS / 1000}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.deviceToken}`,
              'Content-Type': 'application/json',
              'X-Device-ID': deviceId,
            },
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);
        if (!pollResponse.ok) {
          console.warn(`[MCP] Poll ${pollCount} failed: ${pollResponse.statusText}`);
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
          continue;
        }
        const pollResult = await pollResponse.json() as any;
        lastStatus = pollResult.status || 'unknown';
        console.log(`[MCP] Poll ${pollCount}/${MAX_POLLS} for ${operationType} job ${jobId}: status=${lastStatus}`);
        if (lastStatus === 'completed') {
          onProgress?.(100, `${operationType} complete!`);
          if (resultParser) {
            const parsed = resultParser(pollResult);
            if (parsed !== null) return parsed;
          }
          return pollResult as T;
        }
        if (lastStatus === 'failed' || lastStatus === 'error') {
          throw new Error(`Job failed: ${pollResult.error || 'Unknown error'}`);
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log(`[MCP] Poll ${pollCount} timed out, continuing...`);
          continue;
        }
        throw error;
      }
    }
    throw new Error(`Job ${jobId} did not complete within ${MAX_POLLS * POLL_INTERVAL_MS / 1000} seconds. Last status: ${lastStatus}`);
  }

  async convertToTasks(actionItems: ActionItem[]): Promise<ConvertedTask[]> {
    if (!this.deviceToken) await this.authenticate();
    const limits = this.getBatchLimits();
    const batchSize = limits.conversionBatchSize;
    const maxConcurrent = limits.conversionConcurrent;

    if (actionItems.length <= batchSize) return this.convertBatch(actionItems);

    const batches: ActionItem[][] = [];
    for (let i = 0; i < actionItems.length; i += batchSize) {
      batches.push(actionItems.slice(i, i + batchSize));
    }
    console.log(`[MCP] Processing ${actionItems.length} action items in ${batches.length} batches (${maxConcurrent} concurrent, tier: ${this.subscriptionTier}, Pro model)`);

    // Process batches in parallel with controlled concurrency (Pro model has 1000 RPM)
    const allTasks: ConvertedTask[] = [];
    for (let i = 0; i < batches.length; i += maxConcurrent) {
      const concurrentBatches = batches.slice(i, i + maxConcurrent);
      console.log(`[MCP] Processing conversion batches ${i + 1}-${Math.min(i + maxConcurrent, batches.length)} of ${batches.length} in parallel`);

      const results = await Promise.allSettled(
        concurrentBatches.map((batch, idx) => {
          console.log(`[MCP] Starting conversion batch ${i + idx + 1}`);
          return this.convertBatch(batch);
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allTasks.push(...result.value);
        } else {
          console.error(`[MCP] Conversion batch failed:`, result.reason);
        }
      }
    }
    console.log(`[MCP] Batch processing complete. Total tasks: ${allTasks.length}`);
    return allTasks;
  }

  /**
   * Convert action items to tasks and return full metadata including savedCount and auto-scoring info
   * FIX: This replaces convertToTasks + saveTasks to prevent duplicate saves
   * Backend auto-saves tasks via saveTasksToFirestore(), so MCP should NOT call saveTasks() separately
   */
  async convertToTasksWithMetadata(
    actionItems: ActionItem[],
    skipAutoScoring: boolean = false
  ): Promise<{
    tasks: ConvertedTask[];
    savedCount: number;
    autoScoringJobId?: string;
    autoScoringTaskCount?: number;
  }> {
    if (!this.deviceToken) await this.authenticate();
    const deviceId = this.getConsistentDeviceId();
    console.log(`[MCP] Converting ${actionItems.length} action items with metadata, skipAutoScoring=${skipAutoScoring}`);

    try {
      const response = await fetch(`${this.baseUrl}/api/ai/convert-action-items`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
          'X-MCP-Client': 'true', // Mark as MCP for proper source detection
        },
        body: JSON.stringify({
          deviceId: deviceId,
          actionItems,
          conversionMode: 'adhd-optimized',
          breakdownComplexTasks: true,
          maxTasksPerItem: 5,
          skipAutoScoring: skipAutoScoring,
          source: 'mcp', // Explicitly set source for auto-scoring rules
        }),
      });

      if (!response.ok) throw new Error(`Conversion failed: ${response.statusText}`);

      const jobData = await response.json() as { jobId?: string; tasks?: ConvertedTask[] };

      if (jobData.tasks && jobData.tasks.length > 0) {
        // Immediate result (cached or fast response)
        return {
          tasks: jobData.tasks,
          savedCount: jobData.tasks.length,
        };
      }

      if (jobData.jobId) {
        // Poll for job completion and get full result with metadata
        const result = await this.pollJobForFullResult(jobData.jobId, deviceId);
        return result;
      }

      return { tasks: [], savedCount: 0 };
    } catch (error) {
      this.emit('error', { type: 'conversionWithMetadata', error });
      throw error;
    }
  }

  /**
   * Poll job and return full result with metadata (savedCount, autoScoringJobId, etc.)
   */
  private async pollJobForFullResult(
    jobId: string,
    deviceId: string
  ): Promise<{
    tasks: ConvertedTask[];
    savedCount: number;
    autoScoringJobId?: string;
    autoScoringTaskCount?: number;
  }> {
    const MAX_POLLS = 60;
    const POLL_INTERVAL_MS = 2000;
    let lastStatus = '';

    for (let i = 0; i < MAX_POLLS; i++) {
      try {
        const statusResponse = await fetch(`${this.baseUrl}/api/ai/job/${jobId}`, {
          headers: {
            'Authorization': `Bearer ${this.deviceToken}`,
            'X-Device-ID': deviceId,
          },
        });

        if (!statusResponse.ok) {
          throw new Error(`Job status check failed: ${statusResponse.statusText}`);
        }

        const status = await statusResponse.json() as any;
        lastStatus = status.status;

        if (status.status === 'completed' && status.result) {
          const tasks = this.parseConversionResult(status.result) || [];
          return {
            tasks,
            savedCount: status.result.savedCount || (status.result.autoSaved ? tasks.length : 0),
            autoScoringJobId: status.result.autoScoringJobId,
            autoScoringTaskCount: status.result.autoScoringTaskCount,
          };
        }

        if (status.status === 'failed') {
          throw new Error(status.error || 'Job failed');
        }

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      } catch (error) {
        if (i === MAX_POLLS - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }

    throw new Error(`Job ${jobId} timed out after ${MAX_POLLS * POLL_INTERVAL_MS / 1000} seconds. Last status: ${lastStatus}`);
  }

  private async convertBatch(
    actionItems: ActionItem[],
    onProgress?: (progress: number, message: string) => void
  ): Promise<ConvertedTask[]> {
    const startTime = Date.now();
    const analytics = getAnalytics();
    let success = false;
    let tasksGenerated = 0;

    try {
      const deviceId = this.getConsistentDeviceId();
      onProgress?.(5, 'Creating conversion job...');
      const response = await fetch(`${this.baseUrl}/api/ai/convert-action-items`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
        },
        body: JSON.stringify({
          deviceId: deviceId,
          actionItems,
          conversionMode: 'adhd-optimized',
          breakdownComplexTasks: true,
          maxTasksPerItem: 5,
        }),
      });
      if (!response.ok) throw new Error(`Conversion failed: ${response.statusText}`);
      onProgress?.(10, 'Job created, processing...');
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const result = await this.handleSSEResponse(response, 'conversion');
        tasksGenerated = result.length;
        success = true;
        return result;
      }
      const jobData = await response.json() as { jobId?: string; tasks?: ConvertedTask[] };
      if (jobData.tasks && jobData.tasks.length > 0) {
        onProgress?.(100, 'Conversion complete (cached)');
        tasksGenerated = jobData.tasks.length;
        success = true;
        return jobData.tasks;
      }
      if (jobData.jobId) {
        const result = await this.pollJobWithProgress<ConvertedTask[]>(
          jobData.jobId, deviceId, 'conversion', onProgress, this.parseConversionResult.bind(this)
        );
        tasksGenerated = result.length;
        success = true;
        return result;
      }
      success = true;
      return [];
    } catch (error) {
      this.emit('error', { type: 'conversion', error });
      throw error;
    } finally {
      // Track AI conversion analytics (matches Web/iOS ai_conversion_completed event)
      const processingTime = Date.now() - startTime;
      await analytics.trackAIConversion({
        action_items_count: actionItems.length,
        tasks_generated: tasksGenerated,
        model: 'gemini-3-pro-preview',
        processing_time: processingTime,
        success: success,
      }, { userId: this.userId });
    }
  }

  async startScoringJobAsync(tasks: ConvertedTask[]): Promise<{ jobId: string; taskCount: number }> {
    if (!this.deviceToken) await this.authenticate();
    const deviceId = this.getConsistentDeviceId();
    const tasksToScore = tasks.map(task => ({
      id: (task as any).id || crypto.randomUUID(),
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      estimatedTime: task.estimatedTime,
      energyRequired: task.energyRequired,
      tags: task.tags,
      taskType: task.taskType,
    }));
    console.log('[MCP] Starting async scoring for', tasksToScore.length, 'tasks');
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/ai/score-tasks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
        },
        body: JSON.stringify({
          deviceId: deviceId,
          tasks: tasksToScore,
          scoringFactors: { considerADHD: true, timeOfDay: new Date().getHours(), energyLevel: 'medium' },
        }),
      });
      if (!response.ok) throw new Error(`Scoring failed: ${response.statusText}`);
      const jobData = await response.json() as { jobId?: string };
      if (!jobData.jobId) throw new Error('No jobId returned from scoring endpoint');
      return { jobId: jobData.jobId, taskCount: tasksToScore.length };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out while starting scoring job - backend may be slow or unreachable');
      }
      throw error;
    }
  }

  async startConversionJobAsync(actionItems: ActionItem[], skipAutoScoring: boolean = false): Promise<{ jobId: string; actionItemCount: number }> {
    if (!this.deviceToken) await this.authenticate();
    const deviceId = this.getConsistentDeviceId();
    console.log('[MCP] Starting async conversion for', actionItems.length, 'action items, skipAutoScoring=', skipAutoScoring);
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/ai/convert-action-items`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
        },
        body: JSON.stringify({
          deviceId: deviceId,
          actionItems,
          conversionMode: 'adhd-optimized',
          breakdownComplexTasks: true,
          maxTasksPerItem: 5,
          skipAutoScoring: skipAutoScoring,
        }),
      });
      if (!response.ok) throw new Error(`Conversion failed: ${response.statusText}`);
      const jobData = await response.json() as { jobId?: string };
      if (!jobData.jobId) throw new Error('No jobId returned from conversion endpoint');
      return { jobId: jobData.jobId, actionItemCount: actionItems.length };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out while starting conversion job - backend may be slow or unreachable');
      }
      throw error;
    }
  }

  /**
   * Start conversion job using convertAll flag - backend fetches action items directly
   * This is MUCH faster than fetching action items client-side first
   * @param skipDeduplication - If true, skips checking for already-converted items (faster but may create duplicates)
   * @param skipAutoScoring - If true, skips automatic AI scoring after conversion (default: false, scoring runs for paid users)
   */
  async startConversionJobAllAsync(skipDeduplication: boolean = false, skipAutoScoring: boolean = false): Promise<{ jobId: string | null; message: string }> {
    if (!this.deviceToken) await this.authenticate();
    const deviceId = this.getConsistentDeviceId();
    console.log(`[MCP] Starting async conversion with convertAll=true, skipDeduplication=${skipDeduplication}, skipAutoScoring=${skipAutoScoring}`);
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/ai/convert-action-items`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
        },
        body: JSON.stringify({
          deviceId: deviceId,
          convertAll: true,  // Backend fetches action items from Firestore
          skipDeduplication: skipDeduplication,
          skipAutoScoring: skipAutoScoring,
          conversionMode: 'adhd-optimized',
          breakdownComplexTasks: true,
          maxTasksPerItem: 5,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Conversion failed: ${response.statusText} - ${errorData.message || ''}`);
      }
      const jobData = await response.json() as { jobId?: string | null; message?: string; status?: string };
      // Handle "all already converted" case - jobId will be null but status is "skipped"
      if (jobData.status === 'skipped' && !jobData.jobId) {
        return { jobId: null, message: jobData.message || 'All items already converted' };
      }
      if (!jobData.jobId) throw new Error('No jobId returned from conversion endpoint');
      return { jobId: jobData.jobId, message: jobData.message || 'Conversion started' };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out while starting conversion job - backend may be slow or unreachable');
      }
      throw error;
    }
  }

  async scoreTasks(
    tasks: ConvertedTask[],
    onProgress?: (progress: number, message: string) => void
  ): Promise<ScoredTask[]> {
    if (!this.deviceToken) await this.authenticate();
    const limits = this.getBatchLimits();
    const scoringBatchSize = limits.scoringBatchSize;
    const maxConcurrent = limits.scoringConcurrent;

    // For scoring, we want ALL tasks in one batch (up to 500) for relative scoring
    // Only split into batches if we exceed the limit
    if (tasks.length <= scoringBatchSize) {
      console.log(`[MCP] Scoring ${tasks.length} tasks in single batch (tier: ${this.subscriptionTier})`);
      return this.scoreBatch(tasks, onProgress);
    }

    // For very large sets, split into batches and parallelize
    const batches: ConvertedTask[][] = [];
    for (let i = 0; i < tasks.length; i += scoringBatchSize) {
      batches.push(tasks.slice(i, i + scoringBatchSize));
    }
    console.log(`[MCP] Scoring ${tasks.length} tasks in ${batches.length} batches of up to ${scoringBatchSize} (${maxConcurrent} concurrent, tier: ${this.subscriptionTier})`);

    const allScoredTasks: ScoredTask[] = [];
    for (let i = 0; i < batches.length; i += maxConcurrent) {
      const concurrentBatches = batches.slice(i, i + maxConcurrent);
      console.log(`[MCP] Processing scoring batches ${i + 1}-${Math.min(i + maxConcurrent, batches.length)} of ${batches.length} in parallel`);

      const results = await Promise.allSettled(
        concurrentBatches.map((batch, idx) => {
          console.log(`[MCP] Starting scoring batch ${i + idx + 1} (${batch.length} tasks)`);
          return this.scoreBatch(batch);
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allScoredTasks.push(...result.value);
        } else {
          console.error(`[MCP] Scoring batch failed:`, result.reason);
        }
      }
    }

    // Sort all results by score for final ordering
    allScoredTasks.sort((a, b) => b.score - a.score);
    console.log(`[MCP] Scoring complete. Total scored tasks: ${allScoredTasks.length}`);
    return allScoredTasks;
  }

  private async scoreBatch(
    tasks: ConvertedTask[],
    onProgress?: (progress: number, message: string) => void
  ): Promise<ScoredTask[]> {
    const startTime = Date.now();
    const analytics = getAnalytics();
    let success = false;

    try {
      const deviceId = this.getConsistentDeviceId();
      onProgress?.(5, 'Preparing tasks for scoring...');
      const taskIdMap = new Map<string, any>();
      const tasksToScore = tasks.map(task => {
        const taskId = (task as any).id || crypto.randomUUID();
        taskIdMap.set(taskId, task);
        return {
          id: taskId,
          title: task.title,
          description: task.description,
          dueDate: task.dueDate,
          estimatedTime: task.estimatedTime,
          energyRequired: task.energyRequired,
          tags: task.tags,
          taskType: task.taskType,
        };
      });
      console.log('[MCP] Scoring batch:', tasksToScore.length, 'tasks');
      onProgress?.(10, 'Creating scoring job...');
      const response = await fetch(`${this.baseUrl}/api/ai/score-tasks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
        },
        body: JSON.stringify({
          deviceId: deviceId,
          tasks: tasksToScore,
          scoringFactors: { considerADHD: true, timeOfDay: new Date().getHours(), energyLevel: 'medium' },
        }),
      });
      if (!response.ok) throw new Error(`Scoring failed: ${response.statusText}`);
      onProgress?.(15, 'Job created, processing...');
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const result = await this.handleSSEResponse(response, 'scoring');
        success = true;
        return result;
      }
      const jobData = await response.json() as { jobId?: string; scoredTasks?: ScoredTask[] };
      if (jobData.scoredTasks && jobData.scoredTasks.length > 0) {
        onProgress?.(100, 'Scoring complete (cached)');
        success = true;
        return jobData.scoredTasks;
      }
      if (jobData.jobId) {
        const scoringParser = (waitResult: any): ScoredTask[] | null => {
          return this.parseScoringResult(waitResult, taskIdMap);
        };
        const result = await this.pollJobWithProgress<ScoredTask[]>(
          jobData.jobId, deviceId, 'scoring', onProgress, scoringParser
        );
        success = true;
        return result;
      }
      success = true;
      return [];
    } catch (error) {
      this.emit('error', { type: 'scoring', error });
      throw error;
    } finally {
      // Track AI scoring analytics (matches Web/iOS ai_scoring_completed event)
      const processingTime = Date.now() - startTime;
      await analytics.trackAIScoring({
        tasks_count: tasks.length,
        model: 'gemini-3-pro-preview',
        processing_time: processingTime,
        success: success,
      }, { userId: this.userId });
    }
  }

  private parseScoringResult(waitResult: any, taskIdMap: Map<string, any>): ScoredTask[] | null {
    if (waitResult.scoredTasks) return waitResult.scoredTasks;
    if (waitResult.result?.scoredTasks) return waitResult.result.scoredTasks;
    if (waitResult.status === 'completed' && waitResult.result?.scores) {
      const scores = waitResult.result.scores;
      const scoredTasks: ScoredTask[] = [];
      console.log('[MCP] Received scores for task IDs:', Object.keys(scores));
      console.log('[MCP] taskIdMap has IDs:', Array.from(taskIdMap.keys()));
      for (const [taskId, scoreData] of Object.entries(scores)) {
        const originalTask = taskIdMap.get(taskId);
        const typedScoreData = scoreData as { urgency: number; impact: number; relevance: number; energy: number };
        const overallScore = Math.round((typedScoreData.urgency + typedScoreData.impact + typedScoreData.relevance) / 3);
        console.log(`[MCP] Task ${taskId}: urgency=${typedScoreData.urgency}, impact=${typedScoreData.impact}, relevance=${typedScoreData.relevance}, overall=${overallScore}`);
        scoredTasks.push({
          id: taskId,
          title: originalTask?.title || `Task ${taskId}`,
          score: overallScore,
          factors: {
            urgency: Math.round(typedScoreData.urgency / 10),
            importance: Math.round(typedScoreData.impact / 10),
            effort: Math.round(typedScoreData.energy),
            adhd_compatibility: Math.round((100 - typedScoreData.energy * 20) / 10),
          },
          recommendation: overallScore >= 70 ? 'High priority - tackle this soon!'
            : overallScore >= 40 ? 'Medium priority - schedule when ready' : 'Lower priority - can wait',
        });
      }
      scoredTasks.sort((a, b) => b.score - a.score);
      return scoredTasks;
    }
    if (waitResult.status === 'completed') {
      console.warn('Job completed but no scores found in result');
      return [];
    }
    return null;
  }

  async syncTasks(tasks: ConvertedTask[], targetService: string): Promise<boolean> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const response = await fetch(`${this.baseUrl}/api/sync/tasks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tasks,
          targetService,
          syncMode: 'merge',
          createBackup: true,
        }),
      });
      if (!response.ok) throw new Error(`Sync failed: ${response.statusText}`);
      const data = await response.json() as { success?: boolean };
      this.emit('syncComplete', { service: targetService, count: tasks.length });
      return data.success || false;
    } catch (error) {
      this.emit('error', { type: 'sync', error });
      throw error;
    }
  }

  private async handleSSEResponse(response: any, operation: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      let buffer = '';
      response.body.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'progress') {
                this.emit('progress', { operation, progress: data.progress, message: data.message });
              } else if (data.type === 'result') {
                results.push(data.data);
              } else if (data.type === 'complete') {
                resolve(results);
              } else if (data.type === 'error') {
                reject(new Error(data.message));
              }
            } catch (e) {}
          }
        }
      });
      response.body.on('end', () => { resolve(results.length > 0 ? results : []); });
      response.body.on('error', (error: Error) => { reject(error); });
    });
  }

  private generateDeviceId(): string {
    // CRITICAL: Cache the device ID to ensure consistency across all API calls
    // Without caching, each call generates a NEW random UUID, causing:
    // - Jobs created with one device ID to be invisible when checked with another
    // - "Stale" job status showing 5% when backend shows 100% completed
    if (!this.cachedDeviceId) {
      this.cachedDeviceId = `claude-mcp-${crypto.randomUUID()}`;
      console.log(`[MCP] Generated and cached device ID: ${this.cachedDeviceId}`);
    }
    return this.cachedDeviceId;
  }

  // CRITICAL: Get a consistent device ID for all API calls
  // This ensures job creation and job status checks use the SAME device ID
  private getConsistentDeviceId(): string {
    // If user is authenticated, use their stable user-based ID
    if (this.userId) {
      return `mcp-web-${this.userId}`;
    }
    // Otherwise, use the cached random device ID (generated once per session)
    return this.generateDeviceId();
  }

  async refreshAuth(): Promise<boolean> {
    if (!this.refreshToken) return this.authenticate();
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!response.ok) return this.authenticate();
      const data = await response.json() as { deviceToken?: string };
      this.deviceToken = data.deviceToken;
      return true;
    } catch (error) {
      return this.authenticate();
    }
  }

  // CRUD METHODS FOR NOTES, ACTION ITEMS, AND TASKS

  async listNotes(options: { sortBy?: string; order?: string; limit?: number; offset?: number } = {}): Promise<any[]> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const params = new URLSearchParams();
      if (options.sortBy) params.append('sortBy', options.sortBy);
      if (options.order) params.append('order', options.order);
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.offset) params.append('offset', options.offset.toString());
      const response = await fetch(`${this.baseUrl}/api/notes?${params.toString()}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to list notes: ${response.statusText}`);
      const data = await response.json() as { notes?: any[] };
      return data.notes || [];
    } catch (error) {
      this.emit('error', { type: 'listNotes', error });
      throw error;
    }
  }

  async readNote(noteId: string): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const response = await fetch(`${this.baseUrl}/api/notes/${noteId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to read note: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'readNote', error });
      throw error;
    }
  }

  async createNote(note: { title: string; content: string; tags?: string[]; category?: string }): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const response = await fetch(`${this.baseUrl}/api/notes`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
      });
      if (!response.ok) throw new Error(`Failed to create note: ${response.statusText}`);
      const createdNote = await response.json();
      this.emit('noteCreated', createdNote);
      return createdNote;
    } catch (error) {
      this.emit('error', { type: 'createNote', error });
      throw error;
    }
  }

  async listActionItems(options: { sortBy?: string; order?: string; limit?: number; offset?: number } = {}): Promise<ActionItem[]> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const params = new URLSearchParams();
      if (options.sortBy) params.append('sortBy', options.sortBy);
      if (options.order) params.append('order', options.order);
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.offset) params.append('offset', options.offset.toString());
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/actionItems?${params.toString()}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to list action items: ${response.statusText}`);
      const data = await response.json() as { actionItems?: ActionItem[] };
      return data.actionItems || [];
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out while listing action items - backend may be slow or unreachable');
      }
      this.emit('error', { type: 'listActionItems', error });
      throw error;
    }
  }

  async readActionItem(actionItemId: string): Promise<ActionItem> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const response = await fetch(`${this.baseUrl}/api/actionItems/${actionItemId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to read action item: ${response.statusText}`);
      return await response.json() as ActionItem;
    } catch (error) {
      this.emit('error', { type: 'readActionItem', error });
      throw error;
    }
  }

  async listTasks(options: { sortBy?: string; order?: string; limit?: number; offset?: number } = {}): Promise<any[]> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const params = new URLSearchParams();
      if (options.sortBy) params.append('sortBy', options.sortBy);
      if (options.order) params.append('order', options.order);
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.offset) params.append('offset', options.offset.toString());
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/tasks?${params.toString()}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to list tasks: ${response.statusText}`);
      const data = await response.json() as { tasks?: any[] };
      return data.tasks || [];
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out while listing tasks - backend may be slow or unreachable');
      }
      this.emit('error', { type: 'listTasks', error });
      throw error;
    }
  }

  async readTask(taskId: string): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to read task: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'readTask', error });
      throw error;
    }
  }

  // PAGINATION-AWARE LIST METHODS
  // These return total counts so callers know when to paginate

  async listTasksWithPagination(options: {
    sortBy?: string;
    order?: string;
    limit?: number;
    offset?: number;
    // Filters
    category?: string;
    tags?: string;
    maxTimeMinutes?: number;
    maxEnergy?: string;
    onlyAIScored?: boolean;
    dueWithinDays?: number;
    includeCompleted?: boolean;
  } = {}): Promise<PaginatedResponse<any>> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const limit = options.limit || 100;
      const offset = options.offset || 0;
      const params = new URLSearchParams();
      if (options.sortBy) params.append('sortBy', options.sortBy);
      if (options.order) params.append('order', options.order);
      params.append('limit', limit.toString());
      params.append('offset', offset.toString());
      // Add filter parameters
      if (options.category) params.append('category', options.category);
      if (options.tags) params.append('tags', options.tags);
      if (options.maxTimeMinutes !== undefined) params.append('maxTimeMinutes', options.maxTimeMinutes.toString());
      if (options.maxEnergy) params.append('maxEnergy', options.maxEnergy);
      if (options.onlyAIScored) params.append('onlyAIScored', 'true');
      if (options.dueWithinDays !== undefined) params.append('dueWithinDays', options.dueWithinDays.toString());
      if (options.includeCompleted) params.append('includeCompleted', 'true');
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/tasks?${params.toString()}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to list tasks: ${response.statusText}`);
      const data = await response.json() as { tasks?: any[]; total?: number };
      const items = data.tasks || [];
      const total = data.total || items.length;
      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out while listing tasks - backend may be slow or unreachable');
      }
      this.emit('error', { type: 'listTasksWithPagination', error });
      throw error;
    }
  }

  async listActionItemsWithPagination(options: { sortBy?: string; order?: string; limit?: number; offset?: number } = {}): Promise<PaginatedResponse<ActionItem>> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const limit = options.limit || 100;
      const offset = options.offset || 0;
      const params = new URLSearchParams();
      if (options.sortBy) params.append('sortBy', options.sortBy);
      if (options.order) params.append('order', options.order);
      params.append('limit', limit.toString());
      params.append('offset', offset.toString());
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/actionItems?${params.toString()}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to list action items: ${response.statusText}`);
      const data = await response.json() as { actionItems?: ActionItem[]; total?: number };
      const items = data.actionItems || [];
      const total = data.total || items.length;
      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out while listing action items - backend may be slow or unreachable');
      }
      this.emit('error', { type: 'listActionItemsWithPagination', error });
      throw error;
    }
  }

  async listNotesWithPagination(options: { sortBy?: string; order?: string; limit?: number; offset?: number } = {}): Promise<PaginatedResponse<any>> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const limit = options.limit || 100;
      const offset = options.offset || 0;
      const params = new URLSearchParams();
      if (options.sortBy) params.append('sortBy', options.sortBy);
      if (options.order) params.append('order', options.order);
      params.append('limit', limit.toString());
      params.append('offset', offset.toString());
      const response = await fetch(`${this.baseUrl}/api/notes?${params.toString()}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to list notes: ${response.statusText}`);
      const data = await response.json() as { notes?: any[]; total?: number };
      const items = data.notes || [];
      const total = data.total || items.length;
      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total
      };
    } catch (error) {
      this.emit('error', { type: 'listNotesWithPagination', error });
      throw error;
    }
  }

  // SAVE/CREATE METHODS FOR PERSISTING AI RESULTS

  async createActionItem(actionItem: Omit<ActionItem, 'id'>): Promise<ActionItem> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const response = await fetch(`${this.baseUrl}/api/actionItems`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(actionItem),
      });
      if (!response.ok) throw new Error(`Failed to create action item: ${response.statusText}`);
      const createdItem = await response.json() as ActionItem;
      this.emit('actionItemCreated', createdItem);
      return createdItem;
    } catch (error) {
      this.emit('error', { type: 'createActionItem', error });
      throw error;
    }
  }

  async saveActionItems(actionItems: ActionItem[]): Promise<{ success: boolean; count: number; actionItems: ActionItem[] }> {
    if (!this.deviceToken) await this.authenticate();
    if (actionItems.length === 0) return { success: true, count: 0, actionItems: [] };
    try {
      const response = await fetch(`${this.baseUrl}/api/actionItems/batch`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionItems }),
      });
      if (!response.ok) throw new Error(`Failed to save action items: ${response.statusText}`);
      const result = await response.json() as { success: boolean; count: number; actionItems: ActionItem[] };
      console.log(`[MCP] Saved ${result.count} action items to backend`);
      this.emit('actionItemsSaved', { count: result.count });
      return result;
    } catch (error) {
      this.emit('error', { type: 'saveActionItems', error });
      throw error;
    }
  }

  async createTask(task: Omit<ConvertedTask, 'id'> & { id?: string }): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const response = await fetch(`${this.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });
      if (!response.ok) throw new Error(`Failed to create task: ${response.statusText}`);
      const createdTask = await response.json();
      this.emit('taskCreated', createdTask);
      return createdTask;
    } catch (error) {
      this.emit('error', { type: 'createTask', error });
      throw error;
    }
  }

  async saveTasks(tasks: ConvertedTask[]): Promise<{ success: boolean; count: number; tasks: any[] }> {
    if (!this.deviceToken) await this.authenticate();
    if (tasks.length === 0) return { success: true, count: 0, tasks: [] };
    try {
      const response = await fetch(`${this.baseUrl}/api/tasks/batch`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks }),
      });
      if (!response.ok) throw new Error(`Failed to save tasks: ${response.statusText}`);
      const result = await response.json() as { success: boolean; count: number; tasks: any[] };
      console.log(`[MCP] Saved ${result.count} tasks to backend`);
      this.emit('tasksSaved', { count: result.count });
      return result;
    } catch (error) {
      this.emit('error', { type: 'saveTasks', error });
      throw error;
    }
  }

  async saveNotes(notes: Array<{ title: string; content: string; tags?: string[]; category?: string }>): Promise<{ success: boolean; count: number; notes: any[] }> {
    if (!this.deviceToken) await this.authenticate();
    if (notes.length === 0) return { success: true, count: 0, notes: [] };
    try {
      const response = await fetch(`${this.baseUrl}/api/notes/batch`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!response.ok) throw new Error(`Failed to save notes: ${response.statusText}`);
      const result = await response.json() as { success: boolean; count: number; notes: any[] };
      console.log(`[MCP] Saved ${result.count} notes to backend`);
      this.emit('notesSaved', { count: result.count });
      return result;
    } catch (error) {
      this.emit('error', { type: 'saveNotes', error });
      throw error;
    }
  }

  // UPDATE AND DELETE METHODS

  async updateNote(noteId: string, updates: { title?: string; content?: string; tags?: string[]; category?: string }): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/notes/${noteId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error(`Failed to update note: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'updateNote', error });
      throw error;
    }
  }

  async deleteNote(noteId: string): Promise<{ success: boolean }> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/notes/${noteId}`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok) throw new Error(`Failed to delete note: ${response.statusText}`);
      return await response.json() as { success: boolean };
    } catch (error) {
      this.emit('error', { type: 'deleteNote', error });
      throw error;
    }
  }

  async deleteNotes(ids: string[]): Promise<{ success: boolean; deletedCount: number }> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/notes/batch-delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error(`Failed to batch delete notes: ${response.statusText}`);
      return await response.json() as { success: boolean; deletedCount: number };
    } catch (error) {
      this.emit('error', { type: 'deleteNotes', error });
      throw error;
    }
  }

  async updateActionItem(actionItemId: string, updates: {
    title?: string;
    description?: string;
    priority?: string;
    dueDate?: string | null;
    tags?: string[];
    category?: string;
    confidence?: number;
    isCompleted?: boolean;
  }): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/actionItems/${actionItemId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error(`Failed to update action item: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'updateActionItem', error });
      throw error;
    }
  }

  async deleteActionItem(actionItemId: string): Promise<{ success: boolean }> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/actionItems/${actionItemId}`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok) throw new Error(`Failed to delete action item: ${response.statusText}`);
      return await response.json() as { success: boolean };
    } catch (error) {
      this.emit('error', { type: 'deleteActionItem', error });
      throw error;
    }
  }

  async deleteActionItems(ids: string[]): Promise<{ success: boolean; deletedCount: number }> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/actionItems/batch-delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error(`Failed to batch delete action items: ${response.statusText}`);
      return await response.json() as { success: boolean; deletedCount: number };
    } catch (error) {
      this.emit('error', { type: 'deleteActionItems', error });
      throw error;
    }
  }

  async updateTask(taskId: string, updates: {
    title?: string;
    description?: string;
    estimatedTime?: number;
    energyRequired?: string;
    taskType?: string;
    dueDate?: string | null;
    tags?: string[];
    score?: number;
    isCompleted?: boolean;
    dependsOnTaskOrders?: number[];
  }): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error(`Failed to update task: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'updateTask', error });
      throw error;
    }
  }

  async deleteTask(taskId: string): Promise<{ success: boolean }> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok) throw new Error(`Failed to delete task: ${response.statusText}`);
      return await response.json() as { success: boolean };
    } catch (error) {
      this.emit('error', { type: 'deleteTask', error });
      throw error;
    }
  }

  async deleteTasks(ids: string[]): Promise<{ success: boolean; deletedCount: number }> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/tasks/batch-delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error(`Failed to batch delete tasks: ${response.statusText}`);
      return await response.json() as { success: boolean; deletedCount: number };
    } catch (error) {
      this.emit('error', { type: 'deleteTasks', error });
      throw error;
    }
  }

  async getSubscriptionStatus(): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/subscription/status`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        console.warn(`[MCP] Subscription status unavailable: ${response.statusText}`);
        return this.getDefaultSubscriptionStatus();
      }
      return await response.json();
    } catch (error) {
      console.error('[MCP] Error fetching subscription status:', error);
      return this.getDefaultSubscriptionStatus();
    }
  }

  private getDefaultSubscriptionStatus(): any {
    const now = new Date();
    const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return {
      tier: 'FREE',
      usage: {
        notesThisMonth: 0,
        extractionsThisMonth: 0,
        conversionsThisMonth: 0,
        scoringThisMonth: 0,
        totalNotesStored: 0,
        resetDate: resetDate.toISOString(),
      },
    };
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json() as { status?: string };
      return data.status === 'healthy';
    } catch (error) {
      return false;
    }
  }

  getUserId(): string | undefined {
    return this.userId;
  }

  async getAuthenticatedUser(): Promise<{ id: string; userId: string; email: string; name: string; subscriptionTier: string }> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/me`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.deviceToken}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to get authenticated user: ${response.statusText}`);
      return await response.json() as { id: string; userId: string; email: string; name: string; subscriptionTier: string };
    } catch (error) {
      this.emit('error', { type: 'getAuthenticatedUser', error });
      throw error;
    }
  }

  // =============================================================================
  // E2E ENCRYPTION METHODS
  // =============================================================================

  /**
   * Get wrapped key data for E2E encryption
   */
  async getE2EWrappedKey(): Promise<any | null> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/e2e/wrapped-key`, {
        method: 'GET',
        headers,
      });
      if (response.status === 404) {
        return null; // No encryption set up
      }
      if (!response.ok) throw new Error(`Failed to get wrapped key: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'getE2EWrappedKey', error });
      throw error;
    }
  }

  /**
   * Setup E2E encryption for the user
   */
  async setupE2EEncryption(password: string): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/e2e/setup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error(`Failed to setup E2E: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'setupE2EEncryption', error });
      throw error;
    }
  }

  /**
   * Check E2E encryption status
   */
  async getE2EStatus(): Promise<{ hasEncryption: boolean; version?: number }> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/e2e/status`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        return { hasEncryption: false };
      }
      return await response.json() as { hasEncryption: boolean; version?: number };
    } catch (error) {
      console.error('[MCP] E2E status check failed:', error);
      return { hasEncryption: false };
    }
  }

  /**
   * Sync tasks with E2E mode (encrypted blobs)
   */
  async syncE2ETasks(encryptedTasks: any[], deletedIds: string[], lastSyncTimestamp?: Date): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/sync/encrypted/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tasks: encryptedTasks,
          deletedIds,
          lastSyncTimestamp: lastSyncTimestamp?.toISOString(),
          e2eMode: true,
        }),
      });
      if (!response.ok) throw new Error(`E2E tasks sync failed: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'syncE2ETasks', error });
      throw error;
    }
  }

  /**
   * Sync action items with E2E mode (encrypted blobs)
   */
  async syncE2EActionItems(encryptedItems: any[], deletedIds: string[], lastSyncTimestamp?: Date): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/sync/encrypted/actionItems`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          actionItems: encryptedItems,
          deletedIds,
          lastSyncTimestamp: lastSyncTimestamp?.toISOString(),
          e2eMode: true,
        }),
      });
      if (!response.ok) throw new Error(`E2E action items sync failed: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'syncE2EActionItems', error });
      throw error;
    }
  }

  /**
   * Sync notes with E2E mode (encrypted blobs)
   */
  async syncE2ENotes(encryptedNotes: any[], deletedIds: string[], lastSyncTimestamp?: Date): Promise<any> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/sync/encrypted/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          notes: encryptedNotes,
          deletedIds,
          lastSyncTimestamp: lastSyncTimestamp?.toISOString(),
          e2eMode: true,
        }),
      });
      if (!response.ok) throw new Error(`E2E notes sync failed: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'syncE2ENotes', error });
      throw error;
    }
  }

  /**
   * Get current access token for E2E operations
   */
  getAccessToken(): string | undefined {
    return this.deviceToken;
  }

  // =============================================================================
  // AI JOB STATUS METHODS
  // =============================================================================

  /**
   * Get status of a specific AI job
   */
  async getJobStatus(jobId: string): Promise<{
    id: string;
    type: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number;
    message?: string;
    result?: any;
    error?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
  }> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      // CRITICAL: Backend requires X-Device-ID header for job endpoints
      const deviceId = this.getConsistentDeviceId();
      (headers as Record<string, string>)['X-Device-ID'] = deviceId;

      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/ai/jobs/${jobId}`, {
        method: 'GET',
        headers: headers as Record<string, string>,
        timeout: 10000,
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Job ${jobId} not found`);
        }
        throw new Error(`Failed to get job status: ${response.statusText}`);
      }
      const data = await response.json() as { success?: boolean; job?: any };
      // Backend returns { success: true, job: {...} } - extract the job object
      return data.job || data;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out while checking job status');
      }
      this.emit('error', { type: 'getJobStatus', error });
      throw error;
    }
  }

  /**
   * List all AI jobs for the current user
   */
  async listJobs(includeCompleted: boolean = false): Promise<Array<{
    id: string;
    type: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number;
    message?: string;
    createdAt: string;
    updatedAt: string;
  }>> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const headers = await this.getAuthHeaders();
      // CRITICAL: Backend requires X-Device-ID header for job endpoints
      const deviceId = this.getConsistentDeviceId();
      (headers as Record<string, string>)['X-Device-ID'] = deviceId;

      const params = new URLSearchParams();
      if (includeCompleted) params.append('includeCompleted', 'true');

      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/ai/jobs?${params.toString()}`, {
        method: 'GET',
        headers: headers as Record<string, string>,
        timeout: 10000,
      });
      if (!response.ok) {
        throw new Error(`Failed to list jobs: ${response.statusText}`);
      }
      const data = await response.json() as { jobs?: any[] };
      return data.jobs || [];
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out while listing jobs');
      }
      this.emit('error', { type: 'listJobs', error });
      throw error;
    }
  }
}