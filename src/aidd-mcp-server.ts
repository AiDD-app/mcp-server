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
        version: '4.3.0',
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
          case 'aidd_overview_tutorial':
            return await this.handleOverviewTutorial(args);
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
        description: 'Convert action items to ADHD-optimized tasks using AiDD AI processing. Waits for completion and returns results.',
        inputSchema: {
          type: 'object',
          properties: {
            actionItemIds: { type: 'array', items: { type: 'string' }, description: 'Specific action item IDs to convert (leave empty for all)' },
            breakdownMode: { type: 'string', enum: ['simple', 'adhd-optimized', 'detailed'], description: 'Task breakdown mode (default: adhd-optimized)' },
            waitForCompletion: { type: 'boolean', description: 'Wait for conversion to complete (default: false for background processing).' },
          },
        },
      },
      {
        name: 'score_tasks',
        description: 'Score all tasks using AiDD AI for optimal ADHD-friendly prioritization. Waits for completion and returns scored tasks.',
        inputSchema: {
          type: 'object',
          properties: {
            considerCurrentEnergy: { type: 'boolean', description: 'Consider current energy levels (default: true)' },
            timeOfDay: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'auto'], description: 'Time of day for optimization (default: auto)' },
            waitForCompletion: { type: 'boolean', description: 'Wait for scoring to complete (default: false for background processing).' },
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
      {
        name: 'aidd_overview_tutorial',
        description: 'Get a comprehensive overview of AiDD MCP tools and an interactive hands-on tutorial. Use this to learn what AiDD can do and how to use it effectively for ADHD-optimized productivity.',
        annotations: { readOnlyHint: true },
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
    return [
      { uri: 'aidd://notes', name: 'Notes', description: 'All notes from your AiDD account', mimeType: 'application/json' },
      { uri: 'aidd://action-items', name: 'Action Items', description: 'All action items from your AiDD account', mimeType: 'application/json' },
      { uri: 'aidd://tasks', name: 'Tasks', description: 'All ADHD-optimized tasks from your AiDD account', mimeType: 'application/json' },
    ];
  }

  private async handleListNotes(args: any) {
    try {
      let notes = await this.backendClient.listNotes(args);
      notes = await this.enrichNotesWithExtractedActionItems(notes);
      const response = `📝 **Notes Retrieved**\n\n**Total notes:** ${notes.length}\n\n${notes.slice(0, 10).map((note: any, i: number) => {
        const extractedInfo = (note as any).extractedActionItemCount > 0
          ? `• Extracted Action Items: ${(note as any).extractedActionItemCount}`
          : '';
        return `${i + 1}. **${note.title}**\n   • ID: ${note.id}\n   • Category: ${note.category || 'personal'}\n   • Created: ${new Date(note.createdAt).toLocaleDateString()}\n   ${note.tags && note.tags.length > 0 ? `• Tags: ${note.tags.join(', ')}\n   ` : ''}${extractedInfo}`;
      }).join('\n')}\n${notes.length > 10 ? `\n... and ${notes.length - 10} more notes` : ''}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error listing notes: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleReadNote(args: any) {
    try {
      let note = await this.backendClient.readNote(args.noteId);
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
      const note = await this.backendClient.createNote(args);
      const response = `✅ **Note Created**\n\n**Title:** ${note.title}\n**ID:** ${note.id}\n**Category:** ${note.category || 'personal'}\n${note.tags && note.tags.length > 0 ? `**Tags:** ${note.tags.join(', ')}` : ''}\n\nThe note has been saved to your AiDD account.`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error creating note: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleListActionItems(args: any) {
    try {
      let actionItems = await this.backendClient.listActionItems(args);
      actionItems = await this.enrichActionItemsWithDerivedTasks(actionItems);
      const response = `📋 **Action Items Retrieved**\n\n**Total action items:** ${actionItems.length}\n\n${actionItems.slice(0, 10).map((item: any, i: number) => {
        const derivedTasksInfo = item.derivedTaskCount > 0
          ? `• Derived Tasks: ${item.derivedTaskCount} task(s) created`
          : '';
        const sourceNoteInfo = item.sourceNoteId ? `• Source Note ID: ${item.sourceNoteId}` : '';
        return `${i + 1}. **${item.title}**\n   • ID: ${item.id}\n   • Priority: ${item.priority}\n   • Category: ${item.category}\n   ${item.dueDate ? `• Due: ${new Date(item.dueDate).toLocaleDateString()}\n   ` : ''}${item.tags && item.tags.length > 0 ? `• Tags: ${item.tags.join(', ')}\n   ` : ''}${derivedTasksInfo ? `${derivedTasksInfo}\n   ` : ''}${sourceNoteInfo}`;
      }).join('\n')}\n${actionItems.length > 10 ? `\n... and ${actionItems.length - 10} more items` : ''}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error listing action items: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleReadActionItem(args: any) {
    try {
      let item = await this.backendClient.readActionItem(args.actionItemId);
      // Enrich with derived tasks
      const enriched = await this.enrichActionItemsWithDerivedTasks([item]);
      item = enriched[0];
      const derivedTasksSection = (item as any).derivedTasks && (item as any).derivedTasks.length > 0
        ? `\n\n**Derived Tasks (${(item as any).derivedTaskCount}):**\n${(item as any).derivedTasks.map((task: any, i: number) => `${i + 1}. **${task.title}**\n   • Task ID: ${task.id}\n   ${task.estimatedTime ? `• Est. Time: ${task.estimatedTime} min` : ''}\n   ${task.energyRequired ? `• Energy: ${task.energyRequired}` : ''}`).join('\n')}`
        : '';
      const sourceNoteSection = item.sourceNoteId
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
      let tasks = await this.backendClient.listTasks(args);
      tasks = await this.enrichTasksWithSourceActionItems(tasks);
      const response = `✅ **Tasks Retrieved**\n\n**Total tasks:** ${tasks.length}\n\n${tasks.slice(0, 10).map((task: any, i: number) => {
        const hasScores = task.relevanceScore !== undefined && task.impactScore !== undefined && task.urgencyScore !== undefined;
        const overallScore = hasScores ? ((task.relevanceScore + task.impactScore + task.urgencyScore) / 3 * 100).toFixed(0) : undefined;
        const sourceInfo = task.sourceActionItem ? `• Source Action Item: ${task.sourceActionItem.title} (ID: ${task.actionItemId})` : (task.actionItemId ? `• Source Action Item ID: ${task.actionItemId}` : '');
        return `${i + 1}. **${task.title}**\n   • ID: ${task.id}\n   ${sourceInfo ? `${sourceInfo}\n   ` : ''}${task.hasBeenAIScored && overallScore ? `• Overall AI Score: ${overallScore}%` : ''}\n   ${task.relevanceScore !== undefined ? `• Relevance: ${(task.relevanceScore * 100).toFixed(0)}%` : ''}\n   ${task.impactScore !== undefined ? `• Impact: ${(task.impactScore * 100).toFixed(0)}%` : ''}\n   ${task.urgencyScore !== undefined ? `• Urgency: ${(task.urgencyScore * 100).toFixed(0)}%` : ''}\n   ${task.estimatedTime ? `• Time: ${task.estimatedTime} min` : ''}\n   ${task.energyRequired ? `• Energy: ${task.energyRequired}` : ''}\n   ${task.dueDate ? `• Due: ${new Date(task.dueDate).toLocaleDateString()}` : ''}`;
      }).join('\n')}\n${tasks.length > 10 ? `\n... and ${tasks.length - 10} more tasks` : ''}`;
      return { content: [{ type: 'text', text: response } as TextContent] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ Error listing tasks: ${error instanceof Error ? error.message : 'Unknown error'}` } as TextContent] };
    }
  }

  private async handleReadTask(args: any) {
    try {
      let task = await this.backendClient.readTask(args.taskId);
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

## 📝 NOTES TOOLS (5 tools)

Notes are the starting point - capture ideas, meeting notes, emails, or any text.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| \`list_notes\` | List all your notes | sortBy, order, limit, offset |
| \`read_note\` | Read a specific note | noteId (required) |
| \`create_note\` | Create a new note | title, content (required), tags, category |
| \`update_note\` | Update an existing note | noteId (required), title, content, tags |
| \`delete_notes\` | Delete notes | noteIds[] (required) |

**Pro Tips:**
- Notes are auto-enriched with extracted action items when you read them
- Categories: \`work\` or \`personal\`
- Use tags for easy filtering

---

## 📋 ACTION ITEMS TOOLS (6 tools)

Action items are extracted from notes - specific things that need to be done.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| \`list_action_items\` | List all action items | sortBy, order, limit, offset |
| \`read_action_item\` | Read a specific action item | actionItemId (required) |
| \`create_action_item\` | Create an action item | title (required), description, priority, dueDate, tags |
| \`update_action_item\` | Update an action item | actionItemId (required), title, priority, isCompleted |
| \`delete_action_items\` | Delete action items | actionItemIds[] (required) |
| \`extract_action_items\` 🤖 | **AI-powered** extraction from notes/text | source (required), noteIds[], text, extractionMode |

**Pro Tips:**
- Priority levels: \`low\`, \`medium\`, \`high\`, \`critical\`
- Extraction modes: \`quick\`, \`comprehensive\`, \`adhd-optimized\` (default)
- Action items are auto-enriched with derived tasks

---

## ✅ TASKS TOOLS (6 tools)

Tasks are ADHD-optimized, bite-sized work items broken down from action items.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| \`list_tasks\` | List all tasks with AI scores | sortBy, order, limit, offset |
| \`read_task\` | Read a specific task | taskId (required) |
| \`create_task\` | Create a task | title (required), estimatedTime, energyRequired, taskType |
| \`update_task\` | Update a task | taskId (required), title, isCompleted, etc. |
| \`delete_tasks\` | Delete tasks | taskIds[] (required) |
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
