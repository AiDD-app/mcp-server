import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool,
  Resource,
  TextContent,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { AiDDBackendClient } from './aidd-backend-client.js';
import { z } from 'zod';
import { createHash } from 'crypto';
import {
  SubscriptionManager,
  SubscriptionStatus,
  OperationType,
  UsageCheckResult,
} from './subscription-manager.js';
import { E2EEncryptionManager, getE2EManager } from './e2e-encryption-manager.js';
import { getAnalytics } from './analytics/ga4.js';
import { CHATGPT_UI_WIDGETS_HTML, WIDGET_RESOURCES } from './chatgpt-ui-resources.js';

// Widget CSP configuration for ChatGPT app submission
// Must be included in every tool definition that has an outputTemplate
const WIDGET_CSP_CONFIG = {
  'openai/widgetCSP': {
    connect_domains: [
      'https://aidd-backend-prod-739193356129.us-central1.run.app',
      'https://aidd-mcp-webconnector-739193356129.us-central1.run.app',
      'https://mcp.aidd.app',
    ],
    resource_domains: [],
    redirect_domains: [],
    frame_domains: [],
  },
  // widgetDomain must be a full URL for ChatGPT app submission
  'openai/widgetDomain': 'https://mcp.aidd.app',
};

export class AiDDMCPServer {
  private server: Server;
  private backendClient: AiDDBackendClient;
  private oauthToken?: string;
  private subscriptionManager: SubscriptionManager;
  private cachedSubscriptionStatus: SubscriptionStatus | null = null;
  private subscriptionCacheExpiry: number = 0;
  private readonly SUBSCRIPTION_CACHE_TTL_MS = 60000; // 1 minute cache
  private e2eManager: E2EEncryptionManager;
  private e2eInitialized: boolean = false;

  constructor(oauthToken?: string) {
    this.oauthToken = oauthToken;
    this.e2eManager = getE2EManager();
    console.log(`🔑 Using OAuth token from web connector: ${oauthToken ? 'present' : 'missing'}`);

    const BASE_URL = process.env.BASE_URL || 'https://mcp.aidd.app';

    this.server = new Server(
      {
        name: 'AiDD',
        version: '4.4.0',
        icons: [{
          src: `${BASE_URL}/icon.png`,
          mimeType: 'image/png',
          sizes: ['64x64']
        }],
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );
    console.log('✅ MCP SDK Server instance created with capabilities and icon');

    this.backendClient = new AiDDBackendClient(oauthToken);
    console.log('✅ Backend client initialized');

    this.subscriptionManager = new SubscriptionManager();
    console.log('✅ Subscription manager initialized');

    this.setupHandlers();
    console.log('✅ Request handlers registered');

    this.setupBackendListeners();
    console.log('✅ Backend event listeners configured');
  }

  private setupBackendListeners() {
    this.backendClient.on('progress', (data) => {
      console.error(`Progress: ${data.operation} - ${data.progress}% - ${data.message}`);
    });

    this.backendClient.on('error', (data) => {
      console.error(`Backend error: ${data.type} - ${data.error}`);
    });
  }

  // =============================================================================
  // E2E ENCRYPTION INITIALIZATION
  // =============================================================================

  /**
   * Initialize E2E encryption using stored OAuth password
   * Called automatically when the server starts with an OAuth token
   *
   * IMPORTANT: OAuth users must have their encryption password stored on the backend
   * The password is generated randomly on first setup and must be fetched, NOT derived from tokens
   */
  private async initializeE2E(): Promise<void> {
    if (this.e2eInitialized) {
      return;
    }

    const accessToken = this.backendClient.getAccessToken();
    if (!accessToken) {
      console.log('[E2E] No access token available, skipping E2E initialization');
      return;
    }

    try {
      // Check if user has E2E encryption set up
      const status = await this.backendClient.getE2EStatus();
      console.log('[E2E] E2E status check:', status);

      if (status.hasEncryption) {
        // First try: Use stored OAuth password (preferred - works across devices)
        let unlocked = false;
        try {
          unlocked = await this.e2eManager.unlockWithOAuthStoredPassword(accessToken);
          if (unlocked) {
            console.log('[E2E] ✅ Unlocked using stored OAuth password');
          }
        } catch (storedPasswordError) {
          console.log('[E2E] Stored password not available:', storedPasswordError instanceof Error ? storedPasswordError.message : 'Unknown error');
        }

        // Second try: Fallback to token derivation if we have an OAuth token
        if (!unlocked && this.oauthToken) {
          try {
            // Use the deprecated method which handles token derivation
            unlocked = await this.e2eManager.unlockWithOAuthToken(accessToken, this.oauthToken);
            if (unlocked) {
              console.log('[E2E] ✅ Unlocked using token derivation (legacy)');
            }
          } catch (tokenError) {
            console.log('[E2E] Token derivation also failed:', tokenError instanceof Error ? tokenError.message : 'Unknown error');
          }
        }

        if (unlocked) {
          this.e2eInitialized = true;
          console.log('[E2E] ✅ E2E encryption unlocked successfully');
        } else {
          console.log('[E2E] ⚠️ E2E unlock failed - user may need to re-setup encryption from iOS app');
          console.log('[E2E] ⚠️ Data will show as "[Encrypted - Unable to decrypt]" until key sync is restored');
        }
      } else {
        console.log('[E2E] User has not set up E2E encryption yet - data will be backend-encrypted only');
        // Note: E2E must be set up from the iOS app first, MCP can't create the encryption key
      }
    } catch (error) {
      console.error('[E2E] Failed to initialize E2E encryption:', error);
      // Continue without E2E - backend will still encrypt data
      // User data will show as "[Encrypted - Unable to decrypt]" if it was E2E encrypted
    }
  }

  /**
   * Ensure E2E is initialized before operations
   */
  private async ensureE2EInitialized(): Promise<void> {
    if (!this.e2eInitialized && this.oauthToken) {
      await this.initializeE2E();
    }
  }

  /**
   * Check if E2E encryption is available and enabled
   */
  private get e2eEnabled(): boolean {
    return this.e2eInitialized && this.e2eManager.e2eEnabled;
  }

  /**
   * Encrypt sensitive fields for a note before sending to backend
   */
  private encryptNoteForSync(note: any): any {
    if (!this.e2eEnabled) return note;

    return {
      ...note,
      encryptedTitle: this.e2eManager.encrypt(note.title),
      encryptedContent: note.content ? this.e2eManager.encrypt(note.content) : null,
      encryptedTags: note.tags?.length > 0 ? this.e2eManager.encrypt(note.tags.join(',')) : null,
      // Clear plaintext fields when E2E enabled
      title: undefined,
      content: undefined,
      tags: undefined,
    };
  }

  /**
   * Decrypt sensitive fields from a note received from backend
   * Note: Backend already decrypts for MCP/web access, so check if title exists first
   */
  private decryptNoteFromSync(note: any): any {
    if (!this.e2eEnabled) return note;

    // If backend already decrypted (title exists and is valid), use that
    if (note.title && typeof note.title === 'string' && !note.title.includes('[Encrypted')) {
      return note;
    }

    if (!note.encryptedTitle) return note; // Not E2E encrypted

    try {
      return {
        ...note,
        title: this.e2eManager.decrypt(note.encryptedTitle),
        content: note.encryptedContent ? this.e2eManager.decrypt(note.encryptedContent) : null,
        tags: note.encryptedTags ? this.e2eManager.decrypt(note.encryptedTags).split(',') : [],
      };
    } catch (error) {
      console.error('[E2E] Failed to decrypt note:', error);
      return { ...note, title: '[Encrypted - Unable to decrypt]', content: '', tags: [] };
    }
  }

  /**
   * Encrypt sensitive fields for an action item before sending to backend
   */
  private encryptActionItemForSync(item: any): any {
    if (!this.e2eEnabled) return item;

    return {
      ...item,
      encryptedTitle: this.e2eManager.encrypt(item.title),
      encryptedDescription: item.description ? this.e2eManager.encrypt(item.description) : null,
      encryptedTags: item.tags?.length > 0 ? this.e2eManager.encrypt(item.tags.join(',')) : null,
      title: undefined,
      description: undefined,
      tags: undefined,
    };
  }

  /**
   * Decrypt sensitive fields from an action item received from backend
   * Note: Backend already decrypts for MCP/web access, so check if title exists first
   */
  private decryptActionItemFromSync(item: any): any {
    if (!this.e2eEnabled) return item;

    // If backend already decrypted (title exists and is valid), use that
    if (item.title && typeof item.title === 'string' && !item.title.includes('[Encrypted')) {
      return item;
    }

    if (!item.encryptedTitle) return item;

    try {
      return {
        ...item,
        title: this.e2eManager.decrypt(item.encryptedTitle),
        description: item.encryptedDescription ? this.e2eManager.decrypt(item.encryptedDescription) : null,
        tags: item.encryptedTags ? this.e2eManager.decrypt(item.encryptedTags).split(',') : [],
      };
    } catch (error) {
      console.error('[E2E] Failed to decrypt action item:', error);
      return { ...item, title: '[Encrypted - Unable to decrypt]', description: '', tags: [] };
    }
  }

  private normalizeActionItemPriority(priority: any): 'low' | 'medium' | 'high' | 'urgent' {
    const value = typeof priority === 'string' ? priority.trim().toLowerCase() : '';
    if (value === 'critical') return 'urgent';
    if (value === 'urgent' || value === 'high' || value === 'medium' || value === 'low') {
      return value;
    }
    return 'medium';
  }

  private normalizeImportValue(value: any): string {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private normalizeImportDueDate(value: any): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return trimmed.toLowerCase();
    }
    return parsed.toISOString();
  }

  private buildActionItemImportKey(item: { title: string; description?: string; category?: string; dueDate?: any }): string {
    const normalizedTitle = this.normalizeImportValue(item.title);
    const normalizedDescription = this.normalizeImportValue(item.description);
    const normalizedCategory = item.category === 'personal' ? 'personal' : 'work';
    const normalizedDueDate = this.normalizeImportDueDate(item.dueDate);
    return JSON.stringify({
      title: normalizedTitle,
      description: normalizedDescription,
      category: normalizedCategory,
      dueDate: normalizedDueDate,
    });
  }

  private buildImportSourceId(importKey: string): string {
    const hash = createHash('sha256').update(importKey).digest('hex').slice(0, 32);
    return `mcp-import:${hash}`;
  }

  private buildActionItemSourceNoteId(importKey: string): string {
    return this.buildImportSourceId(importKey);
  }

  private buildNoteImportKey(note: { title: string; content: string; category?: string }): string {
    const normalizedTitle = this.normalizeImportValue(note.title);
    const normalizedContent = this.normalizeImportValue(note.content);
    const normalizedCategory = note.category === 'work' ? 'work' : 'personal';
    return JSON.stringify({
      title: normalizedTitle,
      content: normalizedContent,
      category: normalizedCategory,
    });
  }

  private buildNoteSourceId(importKey: string): string {
    return this.buildImportSourceId(importKey);
  }

  private buildTaskImportKey(task: {
    title: string;
    description?: string;
    estimatedTime?: number;
    energyRequired?: string;
    taskType?: string;
    dueDate?: any;
  }): string {
    const normalizedTitle = this.normalizeImportValue(task.title);
    const normalizedDescription = this.normalizeImportValue(task.description);
    const normalizedEnergy = this.normalizeImportValue(task.energyRequired);
    const normalizedTaskType = this.normalizeImportValue(task.taskType);
    const normalizedDueDate = this.normalizeImportDueDate(task.dueDate);
    const estimatedTime = typeof task.estimatedTime === 'number' && Number.isFinite(task.estimatedTime)
      ? Math.round(task.estimatedTime)
      : 15;
    return JSON.stringify({
      title: normalizedTitle,
      description: normalizedDescription,
      estimatedTime,
      energyRequired: normalizedEnergy,
      taskType: normalizedTaskType,
      dueDate: normalizedDueDate,
    });
  }

  private buildTaskSourceId(importKey: string): string {
    return this.buildImportSourceId(importKey);
  }

  /**
   * Encrypt sensitive fields for a task before sending to backend
   */
  private encryptTaskForSync(task: any): any {
    if (!this.e2eEnabled) return task;

    return {
      ...task,
      encryptedTitle: this.e2eManager.encrypt(task.title),
      encryptedDescription: task.description ? this.e2eManager.encrypt(task.description) : null,
      encryptedTags: task.tags?.length > 0 ? this.e2eManager.encrypt(task.tags.join(',')) : null,
      title: undefined,
      description: undefined,
      tags: undefined,
    };
  }

  /**
   * Decrypt sensitive fields from a task received from backend
   * Note: Backend already decrypts for MCP/web access, so check if title exists first
   */
  private decryptTaskFromSync(task: any): any {
    if (!this.e2eEnabled) return task;

    // If backend already decrypted (title exists and is valid), use that
    if (task.title && typeof task.title === 'string' && !task.title.includes('[Encrypted')) {
      return task;
    }

    if (!task.encryptedTitle) return task;

    try {
      return {
        ...task,
        title: this.e2eManager.decrypt(task.encryptedTitle),
        description: task.encryptedDescription ? this.e2eManager.decrypt(task.encryptedDescription) : null,
        tags: task.encryptedTags ? this.e2eManager.decrypt(task.encryptedTags).split(',') : [],
      };
    } catch (error) {
      console.error('[E2E] Failed to decrypt task:', error);
      return { ...task, title: '[Encrypted - Unable to decrypt]', description: '', tags: [] };
    }
  }

  // =============================================================================
  // SUBSCRIPTION & USAGE LIMIT CHECKING
  // =============================================================================

  private async getSubscriptionStatus(): Promise<SubscriptionStatus> {
    const now = Date.now();

    if (this.cachedSubscriptionStatus && now < this.subscriptionCacheExpiry) {
      return this.cachedSubscriptionStatus;
    }

    try {
      const backendResponse = await this.backendClient.getSubscriptionStatus();
      this.cachedSubscriptionStatus = this.subscriptionManager.parseBackendResponse(backendResponse);
      this.subscriptionCacheExpiry = now + this.SUBSCRIPTION_CACHE_TTL_MS;

      const userId = this.backendClient.getUserId();
      if (userId) {
        this.subscriptionManager = new SubscriptionManager(userId);
      }

      return this.cachedSubscriptionStatus;
    } catch (error) {
      console.error('[MCP] Failed to get subscription status:', error);
      return this.subscriptionManager.getDefaultStatus();
    }
  }

  private async checkOperationLimit(operation: OperationType): Promise<UsageCheckResult> {
    const status = await this.getSubscriptionStatus();
    return this.subscriptionManager.checkUsage(operation, status);
  }

  private formatLimitReachedResponse(usageCheck: UsageCheckResult): { content: TextContent[] } {
    return {
      content: [{
        type: 'text',
        text: usageCheck.limitMessage || `You've reached your ${usageCheck.tier} tier limit for this operation.`,
      } as TextContent],
    };
  }

  private appendUsageWarning(responseText: string, usageCheck: UsageCheckResult): string {
    if (usageCheck.warningMessage) {
      return responseText + '\n\n---\n' + usageCheck.warningMessage;
    }
    return responseText;
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.log('📋 MCP Request: list_tools');
      return {
        tools: this.getTools(),
      };
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = this.getResources();
      // Log to verify _meta is included
      console.log('📋 MCP Request: resources/list - returning', resources.length, 'resources');
      const widgetResources = resources.filter(r => r.uri.startsWith('ui://widget'));
      if (widgetResources.length > 0) {
        console.log('📋 Widget resource sample:', JSON.stringify(widgetResources[0], null, 2));
      }
      return { resources };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      return await this.handleResourceRead(uri);
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const analytics = getAnalytics();
      const startTime = Date.now();
      let success = false;

      try {
        let result;
        switch (name) {
          case 'list_notes':
            result = await this.handleListNotes(args);
            break;
          case 'read_note':
            result = await this.handleReadNote(args);
            break;
          case 'create_note':
            result = await this.handleCreateNote(args);
            break;
          case 'create_notes':
            result = await this.handleCreateNotes(args);
            break;
          case 'list_action_items':
            result = await this.handleListActionItems(args);
            break;
          case 'read_action_item':
            result = await this.handleReadActionItem(args);
            break;
          case 'create_action_item':
            result = await this.handleCreateActionItem(args);
            break;
          case 'create_action_items':
            result = await this.handleCreateActionItems(args);
            break;
          case 'extract_action_items':
            result = await this.handleExtractActionItems(args);
            break;
          case 'list_tasks':
            result = await this.handleListTasks(args);
            break;
          case 'read_task':
            result = await this.handleReadTask(args);
            break;
          case 'create_task':
            result = await this.handleCreateTask(args);
            break;
          case 'create_tasks':
            result = await this.handleCreateTasks(args);
            break;
          case 'convert_to_tasks':
            result = await this.handleConvertToTasks(args);
            break;
          case 'score_tasks':
            result = await this.handleScoreTasks(args);
            break;
          case 'check_ai_jobs':
            result = await this.handleCheckAIJobs(args);
            break;
          case 'update_note':
            result = await this.handleUpdateNote(args);
            break;
          case 'update_notes':
            result = await this.handleUpdateNotes(args);
            break;
          case 'delete_notes':
            result = await this.handleDeleteNotes(args);
            break;
          case 'update_action_item':
            result = await this.handleUpdateActionItem(args);
            break;
          case 'update_action_items':
            result = await this.handleUpdateActionItems(args);
            break;
          case 'delete_action_items':
            result = await this.handleDeleteActionItems(args);
            break;
          case 'update_task':
            result = await this.handleUpdateTask(args);
            break;
          case 'update_tasks':
            result = await this.handleUpdateTasks(args);
            break;
          case 'delete_tasks':
            result = await this.handleDeleteTasks(args);
            break;
          case 'delete_all_tasks':
            result = await this.handleDeleteAllTasks(args);
            break;
          case 'session_status':
            result = await this.handleSessionStatus();
            break;
          case 'aidd_overview_tutorial':
            result = await this.handleOverviewTutorial(args);
            break;
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
        success = true;
        return result;
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
          );
        }
        throw error;
      } finally {
        // Track ALL MCP tool calls for GA4 analytics
        const executionTime = Date.now() - startTime;
        await analytics.trackToolUsage(name, success, executionTime);
      }
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: 'list_notes',
        description: 'List notes from your AiDD account with optional sorting and pagination. Set includeWidget=true only when the user explicitly wants a visual list; omit it when you just need IDs for follow-up actions.',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'title'], description: 'Field to sort by (default: updatedAt)' },
            order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default: desc)' },
            limit: { type: 'number', description: 'Maximum number of notes to return (default: 100)' },
            offset: { type: 'number', description: 'Number of notes to skip for pagination (default: 0)' },
            includeWidget: { type: 'boolean', description: 'Include widget-structured output. Use true only when the user asked to view a visual list; otherwise leave false.' },
          },
        },
        _meta: {
          'openai/outputTemplate': 'ui://widget/notes-list.html',
          'openai/widgetAccessible': true,  // Enable widget-initiated calls
          ...WIDGET_CSP_CONFIG,
        },
      },
      {
        name: 'read_note',
        description: 'Read a specific note from your AiDD account',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: { noteId: { type: 'string', description: 'ID of the note to read' } },
          required: ['noteId'],
        },
      },
      {
        name: 'create_note',
        description: 'Create a new note in your AiDD account. Use this for a single note; for lists, use create_notes.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the note' },
            content: { type: 'string', description: 'Content of the note' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the note (optional)' },
            category: { type: 'string', enum: ['work', 'personal'], description: 'Category of the note (default: personal)' },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'create_notes',
        description: 'Create multiple notes from an explicit list. Use this for 1:1 list imports.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            notes: {
              type: 'array',
              description: 'List of notes to create, one per list entry.',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Title of the note' },
                  content: { type: 'string', description: 'Content of the note' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the note (optional)' },
                  category: { type: 'string', enum: ['work', 'personal'], description: 'Category of the note (default: personal)' },
                  sourceId: { type: 'string', description: 'Optional source ID for deduplication (auto-generated if omitted)' },
                },
                required: ['title', 'content'],
              },
            },
          },
          required: ['notes'],
        },
      },
      {
        name: 'list_action_items',
        description: 'List action items from your AiDD account with optional sorting and pagination. Set includeWidget=true only when the user explicitly wants a visual list; omit it when you just need IDs for follow-up actions.',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'priority', 'dueDate'], description: 'Field to sort by (default: createdAt)' },
            order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default: desc)' },
            limit: { type: 'number', description: 'Maximum number of action items to return (default: 100)' },
            offset: { type: 'number', description: 'Number of action items to skip for pagination (default: 0)' },
            includeWidget: { type: 'boolean', description: 'Include widget-structured output. Use true only when the user asked to view a visual list; otherwise leave false.' },
          },
        },
        _meta: {
          'openai/outputTemplate': 'ui://widget/action-items.html',
          'openai/widgetAccessible': true,  // Enable widget-initiated calls
          ...WIDGET_CSP_CONFIG,
        },
      },
      {
        name: 'read_action_item',
        description: 'Read a specific action item from your AiDD account',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: { actionItemId: { type: 'string', description: 'ID of the action item to read' } },
          required: ['actionItemId'],
        },
      },
      {
        name: 'create_action_item',
        description: 'Create a new action item in your AiDD account. Use this for a single item; for explicit lists, use create_action_items.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the action item' },
            description: { type: 'string', description: 'Description of the action item (optional)' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent', 'critical'], description: 'Priority level (default: medium)' },
            dueDate: { type: 'string', description: 'Due date in ISO format (optional)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the action item (optional)' },
            category: { type: 'string', enum: ['work', 'personal'], description: 'Category of the action item (default: work)' },
          },
          required: ['title'],
        },
      },
      {
        name: 'create_action_items',
        description: 'Create multiple action items from an explicit list provided by the user. Use this for 1:1 list imports. Do NOT use extract_action_items for explicit lists.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              description: 'List of action items to create, one per list entry.',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Title of the action item' },
                  description: { type: 'string', description: 'Description of the action item (optional)' },
                  priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent', 'critical'], description: 'Priority level (default: medium)' },
                  dueDate: { type: 'string', description: 'Due date in ISO format (optional)' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the action item (optional)' },
                  category: { type: 'string', enum: ['work', 'personal'], description: 'Category of the action item (default: work)' },
                },
                required: ['title'],
              },
            },
          },
          required: ['items'],
        },
      },
      {
        name: 'extract_action_items',
        description: 'Extract action items from notes or text using AiDD AI processing. Do not use for explicit user-provided lists; use create_action_item(s) instead.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['notes', 'text'], description: 'Extract from saved notes or provided text' },
            noteIds: { type: 'array', items: { type: 'string' }, description: 'Specific note IDs to process (required if source=notes)' },
            text: { type: 'string', description: 'Text content to extract action items from (required if source=text)' },
            extractionMode: { type: 'string', enum: ['quick', 'comprehensive', 'adhd-optimized'], description: 'Extraction mode (default: adhd-optimized)' },
          },
          required: ['source'],
        },
      },
      {
        name: 'list_tasks',
        description: 'List tasks from your AiDD account with optional sorting and pagination. IMPORTANT: By default, tasks are sorted by AI score while respecting dependencies - you do NOT need to set sortBy or ignoreDependencies for normal "what should I work on" queries. Only use ignoreDependencies:true when the user explicitly asks to ignore/disregard dependencies. Set includeWidget=true only when the user explicitly wants a visual dashboard; omit it when you just need IDs for follow-up actions.',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'score', 'dueDate', 'dependencyOrder', 'scoreWithDependencies'], description: 'Field to sort by. Default behavior sorts by AI score while respecting task dependencies (scoreWithDependencies). Use dependencyOrder for pure topological sort. Use score with ignoreDependencies:true for pure score-based sorting.' },
            order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default: desc for score, asc for dueDate)' },
            limit: { type: 'number', description: 'Maximum number of tasks to return (default: 100)' },
            offset: { type: 'number', description: 'Number of tasks to skip for pagination (default: 0)' },
            ignoreDependencies: { type: 'boolean', description: 'When true, sort purely by score without respecting task dependencies. Default: false (dependencies are respected)' },
            // Filters
            category: { type: 'string', description: 'Filter by category (work/personal)' },
            tags: { type: 'string', description: 'Filter by tags (comma-separated list)' },
            maxTimeMinutes: { type: 'number', description: 'Filter to tasks with estimated time <= this value (in minutes)' },
            maxEnergy: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Filter to tasks with energy level <= this value' },
            onlyAIScored: { type: 'boolean', description: 'Only show tasks that have been AI scored' },
            dueWithinDays: { type: 'number', description: 'Filter to tasks due within this many days' },
            includeCompleted: { type: 'boolean', description: 'Include completed tasks (default: false)' },
            timeBudgetMinutes: { type: 'number', description: 'Time budget optimization: fill this many minutes with highest-value task chains. Tasks from highest-scored chains are added first (respecting dependencies), then next highest chain, until time budget is filled.' },
            includeWidget: { type: 'boolean', description: 'Include widget-structured output. Use true only when the user asked to view the task dashboard; otherwise leave false.' },
          },
        },
        _meta: {
          'openai/outputTemplate': 'ui://widget/task-dashboard.html',
          'openai/widgetAccessible': true,  // Enable widget-initiated calls
          ...WIDGET_CSP_CONFIG,
        },
      },
      {
        name: 'read_task',
        description: 'Read a specific task from your AiDD account',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: { taskId: { type: 'string', description: 'ID of the task to read' } },
          required: ['taskId'],
        },
      },
      {
        name: 'create_task',
        description: 'Create a new task in your AiDD account. Use this for a single task; for lists, use create_tasks.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the task' },
            description: { type: 'string', description: 'Description of the task (optional)' },
            estimatedTime: { type: 'number', description: 'Estimated time in minutes (default: 15)' },
            energyRequired: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Energy level required (default: medium)' },
            taskType: { type: 'string', enum: ['quick_win', 'focus_required', 'collaborative', 'creative', 'administrative'], description: 'Type of task (optional - will be inferred from content if not specified)' },
            dueDate: { type: 'string', description: 'Due date in ISO format (optional)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the task (optional)' },
          },
          required: ['title'],
        },
      },
      {
        name: 'create_tasks',
        description: 'Create multiple tasks from an explicit list.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              description: 'List of tasks to create, one per list entry.',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Title of the task' },
                  description: { type: 'string', description: 'Description of the task (optional)' },
                  estimatedTime: { type: 'number', description: 'Estimated time in minutes (default: 15)' },
                  energyRequired: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Energy level required (default: medium)' },
                  taskType: { type: 'string', enum: ['quick_win', 'focus_required', 'collaborative', 'creative', 'administrative'], description: 'Type of task (optional - will be inferred from content if not specified)' },
                  dueDate: { type: 'string', description: 'Due date in ISO format (optional)' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the task (optional)' },
                  sourceId: { type: 'string', description: 'Optional source ID for deduplication (auto-generated if omitted)' },
                },
                required: ['title'],
              },
            },
          },
          required: ['tasks'],
        },
      },
      {
        name: 'convert_to_tasks',
        description: 'Convert action items to ADHD-optimized tasks. IMPORTANT: When user says "convert these action items" or references specific items from a previous extraction/creation, you MUST pass those specific IDs in actionItemIds. Only use convertAll:true when user explicitly says "convert ALL action items".',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            actionItemIds: { type: 'array', items: { type: 'string' }, description: 'REQUIRED when user references "these" items or specific items from a previous operation. Use the IDs from extract_action_items or create_action_item responses. Only omit when user explicitly wants ALL items converted.' },
            convertAll: { type: 'boolean', description: 'Only set to true when user explicitly requests converting ALL action items. Do not use when user references specific items.' },
            breakdownMode: { type: 'string', enum: ['simple', 'adhd-optimized', 'detailed'], description: 'Task breakdown mode (default: adhd-optimized)' },
            waitForCompletion: { type: 'boolean', description: 'AVOID using true - causes timeouts. Default false returns immediately with job ID.' },
            skipDeduplication: { type: 'boolean', description: 'Skip checking for already-converted items. Faster but may create duplicates.' },
            skipAutoScoring: { type: 'boolean', description: 'Skip automatic AI scoring after conversion. Default false (scoring runs automatically for PREMIUM/PRO users).' },
          },
        },
        _meta: {
          'openai/widgetAccessible': true,  // Enable widget-initiated calls
        },
      },
      {
        name: 'score_tasks',
        description: 'Score tasks for ADHD-friendly prioritization. Submits a background AI job and returns immediately with a job ID. Tell user to check back in 5 minutes for results via list_tasks.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            considerCurrentEnergy: { type: 'boolean', description: 'Consider current energy levels (default: true)' },
            timeOfDay: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'auto'], description: 'Time of day for optimization (default: auto)' },
            waitForCompletion: { type: 'boolean', description: 'AVOID using true - causes timeouts. Default false returns immediately.' },
          },
        },
        _meta: {
          'openai/outputTemplate': 'ui://widget/ai-scoring.html',
          'openai/widgetAccessible': true,  // Enable widget-initiated calls
          ...WIDGET_CSP_CONFIG,
        },
      },
      {
        name: 'check_ai_jobs',
        description: 'Check the status and progress of AI processing jobs (action item extraction, task conversion, AI scoring). Use this to monitor long-running operations or check if a job has completed.',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string', description: 'Optional: Specific job ID to check. If not provided, lists all active jobs.' },
            includeCompleted: { type: 'boolean', description: 'Include completed jobs in the list (default: false)' },
          },
        },
        _meta: {
          'openai/widgetAccessible': true,  // Enable widget-initiated calls
        },
      },
      {
        name: 'update_note',
        description: 'Update an existing note in your AiDD account. Use update_notes for bulk updates.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            noteId: { type: 'string', description: 'ID of the note to update' },
            title: { type: 'string', description: 'New title for the note' },
            content: { type: 'string', description: 'New content for the note' },
            tags: { type: 'array', items: { type: 'string' }, description: 'New tags for the note' },
            category: { type: 'string', enum: ['work', 'personal'], description: 'New category for the note' },
          },
          required: ['noteId'],
        },
      },
      {
        name: 'update_notes',
        description: 'Update multiple notes in your AiDD account.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            updates: {
              type: 'array',
              description: 'List of note updates with noteId and fields to change.',
              items: {
                type: 'object',
                properties: {
                  noteId: { type: 'string', description: 'ID of the note to update' },
                  title: { type: 'string', description: 'New title for the note' },
                  content: { type: 'string', description: 'New content for the note' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'New tags for the note' },
                  category: { type: 'string', enum: ['work', 'personal'], description: 'New category for the note' },
                },
                required: ['noteId'],
              },
            },
          },
          required: ['updates'],
        },
      },
      {
        name: 'delete_notes',
        description: 'Delete one or more notes from your AiDD account',
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: { noteIds: { type: 'array', items: { type: 'string' }, description: 'IDs of the notes to delete' } },
          required: ['noteIds'],
        },
      },
      {
        name: 'update_action_item',
        description: 'Update an existing action item in your AiDD account. Use update_action_items for bulk updates.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            actionItemId: { type: 'string', description: 'ID of the action item to update' },
            title: { type: 'string', description: 'New title for the action item' },
            description: { type: 'string', description: 'New description for the action item' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent', 'critical'], description: 'New priority for the action item' },
            dueDate: { type: 'string', description: 'New due date in ISO format (or null to clear)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'New tags for the action item' },
            category: { type: 'string', enum: ['work', 'personal'], description: 'New category for the action item' },
            isCompleted: { type: 'boolean', description: 'Mark the action item as completed or not' },
          },
          required: ['actionItemId'],
        },
      },
      {
        name: 'update_action_items',
        description: 'Update multiple action items in your AiDD account.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            updates: {
              type: 'array',
              description: 'List of action item updates with actionItemId and fields to change.',
              items: {
                type: 'object',
                properties: {
                  actionItemId: { type: 'string', description: 'ID of the action item to update' },
                  title: { type: 'string', description: 'New title for the action item' },
                  description: { type: 'string', description: 'New description for the action item' },
                  priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent', 'critical'], description: 'New priority for the action item' },
                  dueDate: { type: 'string', description: 'New due date in ISO format (or null to clear)' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'New tags for the action item' },
                  category: { type: 'string', enum: ['work', 'personal'], description: 'New category for the action item' },
                  isCompleted: { type: 'boolean', description: 'Mark the action item as completed or not' },
                },
                required: ['actionItemId'],
              },
            },
          },
          required: ['updates'],
        },
      },
      {
        name: 'delete_action_items',
        description: 'Delete one or more action items from your AiDD account. Also deletes any tasks that were derived/converted from these action items.',
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: { actionItemIds: { type: 'array', items: { type: 'string' }, description: 'IDs of the action items to delete' } },
          required: ['actionItemIds'],
        },
      },
      {
        name: 'update_task',
        description: 'Update an existing task in your AiDD account. Use update_tasks for bulk updates.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'ID of the task to update' },
            title: { type: 'string', description: 'New title for the task' },
            description: { type: 'string', description: 'New description for the task' },
            estimatedTime: { type: 'number', description: 'New estimated time in minutes' },
            energyRequired: { type: 'string', enum: ['low', 'medium', 'high'], description: 'New energy level required' },
            taskType: { type: 'string', enum: ['quick_win', 'focus_required', 'collaborative', 'creative', 'administrative'], description: 'New task type' },
            dueDate: { type: 'string', description: 'New due date in ISO format (or null to clear)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'New tags for the task' },
            isCompleted: { type: 'boolean', description: 'Mark the task as completed or not' },
          },
          required: ['taskId'],
        },
        _meta: {
          'openai/widgetAccessible': true,  // Enable widget-initiated calls (for completing tasks)
        },
      },
      {
        name: 'update_tasks',
        description: 'Update multiple tasks in your AiDD account.',
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            updates: {
              type: 'array',
              description: 'List of task updates with taskId and fields to change.',
              items: {
                type: 'object',
                properties: {
                  taskId: { type: 'string', description: 'ID of the task to update' },
                  title: { type: 'string', description: 'New title for the task' },
                  description: { type: 'string', description: 'New description for the task' },
                  estimatedTime: { type: 'number', description: 'New estimated time in minutes' },
                  energyRequired: { type: 'string', enum: ['low', 'medium', 'high'], description: 'New energy level required' },
                  taskType: { type: 'string', enum: ['quick_win', 'focus_required', 'collaborative', 'creative', 'administrative'], description: 'New task type' },
                  dueDate: { type: 'string', description: 'New due date in ISO format (or null to clear)' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'New tags for the task' },
                  isCompleted: { type: 'boolean', description: 'Mark the task as completed or not' },
                },
                required: ['taskId'],
              },
            },
          },
          required: ['updates'],
        },
      },
      {
        name: 'delete_tasks',
        description: 'Delete one or more tasks from your AiDD account. For "delete all tasks", use delete_all_tasks.',
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: { taskIds: { type: 'array', items: { type: 'string' }, description: 'IDs of the tasks to delete' } },
          required: ['taskIds'],
        },
      },
      {
        name: 'delete_all_tasks',
        description: 'Delete all tasks in your AiDD account. Use only when the user explicitly requests deleting all tasks. Default includes completed tasks.',
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            confirm: { type: 'boolean', description: 'Must be true to proceed. Set only when the user explicitly requests deleting all tasks.' },
            includeCompleted: { type: 'boolean', description: 'Include completed tasks. Default true.' },
            // Filters
            category: { type: 'string', description: 'Filter by category (work/personal)' },
            tags: { type: 'string', description: 'Filter by tags (comma-separated list)' },
            maxTimeMinutes: { type: 'number', description: 'Filter to tasks with estimated time <= this value (in minutes)' },
            maxEnergy: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Filter to tasks with energy level <= this value' },
            onlyAIScored: { type: 'boolean', description: 'Only delete tasks that have been AI scored' },
            dueWithinDays: { type: 'number', description: 'Only delete tasks due within this many days' },
          },
          required: ['confirm'],
        },
      },
      {
        name: 'session_status',
        description: 'Check your AiDD authentication session status including token expiry and subscription tier. Use this to verify your connection is healthy.',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'aidd_overview_tutorial',
        description: 'Get a comprehensive overview of AiDD MCP tools and an interactive hands-on tutorial. Use this to learn what AiDD can do and how to use it effectively for ADHD-optimized productivity.',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['overview', 'tutorial', 'quick_start', 'workflow_examples'],
              description: 'Content mode: overview (all tools explained), tutorial (step-by-step walkthrough), quick_start (fastest way to get productive), workflow_examples (real-world usage patterns). Default: overview'
            },
            tutorialStep: {
              type: 'number',
              description: 'For tutorial mode: which step to show (1-7). Leave empty to see all steps.'
            },
          },
        },
      },
    ];
  }

  private getResources(): Resource[] {
    // Include both data resources and UI widget resources
    const dataResources = [
      { uri: 'aidd://notes', name: 'Notes', description: 'All notes from your AiDD account', mimeType: 'application/json' },
      { uri: 'aidd://action-items', name: 'Action Items', description: 'All action items from your AiDD account', mimeType: 'application/json' },
      { uri: 'aidd://tasks', name: 'Tasks', description: 'All ADHD-optimized tasks from your AiDD account', mimeType: 'application/json' },
    ];

    // Add missing notes-list.html resource (used by list_notes tool)
    const allWidgetResources = [
      ...WIDGET_RESOURCES,
      {
        uri: 'ui://widget/notes-list.html',
        name: 'Notes List',
        description: 'Browse and manage notes from your AiDD account',
        mimeType: 'text/html+skybridge' as const,
      },
    ];

    // Add ChatGPT UI widget resources with _meta for CSP (app submission requirement)
    const widgetResources = allWidgetResources.map(w => ({
      uri: w.uri,
      name: w.name,
      description: w.description,
      mimeType: w.mimeType,
      // Include CSP metadata in _meta as required by ChatGPT Apps SDK
      _meta: {
        'openai/outputTemplate': w.uri,
        'openai/widgetAccessible': true,
        ...WIDGET_CSP_CONFIG,
      },
    }));

    return [...dataResources, ...widgetResources];
  }

  private async handleListNotes(args: any) {
    try {
      // Ensure E2E is initialized before fetching data
      await this.ensureE2EInitialized();

      const includeWidget = args?.includeWidget === true;
      const { includeWidget: _includeWidget, ...listArgs } = args ?? {};

      // Use pagination-aware method to get total count
      const paginatedResult = await this.backendClient.listNotesWithPagination(listArgs);
      let notes = paginatedResult.items;
      const { total, limit, offset, hasMore } = paginatedResult;

      // Decrypt notes if E2E is enabled
      notes = notes.map((note: any) => this.decryptNoteFromSync(note));

      notes = await this.enrichNotesWithExtractedActionItems(notes);

      // Build structured note data for ChatGPT widgets
      // ChatGPT expects JSON-encoded data in the text field for proper widget rendering
      const structuredNotes = notes.map((note: any) => ({
        id: note.id,
        title: note.title,
        contentPreview: note.content ? note.content.substring(0, 200) + (note.content.length > 200 ? '...' : '') : null,
        category: note.category || 'personal',
        tags: note.tags || [],
        status: note.isDeleted ? 'deleted' : 'active',
        // Source/origin info
        sourceNoteId: note.sourceNoteId || null,
        source: note.source || null,
        emailSubject: note.emailSubject || null,
        emailFrom: note.emailFrom || null,
        // Extracted action items
        extractedActionItemCount: (note as any).extractedActionItemCount || 0,
        // Timestamps
        createdAt: note.createdAt || null,
        updatedAt: note.updatedAt || null,
      }));

      // Return JSON-encoded data for ChatGPT widget compatibility
      // Return structuredContent for ChatGPT widget rendering
      // CRITICAL: Include IDs in text content so AI models can use them for delete operations
      const notesList = structuredNotes.map((n: any, i: number) =>
        `${offset + i + 1}. **${n.title || 'Untitled'}** (ID: \`${n.id}\`)${n.category ? ` [${n.category}]` : ''}${n.extractedActionItemCount > 0 ? ` - ${n.extractedActionItemCount} action items` : ''}`
      ).join('\n');

      // Build pagination info for the response
      const paginationInfo = hasMore
        ? `\n\n📄 **Showing ${offset + 1}-${offset + notes.length} of ${total} notes.** To see more, call \`list_notes\` with \`offset: ${offset + limit}\`.`
        : '';

      const result: any = {
        content: [{ type: 'text', text: `📝 **Notes** (showing ${notes.length} of ${total} total)\n\n${notesList}${paginationInfo}\n\n*Use the IDs above with \`delete_notes\` to remove notes.*` } as TextContent],
      };

      if (includeWidget) {
        result.structuredContent = {
          success: true,
          // Pagination metadata
          pagination: {
            total,
            returned: notes.length,
            offset,
            limit,
            hasMore,
            nextOffset: hasMore ? offset + limit : null,
          },
          totalNotes: total, // Keep for backwards compatibility
          notes: structuredNotes,
        };
      }

      return result;
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error listing notes: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleReadNote(args: any) {
    try {
      await this.ensureE2EInitialized();

      let note = await this.backendClient.readNote(args.noteId);

      // Decrypt note if E2E is enabled
      note = this.decryptNoteFromSync(note);

      // Enrich with extracted action items
      const enriched = await this.enrichNotesWithExtractedActionItems([note]);
      note = enriched[0];
      const extractedActionItemsSection = (note as any).extractedActionItems && (note as any).extractedActionItems.length > 0
        ? `\n\n**Extracted Action Items (${(note as any).extractedActionItemCount}):**\n${(note as any).extractedActionItems.map((item: any, i: number) => `${i + 1}. **${item.title}**\n   • Action Item ID: ${item.id}\n   • Priority: ${item.priority}\n   • Category: ${item.category}`).join('\n')}`
        : '';
      const response = `📄 **Note Details**\n\n**Title:** ${note.title}\n**ID:** ${note.id}\n**Category:** ${note.category || 'personal'}\n**Created:** ${new Date(note.createdAt).toLocaleDateString()}\n${note.tags && note.tags.length > 0 ? `**Tags:** ${note.tags.join(', ')}\n` : ''}\n**Content:**\n${note.content}${extractedActionItemsSection}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error reading note: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleCreateNote(args: any) {
    try {
      await this.ensureE2EInitialized();

      const note = await this.backendClient.createNote(args);

      // Use original args for display since we know the plaintext
      const response = `✅ **Note Created**\n\n**Title:** ${args.title}\n**ID:** ${note.id}\n**Category:** ${args.category || 'personal'}\n${args.tags && args.tags.length > 0 ? `**Tags:** ${args.tags.join(', ')}` : ''}\n\nThe note has been saved to your AiDD account.`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error creating note: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleCreateNotes(args: any) {
    try {
      await this.ensureE2EInitialized();

      const { notes } = args;
      if (!notes || !Array.isArray(notes) || notes.length === 0) {
        throw new Error('Notes array is required');
      }

      const errors: Array<{ index: number; title?: string; error: string }> = [];
      const seenKeys = new Set<string>();
      const notesToCreate: any[] = [];

      notes.forEach((note: any, index: number) => {
        const title = typeof note?.title === 'string' ? note.title.trim() : '';
        const content = typeof note?.content === 'string' ? note.content : '';
        if (!title || !content) {
          errors.push({ index, title: title || undefined, error: 'Missing title or content' });
          return;
        }

        const normalizedCategory = note.category === 'work' ? 'work' : 'personal';
        const sourceIdInput = typeof note.sourceId === 'string' ? note.sourceId.trim() : '';
        const importKey = this.buildNoteImportKey({ title, content, category: normalizedCategory });
        const sourceId = sourceIdInput || this.buildNoteSourceId(importKey);
        const dedupeKey = sourceId;

        if (seenKeys.has(dedupeKey)) {
          errors.push({ index, title, error: 'Duplicate item in request' });
          return;
        }
        seenKeys.add(dedupeKey);

        notesToCreate.push({
          title,
          content,
          tags: Array.isArray(note.tags) ? note.tags : [],
          category: normalizedCategory,
          sourceId,
        });
      });

      if (notesToCreate.length === 0) {
        return {
          structuredContent: {
            success: false,
            createdCount: 0,
            errorCount: errors.length,
            noteIds: [],
            notes: [],
            errors,
          },
          content: [{ type: 'text', text: `❌ Error creating notes: no valid notes to create` } as TextContent],
        };
      }

      const savedNotes: any[] = [];
      let createdCount = 0;
      let updatedCount = 0;
      const chunkSize = 100;
      for (let i = 0; i < notesToCreate.length; i += chunkSize) {
        const chunk = notesToCreate.slice(i, i + chunkSize);
        const result = await this.backendClient.saveNotes(chunk as any);
        const resultAny = result as any;
        savedNotes.push(...(resultAny.notes || []));
        createdCount += typeof resultAny.created === 'number' ? resultAny.created : (resultAny.count || chunk.length);
        updatedCount += typeof resultAny.updated === 'number' ? resultAny.updated : 0;
      }

      const errorCount = errors.length;
      const noteIds = savedNotes.map((note: any) => note.id).filter(Boolean);

      let response = `✅ **Notes Created**\n\n**Created:** ${createdCount}`;
      if (updatedCount > 0) {
        response += `\n**Updated:** ${updatedCount}`;
      }
      if (errorCount > 0) {
        response += `\n**Failed:** ${errorCount}`;
      }
      if (noteIds.length > 0) {
        response += `\n\n**Note IDs:**\n${JSON.stringify(noteIds)}`;
      }
      if (errorCount > 0) {
        response += `\n\n⚠️ Some notes failed validation. Check the error list in structured content to retry.`;
      }

      return {
        structuredContent: {
          success: errorCount === 0,
          createdCount,
          updatedCount,
          errorCount,
          noteIds,
          notes: savedNotes,
          errors,
        },
        content: [{ type: 'text', text: response.trim() } as TextContent],
      };
    } catch (error) {
      return {
        structuredContent: {
          success: false,
          createdCount: 0,
          errorCount: 0,
          noteIds: [],
          notes: [],
          errors: [{ index: -1, error: error instanceof Error ? error.message : 'Unknown error' }],
        },
        content: [{ type: 'text', text: `❌ Error creating notes: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent],
      };
    }
  }

  private async handleListActionItems(args: any) {
    try {
      await this.ensureE2EInitialized();

      const includeWidget = args?.includeWidget === true;
      const { includeWidget: _includeWidget, ...listArgs } = args ?? {};

      // Use pagination-aware method to get total count
      const paginatedResult = await this.backendClient.listActionItemsWithPagination(listArgs);
      let actionItems = paginatedResult.items;
      const { total, limit, offset, hasMore } = paginatedResult;

      // Decrypt action items if E2E is enabled
      actionItems = actionItems.map((item: any) => this.decryptActionItemFromSync(item));

      actionItems = await this.enrichActionItemsWithDerivedTasks(actionItems);

      // Build structured action item data for ChatGPT widgets
      // ChatGPT expects JSON-encoded data in the text field for proper widget rendering
      const structuredItems = actionItems.map((item: any) => ({
        id: item.id,
        title: item.title,
        description: item.description || null,
        priority: item.priority || null,
        category: item.category || null,
        status: item.isCompleted ? 'completed' : (item.isDeleted ? 'deleted' : 'pending'),
        // AI confidence
        confidence: item.confidence !== undefined ? Math.round(item.confidence * 100) : undefined,
        // Source info
        sourceNoteId: item.sourceNoteId || null,
        source: item.source || null,
        // Derived tasks
        derivedTaskCount: item.derivedTaskCount || 0,
        // Due date and tags
        dueDate: item.dueDate || null,
        tags: item.tags || [],
        // Timestamps
        createdAt: item.createdAt || null,
        updatedAt: item.updatedAt || null,
      }));

      // Return JSON-encoded data for ChatGPT widget compatibility
      // Return structuredContent for ChatGPT widget rendering
      // CRITICAL: Include IDs in text content so AI models can use them for delete operations

      // Check if any action items are encrypted (couldn't be decrypted)
      const encryptedItemCount = structuredItems.filter((item: any) => item.title?.includes('[Encrypted')).length;
      const hasEncryptedItems = encryptedItemCount > 0;

      const itemsList = structuredItems.map((item: any, i: number) => {
        const priorityEmoji = item.priority === 'critical' || item.priority === 'urgent' ? '🔴' : item.priority === 'high' ? '🟠' : item.priority === 'medium' ? '🟡' : '🟢';
        const statusIcon = item.status === 'completed' ? '✅' : item.derivedTaskCount > 0 ? '🔄' : '⬜';
        return `${offset + i + 1}. ${statusIcon} **${item.title}** (ID: \`${item.id}\`) ${priorityEmoji}${item.dueDate ? ` 📅${new Date(item.dueDate).toLocaleDateString()}` : ''}${item.derivedTaskCount > 0 ? ` → ${item.derivedTaskCount} tasks` : ''}`;
      }).join('\n');

      // Build pagination info for the response
      const paginationInfo = hasMore
        ? `\n\n📄 **Showing ${offset + 1}-${offset + actionItems.length} of ${total} action items.** To see more, call \`list_action_items\` with \`offset: ${offset + limit}\`.`
        : '';

      // Add encryption warning if some items couldn't be decrypted
      const encryptionWarning = hasEncryptedItems
        ? `\n\n🔐 **Note:** ${encryptedItemCount} action item(s) are encrypted and couldn't be decrypted. Please open the AiDD iOS app to sync your encryption key.`
        : '';

      const result: any = {
        content: [{ type: 'text', text: `✅ **Action Items** (showing ${actionItems.length} of ${total} total)\n\n${itemsList}${paginationInfo}${encryptionWarning}\n\n*Use the IDs above with \`delete_action_items\` to remove items.*` } as TextContent],
      };

      if (includeWidget) {
        result.structuredContent = {
          success: true,
          // Pagination metadata
          pagination: {
            total,
            returned: actionItems.length,
            offset,
            limit,
            hasMore,
            nextOffset: hasMore ? offset + limit : null,
          },
          totalActionItems: total, // Keep for backwards compatibility
          actionItems: structuredItems,
          // Encryption status for widget display
          hasEncryptedItems,
          encryptedItemCount,
        };
      }

      return result;
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error listing action items: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleReadActionItem(args: any) {
    try {
      await this.ensureE2EInitialized();

      let item = await this.backendClient.readActionItem(args.actionItemId);

      // Decrypt action item if E2E is enabled
      item = this.decryptActionItemFromSync(item);

      // Enrich with derived tasks
      const enriched = await this.enrichActionItemsWithDerivedTasks([item]);
      item = enriched[0];
      const derivedTasksSection = (item as any).derivedTasks && (item as any).derivedTasks.length > 0
        ? `\n\n**Derived Tasks (${(item as any).derivedTaskCount}):**\n${(item as any).derivedTasks.map((task: any, i: number) => `${i + 1}. **${task.title}**\n   • Task ID: ${task.id}\n   ${task.estimatedTime ? `• Est. Time: ${task.estimatedTime} min` : ''}\n   ${task.energyRequired ? `• Energy: ${task.energyRequired}` : ''}`).join('\n')}`
        : '';
      const sourceNoteSection = typeof item.sourceNoteId === 'string' && item.sourceNoteId.length > 0 && !item.sourceNoteId.startsWith('mcp-import:')
        ? `\n**Source Note ID:** ${item.sourceNoteId}`
        : '';
      const response = `📋 **Action Item Details**\n\n**Title:** ${item.title}\n**ID:** ${item.id}\n**Priority:** ${item.priority}\n**Category:** ${item.category}\n${item.dueDate ? `**Due Date:** ${new Date(item.dueDate).toLocaleDateString()}\n` : ''}${item.tags && item.tags.length > 0 ? `**Tags:** ${item.tags.join(', ')}\n` : ''}${sourceNoteSection}\n\n**Description:**\n${item.description || 'No description'}${derivedTasksSection}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error reading action item: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleCreateActionItem(args: any) {
    try {
      await this.ensureE2EInitialized();

      const { title, description, priority = 'medium', dueDate, tags = [], category = 'work' } = args;
      const normalizedPriority = this.normalizeActionItemPriority(priority);
      const normalizedCategory: 'work' | 'personal' = category === 'personal' ? 'personal' : 'work';
      const actionItemData = {
        title,
        description: description || '',
        priority: normalizedPriority,
        dueDate,
        tags,
        category: normalizedCategory,
        confidence: 1.0,
      };

      const createdItem = await this.backendClient.createActionItem(actionItemData);

      // Use original args for display since we know the plaintext
      const response = `✅ **Action Item Created**\n\n**Title:** ${title}\n**ID:** ${createdItem.id}\n**Priority:** ${normalizedPriority}\n**Category:** ${normalizedCategory}\n${dueDate ? `**Due Date:** ${dueDate}` : ''}\n${tags && tags.length > 0 ? `**Tags:** ${tags.join(', ')}` : ''}\n\nThe action item has been saved to your AiDD account.`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error creating action item: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleCreateActionItems(args: any) {
    try {
      await this.ensureE2EInitialized();

      const { items } = args;
      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new Error('Items array is required');
      }

      const errors: Array<{ index: number; title?: string; error: string }> = [];
      const seenKeys = new Set<string>();
      const actionItemsToCreate: any[] = [];

      items.forEach((item: any, index: number) => {
        const title = typeof item?.title === 'string' ? item.title.trim() : '';
        if (!title) {
          errors.push({ index, error: 'Missing title' });
          return;
        }

        const description = typeof item.description === 'string' ? item.description : '';
        const normalizedPriority = this.normalizeActionItemPriority(item.priority);
        const normalizedCategory = item.category === 'personal' ? 'personal' : 'work';
        const sourceNoteIdInput = typeof item.sourceNoteId === 'string' ? item.sourceNoteId.trim() : '';
        const importKey = this.buildActionItemImportKey({
          title,
          description,
          category: normalizedCategory,
          dueDate: item.dueDate,
        });
        const sourceNoteId = sourceNoteIdInput || this.buildActionItemSourceNoteId(importKey);
        const dedupeKey = `${sourceNoteId}:${this.normalizeImportValue(title)}`;

        if (seenKeys.has(dedupeKey)) {
          errors.push({ index, title, error: 'Duplicate item in request' });
          return;
        }
        seenKeys.add(dedupeKey);

        actionItemsToCreate.push({
          title,
          description,
          priority: normalizedPriority,
          dueDate: item.dueDate,
          tags: Array.isArray(item.tags) ? item.tags : [],
          category: normalizedCategory,
          confidence: 1.0,
          sourceNoteId,
        });
      });

      if (actionItemsToCreate.length === 0) {
        return {
          structuredContent: {
            success: false,
            createdCount: 0,
            errorCount: errors.length,
            actionItemIds: [],
            actionItems: [],
            errors,
          },
          content: [{ type: 'text', text: `❌ Error creating action items: no valid items to create` } as TextContent],
        };
      }

      const savedItems: any[] = [];
      let createdCount = 0;
      let updatedCount = 0;
      const chunkSize = 100;
      for (let i = 0; i < actionItemsToCreate.length; i += chunkSize) {
        const chunk = actionItemsToCreate.slice(i, i + chunkSize);
        const result = await this.backendClient.saveActionItems(chunk as any);
        const resultAny = result as any;
        savedItems.push(...(resultAny.actionItems || []));
        createdCount += typeof resultAny.created === 'number' ? resultAny.created : (resultAny.count || chunk.length);
        updatedCount += typeof resultAny.updated === 'number' ? resultAny.updated : 0;
      }

      const errorCount = errors.length;
      const actionItemIds = savedItems.map((item: any) => item.id).filter(Boolean);

      let response = `✅ **Action Items Created**\n\n**Created:** ${createdCount}`;
      if (updatedCount > 0) {
        response += `\n**Updated:** ${updatedCount}`;
      }
      if (errorCount > 0) {
        response += `\n**Failed:** ${errorCount}`;
      }
      if (actionItemIds.length > 0) {
        response += `\n\n**Action Item IDs:**\n${JSON.stringify(actionItemIds)}`;
      }
      if (errorCount > 0) {
        response += `\n\n⚠️ Some items failed validation. Check the error list in structured content to retry.`;
      }

      return {
        structuredContent: {
          success: errorCount === 0,
          createdCount,
          updatedCount,
          errorCount,
          actionItemIds,
          actionItems: savedItems,
          errors,
        },
        content: [{ type: 'text', text: response.trim() } as TextContent],
      };
    } catch (error) {
      return {
        structuredContent: {
          success: false,
          createdCount: 0,
          errorCount: 0,
          actionItemIds: [],
          actionItems: [],
          errors: [{ index: -1, error: error instanceof Error ? error.message : 'Unknown error' }],
        },
        content: [{ type: 'text', text: `❌ Error creating action items: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent],
      };
    }
  }

  private async handleExtractActionItems(args: any) {
    try {
      const usageCheck = await this.checkOperationLimit('extraction');
      if (!usageCheck.allowed) return this.formatLimitReachedResponse(usageCheck);

      const { source, noteIds, text, extractionMode = 'adhd-optimized' } = args;
      let notesToProcess: any[] = [];
      let skippedCount = 0;

      if (source === 'notes') {
        const existingActionItems = await this.backendClient.listActionItems({});
        const extractedNoteIds = new Set(existingActionItems.filter((item: any) => item.sourceNoteId).map((item: any) => item.sourceNoteId));

        if (!noteIds || noteIds.length === 0) {
          const allNotes = await this.backendClient.listNotes({});
          const originalCount = allNotes.length;
          notesToProcess = allNotes.filter((note: any) => !extractedNoteIds.has(note.id));
          skippedCount = originalCount - notesToProcess.length;
        } else {
          for (const noteId of noteIds) {
            if (!extractedNoteIds.has(noteId)) {
              const note = await this.backendClient.readNote(noteId);
              notesToProcess.push(note);
            } else {
              skippedCount++;
            }
          }
        }

        if (notesToProcess.length === 0) {
          return { content: [{ type: 'text', text: `📋 **All Notes Already Processed**\n\nAll ${skippedCount} notes have already had action items extracted.\nNo new processing needed.\n\nTo extract action items from specific notes again, use the \`noteIds\` parameter with specific note IDs.` } as TextContent] };
        }
      } else if (source === 'text') {
        if (!text) throw new Error('Text content is required when source is "text"');
        notesToProcess = [{ id: 'temp', title: 'User Provided Text', content: text }];
      }

      const actionItems = await this.backendClient.extractActionItems(notesToProcess);
      let savedCount = 0;
      let savedActionItems: any[] = [];
      if (actionItems.length > 0) {
        try {
          const saveResult = await this.backendClient.saveActionItems(actionItems);
          savedCount = saveResult.count;
          savedActionItems = saveResult.actionItems || [];
        } catch (saveError) {
          console.error('[MCP] Failed to save extracted action items:', saveError);
        }
      }

      // Collect saved action item IDs (with actual Firestore IDs) for follow-up operations (like convert_to_tasks)
      // Fall back to extracted IDs only if save failed
      const actionItemIds = savedActionItems.length > 0
        ? savedActionItems.map((item: any) => item.id).filter(Boolean)
        : actionItems.map((item: any) => item.id).filter(Boolean);

      // Use saved action items for display if available (they have the correct Firestore IDs)
      const displayItems = savedActionItems.length > 0 ? savedActionItems : actionItems;

      let response = `🔍 **Action Items Extracted**\n\n**Summary:**\n• Source: ${source === 'notes' ? `${notesToProcess.length} notes` : 'provided text'}\n${skippedCount > 0 ? `• Skipped: ${skippedCount} notes (already extracted)` : ''}\n• Extraction mode: ${extractionMode}\n• Action items found: ${actionItems.length}\n• Action items saved: ${savedCount}\n\n**Extracted Action Items:**\n${displayItems.slice(0, 10).map((item: any, i: number) => `${i + 1}. **${item.title}**\n   • ID: ${item.id}\n   • Priority: ${item.priority}\n   • Category: ${item.category}\n   • Confidence: ${(item.confidence * 100).toFixed(0)}%\n   ${item.dueDate ? `• Due: ${item.dueDate}` : ''}\n   ${item.tags && item.tags.length > 0 ? `• Tags: ${item.tags.join(', ')}` : ''}`).join('\n')}\n${displayItems.length > 10 ? `\n... and ${displayItems.length - 10} more items` : ''}\n\n✅ ${savedCount} action items have been saved to your AiDD account.\n\n**Action Item IDs (for convert_to_tasks):**\n${JSON.stringify(actionItemIds)}`;
      response = this.appendUsageWarning(response, usageCheck);
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error extracting action items: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  /**
   * Enrich tasks with their source action item data
   */
  private async enrichTasksWithSourceActionItems(tasks: any[]): Promise<any[]> {
    const actionItemIds = [...new Set(tasks.filter(t => t.actionItemId).map(t => t.actionItemId))];
    if (actionItemIds.length === 0) return tasks;

    const actionItemsMap = new Map<string, any>();
    for (const id of actionItemIds) {
      try {
        const actionItem = await this.backendClient.readActionItem(id);
        actionItemsMap.set(id, actionItem);
      } catch (error) {
        console.warn(`Could not fetch action item ${id}:`, error);
      }
    }

    return tasks.map(task => {
      if (task.actionItemId && actionItemsMap.has(task.actionItemId)) {
        return { ...task, sourceActionItem: actionItemsMap.get(task.actionItemId) };
      }
      return task;
    });
  }

  /**
   * Sort tasks purely by AI score (ignoring dependencies)
   * @param tasks - Tasks to sort
   * @param ascending - If true, sort lowest scores first; default is highest first
   */
  private sortTasksByScore(tasks: any[], ascending: boolean = false): any[] {
    const getOverallScore = (task: any): number => {
      if (task.relevanceScore !== undefined && task.impactScore !== undefined && task.urgencyScore !== undefined) {
        return (task.relevanceScore + task.impactScore + task.urgencyScore) / 3;
      }
      return 0;
    };

    return [...tasks].sort((a, b) => {
      const scoreA = getOverallScore(a);
      const scoreB = getOverallScore(b);
      return ascending ? scoreA - scoreB : scoreB - scoreA;
    });
  }

  /**
   * Sort tasks by dependency order (topological sort)
   * Tasks with no dependencies come first, then tasks that depend on those, etc.
   * Within each level, tasks are sorted by taskOrder
   */
  private sortTasksByDependencyOrder(tasks: any[]): any[] {
    // Group tasks by actionItemId for proper dependency resolution
    const tasksByActionItem = new Map<string, any[]>();
    const standalonesTasks: any[] = [];

    tasks.forEach(task => {
      if (task.actionItemId) {
        const group = tasksByActionItem.get(task.actionItemId) || [];
        group.push(task);
        tasksByActionItem.set(task.actionItemId, group);
      } else {
        standalonesTasks.push(task);
      }
    });

    // Sort each action item's tasks by dependency order
    const sortedGroups: any[] = [];
    tasksByActionItem.forEach((groupTasks, actionItemId) => {
      const sorted = this.topologicalSort(groupTasks);
      sortedGroups.push(...sorted);
    });

    // Standalone tasks go at the end
    return [...sortedGroups, ...standalonesTasks];
  }

  /**
   * Sort tasks by score while respecting dependencies using DFS.
   * Prioritizes unblocking high-value dependency chains.
   *
   * Algorithm:
   * 1. Process tasks in AI score order (highest first)
   * 2. For each task, recursively visit its dependencies first (also in score order)
   * 3. This ensures blockers of high-score tasks come before lower-score independent tasks
   *
   * Example: If Task A (score 90) depends on Task B (score 30), and Task C (score 80)
   * has no dependencies, the order will be: B (30), A (90), C (80)
   * Because B unblocks the highest-scored task A, so we prioritize that chain.
   *
   * CRITICAL FIX: taskOrder is scoped per-actionItemId, so dependency resolution
   * must use actionItemId:taskOrder as the key, not just taskOrder alone.
   * Without this, tasks from different action items could incorrectly appear as dependencies.
   */
  private sortTasksByScoreWithDependencies(tasks: any[]): any[] {
    if (tasks.length === 0) return [];

    // Calculate overall score for each task (matches iOS overallScore calculation)
    const getOverallScore = (task: any): number => {
      if (task.relevanceScore !== undefined && task.impactScore !== undefined && task.urgencyScore !== undefined) {
        return (task.relevanceScore + task.impactScore + task.urgencyScore) / 3;
      }
      return 0; // Unscored tasks have lowest priority
    };

    // Build task lookup by ID
    const taskById = new Map<string, any>();
    tasks.forEach(task => {
      if (task.id) {
        taskById.set(task.id, task);
      }
    });

    // Build task order to ID mapping (for dependsOnTaskOrders resolution)
    // CRITICAL: Key includes actionItemId for proper scoping since taskOrder is per-action-item
    // Without this fix, tasks with same taskOrder from different action items would collide,
    // causing incorrect dependencies to be resolved (low-score tasks incorrectly pulled to front)
    const orderToId = new Map<string, string>();
    tasks.forEach(task => {
      if (task.taskOrder !== undefined && task.id && task.actionItemId) {
        orderToId.set(`${task.actionItemId}:${task.taskOrder}`, task.id);
      }
    });

    // Get all dependency IDs for a task (resolving both taskOrder and taskId references)
    const getDependencyIds = (task: any): string[] => {
      const depIds: string[] = [];

      // Resolve dependsOnTaskOrders to IDs (scoped by actionItemId)
      const orderDeps = task.dependsOnTaskOrders || [];
      if (task.actionItemId) {
        orderDeps.forEach((depOrder: number) => {
          const key = `${task.actionItemId}:${depOrder}`;
          const depId = orderToId.get(key);
          if (depId && taskById.has(depId)) {
            depIds.push(depId);
          }
        });
      }

      // Add direct ID dependencies
      const idDeps = task.dependsOnTaskIds || [];
      idDeps.forEach((depId: string) => {
        if (taskById.has(depId) && !depIds.includes(depId)) {
          depIds.push(depId);
        }
      });

      return depIds;
    };

    // Sort dependencies by score (highest first) - matches iOS sortedDependencies
    const getSortedDependencies = (task: any): string[] => {
      const depIds = getDependencyIds(task);
      return depIds
        .map(depId => ({ id: depId, score: getOverallScore(taskById.get(depId)) }))
        .sort((a, b) => b.score - a.score)
        .map(d => d.id);
    };

    // DFS topological sort with score-based ordering (matches iOS topologicalSortTasks)
    const result: any[] = [];
    const visited = new Set<string>();
    const selectedTaskIds = new Set(tasks.map(t => t.id));

    const visit = (task: any) => {
      if (!task.id || visited.has(task.id)) return;
      visited.add(task.id);

      // Visit dependencies first, in score order (highest first)
      for (const depId of getSortedDependencies(task)) {
        // Only visit if this dependency is in our task list
        if (selectedTaskIds.has(depId)) {
          const depTask = taskById.get(depId);
          if (depTask) {
            visit(depTask);
          }
        }
      }

      result.push(task);
    };

    // Process tasks in AI score order (highest first)
    // This ensures high-score chains are processed first, pulling their blockers to the front
    const tasksSortedByScore = [...tasks].sort((a, b) => getOverallScore(b) - getOverallScore(a));

    for (const task of tasksSortedByScore) {
      visit(task);
    }

    return result;
  }

  /**
   * Sort tasks matching iOS DashboardTasksData.sortTasksRespectingDependencies algorithm.
   *
   * Algorithm (matches iOS exactly):
   * 1. Sort all tasks by AI score (highest first)
   * 2. Build "critical paths" for each task (task + all its prerequisites)
   * 3. Greedily fill time window:
   *    - For each task in score order, collect all prerequisites recursively
   *    - If task + prerequisites fit in remaining time, add prerequisites first, then task
   * 4. Final topological sort to ensure dependencies appear before dependents
   */
  private sortTasksByChainPriority(tasks: any[], timeBudgetMinutes?: number): any[] {
    if (tasks.length === 0) return [];

    console.log('[MCP:sortTasksByChainPriority] Starting with', tasks.length, 'tasks, timeBudget:', timeBudgetMinutes);

    // Helper to get score from task
    const getOverallScore = (task: any): number => {
      if (task.score !== undefined) return task.score;
      if (task.overallScore !== undefined) return task.overallScore;
      if (task.relevanceScore !== undefined && task.impactScore !== undefined && task.urgencyScore !== undefined) {
        return (task.relevanceScore + task.impactScore + task.urgencyScore) / 3 * 100;
      }
      return 0;
    };

    const getEstimatedMinutes = (task: any): number => {
      return task.estimatedTime || 15; // Default 15 minutes
    };

    // Build lookup maps
    const taskById = new Map<string, any>();
    // Use actionItemId:taskOrder as composite key to avoid collisions across action items
    const orderToTask = new Map<string, any>();

    tasks.forEach(task => {
      if (task.id) taskById.set(task.id, task);
      if (task.taskOrder !== undefined) {
        const key = task.actionItemId ? `${task.actionItemId}:${task.taskOrder}` : `_:${task.taskOrder}`;
        orderToTask.set(key, task);
      }
    });

    // Log dependency stats
    const tasksWithDependsOnTaskOrders = tasks.filter(t => t.dependsOnTaskOrders && t.dependsOnTaskOrders.length > 0);
    const tasksWithDependsOnTaskIds = tasks.filter(t => t.dependsOnTaskIds && t.dependsOnTaskIds.length > 0);
    const tasksWithActionItemId = tasks.filter(t => t.actionItemId);
    console.log('[MCP:sortTasksByChainPriority] Dependency stats:',
      'withDependsOnTaskOrders:', tasksWithDependsOnTaskOrders.length,
      'withDependsOnTaskIds:', tasksWithDependsOnTaskIds.length,
      'withActionItemId:', tasksWithActionItemId.length,
      'orderToTask entries:', orderToTask.size);

    // Log actual dependency references to debug resolution
    tasksWithDependsOnTaskIds.forEach(task => {
      const depIds = task.dependsOnTaskIds || [];
      const resolvedDeps = depIds.filter((depId: string) => taskById.has(depId));
      const unresolvedDeps = depIds.filter((depId: string) => !taskById.has(depId));
      console.log('[MCP:sortTasksByChainPriority] Task', task.id?.slice(-8),
        'title:', task.title?.slice(0, 30),
        'dependsOnTaskIds:', depIds.length,
        'resolved:', resolvedDeps.length,
        'unresolved:', unresolvedDeps.length,
        unresolvedDeps.length > 0 ? 'unresolvedIds:' + unresolvedDeps.map((id: string) => id.slice(-8)).join(',') : '');
    });

    // Get all dependency IDs for a task
    const getDependencyIds = (task: any): string[] => {
      const depIds: string[] = [];

      // From dependsOnTaskOrders (use composite key)
      const orderDeps = task.dependsOnTaskOrders || [];
      orderDeps.forEach((depOrder: number) => {
        const key = task.actionItemId ? `${task.actionItemId}:${depOrder}` : `_:${depOrder}`;
        const depTask = orderToTask.get(key);
        if (depTask?.id) {
          depIds.push(depTask.id);
        }
      });

      // From dependsOnTaskIds
      const idDeps = task.dependsOnTaskIds || [];
      idDeps.forEach((depId: string) => {
        if (taskById.has(depId) && !depIds.includes(depId)) {
          depIds.push(depId);
        }
      });

      return depIds;
    };

    // Collect all prerequisites recursively (iOS: collectAllPrerequisitesForSelection)
    const collectAllPrerequisites = (taskId: string, visited: Set<string> = new Set()): string[] => {
      if (visited.has(taskId)) return [];
      visited.add(taskId);

      const task = taskById.get(taskId);
      if (!task) return [];

      const prerequisites: string[] = [];
      for (const depId of getDependencyIds(task)) {
        if (!visited.has(depId)) {
          prerequisites.push(...collectAllPrerequisites(depId, visited));
          prerequisites.push(depId);
        }
      }

      return prerequisites;
    };

    // Step 1: Sort tasks by score (highest first) - iOS: tasksSortedByScore
    const tasksSortedByScore = [...tasks].sort((a, b) => getOverallScore(b) - getOverallScore(a));

    // Step 2 & 3: Greedy time-filling algorithm (iOS: critical paths + greedy filling)
    const selectedTasks: any[] = [];
    const selectedIds = new Set<string>();
    let totalTimeMinutes = 0;
    const hasTimeBudget = timeBudgetMinutes !== undefined && timeBudgetMinutes > 0;
    const availableMinutes = hasTimeBudget ? timeBudgetMinutes : Infinity;

    // Log first 5 tasks in score order for debugging
    console.log('[MCP:sortTasksByChainPriority] First 5 tasks by score:',
      tasksSortedByScore.slice(0, 5).map(t => ({
        id: t.id?.slice(-8),
        title: t.title?.slice(0, 25),
        score: getOverallScore(t),
        deps: (t.dependsOnTaskIds || []).length
      })));

    for (const task of tasksSortedByScore) {
      if (!task.id || selectedIds.has(task.id)) continue;

      // Collect all prerequisites for this task
      const prerequisiteIds = collectAllPrerequisites(task.id);
      const tasksToAdd: any[] = [];
      let chainDuration = getEstimatedMinutes(task);

      // Log if task has prerequisites
      if (prerequisiteIds.length > 0) {
        console.log('[MCP:sortTasksByChainPriority] Task', task.id?.slice(-8),
          'has', prerequisiteIds.length, 'prerequisites:',
          prerequisiteIds.map(id => id.slice(-8)).join(','));
      }

      // Check if all prerequisites can fit
      for (const prereqId of prerequisiteIds) {
        if (selectedIds.has(prereqId)) continue; // Already selected

        const prereqTask = taskById.get(prereqId);
        if (!prereqTask) continue;

        tasksToAdd.push(prereqTask);
        chainDuration += getEstimatedMinutes(prereqTask);
      }

      // Check if entire chain fits in remaining time
      if (hasTimeBudget && totalTimeMinutes + chainDuration > availableMinutes) {
        continue; // Skip this task and its chain
      }

      // Add prerequisites first (in dependency order)
      for (const prereqTask of tasksToAdd) {
        if (!selectedIds.has(prereqTask.id)) {
          selectedTasks.push(prereqTask);
          selectedIds.add(prereqTask.id);
          totalTimeMinutes += getEstimatedMinutes(prereqTask);
        }
      }

      // Add the main task
      selectedTasks.push(task);
      selectedIds.add(task.id);
      totalTimeMinutes += getEstimatedMinutes(task);
    }

    // Step 4: Final topological sort (iOS: topologicalSortTasks)
    // Process in score order, visiting dependencies first
    console.log('[MCP:sortTasksByChainPriority] selectedTasks before topological sort:', selectedTasks.length);
    const result = this.topologicalSortByScore(selectedTasks, taskById, getDependencyIds, getOverallScore);
    console.log('[MCP:sortTasksByChainPriority] Final result:', result.length, 'tasks');
    return result;
  }

  /**
   * Topological sort that processes in score order and visits dependencies first.
   * Matches iOS DashboardTasksData.topologicalSortTasks
   */
  private topologicalSortByScore(
    tasks: any[],
    taskById: Map<string, any>,
    getDependencyIds: (task: any) => string[],
    getOverallScore: (task: any) => number
  ): any[] {
    if (tasks.length <= 1) return tasks;

    const selectedTaskIds = new Set(tasks.map(t => t.id));
    const result: any[] = [];
    const visited = new Set<string>();

    // Get sorted dependencies for a task
    const getSortedDependencies = (task: any): string[] => {
      const depIds = getDependencyIds(task);
      return depIds
        .filter(depId => selectedTaskIds.has(depId))
        .map(depId => ({ id: depId, score: getOverallScore(taskById.get(depId)) }))
        .sort((a, b) => b.score - a.score)
        .map(d => d.id);
    };

    const visit = (task: any) => {
      if (!task.id || visited.has(task.id)) return;
      visited.add(task.id);

      // Visit dependencies first, in score order (highest first)
      for (const depId of getSortedDependencies(task)) {
        const depTask = taskById.get(depId);
        if (depTask) {
          visit(depTask);
        }
      }

      result.push(task);
    };

    // Process tasks in score order (highest first)
    const tasksSortedByScore = [...tasks].sort((a, b) => getOverallScore(b) - getOverallScore(a));
    for (const task of tasksSortedByScore) {
      visit(task);
    }

    return result;
  }

  /**
   * Perform topological sort on tasks within a group
   */
  private topologicalSort(tasks: any[]): any[] {
    if (tasks.length === 0) return [];

    // Build task order lookup
    const taskByOrder = new Map<number, any>();
    tasks.forEach(task => {
      if (task.taskOrder !== undefined) {
        taskByOrder.set(task.taskOrder, task);
      }
    });

    // Build dependency graph: taskOrder -> set of dependent taskOrders
    const dependentsOf = new Map<number, Set<number>>(); // order -> who depends on this order
    const dependencyCount = new Map<number, number>(); // order -> how many dependencies

    tasks.forEach(task => {
      if (task.taskOrder === undefined) return;
      const deps = task.dependsOnTaskOrders || [];
      dependencyCount.set(task.taskOrder, deps.length);

      deps.forEach((depOrder: number) => {
        if (!dependentsOf.has(depOrder)) {
          dependentsOf.set(depOrder, new Set());
        }
        dependentsOf.get(depOrder)!.add(task.taskOrder);
      });
    });

    // Kahn's algorithm for topological sort
    const queue: number[] = [];
    const result: any[] = [];

    // Start with tasks that have no dependencies
    tasks.forEach(task => {
      if (task.taskOrder !== undefined && (dependencyCount.get(task.taskOrder) || 0) === 0) {
        queue.push(task.taskOrder);
      }
    });

    // Sort queue by taskOrder for stable ordering
    queue.sort((a, b) => a - b);

    while (queue.length > 0) {
      const order = queue.shift()!;
      const task = taskByOrder.get(order);
      if (task) {
        result.push(task);
      }

      // Reduce dependency count for dependents
      const dependents = dependentsOf.get(order) || new Set();
      const newlyReady: number[] = [];
      dependents.forEach(depOrder => {
        const count = (dependencyCount.get(depOrder) || 0) - 1;
        dependencyCount.set(depOrder, count);
        if (count === 0) {
          newlyReady.push(depOrder);
        }
      });

      // Sort newly ready tasks by taskOrder and add to queue
      newlyReady.sort((a, b) => a - b);
      queue.push(...newlyReady);
    }

    // Add any tasks without taskOrder at the end
    tasks.forEach(task => {
      if (task.taskOrder === undefined) {
        result.push(task);
      }
    });

    return result;
  }

  /**
   * Enrich action items with tasks that were derived from them
   */
  private async enrichActionItemsWithDerivedTasks(actionItems: any[]): Promise<any[]> {
    if (actionItems.length === 0) return actionItems;

    try {
      const allTasks = await this.backendClient.listTasks({ limit: 500 });
      const tasksByActionItemId = new Map<string, any[]>();
      for (const task of allTasks) {
        if (task.actionItemId) {
          if (!tasksByActionItemId.has(task.actionItemId)) {
            tasksByActionItemId.set(task.actionItemId, []);
          }
          tasksByActionItemId.get(task.actionItemId)!.push(task);
        }
      }

      return actionItems.map(item => {
        const derivedTasks = tasksByActionItemId.get(item.id) || [];
        return { ...item, derivedTasks, derivedTaskCount: derivedTasks.length };
      });
    } catch (error) {
      console.warn('Could not fetch tasks for enrichment:', error);
      return actionItems;
    }
  }

  /**
   * Enrich notes with action items that were extracted from them
   */
  private async enrichNotesWithExtractedActionItems(notes: any[]): Promise<any[]> {
    if (notes.length === 0) return notes;

    try {
      const allActionItems = await this.backendClient.listActionItems({ limit: 500 });
      const actionItemsByNoteId = new Map<string, any[]>();
      for (const item of allActionItems) {
        const noteId = (item as any).noteId || (item as any).sourceNoteId;
        if (noteId) {
          if (!actionItemsByNoteId.has(noteId)) {
            actionItemsByNoteId.set(noteId, []);
          }
          actionItemsByNoteId.get(noteId)!.push(item);
        }
      }

      return notes.map(note => {
        const extractedActionItems = actionItemsByNoteId.get(note.id) || [];
        return { ...note, extractedActionItems, extractedActionItemCount: extractedActionItems.length };
      });
    } catch (error) {
      console.warn('Could not fetch action items for enrichment:', error);
      return notes;
    }
  }

  private async handleListTasks(args: any) {
    try {
      console.log('[MCP] handleListTasks called with args:', JSON.stringify(args));
      // Log filter parameters specifically for debugging
      console.log('[MCP] Filter params - category:', args.category, 'maxEnergy:', args.maxEnergy,
        'maxTimeMinutes:', args.maxTimeMinutes, 'onlyAIScored:', args.onlyAIScored);
      await this.ensureE2EInitialized();

      const includeWidget = args?.includeWidget === true;

      // For scoreWithDependencies (default) or score sorting, we need the backend to return
      // tasks sorted by score first, then we apply dependency-aware ordering client-side.
      // This ensures we get the highest-scored tasks in the paginated result.
      const backendArgs = { ...args };
      delete backendArgs.includeWidget;
      if (!backendArgs.sortBy || backendArgs.sortBy === 'score' || backendArgs.sortBy === 'scoreWithDependencies') {
        backendArgs.sortBy = 'score';
        backendArgs.order = backendArgs.order || 'desc'; // Highest scores first
      }

      // Use pagination-aware method to get total count
      console.log('[MCP] Calling listTasksWithPagination with backend args:', JSON.stringify(backendArgs));
      console.log('[MCP] Filters being passed: category=' + backendArgs.category +
        ', maxEnergy=' + backendArgs.maxEnergy +
        ', maxTimeMinutes=' + backendArgs.maxTimeMinutes +
        ', onlyAIScored=' + backendArgs.onlyAIScored +
        ', dueWithinDays=' + backendArgs.dueWithinDays);
      const paginatedResult = await this.backendClient.listTasksWithPagination(backendArgs);
      console.log('[MCP] listTasksWithPagination returned', paginatedResult.items.length, 'tasks, total:', paginatedResult.total);
      let tasks = paginatedResult.items;
      const { total, limit, offset, hasMore } = paginatedResult;

      // Decrypt tasks if E2E is enabled
      tasks = tasks.map((task: any) => this.decryptTaskFromSync(task));

      tasks = await this.enrichTasksWithSourceActionItems(tasks);

      // Build task lookup maps for dependency resolution
      const taskByOrder: Map<string, any> = new Map(); // actionItemId:taskOrder -> task
      const taskById: Map<string, any> = new Map(); // taskId -> task
      tasks.forEach((task: any) => {
        taskById.set(task.id, task);
        if (task.actionItemId && task.taskOrder !== undefined) {
          taskByOrder.set(`${task.actionItemId}:${task.taskOrder}`, task);
        }
      });

      // Add resolved dependency tasks (full objects with sourceActionItem) to each task
      tasks = tasks.map((task: any) => {
        if (task.dependsOnTaskOrders && task.dependsOnTaskOrders.length > 0 && task.actionItemId) {
          const dependencyTasks = task.dependsOnTaskOrders
            .map((order: number) => {
              const depTask = taskByOrder.get(`${task.actionItemId}:${order}`);
              if (depTask) {
                // Return essential task data including sourceActionItem
                return {
                  id: depTask.id,
                  title: depTask.title,
                  taskOrder: depTask.taskOrder,
                  isCompleted: depTask.isCompleted || false,
                  estimatedTime: depTask.estimatedTime,
                  energyRequired: depTask.energyRequired,
                  sourceActionItem: depTask.sourceActionItem ? {
                    title: depTask.sourceActionItem.title,
                    priority: depTask.sourceActionItem.priority,
                    category: depTask.sourceActionItem.category,
                  } : null,
                };
              }
              return { title: `Task #${order}`, id: null };
            });
          task.resolvedDependencies = dependencyTasks.map((t: any) => t.title); // Keep string array for backward compat
          task.resolvedDependencyTasks = dependencyTasks; // Full task objects for widget
        }
        return task;
      });

      // Sort tasks - default is scoreWithDependencies for best "what should I work on next" results
      console.log('[MCP] Sorting - args.sortBy:', args.sortBy, 'args.ignoreDependencies:', args.ignoreDependencies);
      const preSort = tasks.slice(0, 5).map((t: any) => ({ id: t.id?.slice(-8), title: t.title?.slice(0, 30), score: t.score || t.overallScore }));
      console.log('[MCP] Pre-sort first 5 tasks:', JSON.stringify(preSort));

      // DEPENDENCY FIX: Fetch missing dependent tasks to enable proper dependency-aware sorting
      // When we only fetch top N tasks by score, their dependencies (lower-scored tasks) might not be included
      if (!args.ignoreDependencies && (!args.sortBy || args.sortBy === 'score' || args.sortBy === 'scoreWithDependencies')) {
        const taskIdSet = new Set(tasks.map((t: any) => t.id));
        const missingDepIds: string[] = [];

        // Collect all referenced dependencies that aren't in our current task set
        for (const task of tasks) {
          const depIds = task.dependsOnTaskIds || [];
          for (const depId of depIds) {
            if (!taskIdSet.has(depId) && !missingDepIds.includes(depId)) {
              missingDepIds.push(depId);
            }
          }
        }

        console.log('[MCP] Found', missingDepIds.length, 'missing dependent task IDs to fetch');

        // Fetch missing dependent tasks (in batches if needed)
        if (missingDepIds.length > 0 && missingDepIds.length <= 50) {
          try {
            const missingTasks: any[] = [];
            for (const depId of missingDepIds) {
              try {
                const response = await this.backendClient.readTask(depId);
                // Backend may return {task: {...}} or just the task directly
                const depTask = response?.task || response;
                if (depTask && depTask.id) {
                  // Decrypt if needed
                  const decryptedTask = this.decryptTaskFromSync(depTask);
                  missingTasks.push(decryptedTask);
                  console.log('[MCP] Fetched dependent task:', depId.slice(-8), 'title:', decryptedTask.title?.slice(0, 30));
                }
              } catch (fetchErr) {
                console.warn('[MCP] Could not fetch dependent task', depId.slice(-8), fetchErr);
              }
            }
            console.log('[MCP] Fetched', missingTasks.length, 'missing dependent tasks');
            // Enrich missing tasks with sourceActionItems before adding to pool
            const enrichedMissingTasks = await this.enrichTasksWithSourceActionItems(missingTasks);
            // Add missing tasks to the pool for sorting
            tasks = [...tasks, ...enrichedMissingTasks];
          } catch (err) {
            console.warn('[MCP] Failed to fetch some missing dependencies:', err);
          }
        }
      }

      if (args.sortBy === 'dependencyOrder') {
        // Pure topological sort by dependency order only
        console.log('[MCP] Using sortTasksByDependencyOrder');
        tasks = this.sortTasksByDependencyOrder(tasks);
      } else if (args.ignoreDependencies) {
        // User explicitly wants to ignore dependencies - sort purely by score
        console.log('[MCP] Using sortTasksByScore (ignoreDependencies=true)');
        tasks = this.sortTasksByScore(tasks, args.order === 'asc');
      } else if (!args.sortBy || args.sortBy === 'score' || args.sortBy === 'scoreWithDependencies') {
        // Default: Sort by AI score while respecting dependencies
        // Groups tasks by chain (actionItemId), ranks chains by highest task score,
        // then adds tasks from each chain in dependency order
        console.log('[MCP] Using sortTasksByChainPriority (default dependency-aware sorting)');
        tasks = this.sortTasksByChainPriority(tasks, args.timeBudgetMinutes);
      } else {
        console.log('[MCP] No MCP-side sorting applied, using backend order');
      }
      // For createdAt, updatedAt, dueDate - backend already sorts these, no additional sort needed

      const postSort = tasks.slice(0, 5).map((t: any) => ({ id: t.id?.slice(-8), title: t.title?.slice(0, 30), score: t.score || t.overallScore }));
      console.log('[MCP] Post-sort first 5 tasks:', JSON.stringify(postSort));

      // Trim back to requested limit (we may have added extra tasks for dependency resolution)
      const requestedLimit = args.limit || 100;
      if (tasks.length > requestedLimit) {
        console.log('[MCP] Trimming from', tasks.length, 'to', requestedLimit, 'tasks');
        tasks = tasks.slice(0, requestedLimit);
      }

      // Build structured task data for ChatGPT widgets
      // ChatGPT expects JSON-encoded data in the text field for proper widget rendering
      const structuredTasks = tasks.map((task: any) => {
        const hasScores = task.relevanceScore !== undefined && task.impactScore !== undefined && task.urgencyScore !== undefined;
        const overallScore = hasScores ? Math.round((task.relevanceScore + task.impactScore + task.urgencyScore) / 3 * 100) : undefined;

        return {
          id: task.id,
          title: task.title,
          description: task.description || null,
          status: task.isCompleted ? 'completed' : 'pending',
          // AI Scores - include both 'score' (for widget sorting) and 'overallScore' (for display)
          score: overallScore, // Widget uses this for client-side sorting
          hasBeenAIScored: task.hasBeenAIScored || false,
          overallScore: overallScore,
          urgencyScore: task.urgencyScore !== undefined ? Math.round(task.urgencyScore * 100) : undefined,
          impactScore: task.impactScore !== undefined ? Math.round(task.impactScore * 100) : undefined,
          relevanceScore: task.relevanceScore !== undefined ? Math.round(task.relevanceScore * 100) : undefined,
          // Task metadata
          estimatedTime: task.estimatedTime || null,
          energyRequired: task.energyRequired || null,
          taskType: task.taskType || null,
          dueDate: task.dueDate || null,
          tags: task.tags || [],
          taskOrder: task.taskOrder,
          // Source and dependencies
          actionItemId: task.actionItemId || null,
          sourceActionItem: task.sourceActionItem ? {
            title: task.sourceActionItem.title,
            priority: task.sourceActionItem.priority,
            category: task.sourceActionItem.category,
          } : null,
          dependencies: task.resolvedDependencies || (task.dependsOnTaskOrders ? task.dependsOnTaskOrders.map((o: number) => `Task #${o}`) : []),
          dependencyTasks: task.resolvedDependencyTasks || [], // Full task objects with sourceActionItem
          dependsOnTaskIds: task.dependsOnTaskIds || [],
          // Timestamps
          createdAt: task.createdAt || null,
          updatedAt: task.updatedAt || null,
        };
      });

      // Return JSON-encoded data for ChatGPT widget compatibility
      // The model can parse this JSON and render it as a structured task list
      // Return structuredContent for ChatGPT widget rendering
      // The widget reads from window.openai.toolOutput, model reads content for narration
      // CRITICAL: Include IDs in text content so AI models can use them for delete operations

      // Tasks are already sorted by scoreWithDependencies (default) from the backend
      // This is the ADHD-optimized order that respects dependencies
      // Both text response and widget should use this order without re-sorting

      // Check if any tasks are encrypted (couldn't be decrypted)
      const encryptedTaskCount = structuredTasks.filter((t: any) => t.title?.includes('[Encrypted')).length;
      const hasEncryptedTasks = encryptedTaskCount > 0;

      // Filter out completed tasks for text response (matches widget's default showCompleted=false)
      const pendingTasks = structuredTasks.filter((t: any) => t.status !== 'completed');

      const tasksList = pendingTasks.map((task: any, i: number) => {
        const statusIcon = '⬜';
        const scoreDisplay = task.score !== undefined ? ` [${task.score}%]` : '';
        const timeDisplay = task.estimatedTime ? ` ~${task.estimatedTime}min` : '';
        const energyEmoji = task.energyRequired === 'high' ? '⚡' : task.energyRequired === 'low' ? '🔋' : '';
        const sourceDisplay = task.sourceActionItem ? ` ← "${task.sourceActionItem.title}"` : '';
        return `${i + 1}. ${statusIcon} **${task.title}** (ID: \`${task.id}\`)${scoreDisplay}${timeDisplay}${energyEmoji}${sourceDisplay}`;
      }).join('\n');

      // Build pagination info for the response
      const paginationInfo = hasMore
        ? `\n\n📄 **Showing ${offset + 1}-${offset + tasks.length} of ${total} tasks.** To see more, call \`list_tasks\` with \`offset: ${offset + limit}\`.`
        : '';

      // Add encryption warning if some tasks couldn't be decrypted
      const encryptionWarning = hasEncryptedTasks
        ? `\n\n🔐 **Note:** ${encryptedTaskCount} task(s) are encrypted and couldn't be decrypted. Please open the AiDD iOS app to sync your encryption key.`
        : '';

      const result: any = {
        content: [{ type: 'text', text: `📋 **Pending Tasks** (${pendingTasks.length} of ${total} total)\n\n${tasksList}${paginationInfo}${encryptionWarning}\n\n*Use the IDs above with \`delete_tasks\` to remove tasks.*` } as TextContent],
      };

      if (includeWidget) {
        result.structuredContent = {
          success: true,
          // Pagination metadata
          pagination: {
            total,
            returned: tasks.length,
            offset,
            limit,
            hasMore,
            nextOffset: hasMore ? offset + limit : null,
          },
          totalTasks: total, // Keep for backwards compatibility
          tasks: structuredTasks,
          // Let the widget know about encryption issues
          hasEncryptedItems: hasEncryptedTasks,
          encryptedItemCount: encryptedTaskCount,
        };
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[MCP] handleListTasks error:', errorMessage, error);
      // Throw the error so the MCP framework converts it to an error response
      // This allows the frontend to properly detect and display the error
      throw new Error(`Failed to list tasks: ${errorMessage}`);
    }
  }

  private async handleReadTask(args: any) {
    try {
      await this.ensureE2EInitialized();

      let task = await this.backendClient.readTask(args.taskId);

      // Decrypt task if E2E is enabled
      task = this.decryptTaskFromSync(task);

      // Enrich with source action item
      const enriched = await this.enrichTasksWithSourceActionItems([task]);
      task = enriched[0];
      const hasScores = task.relevanceScore !== undefined && task.impactScore !== undefined && task.urgencyScore !== undefined;
      const overallScore = hasScores ? ((task.relevanceScore + task.impactScore + task.urgencyScore) / 3 * 100).toFixed(0) : undefined;
      const sourceActionItemSection = task.sourceActionItem
        ? `\n**Source Action Item:**\n• Title: ${task.sourceActionItem.title}\n• ID: ${task.actionItemId}\n• Priority: ${task.sourceActionItem.priority || 'N/A'}\n• Category: ${task.sourceActionItem.category || 'N/A'}\n`
        : (task.actionItemId ? `\n**Source Action Item ID:** ${task.actionItemId}\n` : '');
      const response = `✅ **Task Details**\n\n**Title:** ${task.title}\n**ID:** ${task.id}${sourceActionItemSection}\n${task.hasBeenAIScored ? `**AI Scored:** ✓` : ''}\n${overallScore ? `**Overall AI Score:** ${overallScore}%` : ''}\n${task.relevanceScore !== undefined ? `**Relevance Score:** ${(task.relevanceScore * 100).toFixed(0)}%` : ''}\n${task.impactScore !== undefined ? `**Impact Score:** ${(task.impactScore * 100).toFixed(0)}%` : ''}\n${task.urgencyScore !== undefined ? `**Urgency Score:** ${(task.urgencyScore * 100).toFixed(0)}%` : ''}\n${task.estimatedTime ? `**Estimated Time:** ${task.estimatedTime} minutes` : ''}\n${task.energyRequired ? `**Energy Required:** ${task.energyRequired}` : ''}\n${task.taskType ? `**Task Type:** ${task.taskType}` : ''}\n${task.dueDate ? `**Due Date:** ${new Date(task.dueDate).toLocaleDateString()}` : ''}\n${task.tags && task.tags.length > 0 ? `**Tags:** ${task.tags.join(', ')}` : ''}\n\n**Description:**\n${task.description || 'No description'}\n\n${task.dependsOnTaskOrders && task.dependsOnTaskOrders.length > 0 ? `**Dependencies:** Tasks ${task.dependsOnTaskOrders.join(', ')}` : ''}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error reading task: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleCreateTask(args: any) {
    try {
      await this.ensureE2EInitialized();

      const { title, description, estimatedTime = 15, energyRequired = 'medium', taskType, dueDate, tags = [] } = args;

      // FIX v3.2.18: Generate sourceId for deduplication
      // This prevents duplicate tasks when the same task is created multiple times via MCP
      const importKey = this.buildTaskImportKey({
        title,
        description,
        estimatedTime,
        energyRequired,
        taskType,
        dueDate,
      });
      const sourceId = this.buildTaskSourceId(importKey);

      // Only include taskType in taskData if explicitly provided - don't default to 'administrative'
      const taskData: Record<string, any> = { actionItemId: '', taskOrder: 1, title, description: description || '', estimatedTime, energyRequired, tags, dependsOnTaskOrders: [], dueDate, sourceId };
      if (taskType) {
        taskData.taskType = taskType;
      }

      const createdTask = await this.backendClient.createTask(taskData as any);

      // Use original args for display since we know the plaintext
      const response = `✅ **Task Created**\n\n**Title:** ${title}\n**ID:** ${createdTask.id}\n**Estimated Time:** ${estimatedTime} minutes\n**Energy Required:** ${energyRequired}\n${taskType ? `**Task Type:** ${taskType}\n` : ''}${dueDate ? `**Due Date:** ${dueDate}` : ''}\n${tags && tags.length > 0 ? `**Tags:** ${tags.join(', ')}` : ''}\n\nThe task has been saved to your AiDD account.`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error creating task: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleCreateTasks(args: any) {
    try {
      await this.ensureE2EInitialized();

      const { tasks } = args;
      if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
        throw new Error('Tasks array is required');
      }

      const errors: Array<{ index: number; title?: string; error: string }> = [];
      const allowedEnergy = new Set(['low', 'medium', 'high']);
      const allowedTaskTypes = new Set(['quick_win', 'focus_required', 'collaborative', 'creative', 'administrative']);
      const seenKeys = new Set<string>();
      const tasksToCreate: any[] = [];

      tasks.forEach((task: any, index: number) => {
        const title = typeof task?.title === 'string' ? task.title.trim() : '';
        if (!title) {
          errors.push({ index, error: 'Missing title' });
          return;
        }

        const estimatedTime = typeof task.estimatedTime === 'number' ? task.estimatedTime : 15;
        const energyRequired = typeof task.energyRequired === 'string' && allowedEnergy.has(task.energyRequired)
          ? task.energyRequired
          : 'medium';
        const taskType = typeof task.taskType === 'string' && allowedTaskTypes.has(task.taskType)
          ? task.taskType
          : undefined;
        const description = typeof task.description === 'string' ? task.description : '';
        const sourceIdInput = typeof task.sourceId === 'string' ? task.sourceId.trim() : '';
        const importKey = this.buildTaskImportKey({
          title,
          description,
          estimatedTime,
          energyRequired,
          taskType,
          dueDate: task.dueDate,
        });
        const sourceId = sourceIdInput || this.buildTaskSourceId(importKey);
        const dedupeKey = sourceId;

        if (seenKeys.has(dedupeKey)) {
          errors.push({ index, title, error: 'Duplicate item in request' });
          return;
        }
        seenKeys.add(dedupeKey);

        const tags = Array.isArray(task.tags) ? task.tags : [];
        const taskData: Record<string, any> = {
          actionItemId: '',
          taskOrder: 1,
          title,
          description,
          estimatedTime,
          energyRequired,
          tags,
          dependsOnTaskOrders: [],
          dueDate: task.dueDate,
          sourceId,
        };
        if (taskType) {
          taskData.taskType = taskType;
        }
        tasksToCreate.push(taskData);
      });

      if (tasksToCreate.length === 0) {
        return {
          structuredContent: {
            success: false,
            createdCount: 0,
            errorCount: errors.length,
            taskIds: [],
            tasks: [],
            errors,
          },
          content: [{ type: 'text', text: `❌ Error creating tasks: no valid tasks to create` } as TextContent],
        };
      }

      const savedTasks: any[] = [];
      let createdCount = 0;
      let updatedCount = 0;
      const chunkSize = 100;
      for (let i = 0; i < tasksToCreate.length; i += chunkSize) {
        const chunk = tasksToCreate.slice(i, i + chunkSize);
        const result = await this.backendClient.saveTasks(chunk as any);
        const resultAny = result as any;
        savedTasks.push(...(resultAny.tasks || []));
        createdCount += typeof resultAny.newCount === 'number' ? resultAny.newCount : (resultAny.count || chunk.length);
        updatedCount += typeof resultAny.updatedCount === 'number' ? resultAny.updatedCount : 0;
      }

      const errorCount = errors.length;
      const taskIds = savedTasks.map((task: any) => task.id).filter(Boolean);

      let response = `✅ **Tasks Created**\n\n**Created:** ${createdCount}`;
      if (updatedCount > 0) {
        response += `\n**Updated:** ${updatedCount}`;
      }
      if (errorCount > 0) {
        response += `\n**Failed:** ${errorCount}`;
      }
      if (taskIds.length > 0) {
        response += `\n\n**Task IDs:**\n${JSON.stringify(taskIds)}`;
      }
      if (errorCount > 0) {
        response += `\n\n⚠️ Some tasks failed validation. Check the error list in structured content to retry.`;
      }

      return {
        structuredContent: {
          success: errorCount === 0,
          createdCount,
          updatedCount,
          errorCount,
          taskIds,
          tasks: savedTasks,
          errors,
        },
        content: [{ type: 'text', text: response.trim() } as TextContent],
      };
    } catch (error) {
      return {
        structuredContent: {
          success: false,
          createdCount: 0,
          errorCount: 0,
          taskIds: [],
          tasks: [],
          errors: [{ index: -1, error: error instanceof Error ? error.message : 'Unknown error' }],
        },
        content: [{ type: 'text', text: `❌ Error creating tasks: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent],
      };
    }
  }

  private async handleConvertToTasks(args: any) {
    try {
      const usageCheck = await this.checkOperationLimit('conversion');
      if (!usageCheck.allowed) return this.formatLimitReachedResponse(usageCheck);

      const { actionItemIds, convertAll, breakdownMode = 'adhd-optimized', waitForCompletion = false, skipDeduplication = false, skipAutoScoring = false } = args;

      // GUARD: Require explicit intent - don't accidentally convert all items
      // If user didn't specify IDs and didn't explicitly set convertAll=true, ask for clarification
      if ((!actionItemIds || actionItemIds.length === 0) && convertAll !== true) {
        return {
          content: [{
            type: 'text',
            text: `⚠️ **Please specify which action items to convert**

You didn't provide specific action item IDs, and \`convertAll\` was not explicitly set to \`true\`.

**Options:**

1. **Convert specific items** (recommended):
   Pass the \`actionItemIds\` from a previous \`extract_action_items\` or \`list_action_items\` response.
   \`\`\`
   convert_to_tasks:
     actionItemIds: ["ai_xxx", "ai_yyy", "ai_zzz"]
   \`\`\`

2. **Convert ALL action items**:
   Explicitly set \`convertAll: true\` if you want to convert everything.
   \`\`\`
   convert_to_tasks:
     convertAll: true
   \`\`\`

**Tip:** After \`extract_action_items\`, the response includes an **"Action Item IDs (for convert_to_tasks)"** section with the IDs to use.`
          } as TextContent]
        };
      }

      // MODE 1: SPECIFIC IDs - Convert selected action items
      if (actionItemIds && actionItemIds.length > 0) {
        console.log(`[MCP] Converting ${actionItemIds.length} specific action items`);
        let actionItems: any[] = [];
        for (const id of actionItemIds) {
          try {
            const item = await this.backendClient.readActionItem(id);
            actionItems.push(item);
          } catch (err) {
            console.warn(`[MCP] Could not fetch action item ${id}:`, err);
          }
        }

        if (actionItems.length === 0) {
          return { content: [{ type: 'text', text: `❌ No action items found to convert.\n\nThe specified action item IDs were not found. Please use \`list_action_items\` to see available items.` } as TextContent] };
        }

        if (!waitForCompletion) {
          const { jobId, actionItemCount } = await this.backendClient.startConversionJobAsync(actionItems, skipAutoScoring);
          const isPaid = this.backendClient.isPaidUser();
          const willAutoScore = isPaid && !skipAutoScoring;
          let response = `🚀 **AI Conversion Started**\n\nConverting ${actionItemCount} selected action item${actionItemCount > 1 ? 's' : ''} to ADHD-optimized tasks.\n\n**What's happening:**\n• AI is breaking down action items into manageable tasks\n• Tasks are being optimized for ADHD-friendly execution\n• Each action item may generate multiple subtasks${willAutoScore ? '\n• 🎯 **Auto AI Scoring** will run after conversion (Premium/Pro benefit)' : ''}${skipAutoScoring ? '\n• ⏭️ Auto-scoring skipped as requested' : ''}\n\n**Check your results:**\n⏱️ **Check back in ~5 minutes** - use the \`list_tasks\` tool to see your${willAutoScore ? ' scored and' : ''} converted tasks.\n\nJob ID: \`${jobId}\``;
          response = this.appendUsageWarning(response, usageCheck);
          return { content: [{ type: 'text', text: response.trim() } as TextContent] };
        }

        // Synchronous conversion for specific items
        // FIX: Backend auto-saves tasks after conversion via saveTasksToFirestore()
        // Removed duplicate saveTasks() call that was causing task duplication (9x duplicates)
        const conversionResult = await this.backendClient.convertToTasksWithMetadata(actionItems, skipAutoScoring);
        const tasks = conversionResult.tasks;
        const savedCount = conversionResult.savedCount || tasks.length;

        // Auto-scoring is now handled by the backend automatically for MCP users
        // Backend triggers auto-scoring after conversion for paid users (unless skipAutoScoring=true)
        let autoScoringResult: { jobId?: string; scored?: boolean; count?: number; skipped?: boolean } = {};
        if (conversionResult.autoScoringJobId) {
          autoScoringResult = {
            jobId: conversionResult.autoScoringJobId,
            scored: true,
            count: conversionResult.autoScoringTaskCount || savedCount
          };
          console.log(`[MCP] Backend auto-scoring job: ${conversionResult.autoScoringJobId}`);
        } else if (skipAutoScoring) {
          autoScoringResult = { skipped: true };
        }

        let response = this.formatConversionResult(actionItems, tasks, savedCount, breakdownMode, autoScoringResult);
        response = this.appendUsageWarning(response, usageCheck);
        return { content: [{ type: 'text', text: response } as TextContent] };
      }

      // MODE 2: CONVERT ALL - No specific IDs provided (or explicit convertAll=true)
      // This is the default behavior when no actionItemIds are specified
      console.log(`[MCP] Converting all action items (convertAll=${convertAll}, skipDeduplication=${skipDeduplication}, skipAutoScoring=${skipAutoScoring})`);

      if (!waitForCompletion) {
        // FAST PATH: Backend handles fetching and deduplication
        const result = await this.backendClient.startConversionJobAllAsync(skipDeduplication, skipAutoScoring);

        // Handle "all already converted" case
        if (!result.jobId) {
          return { content: [{ type: 'text', text: `✅ **All Action Items Already Converted**\n\n${result.message}\n\nTo re-convert specific action items, use the \`actionItemIds\` parameter with specific IDs.` } as TextContent] };
        }

        const isPaid = this.backendClient.isPaidUser();
        const willAutoScore = isPaid && !skipAutoScoring;
        let response = `🚀 **AI Conversion Started**\n\n${result.message}\n\n**What's happening:**\n• AI is breaking down action items into manageable tasks\n• ${skipDeduplication ? 'Deduplication skipped (faster)' : 'Already-converted items are automatically skipped'}\n• Tasks are optimized for ADHD-friendly execution${willAutoScore ? '\n• 🎯 **Auto AI Scoring** will run after conversion (Premium/Pro benefit)' : ''}${skipAutoScoring ? '\n• ⏭️ Auto-scoring skipped as requested' : ''}\n\n**Check your results:**\n⏱️ **Check back in ~5 minutes** - use the \`list_tasks\` tool to see your${willAutoScore ? ' scored and' : ''} converted tasks.\n\nJob ID: \`${result.jobId}\``;
        response = this.appendUsageWarning(response, usageCheck);
        return { content: [{ type: 'text', text: response.trim() } as TextContent] };
      }

      // SLOW PATH: Synchronous conversion (waitForCompletion=true)
      // Fetch all action items and convert synchronously
      console.log('[MCP] Using synchronous conversion path (waitForCompletion=true)');
      const allActionItems = await this.backendClient.listActionItems({});

      if (allActionItems.length === 0) {
        return { content: [{ type: 'text', text: `📋 **No Action Items Found**\n\nYou don't have any action items to convert. Use \`extract_action_items\` to extract action items from your notes first.` } as TextContent] };
      }

      // FIX: Backend auto-saves tasks after conversion via saveTasksToFirestore()
      // Removed duplicate saveTasks() call that was causing task duplication (9x duplicates)
      const conversionResult = await this.backendClient.convertToTasksWithMetadata(allActionItems, skipAutoScoring);
      const tasks = conversionResult.tasks;
      const savedCount = conversionResult.savedCount || tasks.length;

      // Auto-scoring is now handled by the backend automatically for MCP users
      let autoScoringResult: { jobId?: string; scored?: boolean; count?: number; skipped?: boolean } = {};
      if (conversionResult.autoScoringJobId) {
        autoScoringResult = {
          jobId: conversionResult.autoScoringJobId,
          scored: true,
          count: conversionResult.autoScoringTaskCount || savedCount
        };
        console.log(`[MCP] Backend auto-scoring job: ${conversionResult.autoScoringJobId}`);
      } else if (skipAutoScoring) {
        autoScoringResult = { skipped: true };
      }

      let response = this.formatConversionResult(allActionItems, tasks, savedCount, breakdownMode, autoScoringResult);
      response = this.appendUsageWarning(response, usageCheck);
      return { content: [{ type: 'text', text: response } as TextContent] };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const isTimeout = errorMsg.includes('timed out') || errorMsg.includes('timeout');
      let response = `❌ Error converting to tasks: ${errorMsg}`;
      if (isTimeout) {
        response += `\n\n**💡 Try these options:**\n1. Use default async mode (don't set waitForCompletion)\n2. Specify specific \`actionItemIds\` to convert fewer items\n3. Set \`skipDeduplication: true\` for faster processing\n4. Try again in a few minutes`;
      }
      return { content: [{ type: 'text', text: response } as TextContent] };
    }
  }

  private formatConversionResult(actionItems: any[], tasks: any[], savedCount: number, breakdownMode: string, autoScoringResult?: { jobId?: string; scored?: boolean; count?: number }): string {
    let result = `✨ **Tasks Created (ADHD-Optimized)**\n\n**Summary:**\n• Action items converted: ${actionItems.length}\n• Tasks created: ${tasks.length}\n• Tasks saved: ${savedCount}\n• Breakdown mode: ${breakdownMode}\n• Average tasks per item: ${(tasks.length / actionItems.length).toFixed(1)}\n\n**Created Tasks:**\n${tasks.slice(0, 15).map((task: any, i: number) => `${i + 1}. **${task.title}**\n   • Time: ${task.estimatedTime} min\n   • Energy: ${task.energyRequired}\n   • Type: ${task.taskType}\n   ${task.dependsOnTaskOrders && task.dependsOnTaskOrders.length > 0 ? `• Depends on: Task ${task.dependsOnTaskOrders.join(', ')}` : ''}`).join('\n')}\n${tasks.length > 15 ? `\n... and ${tasks.length - 15} more tasks` : ''}\n\n**Task Breakdown:**\n• Quick wins: ${tasks.filter((t: any) => t.taskType === 'quick_win').length}\n• Focus required: ${tasks.filter((t: any) => t.taskType === 'focus_required').length}\n• Collaborative: ${tasks.filter((t: any) => t.taskType === 'collaborative').length}\n• Creative: ${tasks.filter((t: any) => t.taskType === 'creative').length}\n• Administrative: ${tasks.filter((t: any) => t.taskType === 'administrative').length}\n\n✅ ${savedCount} tasks have been saved to your AiDD account.`;

    // Add auto-scoring info if triggered
    if (autoScoringResult?.scored && autoScoringResult.jobId) {
      result += `\n\n🎯 **Auto AI Scoring Started** (Premium/Pro benefit)\n• Scoring ${autoScoringResult.count || savedCount} tasks in background\n• Job ID: \`${autoScoringResult.jobId}\`\n• Check back in ~5 minutes to see scored tasks`;
    }

    return result;
  }

  private async handleScoreTasks(args: any) {
    try {
      const usageCheck = await this.checkOperationLimit('scoring');
      if (!usageCheck.allowed) return this.formatLimitReachedResponse(usageCheck);

      const { considerCurrentEnergy = true, timeOfDay = 'auto', waitForCompletion = false } = args;
      // CRITICAL: Fetch ALL tasks (up to 10,000) for scoring, not just the default 100
      // The backend defaults to limit=100, which was causing only a small subset to be scored
      const tasks = await this.backendClient.listTasks({ limit: 10000 });

      if (!waitForCompletion) {
        const { jobId, taskCount } = await this.backendClient.startScoringJobAsync(tasks);
        let response = `🚀 **AI Scoring Started**\n\nYour ${taskCount} tasks are being scored in the background using ADHD-optimized AI prioritization.\n\n**What's happening:**\n• AI is analyzing urgency, impact, and relevance for each task\n• Tasks will be ranked by optimal execution order\n• Energy levels and time-of-day are being considered\n\n**Check your results:**\n⏱️ **Check back in ~5 minutes** - use the \`list_tasks\` tool to see your scored and prioritized tasks.\n\nJob ID: \`${jobId}\``;
        response = this.appendUsageWarning(response, usageCheck);
        // CRITICAL: Return jobId in structuredContent for widget polling
        return {
          structuredContent: {
            success: true,
            jobId,
            taskCount,
            status: 'started'
          },
          content: [{ type: 'text', text: response.trim() } as TextContent]
        };
      }

      const scoredTasks = await this.backendClient.scoreTasks(tasks);
      scoredTasks.sort((a: any, b: any) => b.score - a.score);
      const actualTimeOfDay = timeOfDay === 'auto' ? this.getTimeOfDay() : timeOfDay;

      let response = `🎯 **Tasks Scored & Prioritized**\n\n**Summary:**\n• Tasks scored: ${scoredTasks.length}\n• Time optimization: ${actualTimeOfDay}\n• Energy considered: ${considerCurrentEnergy ? 'Yes' : 'No'}\n\n**Top Priority Tasks (Next 2 Hours):**\n${scoredTasks.slice(0, 5).map((task: any, i: number) => `${i + 1}. **${task.title}** (Score: ${task.score}/100)\n   ${task.factors ? `• Urgency: ${task.factors.urgency}/10` : ''}\n   ${task.factors ? `• Importance: ${task.factors.importance}/10` : ''}\n   ${task.factors ? `• Effort: ${task.factors.effort}/10` : ''}\n   ${task.factors ? `• ADHD Match: ${task.factors.adhd_compatibility}/10` : ''}\n   ${task.recommendation ? `📝 ${task.recommendation}` : ''}`).join('\n')}\n\n**Suggested Schedule:**\n🌅 **Morning (High Energy):**\n${scoredTasks.filter((t: any) => t.factors && t.factors.effort >= 7).slice(0, 3).map((t: any) => `  • ${t.title}`).join('\n') || '  No high-energy tasks'}\n\n☀️ **Afternoon (Medium Energy):**\n${scoredTasks.filter((t: any) => t.factors && t.factors.effort >= 4 && t.factors.effort < 7).slice(0, 3).map((t: any) => `  • ${t.title}`).join('\n') || '  No medium-energy tasks'}\n\n🌙 **Evening (Low Energy):**\n${scoredTasks.filter((t: any) => t.factors && t.factors.effort < 4).slice(0, 3).map((t: any) => `  • ${t.title}`).join('\n') || '  No low-energy tasks'}\n\nAll tasks have been scored and saved to your AiDD account.`;
      response = this.appendUsageWarning(response, usageCheck);
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error scoring tasks: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleCheckAIJobs(args: any) {
    try {
      const { jobId, includeCompleted = false } = args;
      const normalizeJobForWidget = (job: any) => {
        const progressValue = typeof job.progress === 'number'
          ? (job.progress > 1 ? job.progress / 100 : job.progress)
          : job.progress;
        return {
          ...job,
          progress: progressValue,
          progressMessage: job.progressMessage ?? job.message,
        };
      };

      // If specific job ID provided, get that job's status
      if (jobId) {
        const job = await this.backendClient.getJobStatus(jobId);
        if (!job) {
          return {
            structuredContent: { success: false, jobs: [], error: 'Job not found', jobId },
            content: [{ type: 'text', text: `❌ **Job Not Found**\n\nNo job found with ID: \`${jobId}\`\n\nThis job may have expired (jobs are kept for 24 hours) or the ID is incorrect.` } as TextContent],
          };
        }

        const normalizedJob = normalizeJobForWidget(job);
        const statusEmoji = job.status === 'completed' ? '✅' : job.status === 'processing' ? '⏳' : job.status === 'failed' ? '❌' : '📋';
        const typeLabels: Record<string, string> = {
          'score_tasks': 'Task Scoring',
          'convert_action_items': 'Task Conversion',
          'extract_action_items': 'Action Item Extraction'
        };

        let response = `${statusEmoji} **Job Status**\n\n`;
        response += `**Job ID:** \`${job.id}\`\n`;
        response += `**Type:** ${typeLabels[job.type] || job.type}\n`;
        response += `**Status:** ${job.status}\n`;
        if (job.progress !== undefined) {
          // Backend returns progress in 0-1 format (iOS compatibility), convert to percentage
          const progressPercent = job.progress <= 1 ? Math.round(job.progress * 100) : Math.round(job.progress);
          response += `**Progress:** ${progressPercent}%\n`;
        }
        if (job.message) {
          response += `**Message:** ${job.message}\n`;
        }
        if (job.createdAt) {
          response += `**Started:** ${new Date(job.createdAt).toLocaleString()}\n`;
        }
        if (job.completedAt) {
          response += `**Completed:** ${new Date(job.completedAt).toLocaleString()}\n`;
        }
        if (job.error) {
          response += `**Error:** ${job.error}\n`;
        }

        // Add next steps based on status
        if (job.status === 'processing') {
          response += `\n**💡 Next Steps:**\n• Wait for the job to complete\n• Check again in a minute using \`check_ai_jobs\` with this job ID`;
        } else if (job.status === 'completed') {
          // Show auto-scoring info for conversion jobs
          if (job.type === 'convert_action_items' && job.result) {
            const result = job.result as any;
            if (result.autoScoringJobId) {
              response += `\n\n🎯 **Auto AI Scoring Triggered**\n• Job ID: \`${result.autoScoringJobId}\`\n• Scoring ${result.autoScoringTaskCount || 'your'} tasks in background`;
            }
            if (result.savedCount) {
              response += `\n• ${result.savedCount} tasks saved to your account`;
            }
          }

          const nextStep = job.type === 'score_tasks' ? 'Use `list_tasks` to see your scored tasks' :
                           job.type === 'convert_action_items' ? 'Use `list_tasks` to see your converted tasks' :
                           job.type === 'extract_action_items' ? 'Use `list_action_items` to see extracted items' : '';
          if (nextStep) {
            response += `\n\n**💡 Next Steps:**\n• ${nextStep}`;
          }
        }

        return {
          structuredContent: { success: true, jobs: [normalizedJob] },
          content: [{ type: 'text', text: response.trim() } as TextContent],
        };
      }

      // List all jobs
      const jobs = await this.backendClient.listJobs(includeCompleted);
      const normalizedJobs = jobs.map(normalizeJobForWidget);

      if (!jobs || jobs.length === 0) {
        return {
          structuredContent: { success: true, jobs: [] },
          content: [{ type: 'text', text: `📋 **No Active AI Jobs**\n\nYou don't have any ${includeCompleted ? '' : 'active '}AI processing jobs.\n\n**To start a job:**\n• Use \`extract_action_items\` to extract action items from notes\n• Use \`convert_to_tasks\` to convert action items to tasks\n• Use \`score_tasks\` to prioritize your tasks` } as TextContent],
        };
      }

      const typeLabels: Record<string, string> = {
        'score_tasks': '🎯 Task Scoring',
        'convert_action_items': '🔄 Task Conversion',
        'extract_action_items': '📝 Action Item Extraction'
      };

      const statusEmojis: Record<string, string> = {
        'completed': '✅',
        'processing': '⏳',
        'pending': '📋',
        'failed': '❌',
        'cancelled': '🚫'
      };

      let response = `📊 **AI Jobs (${jobs.length} ${includeCompleted ? 'total' : 'active'})**\n\n`;

      for (const job of jobs) {
        const emoji = statusEmojis[job.status] || '📋';
        const typeLabel = typeLabels[job.type] || job.type;
        response += `${emoji} **${typeLabel}**\n`;
        response += `   • ID: \`${job.id}\`\n`;
        response += `   • Status: ${job.status}`;
        if (job.progress !== undefined && job.status === 'processing') {
          // Backend returns progress in 0-1 format (iOS compatibility), convert to percentage
          const progressPercent = job.progress <= 1 ? Math.round(job.progress * 100) : Math.round(job.progress);
          response += ` (${progressPercent}%)`;
        }
        response += '\n';
        if (job.message) {
          response += `   • ${job.message}\n`;
        }
        response += '\n';
      }

      response += `**💡 Tip:** Use \`check_ai_jobs\` with a specific \`jobId\` to get detailed status.`;

      return {
        structuredContent: { success: true, jobs: normalizedJobs },
        content: [{ type: 'text', text: response.trim() } as TextContent],
      };

    } catch (error) {
      return {
        structuredContent: { success: false, jobs: [], error: error instanceof Error ? error.message : 'Unknown error' },
        content: [{ type: 'text', text: `❌ **Error checking jobs:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent],
      };
    }
  }

  private async handleUpdateNote(args: any) {
    try {
      const { noteId, ...updates } = args;
      if (!noteId) throw new Error('Note ID is required');
      const updatedNote = await this.backendClient.updateNote(noteId, updates);
      const response = `✅ **Note Updated**\n\n**Updated note:** ${updatedNote.title || 'Untitled'}\n• ID: ${updatedNote.id}\n• Category: ${updatedNote.category || 'personal'}\n• Updated: ${new Date(updatedNote.updatedAt).toLocaleString()}\n${updatedNote.tags && updatedNote.tags.length > 0 ? `• Tags: ${updatedNote.tags.join(', ')}` : ''}`;
      return { content: [{ type: 'text', text: response.trim() } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ **Error updating note:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent], isError: true };
    }
  }

  private async handleUpdateNotes(args: any) {
    try {
      const { updates } = args;
      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        throw new Error('Updates array is required');
      }

      const updatedNotes: any[] = [];
      const errors: Array<{ index: number; noteId?: string; error: string }> = [];

      for (let i = 0; i < updates.length; i += 1) {
        const update = updates[i] || {};
        const noteId = update.noteId;
        if (!noteId) {
          errors.push({ index: i, error: 'Missing noteId' });
          continue;
        }

        const payload: Record<string, any> = {};
        if (typeof update.title === 'string') payload.title = update.title;
        if (typeof update.content === 'string') payload.content = update.content;
        if (Array.isArray(update.tags)) payload.tags = update.tags;
        if (typeof update.category === 'string') payload.category = update.category;

        if (Object.keys(payload).length === 0) {
          errors.push({ index: i, noteId, error: 'No fields to update' });
          continue;
        }

        try {
          const updatedNote = await this.backendClient.updateNote(noteId, payload);
          updatedNotes.push(updatedNote);
        } catch (noteError) {
          errors.push({
            index: i,
            noteId,
            error: noteError instanceof Error ? noteError.message : 'Unknown error',
          });
        }
      }

      const updatedCount = updatedNotes.length;
      const errorCount = errors.length;
      const noteIds = updatedNotes.map((note: any) => note.id).filter(Boolean);

      let response = `✅ **Notes Updated**\n\n**Updated:** ${updatedCount}`;
      if (errorCount > 0) {
        response += `\n**Failed:** ${errorCount}`;
      }
      if (noteIds.length > 0) {
        response += `\n\n**Note IDs:**\n${JSON.stringify(noteIds)}`;
      }
      if (errorCount > 0) {
        response += `\n\n⚠️ Some updates failed. Check the error list in structured content to retry.`;
      }

      return {
        structuredContent: {
          success: errorCount === 0,
          updatedCount,
          errorCount,
          noteIds,
          notes: updatedNotes,
          errors,
        },
        content: [{ type: 'text', text: response.trim() } as TextContent],
      };
    } catch (error) {
      return {
        structuredContent: {
          success: false,
          updatedCount: 0,
          errorCount: 0,
          noteIds: [],
          notes: [],
          errors: [{ index: -1, error: error instanceof Error ? error.message : 'Unknown error' }],
        },
        content: [{ type: 'text', text: `❌ **Error updating notes:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent],
      };
    }
  }

  private async handleDeleteNotes(args: any) {
    try {
      const { noteIds } = args;
      if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) throw new Error('Note IDs array is required');
      const result = noteIds.length === 1 ? await this.backendClient.deleteNote(noteIds[0]) : await this.backendClient.deleteNotes(noteIds);
      const deletedCount = (result as any).deletedCount || 1;
      const response = `🗑️ **Notes Deleted**\n\nSuccessfully deleted ${deletedCount} note${deletedCount > 1 ? 's' : ''}.`;
      return { content: [{ type: 'text', text: response.trim() } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ **Error deleting notes:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent], isError: true };
    }
  }

  private async handleUpdateActionItem(args: any) {
    try {
      const { actionItemId, ...updates } = args;
      if (!actionItemId) throw new Error('Action item ID is required');
      if (updates.priority !== undefined) {
        updates.priority = this.normalizeActionItemPriority(updates.priority);
      }
      const updatedItem = await this.backendClient.updateActionItem(actionItemId, updates);
      const response = `✅ **Action Item Updated**\n\n**Updated item:** ${updatedItem.title}\n• ID: ${updatedItem.id}\n• Priority: ${updatedItem.priority}\n• Category: ${updatedItem.category || 'work'}\n${updatedItem.isCompleted ? '• Status: ✅ Completed' : '• Status: Pending'}\n• Updated: ${new Date(updatedItem.updatedAt).toLocaleString()}\n${updatedItem.dueDate ? `• Due: ${new Date(updatedItem.dueDate).toLocaleDateString()}` : ''}\n${updatedItem.tags && updatedItem.tags.length > 0 ? `• Tags: ${updatedItem.tags.join(', ')}` : ''}`;
      return { content: [{ type: 'text', text: response.trim() } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ **Error updating action item:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent], isError: true };
    }
  }

  private async handleUpdateActionItems(args: any) {
    try {
      const { updates } = args;
      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        throw new Error('Updates array is required');
      }

      const updatedItems: any[] = [];
      const errors: Array<{ index: number; actionItemId?: string; error: string }> = [];

      for (let i = 0; i < updates.length; i += 1) {
        const update = updates[i] || {};
        const actionItemId = update.actionItemId;
        if (!actionItemId) {
          errors.push({ index: i, error: 'Missing actionItemId' });
          continue;
        }

        const payload: Record<string, any> = {};
        if (typeof update.title === 'string') payload.title = update.title;
        if (typeof update.description === 'string') payload.description = update.description;
        if (typeof update.priority === 'string') payload.priority = this.normalizeActionItemPriority(update.priority);
        if (update.dueDate !== undefined) payload.dueDate = update.dueDate;
        if (Array.isArray(update.tags)) payload.tags = update.tags;
        if (typeof update.category === 'string') payload.category = update.category;
        if (typeof update.isCompleted === 'boolean') payload.isCompleted = update.isCompleted;

        if (Object.keys(payload).length === 0) {
          errors.push({ index: i, actionItemId, error: 'No fields to update' });
          continue;
        }

        try {
          const updatedItem = await this.backendClient.updateActionItem(actionItemId, payload);
          updatedItems.push(updatedItem);
        } catch (itemError) {
          errors.push({
            index: i,
            actionItemId,
            error: itemError instanceof Error ? itemError.message : 'Unknown error',
          });
        }
      }

      const updatedCount = updatedItems.length;
      const errorCount = errors.length;
      const actionItemIds = updatedItems.map((item: any) => item.id).filter(Boolean);

      let response = `✅ **Action Items Updated**\n\n**Updated:** ${updatedCount}`;
      if (errorCount > 0) {
        response += `\n**Failed:** ${errorCount}`;
      }
      if (actionItemIds.length > 0) {
        response += `\n\n**Action Item IDs:**\n${JSON.stringify(actionItemIds)}`;
      }
      if (errorCount > 0) {
        response += `\n\n⚠️ Some updates failed. Check the error list in structured content to retry.`;
      }

      return {
        structuredContent: {
          success: errorCount === 0,
          updatedCount,
          errorCount,
          actionItemIds,
          actionItems: updatedItems,
          errors,
        },
        content: [{ type: 'text', text: response.trim() } as TextContent],
      };
    } catch (error) {
      return {
        structuredContent: {
          success: false,
          updatedCount: 0,
          errorCount: 0,
          actionItemIds: [],
          actionItems: [],
          errors: [{ index: -1, error: error instanceof Error ? error.message : 'Unknown error' }],
        },
        content: [{ type: 'text', text: `❌ **Error updating action items:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent],
      };
    }
  }

  private async handleDeleteActionItems(args: any) {
    try {
      const { actionItemIds } = args;
      if (!actionItemIds || !Array.isArray(actionItemIds) || actionItemIds.length === 0) throw new Error('Action item IDs array is required');

      // First, find and delete any tasks derived from these action items
      let deletedTasksCount = 0;
      try {
        const allTasks = await this.backendClient.listTasks({ limit: 1000 });
        const actionItemIdSet = new Set(actionItemIds);
        const derivedTaskIds = allTasks
          .filter((task: any) => {
            // Check both possible field names for the source action item
            const sourceId = task.sourceActionItemId || task.actionItemId;
            return sourceId && actionItemIdSet.has(sourceId);
          })
          .map((task: any) => task.id);

        if (derivedTaskIds.length > 0) {
          console.log(`[MCP] Deleting ${derivedTaskIds.length} derived tasks for action items: ${actionItemIds.join(', ')}`);
          if (derivedTaskIds.length === 1) {
            await this.backendClient.deleteTask(derivedTaskIds[0]);
            deletedTasksCount = 1;
          } else {
            const taskResult = await this.backendClient.deleteTasks(derivedTaskIds);
            deletedTasksCount = taskResult.deletedCount || derivedTaskIds.length;
          }
        }
      } catch (taskError) {
        // Log but don't fail - still proceed with deleting action items
        console.warn(`[MCP] Warning: Could not delete derived tasks: ${taskError instanceof Error ? taskError.message : 'Unknown error'}`);
      }

      // Now delete the action items
      const result = actionItemIds.length === 1 ? await this.backendClient.deleteActionItem(actionItemIds[0]) : await this.backendClient.deleteActionItems(actionItemIds);
      const deletedCount = (result as any).deletedCount || 1;

      // Build response message
      let response = `🗑️ **Action Items Deleted**\n\nSuccessfully deleted ${deletedCount} action item${deletedCount > 1 ? 's' : ''}.`;
      if (deletedTasksCount > 0) {
        response += `\n\n🔗 Also deleted ${deletedTasksCount} derived task${deletedTasksCount > 1 ? 's' : ''}.`;
      }
      return { content: [{ type: 'text', text: response.trim() } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ **Error deleting action items:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent], isError: true };
    }
  }

  private async handleUpdateTask(args: any) {
    try {
      const { taskId, ...updates } = args;
      if (!taskId) throw new Error('Task ID is required');
      const updatedTask = await this.backendClient.updateTask(taskId, updates);
      const response = `✅ **Task Updated**\n\n**Updated task:** ${updatedTask.title}\n• ID: ${updatedTask.id}\n• Type: ${updatedTask.taskType || 'administrative'}\n• Energy: ${updatedTask.energyRequired || 'medium'}\n• Estimated: ${updatedTask.estimatedTime || 15} min\n${updatedTask.score ? `• Score: ${updatedTask.score}` : ''}\n${updatedTask.isCompleted ? '• Status: ✅ Completed' : '• Status: Pending'}\n• Updated: ${new Date(updatedTask.updatedAt).toLocaleString()}\n${updatedTask.dueDate ? `• Due: ${new Date(updatedTask.dueDate).toLocaleDateString()}` : ''}\n${updatedTask.tags && updatedTask.tags.length > 0 ? `• Tags: ${updatedTask.tags.join(', ')}` : ''}`;
      return { content: [{ type: 'text', text: response.trim() } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ **Error updating task:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent], isError: true };
    }
  }

  private async handleUpdateTasks(args: any) {
    try {
      const { updates } = args;
      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        throw new Error('Updates array is required');
      }

      const updatedTasks: any[] = [];
      const errors: Array<{ index: number; taskId?: string; error: string }> = [];

      for (let i = 0; i < updates.length; i += 1) {
        const update = updates[i] || {};
        const taskId = update.taskId;
        if (!taskId) {
          errors.push({ index: i, error: 'Missing taskId' });
          continue;
        }

        const payload: Record<string, any> = {};
        if (typeof update.title === 'string') payload.title = update.title;
        if (typeof update.description === 'string') payload.description = update.description;
        if (typeof update.estimatedTime === 'number') payload.estimatedTime = update.estimatedTime;
        if (typeof update.energyRequired === 'string') payload.energyRequired = update.energyRequired;
        if (typeof update.taskType === 'string') payload.taskType = update.taskType;
        if (update.dueDate !== undefined) payload.dueDate = update.dueDate;
        if (Array.isArray(update.tags)) payload.tags = update.tags;
        if (typeof update.isCompleted === 'boolean') payload.isCompleted = update.isCompleted;

        if (Object.keys(payload).length === 0) {
          errors.push({ index: i, taskId, error: 'No fields to update' });
          continue;
        }

        try {
          const updatedTask = await this.backendClient.updateTask(taskId, payload);
          updatedTasks.push(updatedTask);
        } catch (taskError) {
          errors.push({
            index: i,
            taskId,
            error: taskError instanceof Error ? taskError.message : 'Unknown error',
          });
        }
      }

      const updatedCount = updatedTasks.length;
      const errorCount = errors.length;
      const taskIds = updatedTasks.map((task: any) => task.id).filter(Boolean);

      let response = `✅ **Tasks Updated**\n\n**Updated:** ${updatedCount}`;
      if (errorCount > 0) {
        response += `\n**Failed:** ${errorCount}`;
      }
      if (taskIds.length > 0) {
        response += `\n\n**Task IDs:**\n${JSON.stringify(taskIds)}`;
      }
      if (errorCount > 0) {
        response += `\n\n⚠️ Some updates failed. Check the error list in structured content to retry.`;
      }

      return {
        structuredContent: {
          success: errorCount === 0,
          updatedCount,
          errorCount,
          taskIds,
          tasks: updatedTasks,
          errors,
        },
        content: [{ type: 'text', text: response.trim() } as TextContent],
      };
    } catch (error) {
      return {
        structuredContent: {
          success: false,
          updatedCount: 0,
          errorCount: 0,
          taskIds: [],
          tasks: [],
          errors: [{ index: -1, error: error instanceof Error ? error.message : 'Unknown error' }],
        },
        content: [{ type: 'text', text: `❌ **Error updating tasks:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent],
      };
    }
  }

  private async handleDeleteTasks(args: any) {
    try {
      const { taskIds } = args;
      if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) throw new Error('Task IDs array is required');
      const result = taskIds.length === 1 ? await this.backendClient.deleteTask(taskIds[0]) : await this.backendClient.deleteTasks(taskIds);
      const deletedCount = (result as any).deletedCount || 1;
      const response = `🗑️ **Tasks Deleted**\n\nSuccessfully deleted ${deletedCount} task${deletedCount > 1 ? 's' : ''}.`;
      return { content: [{ type: 'text', text: response.trim() } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ **Error deleting tasks:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent], isError: true };
    }
  }

  private async handleDeleteAllTasks(args: any) {
    try {
      if (args?.confirm !== true) {
        return {
          content: [{ type: 'text', text: '❌ **Confirmation required:** set `confirm: true` to delete all tasks.' } as TextContent],
          isError: true,
        };
      }

      const includeCompleted = args?.includeCompleted !== false;
      const pageSize = 100;
      const listArgs: any = {
        sortBy: 'createdAt',
        order: 'asc',
        limit: pageSize,
        offset: 0,
        includeCompleted,
      };

      if (typeof args?.category === 'string' && args.category.length > 0) listArgs.category = args.category;
      if (typeof args?.tags === 'string' && args.tags.length > 0) listArgs.tags = args.tags;
      if (args?.maxTimeMinutes !== undefined) listArgs.maxTimeMinutes = args.maxTimeMinutes;
      if (typeof args?.maxEnergy === 'string' && args.maxEnergy.length > 0) listArgs.maxEnergy = args.maxEnergy;
      if (args?.onlyAIScored === true) listArgs.onlyAIScored = true;
      if (args?.dueWithinDays !== undefined) listArgs.dueWithinDays = args.dueWithinDays;

      const taskIds = new Set<string>();
      let offset = 0;
      let total = 0;
      let hasMore = true;

      while (hasMore) {
        const paginatedResult = await this.backendClient.listTasksWithPagination({ ...listArgs, offset });
        const tasks = paginatedResult.items || [];
        for (const task of tasks) {
          if (task?.id) taskIds.add(task.id);
        }
        total = paginatedResult.total ?? total;
        if (!paginatedResult.hasMore || tasks.length === 0) {
          hasMore = false;
        } else {
          offset += paginatedResult.limit || pageSize;
        }
      }

      const idsArray = Array.from(taskIds);
      if (idsArray.length === 0) {
        return {
          content: [{ type: 'text', text: '🧹 **No Tasks Found**\n\nThere are no tasks matching the requested filters.' } as TextContent],
        };
      }

      const deleteBatchSize = 100;
      let deletedCount = 0;
      let failedCount = 0;
      let partialFailures = 0;
      const failures: Array<{ id: string; error: string }> = [];

      const recordFailure = (id: string, error: unknown) => {
        failedCount += 1;
        if (failures.length < 20) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ id, error: message });
        }
      };

      for (let i = 0; i < idsArray.length; i += deleteBatchSize) {
        const batch = idsArray.slice(i, i + deleteBatchSize);
        if (batch.length === 1) {
          try {
            await this.backendClient.deleteTask(batch[0]);
            deletedCount += 1;
          } catch (error) {
            recordFailure(batch[0], error);
          }
          continue;
        }

        try {
          const result = await this.backendClient.deleteTasks(batch);
          const batchDeleted = (result as any)?.deletedCount;
          if (typeof batchDeleted === 'number') {
            deletedCount += batchDeleted;
            if (batchDeleted < batch.length) {
              partialFailures += batch.length - batchDeleted;
            }
          } else {
            deletedCount += batch.length;
          }
        } catch (error) {
          for (const id of batch) {
            try {
              await this.backendClient.deleteTask(id);
              deletedCount += 1;
            } catch (taskError) {
              recordFailure(id, taskError);
            }
          }
        }
      }

      let response = `🗑️ **Tasks Deleted**\n\nDeleted ${deletedCount} of ${idsArray.length} task${idsArray.length !== 1 ? 's' : ''}.`;
      const totalFailures = failedCount + partialFailures;
      if (totalFailures > 0) {
        response += `\n\n⚠️ ${totalFailures} task${totalFailures !== 1 ? 's' : ''} may not have been deleted. You can retry if needed.`;
      }

      return {
        structuredContent: {
          success: totalFailures === 0,
          requestedCount: idsArray.length,
          deletedCount,
          failedCount,
          partialFailures,
          total,
          includeCompleted,
          filters: {
            category: listArgs.category ?? null,
            tags: listArgs.tags ?? null,
            maxTimeMinutes: listArgs.maxTimeMinutes ?? null,
            maxEnergy: listArgs.maxEnergy ?? null,
            onlyAIScored: listArgs.onlyAIScored ?? false,
            dueWithinDays: listArgs.dueWithinDays ?? null,
          },
          failures,
        },
        content: [{ type: 'text', text: response } as TextContent],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `❌ **Error deleting all tasks:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent],
        isError: true,
      };
    }
  }

  private async handleSessionStatus() {
    try {
      // Get user info from backend
      const user = await this.backendClient.getAuthenticatedUser();
      const subscriptionStatus = await this.backendClient.getSubscriptionStatus();

      // Calculate token expiry info (if we have access to it)
      const now = new Date();
      const subscriptionTier = user.subscriptionTier || subscriptionStatus?.tier || 'FREE';

      // Build status message
      const statusLines = [
        '# 🔐 AiDD Session Status',
        '',
        '## Authentication',
        `✅ **Status:** Connected`,
        `📧 **Email:** ${user.email}`,
        `👤 **User ID:** ${user.userId}`,
        '',
        '## Subscription',
        `💎 **Tier:** ${subscriptionTier}`,
      ];

      // Add usage limits based on tier
      if (subscriptionStatus?.usage) {
        const usage = subscriptionStatus.usage;
        statusLines.push('');
        statusLines.push('## Usage This Month');
        if (usage.aiRequests !== undefined) {
          statusLines.push(`🤖 **AI Requests:** ${usage.aiRequests}/${usage.aiRequestsLimit || '∞'}`);
        }
        if (usage.notes !== undefined) {
          statusLines.push(`📝 **Notes:** ${usage.notes}/${usage.notesLimit || '∞'}`);
        }
        if (usage.actionItems !== undefined) {
          statusLines.push(`✅ **Action Items:** ${usage.actionItems}/${usage.actionItemsLimit || '∞'}`);
        }
        if (usage.tasks !== undefined) {
          statusLines.push(`📋 **Tasks:** ${usage.tasks}/${usage.tasksLimit || '∞'}`);
        }
      }

      // Add session health info
      statusLines.push('');
      statusLines.push('## Session Health');
      statusLines.push(`🕐 **Checked At:** ${now.toLocaleString()}`);
      statusLines.push(`🔄 **Auto-Refresh:** Enabled (proactive refresh 24hrs before expiry)`);
      statusLines.push('');
      statusLines.push('---');
      statusLines.push('*Session is healthy. Token will auto-refresh before expiry.*');

      return { content: [{ type: 'text', text: statusLines.join('\n') } as TextContent] };
    } catch (error) {
      // If we can't get user info, the session is likely expired
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isAuthError = errorMessage.toLowerCase().includes('auth') ||
                          errorMessage.toLowerCase().includes('token') ||
                          errorMessage.toLowerCase().includes('unauthorized');

      const statusLines = [
        '# 🔐 AiDD Session Status',
        '',
        '## Authentication',
        `❌ **Status:** ${isAuthError ? 'Session Expired' : 'Error'}`,
        '',
        `**Error:** ${errorMessage}`,
        '',
        '---',
        '',
        '## How to Reconnect',
        '',
        'Your session has expired. To reconnect:',
        '1. Use the **connect** command to sign in again',
        '2. Complete the authentication in your browser',
        '',
        '*Tip: Sessions last 30 days. For uninterrupted access, use AiDD at least once a month.*',
      ];

      return { content: [{ type: 'text', text: statusLines.join('\n') } as TextContent] };
    }
  }

  private async handleOverviewTutorial(args: any) {
    const { mode = 'overview', tutorialStep } = args;

    switch (mode) {
      case 'overview':
        return this.generateOverviewContent();
      case 'tutorial':
        return this.generateTutorialContent(tutorialStep);
      case 'quick_start':
        return this.generateQuickStartContent();
      case 'workflow_examples':
        return this.generateWorkflowExamplesContent();
      default:
        return this.generateOverviewContent();
    }
  }

  private generateOverviewContent() {
    const content = `# 🧠 AiDD MCP Server - Complete Tool Overview

**AiDD** (AI-Driven Daily Directives) is an ADHD-optimized productivity platform that helps you capture, organize, and execute tasks with AI assistance.

---

## 📝 NOTES TOOLS (7 tools)

Notes are the starting point - capture ideas, meeting notes, emails, or any text.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| \`list_notes\` | List all your notes | sortBy, order, limit, offset |
| \`read_note\` | Read a specific note | noteId (required) |
| \`create_note\` | Create a new note | title, content (required), tags, category |
| \`create_notes\` | Create multiple notes | notes[] (required), title, content, tags |
| \`update_note\` | Update an existing note | noteId (required), title, content, tags |
| \`update_notes\` | Update multiple notes | updates[] (required), noteId, title, content, tags |
| \`delete_notes\` | Delete notes | noteIds[] (required) |

**Pro Tips:**
- Notes are auto-enriched with extracted action items when you read them
- Categories: \`work\` or \`personal\`
- Use tags for easy filtering
- Use \`create_notes\` / \`update_notes\` for bulk changes

---

## 📋 ACTION ITEMS TOOLS (8 tools)

Action items can be created directly or extracted from notes.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| \`list_action_items\` | List all action items | sortBy, order, limit, offset |
| \`read_action_item\` | Read a specific action item | actionItemId (required) |
| \`create_action_item\` | Create an action item | title (required), description, priority, dueDate, tags |
| \`create_action_items\` | Create multiple action items | items[] (required), title, description, priority, dueDate, tags |
| \`update_action_item\` | Update an action item | actionItemId (required), title, priority, isCompleted |
| \`update_action_items\` | Update multiple action items | updates[] (required), actionItemId, title, priority |
| \`delete_action_items\` | Delete action items | actionItemIds[] (required) |
| \`extract_action_items\` 🤖 | **AI-powered** extraction from notes/text | source (required), noteIds[], text, extractionMode |

**Pro Tips:**
- Priority levels: \`low\`, \`medium\`, \`high\`, \`urgent\` (critical)
- Extraction modes: \`quick\`, \`comprehensive\`, \`adhd-optimized\` (default)
- Action items are auto-enriched with derived tasks
- For explicit lists, use \`create_action_items\` to keep 1:1 entries
- Use \`update_action_items\` for bulk edits

---

## ✅ TASKS TOOLS (10 tools)

Tasks are ADHD-optimized, bite-sized work items broken down from action items.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| \`list_tasks\` | List all tasks with AI scores | sortBy, order, limit, offset |
| \`read_task\` | Read a specific task | taskId (required) |
| \`create_task\` | Create a task | title (required), estimatedTime, energyRequired, taskType |
| \`create_tasks\` | Create multiple tasks | tasks[] (required), title, estimatedTime, energyRequired |
| \`update_task\` | Update a task | taskId (required), title, isCompleted, etc. |
| \`update_tasks\` | Update multiple tasks | updates[] (required), taskId, title, isCompleted |
| \`delete_tasks\` | Delete tasks | taskIds[] (required) |
| \`delete_all_tasks\` | Delete ALL tasks | confirm (required), includeCompleted, filters |
| \`convert_to_tasks\` 🤖 | **AI-powered** conversion from action items | actionItemIds[], breakdownMode, waitForCompletion |
| \`score_tasks\` 🤖 | **AI-powered** prioritization | considerCurrentEnergy, timeOfDay, waitForCompletion |

**Task Types:** \`quick_win\`, \`focus_required\`, \`collaborative\`, \`creative\`, \`administrative\`
**Energy Levels:** \`low\`, \`medium\`, \`high\`

**Pro Tips:**
- Tasks include AI scores: relevance, impact, urgency
- Use \`waitForCompletion: false\` (default) for background processing
- Tasks are enriched with source action item data

---

## 📊 RESOURCES (Read-Only Data Access)

| Resource URI | Description |
|--------------|-------------|
| \`aidd://notes\` | JSON dump of all notes |
| \`aidd://action-items\` | JSON dump of all action items |
| \`aidd://tasks\` | JSON dump of all tasks |

---

## 🤖 AI-POWERED TOOLS (3 tools)

These tools use Google Gemini AI for intelligent processing:

1. **\`extract_action_items\`** - Scans notes/text and identifies actionable items
2. **\`convert_to_tasks\`** - Breaks down action items into ADHD-friendly tasks
3. **\`score_tasks\`** - Prioritizes tasks based on urgency, impact, energy needs

**Usage Limits (per tier):**
| Tier | Scoring | Extraction | Conversion |
|------|---------|------------|------------|
| FREE | 1/month | 3/week | 1/week |
| PRO | 300/month | 200/week | 200/week |

---

## 🚀 Next Steps

Try these modes for more help:
- \`mode: "quick_start"\` - Get productive in 5 minutes
- \`mode: "tutorial"\` - Step-by-step walkthrough (7 steps)
- \`mode: "workflow_examples"\` - Real-world usage patterns

---

*💡 AiDD is designed for ADHD brains - small tasks, clear priorities, dopamine-friendly progress tracking!*`;

    return { content: [{ type: 'text', text: content } as TextContent] };
  }

  private generateTutorialContent(step?: number) {
    const steps = [
      {
        title: '📖 Step 1: Create Your First Note',
        content: `## 📖 Step 1: Create Your First Note

Notes are where everything starts in AiDD. Let's create one!

**Try this command:**
\`\`\`
create_note:
  title: "Project Planning - Q1 Goals"
  content: "Need to finish the website redesign by January 15th. Also should schedule team sync meeting. Remember to review the budget proposal from accounting."
  category: "work"
  tags: ["project", "q1", "planning"]
\`\`\`

**What happens:**
- Your note is saved to your AiDD account
- You get back the note ID for reference
- The note is now ready for AI action item extraction!

**ADHD Tip:** Don't worry about organizing - just dump your thoughts. The AI will help structure them later.

---
➡️ **Next:** Use \`mode: "tutorial", tutorialStep: 2\` to continue`
      },
      {
        title: '🔍 Step 2: Extract Action Items with AI',
        content: `## 🔍 Step 2: Extract Action Items with AI

Now let's use AI to find actionable items in your notes!

**Try this command:**
\`\`\`
extract_action_items:
  source: "notes"
  extractionMode: "adhd-optimized"
\`\`\`

**What happens:**
- AI scans ALL your unprocessed notes
- Identifies specific action items (tasks, deadlines, commitments)
- Assigns priority levels and categories automatically
- Saves extracted items to your account

**Extraction Modes:**
- \`quick\` - Fast, basic extraction
- \`comprehensive\` - Thorough analysis
- \`adhd-optimized\` - Breaks things into smaller, clearer items (default)

**From our example note, AI might extract:**
1. "Finish website redesign" (High priority, due Jan 15)
2. "Schedule team sync meeting" (Medium priority)
3. "Review budget proposal from accounting" (Medium priority)

**ADHD Tip:** The AI automatically skips notes that have already been processed - no duplicates!

---
➡️ **Next:** Use \`mode: "tutorial", tutorialStep: 3\` to continue`
      },
      {
        title: '✨ Step 3: Convert Action Items to Tasks',
        content: `## ✨ Step 3: Convert Action Items to Tasks

Action items are often too big. Let's break them into ADHD-friendly tasks!

**Try this command:**
\`\`\`
convert_to_tasks:
  breakdownMode: "adhd-optimized"
  waitForCompletion: false
\`\`\`

**What happens:**
- AI processes your action items in the background
- Breaks each into 2-5 smaller, manageable tasks
- Assigns time estimates (5-30 min each)
- Sets energy requirements (low/medium/high)
- Creates task dependencies

**Example breakdown of "Finish website redesign":**
1. Review current homepage mockups (15 min, low energy, quick_win)
2. Gather team feedback on color scheme (20 min, medium energy, collaborative)
3. Update hero section copy (25 min, high energy, creative)
4. Test mobile responsiveness (15 min, medium energy, focus_required)

**Task Types:**
- \`quick_win\` - Easy dopamine hits! Do these first
- \`focus_required\` - Need uninterrupted time
- \`collaborative\` - Involves other people
- \`creative\` - Brainstorming, design work
- \`administrative\` - Routine tasks

**ADHD Tip:** Start with quick_wins to build momentum!

---
➡️ **Next:** Use \`mode: "tutorial", tutorialStep: 4\` to continue`
      },
      {
        title: '🎯 Step 4: Score and Prioritize Tasks',
        content: `## 🎯 Step 4: Score and Prioritize Tasks

Now let's use AI to figure out what to work on first!

**Try this command:**
\`\`\`
score_tasks:
  considerCurrentEnergy: true
  timeOfDay: "auto"
  waitForCompletion: false
\`\`\`

**What happens:**
- AI analyzes ALL your tasks
- Scores each on three dimensions:
  - **Relevance** - How important to your goals
  - **Impact** - What difference it makes
  - **Urgency** - How time-sensitive
- Creates an optimal execution order
- Considers your current energy level and time of day

**Scoring Output:**
\`\`\`
1. Review homepage mockups (Score: 87/100)
   • Urgency: 9/10 (deadline approaching)
   • Impact: 7/10
   • ADHD Match: 9/10 (quick win, builds momentum)
   📝 "Start here - easy win before the deadline"
\`\`\`

**Time-of-Day Optimization:**
- 🌅 Morning: High-energy, focus-required tasks
- ☀️ Afternoon: Medium-energy, collaborative tasks
- 🌙 Evening: Low-energy, administrative tasks

**ADHD Tip:** Trust the AI scores! Stop decision paralysis - just start with #1.

---
➡️ **Next:** Use \`mode: "tutorial", tutorialStep: 5\` to continue`
      },
      {
        title: '📊 Step 5: View and Manage Your Work',
        content: `## 📊 Step 5: View and Manage Your Work

Let's see everything you've created and learn to navigate!

**List your tasks (sorted by AI score):**
\`\`\`
list_tasks:
  sortBy: "score"
  order: "desc"
  limit: 10
\`\`\`

**List your action items:**
\`\`\`
list_action_items:
  sortBy: "priority"
  order: "desc"
\`\`\`

**Read a specific task for details:**
\`\`\`
read_task:
  taskId: "task_abc123"
\`\`\`

**What you'll see:**
- Tasks show AI scores, time estimates, energy requirements
- Action items show derived task count
- Notes show extracted action item count

**Sorting Options:**
- Tasks: \`createdAt\`, \`updatedAt\`, \`score\`, \`dueDate\`
- Action Items: \`createdAt\`, \`updatedAt\`, \`priority\`, \`dueDate\`
- Notes: \`createdAt\`, \`updatedAt\`, \`title\`

**ADHD Tip:** Use \`limit: 5\` to avoid overwhelm - just focus on the top 5!

---
➡️ **Next:** Use \`mode: "tutorial", tutorialStep: 6\` to continue`
      },
      {
        title: '✅ Step 6: Complete and Update Tasks',
        content: `## ✅ Step 6: Complete and Update Tasks

Time to mark progress and feel that dopamine hit!

**Mark a task as completed:**
\`\`\`
update_task:
  taskId: "task_abc123"
  isCompleted: true
\`\`\`

**Update task details:**
\`\`\`
update_task:
  taskId: "task_abc123"
  estimatedTime: 20
  dueDate: "2024-01-20"
\`\`\`

**Mark action item complete (when all tasks done):**
\`\`\`
update_action_item:
  actionItemId: "ai_xyz789"
  isCompleted: true
\`\`\`

**Delete items you no longer need:**
\`\`\`
delete_tasks:
  taskIds: ["task_old1", "task_old2"]
\`\`\`

**What you can update:**
| Type | Updatable Fields |
|------|-----------------|
| Tasks | title, description, estimatedTime, energyRequired, taskType, dueDate, tags, isCompleted |
| Action Items | title, description, priority, dueDate, tags, category, isCompleted |
| Notes | title, content, tags, category |

**ADHD Tip:** Celebrate completions! Each ✅ is progress worth acknowledging.

---
➡️ **Next:** Use \`mode: "tutorial", tutorialStep: 7\` to continue`
      },
      {
        title: '🔄 Step 7: Daily Workflow',
        content: `## 🔄 Step 7: Your Daily AiDD Workflow

Here's a sustainable daily routine using AiDD:

### 🌅 Morning (5 minutes)
\`\`\`
1. score_tasks (timeOfDay: "morning")
2. list_tasks (sortBy: "score", limit: 5)
3. Start with task #1!
\`\`\`

### 📝 Throughout the Day
\`\`\`
- Capture thoughts: create_note
- Quick extraction: extract_action_items (on new notes)
- Mark done: update_task (isCompleted: true)
\`\`\`

### 🌙 Evening/Weekly (10 minutes)
\`\`\`
1. extract_action_items (process all new notes)
2. convert_to_tasks (break down new action items)
3. Review: list_action_items to see what's pending
\`\`\`

### 💡 ADHD Success Tips

1. **Don't over-organize** - Let AI do the sorting
2. **Start with quick wins** - Build momentum
3. **Time-box processing** - 5 min max for daily review
4. **Trust the scores** - Stop re-prioritizing mentally
5. **Capture immediately** - Note it or lose it
6. **Celebrate completions** - Every ✅ matters!

---

## 🎉 You're Ready!

You now know how to:
- ✅ Create and manage notes
- ✅ Extract action items with AI
- ✅ Convert to ADHD-friendly tasks
- ✅ Prioritize with AI scoring
- ✅ Track and complete work

**Pro tip:** Use \`mode: "workflow_examples"\` to see real-world scenarios!

---
*Remember: AiDD works WITH your ADHD brain, not against it. Small tasks, clear priorities, visible progress. You've got this! 🧠✨*`
      }
    ];

    if (step && step >= 1 && step <= steps.length) {
      return { content: [{ type: 'text', text: steps[step - 1].content } as TextContent] };
    }

    // Return all steps with navigation
    const fullTutorial = `# 🎓 AiDD Interactive Tutorial

This 7-step tutorial will teach you everything about AiDD. Each step is hands-on!

**Navigation:**
- Use \`tutorialStep: 1\` through \`tutorialStep: 7\` to view individual steps
- Or read through all steps below

---

${steps.map(s => s.content).join('\n\n---\n\n')}`;

    return { content: [{ type: 'text', text: fullTutorial } as TextContent] };
  }

  private generateQuickStartContent() {
    const content = `# ⚡ AiDD Quick Start - Be Productive in 5 Minutes

## Step 1: Dump Your Brain (1 minute)

Create a note with everything on your mind:

\`\`\`
create_note:
  title: "Brain Dump - Today"
  content: "Reply to Sarah's email about the project timeline. Need to buy groceries - milk, eggs, bread. Call dentist to reschedule appointment. Review pull request from Tom. Fix the login bug before Friday."
  category: "work"
\`\`\`

## Step 2: Let AI Extract Actions (1 minute)

\`\`\`
extract_action_items:
  source: "notes"
  extractionMode: "adhd-optimized"
\`\`\`

This finds all the actionable items and saves them.

## Step 3: Convert to Tasks (1 minute)

\`\`\`
convert_to_tasks:
  breakdownMode: "adhd-optimized"
\`\`\`

AI breaks your action items into small, doable tasks.

## Step 4: Get Your Priority List (1 minute)

\`\`\`
score_tasks:
  timeOfDay: "auto"
\`\`\`

AI tells you exactly what to work on first.

## Step 5: See Your Tasks (1 minute)

\`\`\`
list_tasks:
  sortBy: "score"
  order: "desc"
  limit: 5
\`\`\`

## 🎉 Done! Now Just Start Task #1

That's it! In 5 minutes you went from chaos to a prioritized task list.

---

### Quick Commands Reference

| What You Want | Command |
|--------------|---------|
| Add a thought | \`create_note\` |
| Find action items | \`extract_action_items\` |
| Make tasks | \`convert_to_tasks\` |
| Prioritize | \`score_tasks\` |
| See top tasks | \`list_tasks\` (sortBy: score) |
| Mark done | \`update_task\` (isCompleted: true) |

---

*🧠 ADHD Pro Tip: Don't think, just capture. Let the AI organize. Start with whatever task it says is #1.*`;

    return { content: [{ type: 'text', text: content } as TextContent] };
  }

  private generateWorkflowExamplesContent() {
    const content = `# 🔄 AiDD Real-World Workflow Examples

## 📧 Workflow 1: Processing Email Backlog

**Scenario:** You have 50 unread emails and feel overwhelmed.

\`\`\`
# Step 1: Create a note with email summaries
create_note:
  title: "Email Backlog - December 15"
  content: |
    From Boss: Need Q4 report by Friday
    From Client: Website feedback - wants darker colors
    From HR: Benefits enrollment deadline Dec 20
    From Dev Team: Code review needed for auth module
    From Marketing: Approve social media calendar
  category: "work"
  tags: ["email", "inbox-zero"]

# Step 2: Extract action items
extract_action_items:
  source: "notes"
  extractionMode: "comprehensive"

# Step 3: Convert to tasks
convert_to_tasks:
  breakdownMode: "adhd-optimized"

# Step 4: Prioritize based on deadlines
score_tasks:
  considerCurrentEnergy: true
\`\`\`

**Result:** 5 emails → 5 action items → ~15 small tasks → prioritized list

---

## 📝 Workflow 2: Meeting Notes to Actions

**Scenario:** You just finished a 1-hour meeting with lots of takeaways.

\`\`\`
# Step 1: Brain dump meeting notes immediately
create_note:
  title: "Product Sync - Dec 15"
  content: |
    Attendees: Me, Sarah, Tom, Lisa

    Decisions made:
    - Launch date moved to Jan 15
    - Budget approved for extra developer

    My action items:
    - Update project timeline in Jira
    - Send revised estimate to client
    - Schedule interview for new dev role
    - Review Tom's wireframes by EOD tomorrow

    Follow-ups:
    - Lisa will send competitive analysis
    - Need to sync with marketing next week
  category: "work"
  tags: ["meeting", "product", "q1-launch"]

# Step 2: Extract (AI finds YOUR action items)
extract_action_items:
  source: "notes"

# Step 3: Convert (breaks "Update project timeline" into smaller steps)
convert_to_tasks:
  breakdownMode: "adhd-optimized"
\`\`\`

**Result:** Meeting → 4 action items → ~12 tasks with time estimates

---

## 🏠 Workflow 3: Personal Life Management

**Scenario:** Weekend chores and errands piling up.

\`\`\`
# Step 1: List everything
create_note:
  title: "Weekend TODO"
  content: |
    House stuff:
    - Clean bathroom (it's bad)
    - Do laundry - at least 3 loads
    - Fix leaky faucet in kitchen

    Errands:
    - Grocery shopping
    - Return Amazon package
    - Pick up dry cleaning

    Personal:
    - Call mom for her birthday
    - Book flights for February trip
    - Cancel unused gym membership
  category: "personal"
  tags: ["weekend", "chores"]

# Step 2-4: Same process
extract_action_items: { source: "notes" }
convert_to_tasks: { breakdownMode: "adhd-optimized" }
score_tasks: { timeOfDay: "morning" }
\`\`\`

**ADHD Tip:** Tasks like "Clean bathroom" become:
1. Gather cleaning supplies (5 min)
2. Clean toilet (10 min)
3. Clean sink and counter (10 min)
4. Clean shower/tub (15 min)
5. Mop floor (10 min)

Much less scary as 5 small tasks!

---

## 🚀 Workflow 4: Project Kickoff

**Scenario:** Starting a new project, need to plan everything.

\`\`\`
# Step 1: Brainstorm everything
create_note:
  title: "New Project: Mobile App v2"
  content: |
    Goals:
    - Redesign home screen
    - Add dark mode
    - Improve performance
    - Fix top 10 user complaints

    Stakeholders to involve:
    - Design team for mockups
    - Backend team for API changes
    - QA for test plan
    - Marketing for launch assets

    Milestones:
    - Design complete by Jan 15
    - Development done by Feb 15
    - Testing complete by Feb 28
    - Launch March 1

    Risks:
    - Backend team has limited availability
    - New design system not documented
  category: "work"
  tags: ["project", "mobile-app", "v2"]

# Continue with extract → convert → score
\`\`\`

---

## 💡 Workflow 5: Daily Review Ritual

**Scenario:** Start of each day, 5-minute routine.

\`\`\`
# Morning Startup
score_tasks:
  timeOfDay: "morning"
  considerCurrentEnergy: true

list_tasks:
  sortBy: "score"
  order: "desc"
  limit: 3

# → Work on task #1
# → When done:
update_task:
  taskId: "completed_task_id"
  isCompleted: true

# → Check next task:
list_tasks:
  sortBy: "score"
  limit: 1
\`\`\`

---

## 📱 Quick Reference: Common Patterns

| Situation | Tools to Use |
|-----------|-------------|
| Brain is full | \`create_note\` → \`extract_action_items\` |
| Need to start working | \`score_tasks\` → \`list_tasks\` (limit: 1) |
| Finished something | \`update_task\` (isCompleted: true) |
| Feel overwhelmed | \`list_tasks\` (limit: 3) - just 3 things |
| End of day | \`list_action_items\` - see what's pending |
| Weekly review | \`list_notes\` → \`extract_action_items\` |

---

*🧠 Remember: The goal isn't to do everything. It's to do the RIGHT things. Let AI handle the prioritization so you can focus on execution.*`;

    return { content: [{ type: 'text', text: content } as TextContent] };
  }

  private getTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }

  private async handleResourceRead(uri: string) {
    // Handle data resources
    switch (uri) {
      case 'aidd://notes':
        const notes = await this.backendClient.listNotes({});
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(notes, null, 2) }] };
      case 'aidd://action-items':
        const actionItems = await this.backendClient.listActionItems({});
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(actionItems, null, 2) }] };
      case 'aidd://tasks':
        const tasks = await this.backendClient.listTasks({});
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(tasks, null, 2) }] };
    }

    // Handle UI widget resources (ui://widget/*)
    if (uri.startsWith('ui://widget/')) {
      // All widget URIs serve the same bundled React app
      // The app routes internally based on the tool that triggered it
      const widgetMeta = {
        // Use shared CSP config for consistency with resources/list
        ...WIDGET_CSP_CONFIG,
        'openai/widgetDescription': 'AiDD productivity dashboard for ADHD-optimized task management, AI scoring, and action item tracking',
        'openai/widgetPrefersBorder': true,  // Visually frame the widget in conversation
      };

      return {
        contents: [{
          uri,
          mimeType: 'text/html+skybridge',
          text: CHATGPT_UI_WIDGETS_HTML,
          _meta: widgetMeta,
        }],
        _meta: widgetMeta,
      };
    }

    throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
  }

  async connect(transport: Transport) {
    console.log('🔌 AiDDMCPServer: Starting connection to transport...');
    try {
      await this.server.connect(transport);
      console.log('✅ AiDDMCPServer: Successfully connected to transport');
    } catch (error) {
      console.error('❌ AiDDMCPServer: Failed to connect to transport:', error);
      throw error;
    }
  }

  async close() {
    await this.server.close();
  }
}
