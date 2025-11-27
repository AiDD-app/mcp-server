import fetch from 'node-fetch';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { AuthManager } from './auth-manager.js';

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

// Default timeout for API calls (30 seconds)
const API_TIMEOUT_MS = 30000;

export class AiDDBackendClient extends EventEmitter {
  private baseUrl = 'https://aidd-backend-prod-739193356129.us-central1.run.app';
  private apiKey = 'dev-api-key-123456';
  private deviceToken?: string;
  private refreshToken?: string;
  private userId?: string;
  private authManager: AuthManager;
  private useUserAuth: boolean = false;
  private oauthToken?: string;

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
      this.emit('userAuthenticated', userInfo);
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
          this.emit('authenticated', {
            userId: userInfo.userId,
            email: userInfo.email,
            subscription: userInfo.subscription,
            authType: 'user'
          });
          console.log(`Authenticated as: ${userInfo.email} (${userInfo.subscription || 'FREE'})`);
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
          deviceName: 'Claude Desktop MCP',
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
    const BATCH_SIZE = 3;
    const BATCH_DELAY_MS = 2000;
    if (notes.length <= BATCH_SIZE) return this.extractBatch(notes);
    const allActionItems: ActionItem[] = [];
    const batches: Array<{ id: string; title: string; content: string }>[] = [];
    for (let i = 0; i < notes.length; i += BATCH_SIZE) {
      batches.push(notes.slice(i, i + BATCH_SIZE));
    }
    console.log(`[MCP] Extracting action items from ${notes.length} notes in ${batches.length} batches`);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[MCP] Processing extraction batch ${i + 1}/${batches.length} (${batch.length} notes)`);
      try {
        const actionItems = await this.extractBatch(batch);
        allActionItems.push(...actionItems);
        if (i < batches.length - 1) await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      } catch (error) {
        console.error(`[MCP] Extraction batch ${i + 1} failed:`, error);
      }
    }
    console.log(`[MCP] Extraction batch processing complete. Total action items: ${allActionItems.length}`);
    return allActionItems;
  }

  private async extractBatch(
    notes: Array<{ id: string; title: string; content: string }>,
    onProgress?: (progress: number, message: string) => void
  ): Promise<ActionItem[]> {
    try {
      const deviceId = this.userId ? `mcp-web-${this.userId}` : this.generateDeviceId();
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
        return await this.handleSSEResponse(response, 'extraction');
      }
      const jobData = await response.json() as { jobId?: string; actionItems?: ActionItem[] };
      if (jobData.actionItems && jobData.actionItems.length > 0) {
        onProgress?.(100, 'Extraction complete (cached)');
        return jobData.actionItems;
      }
      if (jobData.jobId) {
        return await this.pollJobWithProgress<ActionItem[]>(
          jobData.jobId, deviceId, 'extraction', onProgress, this.parseExtractionResult.bind(this)
        );
      }
      return [];
    } catch (error) {
      this.emit('error', { type: 'extraction', error });
      throw error;
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
    interface WrappedTask { originalId: string; converted: boolean; task: ConvertedTask; }
    const unwrapTasks = (tasks: Array<WrappedTask | ConvertedTask>): ConvertedTask[] => {
      return tasks.map(t => {
        if ('task' in t && t.task && typeof t.task === 'object') {
          console.log(`[MCP] Unwrapping task: ${(t.task as ConvertedTask).title}`);
          return t.task as ConvertedTask;
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
    const BATCH_SIZE = 3;
    const BATCH_DELAY_MS = 2000;
    if (actionItems.length <= BATCH_SIZE) return this.convertBatch(actionItems);
    const allTasks: ConvertedTask[] = [];
    const batches: ActionItem[][] = [];
    for (let i = 0; i < actionItems.length; i += BATCH_SIZE) {
      batches.push(actionItems.slice(i, i + BATCH_SIZE));
    }
    console.log(`[MCP] Processing ${actionItems.length} action items in ${batches.length} batches`);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[MCP] Processing batch ${i + 1}/${batches.length} (${batch.length} items)`);
      try {
        const tasks = await this.convertBatch(batch);
        allTasks.push(...tasks);
        if (i < batches.length - 1) await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      } catch (error) {
        console.error(`[MCP] Batch ${i + 1} failed:`, error);
      }
    }
    console.log(`[MCP] Batch processing complete. Total tasks: ${allTasks.length}`);
    return allTasks;
  }

  private async convertBatch(
    actionItems: ActionItem[],
    onProgress?: (progress: number, message: string) => void
  ): Promise<ConvertedTask[]> {
    try {
      const deviceId = this.userId ? `mcp-web-${this.userId}` : this.generateDeviceId();
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
        return await this.handleSSEResponse(response, 'conversion');
      }
      const jobData = await response.json() as { jobId?: string; tasks?: ConvertedTask[] };
      if (jobData.tasks && jobData.tasks.length > 0) {
        onProgress?.(100, 'Conversion complete (cached)');
        return jobData.tasks;
      }
      if (jobData.jobId) {
        return await this.pollJobWithProgress<ConvertedTask[]>(
          jobData.jobId, deviceId, 'conversion', onProgress, this.parseConversionResult.bind(this)
        );
      }
      return [];
    } catch (error) {
      this.emit('error', { type: 'conversion', error });
      throw error;
    }
  }

  async startScoringJobAsync(tasks: ConvertedTask[]): Promise<{ jobId: string; taskCount: number }> {
    if (!this.deviceToken) await this.authenticate();
    const deviceId = this.userId ? `mcp-web-${this.userId}` : this.generateDeviceId();
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

  async startConversionJobAsync(actionItems: ActionItem[]): Promise<{ jobId: string; actionItemCount: number }> {
    if (!this.deviceToken) await this.authenticate();
    const deviceId = this.userId ? `mcp-web-${this.userId}` : this.generateDeviceId();
    console.log('[MCP] Starting async conversion for', actionItems.length, 'action items');
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

  async scoreTasks(
    tasks: ConvertedTask[],
    onProgress?: (progress: number, message: string) => void
  ): Promise<ScoredTask[]> {
    if (!this.deviceToken) await this.authenticate();
    try {
      const deviceId = this.userId ? `mcp-web-${this.userId}` : this.generateDeviceId();
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
      console.log('[MCP] Scoring tasks:', tasksToScore.map(t => ({ id: t.id, title: t.title })));
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
        return await this.handleSSEResponse(response, 'scoring');
      }
      const jobData = await response.json() as { jobId?: string; scoredTasks?: ScoredTask[] };
      if (jobData.scoredTasks && jobData.scoredTasks.length > 0) {
        onProgress?.(100, 'Scoring complete (cached)');
        return jobData.scoredTasks;
      }
      if (jobData.jobId) {
        const scoringParser = (waitResult: any): ScoredTask[] | null => {
          return this.parseScoringResult(waitResult, taskIdMap);
        };
        return await this.pollJobWithProgress<ScoredTask[]>(
          jobData.jobId, deviceId, 'scoring', onProgress, scoringParser
        );
      }
      return [];
    } catch (error) {
      this.emit('error', { type: 'scoring', error });
      throw error;
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
    return `claude-mcp-${crypto.randomUUID()}`;
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
}