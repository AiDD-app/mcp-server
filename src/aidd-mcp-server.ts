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
import {
  SubscriptionManager,
  SubscriptionStatus,
  OperationType,
  UsageCheckResult,
} from './subscription-manager.js';

export class AiDDMCPServer {
  private server: Server;
  private backendClient: AiDDBackendClient;
  private oauthToken?: string;
  private subscriptionManager: SubscriptionManager;
  private cachedSubscriptionStatus: SubscriptionStatus | null = null;
  private subscriptionCacheExpiry: number = 0;
  private readonly SUBSCRIPTION_CACHE_TTL_MS = 60000; // 1 minute cache

  constructor(oauthToken?: string) {
    this.oauthToken = oauthToken;
    console.log(`🔑 Using OAuth token from web connector: ${oauthToken ? 'present' : 'missing'}`);

    const BASE_URL = process.env.BASE_URL || 'https://mcp.aidd.app';

    this.server = new Server(
      {
        name: 'AiDD',
        version: '4.1.1',
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

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: this.getResources(),
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      return await this.handleResourceRead(uri);
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_notes':
            return await this.handleListNotes(args);
          case 'read_note':
            return await this.handleReadNote(args);
          case 'create_note':
            return await this.handleCreateNote(args);
          case 'list_action_items':
            return await this.handleListActionItems(args);
          case 'read_action_item':
            return await this.handleReadActionItem(args);
          case 'create_action_item':
            return await this.handleCreateActionItem(args);
          case 'extract_action_items':
            return await this.handleExtractActionItems(args);
          case 'list_tasks':
            return await this.handleListTasks(args);
          case 'read_task':
            return await this.handleReadTask(args);
          case 'create_task':
            return await this.handleCreateTask(args);
          case 'convert_to_tasks':
            return await this.handleConvertToTasks(args);
          case 'score_tasks':
            return await this.handleScoreTasks(args);
          case 'update_note':
            return await this.handleUpdateNote(args);
          case 'delete_notes':
            return await this.handleDeleteNotes(args);
          case 'update_action_item':
            return await this.handleUpdateActionItem(args);
          case 'delete_action_items':
            return await this.handleDeleteActionItems(args);
          case 'update_task':
            return await this.handleUpdateTask(args);
          case 'delete_tasks':
            return await this.handleDeleteTasks(args);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
          );
        }
        throw error;
      }
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: 'list_notes',
        description: 'List notes from your AiDD account with optional sorting and pagination',
        annotations: { readOnlyHint: true },
        inputSchema: {
          type: 'object',
          properties: {
            sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'title'], description: 'Field to sort by (default: updatedAt)' },
            order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default: desc)' },
            limit: { type: 'number', description: 'Maximum number of notes to return (default: 100)' },
            offset: { type: 'number', description: 'Number of notes to skip for pagination (default: 0)' },
          },
        },
      },
      {
        name: 'read_note',
        description: 'Read a specific note from your AiDD account',
        annotations: { readOnlyHint: true },
        inputSchema: {
          type: 'object',
          properties: { noteId: { type: 'string', description: 'ID of the note to read' } },
          required: ['noteId'],
        },
      },
      {
        name: 'create_note',
        description: 'Create a new note in your AiDD account',
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
        name: 'list_action_items',
        description: 'List action items from your AiDD account with optional sorting and pagination',
        annotations: { readOnlyHint: true },
        inputSchema: {
          type: 'object',
          properties: {
            sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'priority', 'dueDate'], description: 'Field to sort by (default: createdAt)' },
            order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default: desc)' },
            limit: { type: 'number', description: 'Maximum number of action items to return (default: 100)' },
            offset: { type: 'number', description: 'Number of action items to skip for pagination (default: 0)' },
          },
        },
      },
      {
        name: 'read_action_item',
        description: 'Read a specific action item from your AiDD account',
        annotations: { readOnlyHint: true },
        inputSchema: {
          type: 'object',
          properties: { actionItemId: { type: 'string', description: 'ID of the action item to read' } },
          required: ['actionItemId'],
        },
      },
      {
        name: 'create_action_item',
        description: 'Create a new action item in your AiDD account',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the action item' },
            description: { type: 'string', description: 'Description of the action item (optional)' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Priority level (default: medium)' },
            dueDate: { type: 'string', description: 'Due date in ISO format (optional)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the action item (optional)' },
            category: { type: 'string', enum: ['work', 'personal'], description: 'Category of the action item (default: work)' },
          },
          required: ['title'],
        },
      },
      {
        name: 'extract_action_items',
        description: 'Extract action items from notes or text using AiDD AI processing',
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
        description: 'List tasks from your AiDD account with optional sorting and pagination',
        annotations: { readOnlyHint: true },
        inputSchema: {
          type: 'object',
          properties: {
            sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'score', 'dueDate'], description: 'Field to sort by (default: score)' },
            order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default: desc for score, asc for dueDate)' },
            limit: { type: 'number', description: 'Maximum number of tasks to return (default: 100)' },
            offset: { type: 'number', description: 'Number of tasks to skip for pagination (default: 0)' },
          },
        },
      },
      {
        name: 'read_task',
        description: 'Read a specific task from your AiDD account',
        annotations: { readOnlyHint: true },
        inputSchema: {
          type: 'object',
          properties: { taskId: { type: 'string', description: 'ID of the task to read' } },
          required: ['taskId'],
        },
      },
      {
        name: 'create_task',
        description: 'Create a new task in your AiDD account',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the task' },
            description: { type: 'string', description: 'Description of the task (optional)' },
            estimatedTime: { type: 'number', description: 'Estimated time in minutes (default: 15)' },
            energyRequired: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Energy level required (default: medium)' },
            taskType: { type: 'string', enum: ['quick_win', 'focus_required', 'collaborative', 'creative', 'administrative'], description: 'Type of task (default: administrative)' },
            dueDate: { type: 'string', description: 'Due date in ISO format (optional)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the task (optional)' },
          },
          required: ['title'],
        },
      },
      {
        name: 'convert_to_tasks',
        description: 'Convert action items to ADHD-optimized tasks using AiDD AI processing. Runs in background by default - check tasks in ~5 minutes.',
        inputSchema: {
          type: 'object',
          properties: {
            actionItemIds: { type: 'array', items: { type: 'string' }, description: 'Specific action item IDs to convert (leave empty for all)' },
            breakdownMode: { type: 'string', enum: ['simple', 'adhd-optimized', 'detailed'], description: 'Task breakdown mode (default: adhd-optimized)' },
            waitForCompletion: { type: 'boolean', description: 'Wait for conversion to complete (default: false). Set to true only for small batches (<10 action items).' },
          },
        },
      },
      {
        name: 'score_tasks',
        description: 'Score all tasks using AiDD AI for optimal ADHD-friendly prioritization. Runs in background by default - check tasks in ~5 minutes for updated scores.',
        inputSchema: {
          type: 'object',
          properties: {
            considerCurrentEnergy: { type: 'boolean', description: 'Consider current energy levels (default: true)' },
            timeOfDay: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'auto'], description: 'Time of day for optimization (default: auto)' },
            waitForCompletion: { type: 'boolean', description: 'Wait for scoring to complete (default: false). Set to true only for small task lists (<30 tasks).' },
          },
        },
      },
      {
        name: 'update_note',
        description: 'Update an existing note in your AiDD account',
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
        name: 'delete_notes',
        description: 'Delete one or more notes from your AiDD account',
        inputSchema: {
          type: 'object',
          properties: { noteIds: { type: 'array', items: { type: 'string' }, description: 'IDs of the notes to delete' } },
          required: ['noteIds'],
        },
      },
      {
        name: 'update_action_item',
        description: 'Update an existing action item in your AiDD account',
        inputSchema: {
          type: 'object',
          properties: {
            actionItemId: { type: 'string', description: 'ID of the action item to update' },
            title: { type: 'string', description: 'New title for the action item' },
            description: { type: 'string', description: 'New description for the action item' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'New priority for the action item' },
            dueDate: { type: 'string', description: 'New due date in ISO format (or null to clear)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'New tags for the action item' },
            category: { type: 'string', enum: ['work', 'personal'], description: 'New category for the action item' },
            isCompleted: { type: 'boolean', description: 'Mark the action item as completed or not' },
          },
          required: ['actionItemId'],
        },
      },
      {
        name: 'delete_action_items',
        description: 'Delete one or more action items from your AiDD account',
        inputSchema: {
          type: 'object',
          properties: { actionItemIds: { type: 'array', items: { type: 'string' }, description: 'IDs of the action items to delete' } },
          required: ['actionItemIds'],
        },
      },
      {
        name: 'update_task',
        description: 'Update an existing task in your AiDD account',
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
      },
      {
        name: 'delete_tasks',
        description: 'Delete one or more tasks from your AiDD account',
        inputSchema: {
          type: 'object',
          properties: { taskIds: { type: 'array', items: { type: 'string' }, description: 'IDs of the tasks to delete' } },
          required: ['taskIds'],
        },
      },
    ];
  }

  private getResources(): Resource[] {
    return [
      { uri: 'aidd://notes', name: 'Notes', description: 'All notes from your AiDD account', mimeType: 'application/json' },
      { uri: 'aidd://action-items', name: 'Action Items', description: 'All action items from your AiDD account', mimeType: 'application/json' },
      { uri: 'aidd://tasks', name: 'Tasks', description: 'All ADHD-optimized tasks from your AiDD account', mimeType: 'application/json' },
    ];
  }

  private async handleListNotes(args: any) {
    try {
      const notes = await this.backendClient.listNotes(args);
      const response = `📝 **Notes Retrieved**\n\n**Total notes:** ${notes.length}\n\n${notes.slice(0, 10).map((note: any, i: number) => `${i + 1}. **${note.title}**\n   • ID: ${note.id}\n   • Category: ${note.category || 'personal'}\n   • Created: ${new Date(note.createdAt).toLocaleDateString()}\n   ${note.tags && note.tags.length > 0 ? `• Tags: ${note.tags.join(', ')}` : ''}`).join('\n')}\n${notes.length > 10 ? `\n... and ${notes.length - 10} more notes` : ''}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error listing notes: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleReadNote(args: any) {
    try {
      const note = await this.backendClient.readNote(args.noteId);
      const response = `📄 **Note Details**\n\n**Title:** ${note.title}\n**ID:** ${note.id}\n**Category:** ${note.category || 'personal'}\n**Created:** ${new Date(note.createdAt).toLocaleDateString()}\n${note.tags && note.tags.length > 0 ? `**Tags:** ${note.tags.join(', ')}` : ''}\n\n**Content:**\n${note.content}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error reading note: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleCreateNote(args: any) {
    try {
      const note = await this.backendClient.createNote(args);
      const response = `✅ **Note Created**\n\n**Title:** ${note.title}\n**ID:** ${note.id}\n**Category:** ${note.category || 'personal'}\n${note.tags && note.tags.length > 0 ? `**Tags:** ${note.tags.join(', ')}` : ''}\n\nThe note has been saved to your AiDD account.`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error creating note: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleListActionItems(args: any) {
    try {
      const actionItems = await this.backendClient.listActionItems(args);
      const response = `📋 **Action Items Retrieved**\n\n**Total action items:** ${actionItems.length}\n\n${actionItems.slice(0, 10).map((item: any, i: number) => `${i + 1}. **${item.title}**\n   • ID: ${item.id}\n   • Priority: ${item.priority}\n   • Category: ${item.category}\n   ${item.dueDate ? `• Due: ${new Date(item.dueDate).toLocaleDateString()}` : ''}\n   ${item.tags && item.tags.length > 0 ? `• Tags: ${item.tags.join(', ')}` : ''}`).join('\n')}\n${actionItems.length > 10 ? `\n... and ${actionItems.length - 10} more items` : ''}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error listing action items: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleReadActionItem(args: any) {
    try {
      const item = await this.backendClient.readActionItem(args.actionItemId);
      const response = `📋 **Action Item Details**\n\n**Title:** ${item.title}\n**ID:** ${item.id}\n**Priority:** ${item.priority}\n**Category:** ${item.category}\n${item.dueDate ? `**Due Date:** ${new Date(item.dueDate).toLocaleDateString()}` : ''}\n${item.tags && item.tags.length > 0 ? `**Tags:** ${item.tags.join(', ')}` : ''}\n\n**Description:**\n${item.description || 'No description'}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error reading action item: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleCreateActionItem(args: any) {
    try {
      const { title, description, priority = 'medium', dueDate, tags = [], category = 'work' } = args;
      const actionItemData = { title, description: description || '', priority, dueDate, tags, category, confidence: 1.0 };
      const createdItem = await this.backendClient.createActionItem(actionItemData);
      const response = `✅ **Action Item Created**\n\n**Title:** ${createdItem.title}\n**ID:** ${createdItem.id}\n**Priority:** ${createdItem.priority}\n**Category:** ${createdItem.category}\n${createdItem.dueDate ? `**Due Date:** ${createdItem.dueDate}` : ''}\n${createdItem.tags && createdItem.tags.length > 0 ? `**Tags:** ${createdItem.tags.join(', ')}` : ''}\n\nThe action item has been saved to your AiDD account.`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error creating action item: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
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
      if (actionItems.length > 0) {
        try {
          const saveResult = await this.backendClient.saveActionItems(actionItems);
          savedCount = saveResult.count;
        } catch (saveError) {
          console.error('[MCP] Failed to save extracted action items:', saveError);
        }
      }

      let response = `🔍 **Action Items Extracted**\n\n**Summary:**\n• Source: ${source === 'notes' ? `${notesToProcess.length} notes` : 'provided text'}\n${skippedCount > 0 ? `• Skipped: ${skippedCount} notes (already extracted)` : ''}\n• Extraction mode: ${extractionMode}\n• Action items found: ${actionItems.length}\n• Action items saved: ${savedCount}\n\n**Extracted Action Items:**\n${actionItems.slice(0, 10).map((item: any, i: number) => `${i + 1}. **${item.title}**\n   • Priority: ${item.priority}\n   • Category: ${item.category}\n   • Confidence: ${(item.confidence * 100).toFixed(0)}%\n   ${item.dueDate ? `• Due: ${item.dueDate}` : ''}\n   ${item.tags && item.tags.length > 0 ? `• Tags: ${item.tags.join(', ')}` : ''}`).join('\n')}\n${actionItems.length > 10 ? `\n... and ${actionItems.length - 10} more items` : ''}\n\n✅ ${savedCount} action items have been saved to your AiDD account.`;
      response = this.appendUsageWarning(response, usageCheck);
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error extracting action items: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleListTasks(args: any) {
    try {
      const tasks = await this.backendClient.listTasks(args);
      const response = `✅ **Tasks Retrieved**\n\n**Total tasks:** ${tasks.length}\n\n${tasks.slice(0, 10).map((task: any, i: number) => {
        const hasScores = task.relevanceScore !== undefined && task.impactScore !== undefined && task.urgencyScore !== undefined;
        const overallScore = hasScores ? ((task.relevanceScore + task.impactScore + task.urgencyScore) / 3 * 100).toFixed(0) : undefined;
        return `${i + 1}. **${task.title}**\n   • ID: ${task.id}\n   ${task.hasBeenAIScored && overallScore ? `• Overall AI Score: ${overallScore}%` : ''}\n   ${task.relevanceScore !== undefined ? `• Relevance: ${(task.relevanceScore * 100).toFixed(0)}%` : ''}\n   ${task.impactScore !== undefined ? `• Impact: ${(task.impactScore * 100).toFixed(0)}%` : ''}\n   ${task.urgencyScore !== undefined ? `• Urgency: ${(task.urgencyScore * 100).toFixed(0)}%` : ''}\n   ${task.estimatedTime ? `• Time: ${task.estimatedTime} min` : ''}\n   ${task.energyRequired ? `• Energy: ${task.energyRequired}` : ''}\n   ${task.dueDate ? `• Due: ${new Date(task.dueDate).toLocaleDateString()}` : ''}`;
      }).join('\n')}\n${tasks.length > 10 ? `\n... and ${tasks.length - 10} more tasks` : ''}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error listing tasks: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleReadTask(args: any) {
    try {
      const task = await this.backendClient.readTask(args.taskId);
      const hasScores = task.relevanceScore !== undefined && task.impactScore !== undefined && task.urgencyScore !== undefined;
      const overallScore = hasScores ? ((task.relevanceScore + task.impactScore + task.urgencyScore) / 3 * 100).toFixed(0) : undefined;
      const response = `✅ **Task Details**\n\n**Title:** ${task.title}\n**ID:** ${task.id}\n${task.hasBeenAIScored ? `**AI Scored:** ✓` : ''}\n${overallScore ? `**Overall AI Score:** ${overallScore}%` : ''}\n${task.relevanceScore !== undefined ? `**Relevance Score:** ${(task.relevanceScore * 100).toFixed(0)}%` : ''}\n${task.impactScore !== undefined ? `**Impact Score:** ${(task.impactScore * 100).toFixed(0)}%` : ''}\n${task.urgencyScore !== undefined ? `**Urgency Score:** ${(task.urgencyScore * 100).toFixed(0)}%` : ''}\n${task.estimatedTime ? `**Estimated Time:** ${task.estimatedTime} minutes` : ''}\n${task.energyRequired ? `**Energy Required:** ${task.energyRequired}` : ''}\n${task.taskType ? `**Task Type:** ${task.taskType}` : ''}\n${task.dueDate ? `**Due Date:** ${new Date(task.dueDate).toLocaleDateString()}` : ''}\n${task.tags && task.tags.length > 0 ? `**Tags:** ${task.tags.join(', ')}` : ''}\n\n**Description:**\n${task.description || 'No description'}\n\n${task.dependsOnTaskOrders && task.dependsOnTaskOrders.length > 0 ? `**Dependencies:** Tasks ${task.dependsOnTaskOrders.join(', ')}` : ''}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error reading task: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleCreateTask(args: any) {
    try {
      const { title, description, estimatedTime = 15, energyRequired = 'medium', taskType = 'administrative', dueDate, tags = [] } = args;
      const taskData = { actionItemId: '', taskOrder: 1, title, description: description || '', estimatedTime, energyRequired, tags, dependsOnTaskOrders: [], taskType, dueDate };
      const createdTask = await this.backendClient.createTask(taskData);
      const response = `✅ **Task Created**\n\n**Title:** ${createdTask.title}\n**ID:** ${createdTask.id}\n**Estimated Time:** ${createdTask.estimatedTime || estimatedTime} minutes\n**Energy Required:** ${createdTask.energyRequired || energyRequired}\n**Task Type:** ${createdTask.taskType || taskType}\n${createdTask.dueDate ? `**Due Date:** ${createdTask.dueDate}` : ''}\n${createdTask.tags && createdTask.tags.length > 0 ? `**Tags:** ${createdTask.tags.join(', ')}` : ''}\n\nThe task has been saved to your AiDD account.`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error creating task: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleConvertToTasks(args: any) {
    try {
      const usageCheck = await this.checkOperationLimit('conversion');
      if (!usageCheck.allowed) return this.formatLimitReachedResponse(usageCheck);

      const { actionItemIds, breakdownMode = 'adhd-optimized', waitForCompletion = false } = args;
      let actionItems: any[] = [];
      let skippedCount = 0;

      const existingTasks = await this.backendClient.listTasks({});
      const convertedActionItemIds = new Set(existingTasks.filter((task: any) => task.actionItemId).map((task: any) => task.actionItemId));

      if (!actionItemIds || actionItemIds.length === 0) {
        const allActionItems = await this.backendClient.listActionItems({});
        const originalCount = allActionItems.length;
        actionItems = allActionItems.filter((item: any) => !convertedActionItemIds.has(item.id));
        skippedCount = originalCount - actionItems.length;
      } else {
        for (const id of actionItemIds) {
          if (!convertedActionItemIds.has(id)) {
            const item = await this.backendClient.readActionItem(id);
            actionItems.push(item);
          } else {
            skippedCount++;
          }
        }
      }

      if (actionItems.length === 0) {
        return { content: [{ type: 'text', text: `✅ **All Action Items Already Converted**\n\nAll ${skippedCount} action items have already been converted to tasks.\nNo new processing needed.\n\nTo convert specific action items again, use the \`actionItemIds\` parameter with specific action item IDs.` } as TextContent] };
      }

      if (!waitForCompletion) {
        const { jobId, actionItemCount } = await this.backendClient.startConversionJobAsync(actionItems);
        let response = `🚀 **AI Conversion Started**\n\nConverting ${actionItemCount} action items to ADHD-optimized tasks in the background.\n${skippedCount > 0 ? `Skipped ${skippedCount} action items (already converted).` : ''}\n\n**What's happening:**\n• AI is breaking down action items into manageable tasks\n• Tasks are being optimized for ADHD-friendly execution\n• Each action item may generate multiple subtasks\n\n**Check your results:**\n⏱️ **Check back in ~5 minutes** - use the \`list_tasks\` tool to see your converted tasks.\n\nJob ID: \`${jobId}\``;
        response = this.appendUsageWarning(response, usageCheck);
        return { content: [{ type: 'text', text: response.trim() } as TextContent] };
      }

      const tasks = await this.backendClient.convertToTasks(actionItems);
      let savedCount = 0;
      if (tasks.length > 0) {
        try {
          const saveResult = await this.backendClient.saveTasks(tasks);
          savedCount = saveResult.count;
        } catch (saveError) {
          console.error('[MCP] Failed to save converted tasks:', saveError);
        }
      }

      let response = `✨ **Tasks Created (ADHD-Optimized)**\n\n**Summary:**\n• Action items converted: ${actionItems.length}\n${skippedCount > 0 ? `• Skipped: ${skippedCount} action items (already converted)` : ''}\n• Tasks created: ${tasks.length}\n• Tasks saved: ${savedCount}\n• Breakdown mode: ${breakdownMode}\n• Average tasks per item: ${(tasks.length / actionItems.length).toFixed(1)}\n\n**Created Tasks:**\n${tasks.slice(0, 15).map((task: any, i: number) => `${i + 1}. **${task.title}**\n   • Time: ${task.estimatedTime} min\n   • Energy: ${task.energyRequired}\n   • Type: ${task.taskType}\n   ${task.dependsOnTaskOrders && task.dependsOnTaskOrders.length > 0 ? `• Depends on: Task ${task.dependsOnTaskOrders.join(', ')}` : ''}`).join('\n')}\n${tasks.length > 15 ? `\n... and ${tasks.length - 15} more tasks` : ''}\n\n**Task Breakdown:**\n• Quick wins: ${tasks.filter((t: any) => t.taskType === 'quick_win').length}\n• Focus required: ${tasks.filter((t: any) => t.taskType === 'focus_required').length}\n• Collaborative: ${tasks.filter((t: any) => t.taskType === 'collaborative').length}\n• Creative: ${tasks.filter((t: any) => t.taskType === 'creative').length}\n• Administrative: ${tasks.filter((t: any) => t.taskType === 'administrative').length}\n\n✅ ${savedCount} tasks have been saved to your AiDD account.`;
      response = this.appendUsageWarning(response, usageCheck);
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error converting to tasks: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleScoreTasks(args: any) {
    try {
      const usageCheck = await this.checkOperationLimit('scoring');
      if (!usageCheck.allowed) return this.formatLimitReachedResponse(usageCheck);

      const { considerCurrentEnergy = true, timeOfDay = 'auto', waitForCompletion = false } = args;
      const tasks = await this.backendClient.listTasks({});

      if (!waitForCompletion) {
        const { jobId, taskCount } = await this.backendClient.startScoringJobAsync(tasks);
        let response = `🚀 **AI Scoring Started**\n\nYour ${taskCount} tasks are being scored in the background using ADHD-optimized AI prioritization.\n\n**What's happening:**\n• AI is analyzing urgency, impact, and relevance for each task\n• Tasks will be ranked by optimal execution order\n• Energy levels and time-of-day are being considered\n\n**Check your results:**\n⏱️ **Check back in ~5 minutes** - use the \`list_tasks\` tool to see your scored and prioritized tasks.\n\nJob ID: \`${jobId}\``;
        response = this.appendUsageWarning(response, usageCheck);
        return { content: [{ type: 'text', text: response.trim() } as TextContent] };
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
      const updatedItem = await this.backendClient.updateActionItem(actionItemId, updates);
      const response = `✅ **Action Item Updated**\n\n**Updated item:** ${updatedItem.title}\n• ID: ${updatedItem.id}\n• Priority: ${updatedItem.priority}\n• Category: ${updatedItem.category || 'work'}\n${updatedItem.isCompleted ? '• Status: ✅ Completed' : '• Status: Pending'}\n• Updated: ${new Date(updatedItem.updatedAt).toLocaleString()}\n${updatedItem.dueDate ? `• Due: ${new Date(updatedItem.dueDate).toLocaleDateString()}` : ''}\n${updatedItem.tags && updatedItem.tags.length > 0 ? `• Tags: ${updatedItem.tags.join(', ')}` : ''}`;
      return { content: [{ type: 'text', text: response.trim() } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ **Error updating action item:** ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent], isError: true };
    }
  }

  private async handleDeleteActionItems(args: any) {
    try {
      const { actionItemIds } = args;
      if (!actionItemIds || !Array.isArray(actionItemIds) || actionItemIds.length === 0) throw new Error('Action item IDs array is required');
      const result = actionItemIds.length === 1 ? await this.backendClient.deleteActionItem(actionItemIds[0]) : await this.backendClient.deleteActionItems(actionItemIds);
      const deletedCount = (result as any).deletedCount || 1;
      const response = `🗑️ **Action Items Deleted**\n\nSuccessfully deleted ${deletedCount} action item${deletedCount > 1 ? 's' : ''}.`;
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

  private getTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }

  private async handleResourceRead(uri: string) {
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
      default:
        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
    }
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
