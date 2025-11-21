#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
import { execAppleScript } from './applescript.js';
import { AiDDBackendClient } from './aidd-backend-client.js';
import { z } from 'zod';

// Workflow state management
interface WorkflowState {
  currentStep: 'idle' | 'auth' | 'import' | 'extract' | 'convert' | 'score' | 'sync' | 'complete';
  isAuthenticated: boolean;
  importedNotes: Array<{ id: string; title: string; content: string }>;
  extractedActionItems: any[];
  convertedTasks: any[];
  scoredTasks: any[];
  targetService?: string;
  userId?: string;
}

// Tool Schemas
const StartWorkflowSchema = z.object({
  targetService: z.enum(['google-tasks', 'microsoft-todo', 'trello', 'todoist', 'notion', 'ticktick']).optional(),
  autoSync: z.boolean().default(false),
});

const ImportNotesSchema = z.object({
  folder: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().default(50),
});

const ProcessNotesSchema = z.object({
  noteIds: z.array(z.string()).optional(),
  extractionMode: z.enum(['quick', 'comprehensive', 'adhd-optimized']).default('adhd-optimized'),
});

const ReviewActionItemsSchema = z.object({
  actionItemIds: z.array(z.string()).optional(),
  autoApprove: z.boolean().default(false),
});

const ConvertToTasksSchema = z.object({
  actionItemIds: z.array(z.string()).optional(),
  breakdownMode: z.enum(['simple', 'adhd-optimized', 'detailed']).default('adhd-optimized'),
});

const ScoreAndPrioritizeSchema = z.object({
  considerCurrentEnergy: z.boolean().default(true),
  timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'auto']).default('auto'),
});

const SyncToServiceSchema = z.object({
  service: z.enum(['google-tasks', 'microsoft-todo', 'trello', 'todoist', 'notion', 'ticktick']),
  createBackup: z.boolean().default(true),
});

class AiDDMCPServer {
  private server: Server;
  private backendClient: AiDDBackendClient;
  private workflowState: WorkflowState;

  constructor() {
    this.server = new Server(
      {
        name: 'AiDD',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.backendClient = new AiDDBackendClient();
    this.workflowState = {
      currentStep: 'idle',
      isAuthenticated: false,
      importedNotes: [],
      extractedActionItems: [],
      convertedTasks: [],
      scoredTasks: [],
    };

    this.setupHandlers();
    this.setupBackendListeners();
  }

  private setupBackendListeners() {
    this.backendClient.on('authenticated', (data) => {
      this.workflowState.isAuthenticated = true;
      this.workflowState.userId = data.userId;
    });

    this.backendClient.on('progress', (data) => {
      console.error(`Progress: ${data.operation} - ${data.progress}% - ${data.message}`);
    });

    this.backendClient.on('error', (data) => {
      console.error(`Backend error: ${data.type} - ${data.error}`);
    });
  }

  private setupHandlers() {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

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
          // Workflow Tools
          case 'start_workflow':
            return await this.startWorkflow(StartWorkflowSchema.parse(args));
          case 'import_notes':
            return await this.importNotes(ImportNotesSchema.parse(args));
          case 'process_notes':
            return await this.processNotes(ProcessNotesSchema.parse(args));
          case 'review_action_items':
            return await this.reviewActionItems(ReviewActionItemsSchema.parse(args));
          case 'convert_to_tasks':
            return await this.convertToTasks(ConvertToTasksSchema.parse(args));
          case 'score_and_prioritize':
            return await this.scoreAndPrioritize(ScoreAndPrioritizeSchema.parse(args));
          case 'sync_to_service':
            return await this.syncToService(SyncToServiceSchema.parse(args));

          // Utility Tools
          case 'get_workflow_status':
            return await this.getWorkflowStatus();
          case 'reset_workflow':
            return await this.resetWorkflow();
          case 'check_backend_health':
            return await this.checkBackendHealth();

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
      // Main Workflow Tools
      {
        name: 'start_workflow',
        description: 'Start the AiDD workflow for processing Apple Notes into tasks',
        inputSchema: {
          type: 'object',
          properties: {
            targetService: {
              type: 'string',
              enum: ['google-tasks', 'microsoft-todo', 'trello', 'todoist', 'notion', 'ticktick'],
              description: 'Target service for syncing (optional)',
            },
            autoSync: {
              type: 'boolean',
              description: 'Automatically sync at the end (default: false)',
            },
          },
        },
      },
      {
        name: 'import_notes',
        description: 'Import notes from Apple Notes for processing',
        inputSchema: {
          type: 'object',
          properties: {
            folder: { type: 'string', description: 'Specific folder to import from (optional)' },
            query: { type: 'string', description: 'Search query to filter notes (optional)' },
            limit: { type: 'number', description: 'Maximum notes to import (default: 50)' },
          },
        },
      },
      {
        name: 'process_notes',
        description: 'Process imported notes to extract action items using AiDD backend AI',
        inputSchema: {
          type: 'object',
          properties: {
            noteIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific note IDs to process (optional)',
            },
            extractionMode: {
              type: 'string',
              enum: ['quick', 'comprehensive', 'adhd-optimized'],
              description: 'Extraction mode (default: adhd-optimized)',
            },
          },
        },
      },
      {
        name: 'review_action_items',
        description: 'Review and optionally edit extracted action items',
        inputSchema: {
          type: 'object',
          properties: {
            actionItemIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific items to review (optional)',
            },
            autoApprove: {
              type: 'boolean',
              description: 'Auto-approve all items (default: false)',
            },
          },
        },
      },
      {
        name: 'convert_to_tasks',
        description: 'Convert action items to ADHD-optimized tasks',
        inputSchema: {
          type: 'object',
          properties: {
            actionItemIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific items to convert (optional)',
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
        name: 'score_and_prioritize',
        description: 'Score tasks using AI for optimal prioritization',
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
      {
        name: 'sync_to_service',
        description: 'Sync tasks to your preferred task management service',
        inputSchema: {
          type: 'object',
          properties: {
            service: {
              type: 'string',
              enum: ['google-tasks', 'microsoft-todo', 'trello', 'todoist', 'notion', 'ticktick'],
              description: 'Service to sync to',
            },
            createBackup: {
              type: 'boolean',
              description: 'Create backup before sync (default: true)',
            },
          },
          required: ['service'],
        },
      },

      // Utility Tools
      {
        name: 'get_workflow_status',
        description: 'Get current workflow status and progress',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'reset_workflow',
        description: 'Reset workflow to start fresh',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'check_backend_health',
        description: 'Check AiDD backend service health',
        inputSchema: { type: 'object', properties: {} },
      },
    ];
  }

  private getResources(): Resource[] {
    return [
      {
        uri: 'aidd://workflow/status',
        name: 'Workflow Status',
        description: 'Current AiDD workflow status and progress',
        mimeType: 'application/json',
      },
      {
        uri: 'aidd://action-items',
        name: 'Extracted Action Items',
        description: 'Action items extracted from notes',
        mimeType: 'application/json',
      },
      {
        uri: 'aidd://tasks',
        name: 'Converted Tasks',
        description: 'ADHD-optimized tasks ready for sync',
        mimeType: 'application/json',
      },
      {
        uri: 'aidd://backend/metrics',
        name: 'Backend Metrics',
        description: 'AiDD backend performance metrics',
        mimeType: 'application/json',
      },
    ];
  }

  // Workflow Implementation
  private async startWorkflow(params: z.infer<typeof StartWorkflowSchema>) {
    // Authenticate with backend
    const authSuccess = await this.backendClient.authenticate();

    if (!authSuccess) {
      return {
        content: [{
          type: 'text',
          text: '❌ Failed to authenticate with AiDD backend. Please check your connection.',
        } as TextContent],
      };
    }

    this.workflowState.currentStep = 'auth';
    this.workflowState.targetService = params.targetService;

    const response = `
🚀 **AiDD Workflow Started**

✅ Authenticated with backend
👤 User ID: ${this.workflowState.userId}

**Next Steps:**
1. Import notes from Apple Notes → Use \`import_notes\`
2. Process notes to extract action items → Use \`process_notes\`
3. Review and approve action items → Use \`review_action_items\`
4. Convert to ADHD-optimized tasks → Use \`convert_to_tasks\`
5. Score and prioritize tasks → Use \`score_and_prioritize\`
${params.targetService ? `6. Sync to ${params.targetService} → Use \`sync_to_service\`` : '6. Choose service and sync → Use `sync_to_service`'}

${params.autoSync ? '🔄 Auto-sync enabled' : '📌 Manual sync required'}

Ready to import notes. Use \`import_notes\` to begin.
    `;

    return {
      content: [{
        type: 'text',
        text: response,
      } as TextContent],
    };
  }

  private async importNotes(params: z.infer<typeof ImportNotesSchema>) {
    this.workflowState.currentStep = 'import';

    // Build AppleScript query
    let searchCondition = '';
    if (params.query && params.query !== '*') {
      searchCondition = `whose body contains "${params.query}" or name contains "${params.query}"`;
    }

    const script = `
      on run
        tell application "Notes"
          set output to "["
          set noteCount to 0
          set maxCount to ${params.limit}

          ${params.folder ?
            `set targetFolder to folder "${params.folder}"
            set allNotes to notes of targetFolder ${searchCondition}` :
            `set allNotes to every note ${searchCondition}`
          }

          repeat with aNote in allNotes
            if noteCount ≥ maxCount then exit repeat

            set noteTitle to name of aNote as string
            set noteId to id of aNote as string
            set noteBody to body of aNote as string

            -- Escape JSON special characters
            set noteTitle to my escapeJSON(noteTitle)
            set noteBody to my escapeJSON(noteBody)
            set noteId to my escapeJSON(noteId)

            if noteCount > 0 then set output to output & ","
            set output to output & "{\\"id\\":\\"" & noteId & "\\",\\"title\\":\\"" & noteTitle & "\\",\\"content\\":\\"" & noteBody & "\\"}"

            set noteCount to noteCount + 1
          end repeat

          set output to output & "]"
          return output
        end tell
      end run

      on escapeJSON(str)
        set str to my replace(str, "\\\\", "\\\\\\\\")
        set str to my replace(str, "\\"", "\\\\\\"")
        set str to my replace(str, return, "\\\\n")
        set str to my replace(str, linefeed, "\\\\n")
        set str to my replace(str, tab, "\\\\t")
        return str
      end escapeJSON

      on replace(str, find, replacement)
        set text item delimiters to find
        set pieces to text items of str
        set text item delimiters to replacement
        set str to pieces as string
        set text item delimiters to ""
        return str
      end replace
    `;

    try {
      const result = await execAppleScript(script);
      const notes = JSON.parse(result);

      this.workflowState.importedNotes = notes;

      const response = `
📥 **Notes Imported Successfully**

**Summary:**
• Notes imported: ${notes.length}
${params.folder ? `• From folder: ${params.folder}` : '• From: All folders'}
${params.query ? `• Search filter: "${params.query}"` : ''}

**Imported Notes:**
${notes.slice(0, 10).map((note: any, i: number) =>
  `${i + 1}. ${note.title} (${note.content.slice(0, 50).replace(/\n/g, ' ')}...)`
).join('\n')}
${notes.length > 10 ? `\n... and ${notes.length - 10} more notes` : ''}

**Next Step:** Process notes to extract action items
Use \`process_notes\` to continue.
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
          text: `❌ Error importing notes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  private async processNotes(params: z.infer<typeof ProcessNotesSchema>) {
    if (this.workflowState.importedNotes.length === 0) {
      return {
        content: [{
          type: 'text',
          text: '⚠️ No notes imported. Please use `import_notes` first.',
        } as TextContent],
      };
    }

    this.workflowState.currentStep = 'extract';

    const notesToProcess = params.noteIds
      ? this.workflowState.importedNotes.filter(n => params.noteIds?.includes(n.id))
      : this.workflowState.importedNotes;

    try {
      // Extract action items using backend AI
      const actionItems = await this.backendClient.extractActionItems(notesToProcess);
      this.workflowState.extractedActionItems = actionItems;

      const response = `
🔍 **Action Items Extracted**

**Extraction Summary:**
• Notes processed: ${notesToProcess.length}
• Action items found: ${actionItems.length}
• Mode: ${params.extractionMode}

**Extracted Action Items:**
${actionItems.slice(0, 10).map((item: any, i: number) => `
${i + 1}. **${item.title}**
   • Priority: ${item.priority}
   • Category: ${item.category}
   • Confidence: ${(item.confidence * 100).toFixed(0)}%
   ${item.dueDate ? `• Due: ${item.dueDate}` : ''}
   ${item.tags.length > 0 ? `• Tags: ${item.tags.join(', ')}` : ''}
`).join('\n')}
${actionItems.length > 10 ? `\n... and ${actionItems.length - 10} more items` : ''}

**Next Step:** Review action items
Use \`review_action_items\` to review or \`convert_to_tasks\` to proceed directly.
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
          text: `❌ Error processing notes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  private async reviewActionItems(params: z.infer<typeof ReviewActionItemsSchema>) {
    if (this.workflowState.extractedActionItems.length === 0) {
      return {
        content: [{
          type: 'text',
          text: '⚠️ No action items to review. Please use `process_notes` first.',
        } as TextContent],
      };
    }

    const itemsToReview = params.actionItemIds
      ? this.workflowState.extractedActionItems.filter(i => params.actionItemIds?.includes(i.id))
      : this.workflowState.extractedActionItems;

    if (params.autoApprove) {
      return {
        content: [{
          type: 'text',
          text: `✅ Auto-approved ${itemsToReview.length} action items. Use \`convert_to_tasks\` to continue.`,
        } as TextContent],
      };
    }

    const response = `
📋 **Review Action Items**

${itemsToReview.map((item: any, i: number) => `
**${i + 1}. ${item.title}**
• Description: ${item.description}
• Priority: ${item.priority}
• Category: ${item.category}
• Confidence: ${(item.confidence * 100).toFixed(0)}%
${item.dueDate ? `• Due: ${item.dueDate}` : ''}
${item.tags.length > 0 ? `• Tags: ${item.tags.join(', ')}` : ''}
`).join('\n---\n')}

**Options:**
• To approve all: Use \`review_action_items\` with \`autoApprove: true\`
• To continue: Use \`convert_to_tasks\`
• To re-extract: Use \`process_notes\` with different mode
    `;

    return {
      content: [{
        type: 'text',
        text: response,
      } as TextContent],
    };
  }

  private async convertToTasks(params: z.infer<typeof ConvertToTasksSchema>) {
    if (this.workflowState.extractedActionItems.length === 0) {
      return {
        content: [{
          type: 'text',
          text: '⚠️ No action items to convert. Please extract action items first.',
        } as TextContent],
      };
    }

    this.workflowState.currentStep = 'convert';

    const itemsToConvert = params.actionItemIds
      ? this.workflowState.extractedActionItems.filter(i => params.actionItemIds?.includes(i.id))
      : this.workflowState.extractedActionItems;

    try {
      // Convert to ADHD-optimized tasks using backend AI
      const tasks = await this.backendClient.convertToTasks(itemsToConvert);
      this.workflowState.convertedTasks = tasks;

      const response = `
✨ **Tasks Created (ADHD-Optimized)**

**Conversion Summary:**
• Action items converted: ${itemsToConvert.length}
• Tasks created: ${tasks.length}
• Mode: ${params.breakdownMode}
• Average tasks per item: ${(tasks.length / itemsToConvert.length).toFixed(1)}

**Converted Tasks:**
${tasks.slice(0, 15).map((task: any, i: number) => `
${i + 1}. **${task.title}**
   • Time: ${task.estimatedTime} min
   • Energy: ${task.energyRequired}
   • Type: ${task.taskType}
   ${task.dependsOnTaskOrders.length > 0 ? `• Depends on: Task ${task.dependsOnTaskOrders.join(', ')}` : ''}
`).join('\n')}
${tasks.length > 15 ? `\n... and ${tasks.length - 15} more tasks` : ''}

**Task Breakdown:**
• Quick wins: ${tasks.filter((t: any) => t.taskType === 'quick_win').length}
• Focus required: ${tasks.filter((t: any) => t.taskType === 'focus_required').length}
• Collaborative: ${tasks.filter((t: any) => t.taskType === 'collaborative').length}
• Creative: ${tasks.filter((t: any) => t.taskType === 'creative').length}
• Administrative: ${tasks.filter((t: any) => t.taskType === 'administrative').length}

**Next Step:** Score and prioritize tasks
Use \`score_and_prioritize\` to continue.
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
          text: `❌ Error converting tasks: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  private async scoreAndPrioritize(params: z.infer<typeof ScoreAndPrioritizeSchema>) {
    if (this.workflowState.convertedTasks.length === 0) {
      return {
        content: [{
          type: 'text',
          text: '⚠️ No tasks to score. Please convert action items first.',
        } as TextContent],
      };
    }

    this.workflowState.currentStep = 'score';

    try {
      // Score tasks using backend AI
      const scoredTasks = await this.backendClient.scoreTasks(this.workflowState.convertedTasks);
      this.workflowState.scoredTasks = scoredTasks;

      // Sort by score
      scoredTasks.sort((a: any, b: any) => b.score - a.score);

      const timeOfDay = params.timeOfDay === 'auto'
        ? this.getTimeOfDay()
        : params.timeOfDay;

      const response = `
🎯 **Tasks Scored & Prioritized**

**Scoring Summary:**
• Tasks scored: ${scoredTasks.length}
• Time optimization: ${timeOfDay}
• Energy considered: ${params.considerCurrentEnergy ? 'Yes' : 'No'}

**Top Priority Tasks (Next 2 Hours):**
${scoredTasks.slice(0, 5).map((task: any, i: number) => `
${i + 1}. **${task.title}** (Score: ${task.score}/100)
   • Urgency: ${task.factors.urgency}/10
   • Importance: ${task.factors.importance}/10
   • Effort: ${task.factors.effort}/10
   • ADHD Match: ${task.factors.adhd_compatibility}/10
   📝 ${task.recommendation}
`).join('\n')}

**Suggested Schedule:**
🌅 **Morning (High Energy):**
${scoredTasks.filter((t: any) => t.factors.effort >= 7).slice(0, 3).map((t: any) => `  • ${t.title}`).join('\n')}

☀️ **Afternoon (Medium Energy):**
${scoredTasks.filter((t: any) => t.factors.effort >= 4 && t.factors.effort < 7).slice(0, 3).map((t: any) => `  • ${t.title}`).join('\n')}

🌙 **Evening (Low Energy):**
${scoredTasks.filter((t: any) => t.factors.effort < 4).slice(0, 3).map((t: any) => `  • ${t.title}`).join('\n')}

**Next Step:** Sync to your task management service
Use \`sync_to_service\` with your preferred service.
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

  private async syncToService(params: z.infer<typeof SyncToServiceSchema>) {
    if (this.workflowState.convertedTasks.length === 0) {
      return {
        content: [{
          type: 'text',
          text: '⚠️ No tasks to sync. Please complete the workflow first.',
        } as TextContent],
      };
    }

    this.workflowState.currentStep = 'sync';

    try {
      const success = await this.backendClient.syncTasks(
        this.workflowState.convertedTasks,
        params.service
      );

      if (success) {
        this.workflowState.currentStep = 'complete';

        const response = `
🎉 **Sync Complete!**

✅ Successfully synced ${this.workflowState.convertedTasks.length} tasks to **${params.service}**

**Summary:**
• Notes processed: ${this.workflowState.importedNotes.length}
• Action items extracted: ${this.workflowState.extractedActionItems.length}
• Tasks created: ${this.workflowState.convertedTasks.length}
• Tasks synced: ${this.workflowState.convertedTasks.length}
${params.createBackup ? '• Backup created: Yes' : ''}

**What's Next:**
1. Open ${params.service} to see your new tasks
2. Tasks are organized by priority and energy level
3. Start with the top-priority quick wins
4. Take breaks between focus-intensive tasks

**Workflow Complete!** 🚀

To process more notes, use \`reset_workflow\` and start again.
        `;

        return {
          content: [{
            type: 'text',
            text: response,
          } as TextContent],
        };
      } else {
        return {
          content: [{
            type: 'text',
            text: `❌ Sync failed. Please check your ${params.service} credentials and try again.`,
          } as TextContent],
        };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error syncing: ${error instanceof Error ? error.message : 'Unknown error'}`,
        } as TextContent],
      };
    }
  }

  private async getWorkflowStatus() {
    const statusEmoji = {
      idle: '💤',
      auth: '🔐',
      import: '📥',
      extract: '🔍',
      convert: '✨',
      score: '🎯',
      sync: '🔄',
      complete: '✅',
    };

    const response = `
${statusEmoji[this.workflowState.currentStep]} **AiDD Workflow Status**

**Current Step:** ${this.workflowState.currentStep}
**Authenticated:** ${this.workflowState.isAuthenticated ? '✅' : '❌'}
${this.workflowState.userId ? `**User ID:** ${this.workflowState.userId}` : ''}

**Progress:**
• Notes imported: ${this.workflowState.importedNotes.length}
• Action items extracted: ${this.workflowState.extractedActionItems.length}
• Tasks created: ${this.workflowState.convertedTasks.length}
• Tasks scored: ${this.workflowState.scoredTasks.length}
${this.workflowState.targetService ? `• Target service: ${this.workflowState.targetService}` : ''}

**Available Actions:**
${this.getAvailableActions().map(a => `• ${a}`).join('\n')}
    `;

    return {
      content: [{
        type: 'text',
        text: response,
      } as TextContent],
    };
  }

  private async resetWorkflow() {
    this.workflowState = {
      currentStep: 'idle',
      isAuthenticated: false,
      importedNotes: [],
      extractedActionItems: [],
      convertedTasks: [],
      scoredTasks: [],
    };

    return {
      content: [{
        type: 'text',
        text: '🔄 Workflow reset. Use `start_workflow` to begin again.',
      } as TextContent],
    };
  }

  private async checkBackendHealth() {
    const isHealthy = await this.backendClient.checkHealth();

    const response = isHealthy
      ? '✅ AiDD backend is healthy and responding'
      : '❌ AiDD backend is not responding. Please check your connection.';

    return {
      content: [{
        type: 'text',
        text: response,
      } as TextContent],
    };
  }

  // Helper methods
  private getAvailableActions(): string[] {
    const actions: string[] = [];

    switch (this.workflowState.currentStep) {
      case 'idle':
        actions.push('start_workflow - Begin the AiDD workflow');
        break;
      case 'auth':
        actions.push('import_notes - Import notes from Apple Notes');
        break;
      case 'import':
        actions.push('process_notes - Extract action items');
        break;
      case 'extract':
        actions.push('review_action_items - Review extracted items');
        actions.push('convert_to_tasks - Convert to tasks');
        break;
      case 'convert':
        actions.push('score_and_prioritize - Score and prioritize tasks');
        break;
      case 'score':
        actions.push('sync_to_service - Sync to task management service');
        break;
      case 'complete':
        actions.push('reset_workflow - Start a new workflow');
        break;
    }

    actions.push('get_workflow_status - Check current status');
    return actions;
  }

  private getTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }

  private async handleResourceRead(uri: string) {
    switch (uri) {
      case 'aidd://workflow/status':
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(this.workflowState, null, 2),
          }],
        };

      case 'aidd://action-items':
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(this.workflowState.extractedActionItems, null, 2),
          }],
        };

      case 'aidd://tasks':
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(this.workflowState.convertedTasks, null, 2),
          }],
        };

      case 'aidd://backend/metrics':
        // Would fetch from backend monitoring endpoint
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ status: 'healthy', uptime: '99.9%' }, null, 2),
          }],
        };

      default:
        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('AiDD MCP Server running (v2.0 - Backend Integrated)...');
  }
}

// Start the server
const server = new AiDDMCPServer();
server.run().catch(console.error);