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

export class AiDDMCPServer {
  private server: Server;
  private backendClient: AiDDBackendClient;
  private oauthToken?: string;

  constructor(oauthToken?: string) {
    this.oauthToken = oauthToken;
    console.log(`🔑 Using OAuth token from web connector: ${oauthToken ? 'present' : 'missing'}`);

    const BASE_URL = process.env.BASE_URL || 'https://mcp.aidd.app';

    this.server = new Server(
      {
        name: 'AiDD',
        version: '4.0.1',
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

  private setupHandlers() {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.log('📋 MCP Request: list_tools');
      return {
        tools: this.getTools(),
      };
    });

    // Handle resource listing
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: this.getResources(),
    }));

    // Handle resource reading
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      return await this.handleResourceRead(uri);
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          // Notes Management
          case 'list_notes':
            return await this.handleListNotes(args);
          case 'read_note':
            return await this.handleReadNote(args);
          case 'create_note':
            return await this.handleCreateNote(args);

          // Action Items Management
          case 'list_action_items':
            return await this.handleListActionItems(args);
          case 'read_action_item':
            return await this.handleReadActionItem(args);
          case 'extract_action_items':
            return await this.handleExtractActionItems(args);

          // Tasks Management
          case 'list_tasks':
            return await this.handleListTasks(args);
          case 'read_task':
            return await this.handleReadTask(args);
          case 'convert_to_tasks':
            return await this.handleConvertToTasks(args);
          case 'score_tasks':
            return await this.handleScoreTasks(args);

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
      // =============================================================================
      // NOTES MANAGEMENT
      // =============================================================================
      {
        name: 'list_notes',
        description: 'List notes from your AiDD account with optional sorting and pagination',
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: 'object',
          properties: {
            sortBy: {
              type: 'string',
              enum: ['createdAt', 'updatedAt', 'title'],
              description: 'Field to sort by (default: updatedAt)',
            },
            order: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: 'Sort order (default: desc)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of notes to return (default: 100)',
            },
            offset: {
              type: 'number',
              description: 'Number of notes to skip for pagination (default: 0)',
            },
          },
        },
      },
      {
        name: 'read_note',
        description: 'Read a specific note from your AiDD account',
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: 'object',
          properties: {
            noteId: {
              type: 'string',
              description: 'ID of the note to read',
            },
          },
          required: ['noteId'],
        },
      },
      {
        name: 'create_note',
        description: 'Create a new note in your AiDD account',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Title of the note',
            },
            content: {
              type: 'string',
              description: 'Content of the note',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for the note (optional)',
            },
            category: {
              type: 'string',
              enum: ['work', 'personal'],
              description: 'Category of the note (default: personal)',
            },
          },
          required: ['title', 'content'],
        },
      },

      // =============================================================================
      // ACTION ITEMS MANAGEMENT
      // =============================================================================
      {
        name: 'list_action_items',
        description: 'List action items from your AiDD account with optional sorting and pagination',
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: 'object',
          properties: {
            sortBy: {
              type: 'string',
              enum: ['createdAt', 'updatedAt', 'priority', 'dueDate'],
              description: 'Field to sort by (default: createdAt)',
            },
            order: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: 'Sort order (default: desc)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of action items to return (default: 100)',
            },
            offset: {
              type: 'number',
              description: 'Number of action items to skip for pagination (default: 0)',
            },
          },
        },
      },
      {
        name: 'read_action_item',
        description: 'Read a specific action item from your AiDD account',
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: 'object',
          properties: {
            actionItemId: {
              type: 'string',
              description: 'ID of the action item to read',
            },
          },
          required: ['actionItemId'],
        },
      },
      {
        name: 'extract_action_items',
        description: 'Extract action items from notes or text using AiDD AI processing',
        inputSchema: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              enum: ['notes', 'text'],
              description: 'Extract from saved notes or provided text',
            },
            noteIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific note IDs to process (required if source=notes)',
            },
            text: {
              type: 'string',
              description: 'Text content to extract action items from (required if source=text)',
            },
            extractionMode: {
              type: 'string',
              enum: ['quick', 'comprehensive', 'adhd-optimized'],
              description: 'Extraction mode (default: adhd-optimized)',
            },
          },
          required: ['source'],
        },
      },

      // =============================================================================
      // TASKS MANAGEMENT
      // =============================================================================
      {
        name: 'list_tasks',
        description: 'List tasks from your AiDD account with optional sorting and pagination',
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: 'object',
          properties: {
            sortBy: {
              type: 'string',
              enum: ['createdAt', 'updatedAt', 'score', 'dueDate'],
              description: 'Field to sort by (default: score)',
            },
            order: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: 'Sort order (default: desc for score, asc for dueDate)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of tasks to return (default: 100)',
            },
            offset: {
              type: 'number',
              description: 'Number of tasks to skip for pagination (default: 0)',
            },
          },
        },
      },
      {
        name: 'read_task',
        description: 'Read a specific task from your AiDD account',
        annotations: {
          readOnlyHint: true
        },
        inputSchema: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'ID of the task to read',
            },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'convert_to_tasks',
        description: 'Convert action items to ADHD-optimized tasks using AiDD AI processing',
        inputSchema: {
          type: 'object',
          properties: {
            actionItemIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific action item IDs to convert (leave empty for all)',
            },
            breakdownMode: {
              type: 'string',
              enum: ['simple', 'adhd-optimized', 'detailed'],
              description: 'Task breakdown mode (default: adhd-optimized)',
            },
          },
        },
      },
      {
        name: 'score_tasks',
        description: 'Score all tasks using AiDD AI for optimal ADHD-friendly prioritization',
        inputSchema: {
          type: 'object',
          properties: {
            considerCurrentEnergy: {
              type: 'boolean',
              description: 'Consider current energy levels (default: true)',
            },
            timeOfDay: {
              type: 'string',
              enum: ['morning', 'afternoon', 'evening', 'auto'],
              description: 'Time of day for optimization (default: auto)',
            },
          },
        },
      },
    ];
  }

  private getResources(): Resource[] {
    return [
      {
        uri: 'aidd://notes',
        name: 'Notes',
        description: 'All notes from your AiDD account',
        mimeType: 'application/json',
      },
      {
        uri: 'aidd://action-items',
        name: 'Action Items',
        description: 'All action items from your AiDD account',
        mimeType: 'application/json',
      },
      {
        uri: 'aidd://tasks',
        name: 'Tasks',
        description: 'All ADHD-optimized tasks from your AiDD account',
        mimeType: 'application/json',
      },
    ];
  }

  // =============================================================================
  // NOTES MANAGEMENT HANDLERS
  // =============================================================================

  private async handleListNotes(args: any) {
    try {
      const notes = await this.backendClient.listNotes(args);

      const response = `
📝 **Notes Retrieved**

**Total notes:** ${notes.length}

${notes.slice(0, 10).map((note: any, i: number) => `
${i + 1}. **${note.title}**
   • ID: ${note.id}
   • Category: ${note.category || 'personal'}
   • Created: ${new Date(note.createdAt).toLocaleDateString()}
   ${note.tags && note.tags.length > 0 ? `• Tags: ${note.tags.join(', ')}` : ''}
`).join('\n')}
${notes.length > 10 ? `\n... and ${notes.length - 10} more notes` : ''}
      `;

      return {
        content: [{
          type: 'text',
          text: response,
        } as TextContent],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error listing notes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  private async handleReadNote(args: any) {
    try {
      const note = await this.backendClient.readNote(args.noteId);

      const response = `
📄 **Note Details**

**Title:** ${note.title}
**ID:** ${note.id}
**Category:** ${note.category || 'personal'}
**Created:** ${new Date(note.createdAt).toLocaleDateString()}
${note.tags && note.tags.length > 0 ? `**Tags:** ${note.tags.join(', ')}` : ''}

**Content:**
${note.content}
      `;

      return {
        content: [{
          type: 'text',
          text: response,
        } as TextContent],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error reading note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  private async handleCreateNote(args: any) {
    try {
      const note = await this.backendClient.createNote(args);

      const response = `
✅ **Note Created**

**Title:** ${note.title}
**ID:** ${note.id}
**Category:** ${note.category || 'personal'}
${note.tags && note.tags.length > 0 ? `**Tags:** ${note.tags.join(', ')}` : ''}

The note has been saved to your AiDD account.
      `;

      return {
        content: [{
          type: 'text',
          text: response,
        } as TextContent],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error creating note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  // =============================================================================
  // ACTION ITEMS MANAGEMENT HANDLERS
  // =============================================================================

  private async handleListActionItems(args: any) {
    try {
      const actionItems = await this.backendClient.listActionItems(args);

      const response = `
📋 **Action Items Retrieved**

**Total action items:** ${actionItems.length}

${actionItems.slice(0, 10).map((item: any, i: number) => `
${i + 1}. **${item.title}**
   • ID: ${item.id}
   • Priority: ${item.priority}
   • Category: ${item.category}
   ${item.dueDate ? `• Due: ${new Date(item.dueDate).toLocaleDateString()}` : ''}
   ${item.tags && item.tags.length > 0 ? `• Tags: ${item.tags.join(', ')}` : ''}
`).join('\n')}
${actionItems.length > 10 ? `\n... and ${actionItems.length - 10} more items` : ''}
      `;

      return {
        content: [{
          type: 'text',
          text: response,
        } as TextContent],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error listing action items: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  private async handleReadActionItem(args: any) {
    try {
      const item = await this.backendClient.readActionItem(args.actionItemId);

      const response = `
📋 **Action Item Details**

**Title:** ${item.title}
**ID:** ${item.id}
**Priority:** ${item.priority}
**Category:** ${item.category}
${item.dueDate ? `**Due Date:** ${new Date(item.dueDate).toLocaleDateString()}` : ''}
${item.tags && item.tags.length > 0 ? `**Tags:** ${item.tags.join(', ')}` : ''}

**Description:**
${item.description || 'No description'}
      `;

      return {
        content: [{
          type: 'text',
          text: response,
        } as TextContent],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error reading action item: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  private async handleExtractActionItems(args: any) {
    try {
      const { source, noteIds, text, extractionMode = 'adhd-optimized' } = args;

      let notesToProcess: any[] = [];

      if (source === 'notes') {
        if (!noteIds || noteIds.length === 0) {
          // Get all notes
          const allNotes = await this.backendClient.listNotes({});
          notesToProcess = allNotes;
        } else {
          // Get specific notes
          for (const noteId of noteIds) {
            const note = await this.backendClient.readNote(noteId);
            notesToProcess.push(note);
          }
        }
      } else if (source === 'text') {
        if (!text) {
          throw new Error('Text content is required when source is "text"');
        }
        notesToProcess = [{
          id: 'temp',
          title: 'User Provided Text',
          content: text,
        }];
      }

      const actionItems = await this.backendClient.extractActionItems(notesToProcess);

      const response = `
🔍 **Action Items Extracted**

**Summary:**
• Source: ${source === 'notes' ? `${notesToProcess.length} notes` : 'provided text'}
• Extraction mode: ${extractionMode}
• Action items found: ${actionItems.length}

**Extracted Action Items:**
${actionItems.slice(0, 10).map((item: any, i: number) => `
${i + 1}. **${item.title}**
   • Priority: ${item.priority}
   • Category: ${item.category}
   • Confidence: ${(item.confidence * 100).toFixed(0)}%
   ${item.dueDate ? `• Due: ${item.dueDate}` : ''}
   ${item.tags && item.tags.length > 0 ? `• Tags: ${item.tags.join(', ')}` : ''}
`).join('\n')}
${actionItems.length > 10 ? `\n... and ${actionItems.length - 10} more items` : ''}

Action items have been saved to your AiDD account.
      `;

      return {
        content: [{
          type: 'text',
          text: response,
        } as TextContent],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error extracting action items: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  // =============================================================================
  // TASKS MANAGEMENT HANDLERS
  // =============================================================================

  private async handleListTasks(args: any) {
    try {
      const tasks = await this.backendClient.listTasks(args);

      const response = `
✅ **Tasks Retrieved**

**Total tasks:** ${tasks.length}

${tasks.slice(0, 10).map((task: any, i: number) => {
  const hasScores = task.relevanceScore !== undefined && task.impactScore !== undefined && task.urgencyScore !== undefined;
  const overallScore = hasScores ? ((task.relevanceScore + task.impactScore + task.urgencyScore) / 3 * 100).toFixed(0) : undefined;

  return `
${i + 1}. **${task.title}**
   • ID: ${task.id}
   ${task.hasBeenAIScored && overallScore ? `• Overall AI Score: ${overallScore}%` : ''}
   ${task.relevanceScore !== undefined ? `• Relevance: ${(task.relevanceScore * 100).toFixed(0)}%` : ''}
   ${task.impactScore !== undefined ? `• Impact: ${(task.impactScore * 100).toFixed(0)}%` : ''}
   ${task.urgencyScore !== undefined ? `• Urgency: ${(task.urgencyScore * 100).toFixed(0)}%` : ''}
   ${task.estimatedTime ? `• Time: ${task.estimatedTime} min` : ''}
   ${task.energyRequired ? `• Energy: ${task.energyRequired}` : ''}
   ${task.dueDate ? `• Due: ${new Date(task.dueDate).toLocaleDateString()}` : ''}
`;
}).join('\n')}
${tasks.length > 10 ? `\n... and ${tasks.length - 10} more tasks` : ''}
      `;

      return {
        content: [{
          type: 'text',
          text: response,
        } as TextContent],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error listing tasks: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  private async handleReadTask(args: any) {
    try {
      const task = await this.backendClient.readTask(args.taskId);

      const hasScores = task.relevanceScore !== undefined && task.impactScore !== undefined && task.urgencyScore !== undefined;
      const overallScore = hasScores ? ((task.relevanceScore + task.impactScore + task.urgencyScore) / 3 * 100).toFixed(0) : undefined;

      const response = `
✅ **Task Details**

**Title:** ${task.title}
**ID:** ${task.id}
${task.hasBeenAIScored ? `**AI Scored:** ✓` : ''}
${overallScore ? `**Overall AI Score:** ${overallScore}%` : ''}
${task.relevanceScore !== undefined ? `**Relevance Score:** ${(task.relevanceScore * 100).toFixed(0)}%` : ''}
${task.impactScore !== undefined ? `**Impact Score:** ${(task.impactScore * 100).toFixed(0)}%` : ''}
${task.urgencyScore !== undefined ? `**Urgency Score:** ${(task.urgencyScore * 100).toFixed(0)}%` : ''}
${task.estimatedTime ? `**Estimated Time:** ${task.estimatedTime} minutes` : ''}
${task.energyRequired ? `**Energy Required:** ${task.energyRequired}` : ''}
${task.taskType ? `**Task Type:** ${task.taskType}` : ''}
${task.dueDate ? `**Due Date:** ${new Date(task.dueDate).toLocaleDateString()}` : ''}
${task.tags && task.tags.length > 0 ? `**Tags:** ${task.tags.join(', ')}` : ''}

**Description:**
${task.description || 'No description'}

${task.dependsOnTaskOrders && task.dependsOnTaskOrders.length > 0 ?
  `**Dependencies:** Tasks ${task.dependsOnTaskOrders.join(', ')}` : ''}
      `;

      return {
        content: [{
          type: 'text',
          text: response,
        } as TextContent],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error reading task: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  private async handleConvertToTasks(args: any) {
    try {
      const { actionItemIds, breakdownMode = 'adhd-optimized' } = args;

      let actionItems: any[] = [];

      if (!actionItemIds || actionItemIds.length === 0) {
        // Convert all action items
        actionItems = await this.backendClient.listActionItems({});
      } else {
        // Convert specific action items
        for (const id of actionItemIds) {
          const item = await this.backendClient.readActionItem(id);
          actionItems.push(item);
        }
      }

      const tasks = await this.backendClient.convertToTasks(actionItems);

      const response = `
✨ **Tasks Created (ADHD-Optimized)**

**Summary:**
• Action items converted: ${actionItems.length}
• Tasks created: ${tasks.length}
• Breakdown mode: ${breakdownMode}
• Average tasks per item: ${(tasks.length / actionItems.length).toFixed(1)}

**Created Tasks:**
${tasks.slice(0, 15).map((task: any, i: number) => `
${i + 1}. **${task.title}**
   • Time: ${task.estimatedTime} min
   • Energy: ${task.energyRequired}
   • Type: ${task.taskType}
   ${task.dependsOnTaskOrders && task.dependsOnTaskOrders.length > 0 ? `• Depends on: Task ${task.dependsOnTaskOrders.join(', ')}` : ''}
`).join('\n')}
${tasks.length > 15 ? `\n... and ${tasks.length - 15} more tasks` : ''}

**Task Breakdown:**
• Quick wins: ${tasks.filter((t: any) => t.taskType === 'quick_win').length}
• Focus required: ${tasks.filter((t: any) => t.taskType === 'focus_required').length}
• Collaborative: ${tasks.filter((t: any) => t.taskType === 'collaborative').length}
• Creative: ${tasks.filter((t: any) => t.taskType === 'creative').length}
• Administrative: ${tasks.filter((t: any) => t.taskType === 'administrative').length}

Tasks have been saved to your AiDD account.
      `;

      return {
        content: [{
          type: 'text',
          text: response,
        } as TextContent],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error converting to tasks: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  private async handleScoreTasks(args: any) {
    try {
      const { considerCurrentEnergy = true, timeOfDay = 'auto' } = args;

      // Get all tasks
      const tasks = await this.backendClient.listTasks({});

      // Score tasks using backend AI
      const scoredTasks = await this.backendClient.scoreTasks(tasks);

      // Sort by score
      scoredTasks.sort((a: any, b: any) => b.score - a.score);

      const actualTimeOfDay = timeOfDay === 'auto' ? this.getTimeOfDay() : timeOfDay;

      const response = `
🎯 **Tasks Scored & Prioritized**

**Summary:**
• Tasks scored: ${scoredTasks.length}
• Time optimization: ${actualTimeOfDay}
• Energy considered: ${considerCurrentEnergy ? 'Yes' : 'No'}

**Top Priority Tasks (Next 2 Hours):**
${scoredTasks.slice(0, 5).map((task: any, i: number) => `
${i + 1}. **${task.title}** (Score: ${task.score}/100)
   ${task.factors ? `• Urgency: ${task.factors.urgency}/10` : ''}
   ${task.factors ? `• Importance: ${task.factors.importance}/10` : ''}
   ${task.factors ? `• Effort: ${task.factors.effort}/10` : ''}
   ${task.factors ? `• ADHD Match: ${task.factors.adhd_compatibility}/10` : ''}
   ${task.recommendation ? `📝 ${task.recommendation}` : ''}
`).join('\n')}

**Suggested Schedule:**
🌅 **Morning (High Energy):**
${scoredTasks.filter((t: any) => t.factors && t.factors.effort >= 7).slice(0, 3).map((t: any) => `  • ${t.title}`).join('\n') || '  No high-energy tasks'}

☀️ **Afternoon (Medium Energy):**
${scoredTasks.filter((t: any) => t.factors && t.factors.effort >= 4 && t.factors.effort < 7).slice(0, 3).map((t: any) => `  • ${t.title}`).join('\n') || '  No medium-energy tasks'}

🌙 **Evening (Low Energy):**
${scoredTasks.filter((t: any) => t.factors && t.factors.effort < 4).slice(0, 3).map((t: any) => `  • ${t.title}`).join('\n') || '  No low-energy tasks'}

All tasks have been scored and saved to your AiDD account.
      `;

      return {
        content: [{
          type: 'text',
          text: response,
        } as TextContent],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error scoring tasks: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  // Helper methods
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
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(notes, null, 2),
          }],
        };

      case 'aidd://action-items':
        const actionItems = await this.backendClient.listActionItems({});
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(actionItems, null, 2),
          }],
        };

      case 'aidd://tasks':
        const tasks = await this.backendClient.listTasks({});
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(tasks, null, 2),
          }],
        };

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
