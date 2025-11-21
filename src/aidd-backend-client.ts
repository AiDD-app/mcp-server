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

  constructor() {
    super();
    this.authManager = new AuthManager();
    this.checkUserAuth();
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
   * Extract action items from notes using AiDD backend AI
   */
  async extractActionItems(notes: Array<{ id: string; title: string; content: string }>): Promise<ActionItem[]> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/ai/extract-action-items`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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

      const data = await response.json() as { actionItems?: ActionItem[] };
      return data.actionItems || [];
    } catch (error) {
      this.emit('error', { type: 'extraction', error });
      throw error;
    }
  }

  /**
   * Convert action items to ADHD-optimized tasks
   */
  async convertToTasks(actionItems: ActionItem[]): Promise<ConvertedTask[]> {
    if (!this.deviceToken) {
      await this.authenticate();
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/ai/convert-action-items`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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

      const data = await response.json() as { tasks?: ConvertedTask[] };
      return data.tasks || [];
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
      const response = await fetch(`${this.baseUrl}/api/ai/score-tasks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tasks: tasks.map(task => ({
            id: crypto.randomUUID(),
            title: task.title,
            description: task.description,
            dueDate: task.dueDate,
            estimatedTime: task.estimatedTime,
            energyRequired: task.energyRequired,
            tags: task.tags,
            taskType: task.taskType,
          })),
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

      const data = await response.json() as { scoredTasks?: ScoredTask[] };
      return data.scoredTasks || [];
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