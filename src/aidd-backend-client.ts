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

export class AiDDBackendClient extends EventEmitter {
  private baseUrl = 'https://aidd-backend-prod-739193356129.us-central1.run.app';
  private apiKey = 'dev-api-key-123456'; // Fallback for dev mode
  private deviceToken?: string;
  private refreshToken?: string;
  private userId?: string;
  private authManager: AuthManager;
  private useUserAuth: boolean = false;
  private oauthToken?: string;

  constructor(oauthToken?: string) {
    super();
    this.oauthToken = oauthToken;
    this.authManager = new AuthManager();

    // If OAuth token is provided (web connector mode), use it directly
    if (oauthToken) {
      this.useUserAuth = true;
      this.deviceToken = oauthToken;
      console.log('🔑 Using OAuth token from web connector');
    } else {
      // Desktop mode - check local credentials
      this.checkUserAuth();
    }
  }

  /**
   * Check if user is authenticated
   */
  private async checkUserAuth(): Promise<void> {
    this.useUserAuth = this.authManager.isSignedIn();
    if (this.useUserAuth) {
      const userInfo = this.authManager.getUserInfo();
      this.userId = userInfo.userId;
      this.emit('userAuthenticated', userInfo);
    }
  }

  /**
   * Authenticate with the AiDD backend
   */
  async authenticate(deviceId?: string): Promise<boolean> {
    try {
      // Check if user is signed in first
      await this.checkUserAuth();

      if (this.useUserAuth) {
        // User is signed in, use their credentials
        const token = await this.authManager.getAccessToken();
        if (token) {
          this.deviceToken = token; // Use access token as auth token
          const userInfo = this.authManager.getUserInfo();
          this.userId = userInfo.userId;

          this.emit('authenticated', {
            userId: userInfo.userId,
            email: userInfo.email,
            subscription: userInfo.subscription,
            authType: 'user'
          });

          console.log(`✅ Authenticated as: ${userInfo.email} (${userInfo.subscription || 'FREE'})`);
          return true;
        }
      }

      // Fall back to device authentication (dev mode)
      console.log('⚠️  No user credentials found, using development mode with limited access');

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

  /**
   * Get authorization headers based on auth type
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    if (this.useUserAuth) {
      // Web connector mode - use OAuth token directly
      if (this.oauthToken) {
        return {
          'Authorization': `Bearer ${this.oauthToken}`,
          'Content-Type': 'application/json',
        };
      }

      // Desktop mode - get token from AuthManager
      const token = await this.authManager.getAccessToken();
      if (token) {
        return {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        };
      }
    }

    // Fallback to device auth
    return {
      'Authorization': `Bearer ${this.deviceToken}`,
      'X-Device-ID': this.generateDeviceId(),
      'Content-Type': 'application/json',
    };
  }

  /**
   * Extract action items from notes using AiDD backend AI with batch processing
   */
  async extractActionItems(notes: Array<{ id: string; title: string; content: string }>): Promise<ActionItem[]> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    // Batch processing configuration
    const BATCH_SIZE = 3; // Process 3 notes at a time to avoid rate limits
    const BATCH_DELAY_MS = 2000; // 2 second delay between batches

    // If small number of notes, process directly
    if (notes.length <= BATCH_SIZE) {
      return this.extractBatch(notes);
    }

    // Split into batches and process sequentially
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

        // Add delay between batches (except for last batch)
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      } catch (error) {
        console.error(`[MCP] Extraction batch ${i + 1} failed:`, error);
        // Continue with remaining batches even if one fails
      }
    }

    console.log(`[MCP] Extraction batch processing complete. Total action items: ${allActionItems.length}`);
    return allActionItems;
  }

  /**
   * Extract action items from a single batch of notes
   */
  private async extractBatch(notes: Array<{ id: string; title: string; content: string }>): Promise<ActionItem[]> {
    try {
      // Generate deviceId for this request (use userId if available, otherwise generate one)
      const deviceId = this.userId ? `mcp-web-${this.userId}` : this.generateDeviceId();

      // Step 1: Create the extraction job
      const response = await fetch(`${this.baseUrl}/api/ai/extract-action-items`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
        },
        body: JSON.stringify({
          deviceId: deviceId, // Also include in body as fallback
          notes: notes.map(note => ({
            id: note.id,
            content: note.content,
            metadata: {
              title: note.title,
              source: 'apple-notes',
            },
          })),
          extractionMode: 'comprehensive',
          includeContext: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Extraction failed: ${response.statusText}`);
      }

      // Handle SSE response for progress tracking
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        return await this.handleSSEResponse(response, 'extraction');
      }

      // Step 2: Parse job creation response
      const jobData = await response.json() as { jobId?: string; actionItems?: ActionItem[] };

      // If immediate results are returned (cached/mock), use them
      if (jobData.actionItems && jobData.actionItems.length > 0) {
        return jobData.actionItems;
      }

      // Step 3: If we got a jobId, wait for the job to complete
      if (jobData.jobId) {
        const waitResponse = await fetch(`${this.baseUrl}/api/ai/jobs/${jobData.jobId}/wait?timeout=90`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.deviceToken}`,
            'Content-Type': 'application/json',
            'X-Device-ID': deviceId,
          },
        });

        if (!waitResponse.ok) {
          throw new Error(`Job wait failed: ${waitResponse.statusText}`);
        }

        const waitResult = await waitResponse.json() as {
          status?: string;
          result?: {
            actionItems?: ActionItem[];
            extractions?: Array<{ noteId: string; actionItems: ActionItem[] }>;
            totalActionItems?: number;
          };
          actionItems?: ActionItem[];
          extractions?: Array<{ noteId: string; actionItems: ActionItem[] }>;
        };

        console.log('[MCP] Extraction wait result:', JSON.stringify(waitResult, null, 2).substring(0, 500));

        // Handle different response formats from backend
        // 1. Direct actionItems array
        if (waitResult.actionItems && waitResult.actionItems.length > 0) {
          return waitResult.actionItems;
        }
        if (waitResult.result?.actionItems && waitResult.result.actionItems.length > 0) {
          return waitResult.result.actionItems;
        }

        // 2. Backend returns extractions array: [{noteId, actionItems: [...]}]
        // Flatten all action items from all extractions
        if (waitResult.extractions && waitResult.extractions.length > 0) {
          const allItems = waitResult.extractions.flatMap(e => e.actionItems || []);
          console.log(`[MCP] Extracted ${allItems.length} action items from ${waitResult.extractions.length} extractions`);
          return allItems;
        }
        if (waitResult.result?.extractions && waitResult.result.extractions.length > 0) {
          const allItems = waitResult.result.extractions.flatMap(e => e.actionItems || []);
          console.log(`[MCP] Extracted ${allItems.length} action items from ${waitResult.result.extractions.length} extractions`);
          return allItems;
        }

        // If job completed but no action items, return empty
        if (waitResult.status === 'completed') {
          console.warn('Job completed but no actionItems found in result. Full result:', JSON.stringify(waitResult));
          return [];
        }

        throw new Error(`Job did not complete successfully: ${waitResult.status}`);
      }

      return [];
    } catch (error) {
      this.emit('error', { type: 'extraction', error });
      throw error;
    }
  }

  /**
   * Convert action items to ADHD-optimized tasks with batch processing
   */
  async convertToTasks(actionItems: ActionItem[]): Promise<ConvertedTask[]> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    // Batch processing configuration
    const BATCH_SIZE = 3; // Process 3 action items at a time to avoid rate limits
    const BATCH_DELAY_MS = 2000; // 2 second delay between batches

    // If small number of items, process directly
    if (actionItems.length <= BATCH_SIZE) {
      return this.convertBatch(actionItems);
    }

    // Split into batches and process sequentially
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

        // Add delay between batches (except for last batch)
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      } catch (error) {
        console.error(`[MCP] Batch ${i + 1} failed:`, error);
        // Continue with remaining batches even if one fails
      }
    }

    console.log(`[MCP] Batch processing complete. Total tasks: ${allTasks.length}`);
    return allTasks;
  }

  /**
   * Convert a single batch of action items
   */
  private async convertBatch(actionItems: ActionItem[]): Promise<ConvertedTask[]> {
    try {
      // Generate deviceId for this request (use userId if available, otherwise generate one)
      const deviceId = this.userId ? `mcp-web-${this.userId}` : this.generateDeviceId();

      // Step 1: Create the conversion job
      const response = await fetch(`${this.baseUrl}/api/ai/convert-action-items`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
        },
        body: JSON.stringify({
          deviceId: deviceId, // Also include in body as fallback
          actionItems,
          conversionMode: 'adhd-optimized',
          breakdownComplexTasks: true,
          maxTasksPerItem: 5,
        }),
      });

      if (!response.ok) {
        throw new Error(`Conversion failed: ${response.statusText}`);
      }

      // Handle SSE response for progress tracking
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        return await this.handleSSEResponse(response, 'conversion');
      }

      // Step 2: Parse job creation response
      const jobData = await response.json() as { jobId?: string; tasks?: ConvertedTask[] };

      // If immediate results are returned (cached/mock), use them
      if (jobData.tasks && jobData.tasks.length > 0) {
        return jobData.tasks;
      }

      // Step 3: If we got a jobId, wait for the job to complete
      if (jobData.jobId) {
        const waitResponse = await fetch(`${this.baseUrl}/api/ai/jobs/${jobData.jobId}/wait?timeout=90`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.deviceToken}`,
            'Content-Type': 'application/json',
            'X-Device-ID': deviceId,
          },
        });

        if (!waitResponse.ok) {
          throw new Error(`Job wait failed: ${waitResponse.statusText}`);
        }

        // Backend returns wrapped tasks: { tasks: [{originalId, converted, task: {...}}] }
        interface WrappedTask {
          originalId: string;
          converted: boolean;
          task: ConvertedTask;
        }

        const waitResult = await waitResponse.json() as {
          status?: string;
          result?: {
            tasks?: Array<WrappedTask | ConvertedTask>;
            totalProcessed?: number;
          };
          tasks?: Array<WrappedTask | ConvertedTask>;
        };

        console.log('[MCP] Conversion wait result:', JSON.stringify(waitResult, null, 2).substring(0, 500));

        // Helper to unwrap tasks - backend sends wrapped format: {originalId, converted, task: {...}}
        const unwrapTasks = (tasks: Array<WrappedTask | ConvertedTask>): ConvertedTask[] => {
          return tasks.map(t => {
            // Check if it's a wrapped task (has 'task' property with the actual task)
            if ('task' in t && t.task && typeof t.task === 'object') {
              console.log(`[MCP] Unwrapping task: ${(t.task as ConvertedTask).title}`);
              return t.task as ConvertedTask;
            }
            // Already a flat task
            return t as ConvertedTask;
          });
        };

        // Handle different response formats
        if (waitResult.tasks && waitResult.tasks.length > 0) {
          const unwrapped = unwrapTasks(waitResult.tasks);
          console.log(`[MCP] Converted ${unwrapped.length} tasks`);
          return unwrapped;
        }
        if (waitResult.result?.tasks && waitResult.result.tasks.length > 0) {
          const unwrapped = unwrapTasks(waitResult.result.tasks);
          console.log(`[MCP] Converted ${unwrapped.length} tasks from result`);
          return unwrapped;
        }

        // If job completed but no tasks, return empty
        if (waitResult.status === 'completed') {
          console.warn('Job completed but no tasks found in result. Full result:', JSON.stringify(waitResult));
          return [];
        }

        throw new Error(`Job did not complete successfully: ${waitResult.status}`);
      }

      return [];
    } catch (error) {
      this.emit('error', { type: 'conversion', error });
      throw error;
    }
  }

  /**
   * Score tasks using AI for prioritization
   */
  async scoreTasks(tasks: ConvertedTask[]): Promise<ScoredTask[]> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    try {
      // Generate deviceId for this request (use userId if available, otherwise generate one)
      const deviceId = this.userId ? `mcp-web-${this.userId}` : this.generateDeviceId();

      // Build task array with stable IDs, tracking the mapping for score lookup later
      const taskIdMap = new Map<string, any>(); // Maps sent taskId -> original task
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

      // Step 1: Create the scoring job
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
          scoringFactors: {
            considerADHD: true,
            timeOfDay: new Date().getHours(),
            energyLevel: 'medium',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Scoring failed: ${response.statusText}`);
      }

      // Handle SSE response for progress tracking
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        return await this.handleSSEResponse(response, 'scoring');
      }

      // Step 2: Parse job creation response
      const jobData = await response.json() as { jobId?: string; scoredTasks?: ScoredTask[] };

      // If immediate results are returned (cached/mock), use them
      if (jobData.scoredTasks && jobData.scoredTasks.length > 0) {
        return jobData.scoredTasks;
      }

      // Step 3: If we got a jobId, wait for the job to complete
      if (jobData.jobId) {
        const waitResponse = await fetch(`${this.baseUrl}/api/ai/jobs/${jobData.jobId}/wait?timeout=90`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.deviceToken}`,
            'Content-Type': 'application/json',
            'X-Device-ID': deviceId,
          },
        });

        if (!waitResponse.ok) {
          throw new Error(`Job wait failed: ${waitResponse.statusText}`);
        }

        const waitResult = await waitResponse.json() as {
          status?: string;
          result?: {
            scores?: Record<string, { urgency: number; impact: number; relevance: number; energy: number }>;
            scoredTasks?: ScoredTask[];
          };
          scoredTasks?: ScoredTask[];
        };

        // Handle different response formats
        if (waitResult.scoredTasks) {
          return waitResult.scoredTasks;
        }
        if (waitResult.result?.scoredTasks) {
          return waitResult.result.scoredTasks;
        }

        // Handle backend format: result.scores is an object keyed by task ID
        if (waitResult.status === 'completed' && waitResult.result?.scores) {
          const scores = waitResult.result.scores;
          const scoredTasks: ScoredTask[] = [];

          console.log('[MCP] Received scores for task IDs:', Object.keys(scores));
          console.log('[MCP] taskIdMap has IDs:', Array.from(taskIdMap.keys()));

          // Convert scores object to ScoredTask array
          // Use taskIdMap we created earlier to map back to original tasks
          for (const [taskId, scoreData] of Object.entries(scores)) {
            const originalTask = taskIdMap.get(taskId);
            const overallScore = Math.round((scoreData.urgency + scoreData.impact + scoreData.relevance) / 3);

            console.log(`[MCP] Task ${taskId}: urgency=${scoreData.urgency}, impact=${scoreData.impact}, relevance=${scoreData.relevance}, overall=${overallScore}`);

            scoredTasks.push({
              id: taskId,
              title: originalTask?.title || `Task ${taskId}`,
              score: overallScore,
              factors: {
                urgency: Math.round(scoreData.urgency / 10), // Convert 0-100 to 0-10
                importance: Math.round(scoreData.impact / 10),
                effort: Math.round(scoreData.energy), // Energy is already 1-5 scale, use as effort
                adhd_compatibility: Math.round((100 - scoreData.energy * 20) / 10), // Inverse energy for ADHD (lower energy = higher compatibility)
              },
              recommendation: overallScore >= 70
                ? 'High priority - tackle this soon!'
                : overallScore >= 40
                  ? 'Medium priority - schedule when ready'
                  : 'Lower priority - can wait',
            });
          }

          // Sort by score descending
          scoredTasks.sort((a, b) => b.score - a.score);
          return scoredTasks;
        }

        // If job completed but no scores, return empty
        if (waitResult.status === 'completed') {
          console.warn('Job completed but no scores found in result');
          return [];
        }

        throw new Error(`Job did not complete successfully: ${waitResult.status}`);
      }

      return [];
    } catch (error) {
      this.emit('error', { type: 'scoring', error });
      throw error;
    }
  }

  /**
   * Sync tasks to user's preferred integration
   */
  async syncTasks(tasks: ConvertedTask[], targetService: string): Promise<boolean> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

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

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.statusText}`);
      }

      const data = await response.json() as { success?: boolean };
      this.emit('syncComplete', { service: targetService, count: tasks.length });
      return data.success || false;
    } catch (error) {
      this.emit('error', { type: 'sync', error });
      throw error;
    }
  }

  /**
   * Handle Server-Sent Events for progress tracking
   */
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
                this.emit('progress', {
                  operation,
                  progress: data.progress,
                  message: data.message,
                });
              } else if (data.type === 'result') {
                results.push(data.data);
              } else if (data.type === 'complete') {
                resolve(results);
              } else if (data.type === 'error') {
                reject(new Error(data.message));
              }
            } catch (e) {
              // Ignore parse errors for non-JSON SSE messages
            }
          }
        }
      });

      response.body.on('end', () => {
        if (results.length > 0) {
          resolve(results);
        } else {
          resolve([]);
        }
      });

      response.body.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * Generate a unique device ID
   */
  private generateDeviceId(): string {
    return `claude-mcp-${crypto.randomUUID()}`;
  }

  /**
   * Refresh authentication token
   */
  async refreshAuth(): Promise<boolean> {
    if (!this.refreshToken) {
      return this.authenticate();
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refreshToken: this.refreshToken,
        }),
      });

      if (!response.ok) {
        // Refresh failed, try full auth
        return this.authenticate();
      }

      const data = await response.json() as { deviceToken?: string };
      this.deviceToken = data.deviceToken;
      return true;
    } catch (error) {
      return this.authenticate();
    }
  }

  // =============================================================================
  // CRUD METHODS FOR NOTES, ACTION ITEMS, AND TASKS
  // =============================================================================

  /**
   * List notes from backend
   */
  async listNotes(options: { sortBy?: string; order?: string; limit?: number; offset?: number } = {}): Promise<any[]> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    try {
      const params = new URLSearchParams();
      if (options.sortBy) params.append('sortBy', options.sortBy);
      if (options.order) params.append('order', options.order);
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.offset) params.append('offset', options.offset.toString());

      const response = await fetch(`${this.baseUrl}/api/notes?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to list notes: ${response.statusText}`);
      }

      const data = await response.json() as { notes?: any[] };
      return data.notes || [];
    } catch (error) {
      this.emit('error', { type: 'listNotes', error });
      throw error;
    }
  }

  /**
   * Read a specific note from backend
   */
  async readNote(noteId: string): Promise<any> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/notes/${noteId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to read note: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'readNote', error });
      throw error;
    }
  }

  /**
   * Create a new note in backend
   */
  async createNote(note: { title: string; content: string; tags?: string[]; category?: string }): Promise<any> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/notes`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(note),
      });

      if (!response.ok) {
        throw new Error(`Failed to create note: ${response.statusText}`);
      }

      const createdNote = await response.json();
      this.emit('noteCreated', createdNote);
      return createdNote;
    } catch (error) {
      this.emit('error', { type: 'createNote', error });
      throw error;
    }
  }

  /**
   * List action items from backend
   */
  async listActionItems(options: { sortBy?: string; order?: string; limit?: number; offset?: number } = {}): Promise<ActionItem[]> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    try {
      const params = new URLSearchParams();
      if (options.sortBy) params.append('sortBy', options.sortBy);
      if (options.order) params.append('order', options.order);
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.offset) params.append('offset', options.offset.toString());

      const response = await fetch(`${this.baseUrl}/api/actionItems?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to list action items: ${response.statusText}`);
      }

      const data = await response.json() as { actionItems?: ActionItem[] };
      return data.actionItems || [];
    } catch (error) {
      this.emit('error', { type: 'listActionItems', error });
      throw error;
    }
  }

  /**
   * Read a specific action item from backend
   */
  async readActionItem(actionItemId: string): Promise<ActionItem> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/actionItems/${actionItemId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to read action item: ${response.statusText}`);
      }

      return await response.json() as ActionItem;
    } catch (error) {
      this.emit('error', { type: 'readActionItem', error });
      throw error;
    }
  }

  /**
   * List tasks from backend with sorting support
   */
  async listTasks(options: { sortBy?: string; order?: string; limit?: number; offset?: number } = {}): Promise<any[]> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    try {
      const params = new URLSearchParams();
      if (options.sortBy) params.append('sortBy', options.sortBy);
      if (options.order) params.append('order', options.order);
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.offset) params.append('offset', options.offset.toString());

      const response = await fetch(`${this.baseUrl}/api/tasks?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to list tasks: ${response.statusText}`);
      }

      const data = await response.json() as { tasks?: any[] };
      return data.tasks || [];
    } catch (error) {
      this.emit('error', { type: 'listTasks', error });
      throw error;
    }
  }

  /**
   * Read a specific task from backend
   */
  async readTask(taskId: string): Promise<any> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to read task: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'readTask', error });
      throw error;
    }
  }

  // =============================================================================
  // END OF CRUD METHODS
  // =============================================================================

  /**
   * Get backend health status
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json() as { status?: string };
      return data.status === 'healthy';
    } catch (error) {
      return false;
    }
  }
}