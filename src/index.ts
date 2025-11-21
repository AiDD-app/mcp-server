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
  ImageContent,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { execAppleScript } from './applescript.js';
import { z } from 'zod';
import { format, parseISO, isValid } from 'date-fns';

// Define tool schemas
const CreateNoteSchema = z.object({
  title: z.string().describe('Title of the note'),
  content: z.string().describe('Content/body of the note'),
  folder: z.string().optional().describe('Folder name to create the note in (optional)'),
  tags: z.array(z.string()).optional().describe('Tags to add to the note (optional)'),
});

const SearchNotesSchema = z.object({
  query: z.string().describe('Search query to find notes'),
  folder: z.string().optional().describe('Limit search to specific folder (optional)'),
  limit: z.number().optional().default(10).describe('Maximum number of results to return'),
  dateFrom: z.string().optional().describe('Filter notes created after this date (ISO format)'),
  dateTo: z.string().optional().describe('Filter notes created before this date (ISO format)'),
});

const ReadNoteSchema = z.object({
  noteId: z.string().describe('ID or title of the note to read'),
  includeMetadata: z.boolean().optional().default(true).describe('Include metadata like creation date and folder'),
});

const UpdateNoteSchema = z.object({
  noteId: z.string().describe('ID or title of the note to update'),
  title: z.string().optional().describe('New title for the note'),
  content: z.string().optional().describe('New content for the note'),
  appendContent: z.string().optional().describe('Content to append to the note'),
  folder: z.string().optional().describe('Move note to different folder'),
});

const DeleteNoteSchema = z.object({
  noteId: z.string().describe('ID or title of the note to delete'),
  confirm: z.boolean().default(false).describe('Confirmation flag for deletion'),
});

const ListFoldersSchema = z.object({
  parentFolder: z.string().optional().describe('List subfolders of a specific folder'),
});

const ExtractActionItemsSchema = z.object({
  noteId: z.string().optional().describe('Extract from specific note (optional)'),
  folder: z.string().optional().describe('Extract from all notes in folder (optional)'),
  dateRange: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  }).optional().describe('Extract from notes within date range'),
  format: z.enum(['json', 'markdown', 'plain']).default('json').describe('Output format'),
});

const ExportNotesSchema = z.object({
  folder: z.string().optional().describe('Export notes from specific folder'),
  format: z.enum(['markdown', 'json', 'csv']).default('markdown').describe('Export format'),
  includeMetadata: z.boolean().default(true).describe('Include metadata in export'),
  dateRange: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  }).optional().describe('Export notes within date range'),
});

const BulkImportSchema = z.object({
  notes: z.array(z.object({
    title: z.string(),
    content: z.string(),
    folder: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })).describe('Array of notes to import'),
  targetFolder: z.string().optional().describe('Target folder for all imported notes'),
});

class AiDDAppleNotesMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'aidd-apple-notes-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
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
          case 'create_note':
            return await this.createNote(CreateNoteSchema.parse(args));
          case 'search_notes':
            return await this.searchNotes(SearchNotesSchema.parse(args));
          case 'read_note':
            return await this.readNote(ReadNoteSchema.parse(args));
          case 'update_note':
            return await this.updateNote(UpdateNoteSchema.parse(args));
          case 'delete_note':
            return await this.deleteNote(DeleteNoteSchema.parse(args));
          case 'list_folders':
            return await this.listFolders(ListFoldersSchema.parse(args));
          case 'extract_action_items':
            return await this.extractActionItems(ExtractActionItemsSchema.parse(args));
          case 'export_notes':
            return await this.exportNotes(ExportNotesSchema.parse(args));
          case 'bulk_import':
            return await this.bulkImport(BulkImportSchema.parse(args));
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
        name: 'create_note',
        description: 'Create a new note in Apple Notes',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the note' },
            content: { type: 'string', description: 'Content/body of the note' },
            folder: { type: 'string', description: 'Folder name (optional)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags (optional)' },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'search_notes',
        description: 'Search for notes in Apple Notes',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            folder: { type: 'string', description: 'Limit to folder (optional)' },
            limit: { type: 'number', description: 'Max results (default: 10)' },
            dateFrom: { type: 'string', description: 'Notes after date (ISO format)' },
            dateTo: { type: 'string', description: 'Notes before date (ISO format)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'read_note',
        description: 'Read the content of a specific note',
        inputSchema: {
          type: 'object',
          properties: {
            noteId: { type: 'string', description: 'Note ID or title' },
            includeMetadata: { type: 'boolean', description: 'Include metadata (default: true)' },
          },
          required: ['noteId'],
        },
      },
      {
        name: 'update_note',
        description: 'Update an existing note',
        inputSchema: {
          type: 'object',
          properties: {
            noteId: { type: 'string', description: 'Note ID or title' },
            title: { type: 'string', description: 'New title (optional)' },
            content: { type: 'string', description: 'New content (optional)' },
            appendContent: { type: 'string', description: 'Content to append (optional)' },
            folder: { type: 'string', description: 'Move to folder (optional)' },
          },
          required: ['noteId'],
        },
      },
      {
        name: 'delete_note',
        description: 'Delete a note from Apple Notes',
        inputSchema: {
          type: 'object',
          properties: {
            noteId: { type: 'string', description: 'Note ID or title' },
            confirm: { type: 'boolean', description: 'Confirm deletion (default: false)' },
          },
          required: ['noteId'],
        },
      },
      {
        name: 'list_folders',
        description: 'List all folders in Apple Notes',
        inputSchema: {
          type: 'object',
          properties: {
            parentFolder: { type: 'string', description: 'Parent folder (optional)' },
          },
        },
      },
      {
        name: 'extract_action_items',
        description: 'Extract action items and tasks from notes',
        inputSchema: {
          type: 'object',
          properties: {
            noteId: { type: 'string', description: 'Specific note (optional)' },
            folder: { type: 'string', description: 'Folder to scan (optional)' },
            dateRange: {
              type: 'object',
              properties: {
                from: { type: 'string', description: 'Start date (ISO format)' },
                to: { type: 'string', description: 'End date (ISO format)' },
              },
            },
            format: {
              type: 'string',
              enum: ['json', 'markdown', 'plain'],
              description: 'Output format (default: json)'
            },
          },
        },
      },
      {
        name: 'export_notes',
        description: 'Export notes in various formats',
        inputSchema: {
          type: 'object',
          properties: {
            folder: { type: 'string', description: 'Folder to export (optional)' },
            format: {
              type: 'string',
              enum: ['markdown', 'json', 'csv'],
              description: 'Export format (default: markdown)'
            },
            includeMetadata: { type: 'boolean', description: 'Include metadata (default: true)' },
            dateRange: {
              type: 'object',
              properties: {
                from: { type: 'string', description: 'Start date (ISO format)' },
                to: { type: 'string', description: 'End date (ISO format)' },
              },
            },
          },
        },
      },
      {
        name: 'bulk_import',
        description: 'Import multiple notes at once',
        inputSchema: {
          type: 'object',
          properties: {
            notes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Note title' },
                  content: { type: 'string', description: 'Note content' },
                  folder: { type: 'string', description: 'Target folder (optional)' },
                  tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags (optional)'
                  },
                },
                required: ['title', 'content'],
              },
            },
            targetFolder: { type: 'string', description: 'Default folder for all notes (optional)' },
          },
          required: ['notes'],
        },
      },
    ];
  }

  private getResources(): Resource[] {
    return [
      {
        uri: 'notes://recent',
        name: 'Recent Notes',
        description: 'Access to recently modified notes',
        mimeType: 'application/json',
      },
      {
        uri: 'notes://folders',
        name: 'Note Folders',
        description: 'List of all note folders',
        mimeType: 'application/json',
      },
      {
        uri: 'notes://action-items',
        name: 'Action Items',
        description: 'Extracted action items from all notes',
        mimeType: 'application/json',
      },
      {
        uri: 'notes://stats',
        name: 'Notes Statistics',
        description: 'Statistics about your notes',
        mimeType: 'application/json',
      },
    ];
  }

  private async handleResourceRead(uri: string) {
    switch (uri) {
      case 'notes://recent':
        return await this.getRecentNotes();
      case 'notes://folders':
        return await this.getFoldersResource();
      case 'notes://action-items':
        return await this.getAllActionItems();
      case 'notes://stats':
        return await this.getNotesStats();
      default:
        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
    }
  }

  // Tool implementations
  private async createNote(params: z.infer<typeof CreateNoteSchema>) {
    try {
      // Escape content for AppleScript
      const escapedTitle = params.title.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
      const escapedContent = params.content.replace(/"/g, '\\"').replace(/\\/g, '\\\\').replace(/\n/g, '\\n');

      const script = `
        on run
          tell application "Notes"
            set newNote to make new note
            set name of newNote to "${escapedTitle}"
            set body of newNote to "${escapedContent}"
            ${params.folder ? `
              try
                move newNote to folder "${params.folder}"
              on error
                -- Folder might not exist, note still created in default location
              end try
            ` : ''}
            set noteId to id of newNote as string
            return "{\\"id\\":\\"" & noteId & "\\",\\"status\\":\\"success\\"}"
          end tell
        end run
      `;

      const result = await execAppleScript(script);
      const response = JSON.parse(result);

      return {
        content: [
          {
            type: 'text',
            text: `Note "${params.title}" created successfully with ID: ${response.id}`,
          } as TextContent,
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating note: ${error instanceof Error ? error.message : 'Unknown error'}`,
          } as TextContent,
        ],
      };
    }
  }

  private async searchNotes(params: z.infer<typeof SearchNotesSchema>) {
    const script = `
      on run
        tell application "Notes"
          set output to "["
          set noteCount to 0
          set maxCount to ${params.limit || 10}

          if "${params.query}" is "*" then
            set allNotes to every note
          else
            set allNotes to notes whose body contains "${params.query}" or name contains "${params.query}"
          end if

          repeat with aNote in allNotes
            if noteCount ≥ maxCount then exit repeat

            set noteTitle to name of aNote as string
            set noteId to id of aNote as string
            set noteBody to body of aNote as string

            -- Get safe preview (handle short notes)
            set bodyLength to length of noteBody
            if bodyLength > 200 then
              set notePreview to text 1 thru 200 of noteBody
            else if bodyLength > 0 then
              set notePreview to noteBody
            else
              set notePreview to ""
            end if

            -- Escape JSON special characters
            set noteTitle to my escapeJSON(noteTitle)
            set notePreview to my escapeJSON(notePreview)
            set noteId to my escapeJSON(noteId)

            if noteCount > 0 then set output to output & ","
            set output to output & "{\\"id\\":\\"" & noteId & "\\",\\"title\\":\\"" & noteTitle & "\\",\\"preview\\":\\"" & notePreview & "\\"}"

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
      const results = await execAppleScript(script);
      const notes = JSON.parse(results);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(notes, null, 2),
          } as TextContent,
        ],
      };
    } catch (error) {
      // Fallback for when AppleScript fails
      return {
        content: [
          {
            type: 'text',
            text: `Error searching notes: ${error instanceof Error ? error.message : 'Unknown error'}`,
          } as TextContent,
        ],
      };
    }
  }

  private async readNote(params: z.infer<typeof ReadNoteSchema>) {
    const script = `
      tell application "Notes"
        set targetNote to note "${params.noteId}"
        set noteContent to body of targetNote
        ${params.includeMetadata ?
          `set noteMetadata to {title:name of targetNote, created:creation date of targetNote, modified:modification date of targetNote}
          return {content:noteContent, metadata:noteMetadata}` :
          'return noteContent'
        }
      end tell
    `;

    const result = await execAppleScript(script);

    return {
      content: [
        {
          type: 'text',
          text: result,
        } as TextContent,
      ],
    };
  }

  private async updateNote(params: z.infer<typeof UpdateNoteSchema>) {
    const updates = [];
    if (params.title) updates.push(`set name of targetNote to "${params.title}"`);
    if (params.content) updates.push(`set body of targetNote to "${params.content.replace(/"/g, '\\"')}"`);
    if (params.appendContent) updates.push(`set body of targetNote to body of targetNote & "\\n" & "${params.appendContent.replace(/"/g, '\\"')}"`);
    if (params.folder) updates.push(`move targetNote to folder "${params.folder}"`);

    const script = `
      tell application "Notes"
        set targetNote to note "${params.noteId}"
        ${updates.join('\n        ')}
        return "Note updated successfully"
      end tell
    `;

    const result = await execAppleScript(script);

    return {
      content: [
        {
          type: 'text',
          text: result,
        } as TextContent,
      ],
    };
  }

  private async deleteNote(params: z.infer<typeof DeleteNoteSchema>) {
    if (!params.confirm) {
      return {
        content: [
          {
            type: 'text',
            text: 'Deletion not confirmed. Set confirm:true to delete the note.',
          } as TextContent,
        ],
      };
    }

    const script = `
      tell application "Notes"
        delete note "${params.noteId}"
        return "Note deleted successfully"
      end tell
    `;

    const result = await execAppleScript(script);

    return {
      content: [
        {
          type: 'text',
          text: result,
        } as TextContent,
      ],
    };
  }

  private async listFolders(params: z.infer<typeof ListFoldersSchema>) {
    const script = `
      on run
        tell application "Notes"
          set output to "["
          set folderCount to 0

          ${params.parentFolder ?
            `set parentFolder to folder "${params.parentFolder}"
            set allFolders to folders of parentFolder` :
            'set allFolders to folders'
          }

          repeat with aFolder in allFolders
            set folderName to name of aFolder as string
            set noteCount to count of notes of aFolder

            -- Escape JSON special characters
            set folderName to my escapeJSON(folderName)

            if folderCount > 0 then set output to output & ","
            set output to output & "{\\"name\\":\\"" & folderName & "\\",\\"noteCount\\":" & noteCount & "}"

            set folderCount to folderCount + 1
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
      const folders = JSON.parse(result);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(folders, null, 2),
          } as TextContent,
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing folders: ${error instanceof Error ? error.message : 'Unknown error'}`,
          } as TextContent,
        ],
      };
    }
  }

  private async extractActionItems(params: z.infer<typeof ExtractActionItemsSchema>) {
    // This would use AI or pattern matching to extract action items
    // For now, we'll do simple pattern matching for TODO, TASK, ACTION, etc.
    const patterns = [
      /(?:TODO|TASK|ACTION):\s*(.+?)(?:\n|$)/gi,
      /(?:^|\n)\s*[-*]\s*\[[ ]\]\s*(.+?)(?:\n|$)/gi, // Unchecked markdown tasks
      /(?:^|\n)\s*(?:\d+\.|-)?\s*(?:Need to|Must|Should|Will)\s+(.+?)(?:\n|$)/gi,
    ];

    // Get notes content based on parameters
    let notesContent = '';
    if (params.noteId) {
      const note = await this.readNote({ noteId: params.noteId, includeMetadata: false });
      notesContent = (note.content[0] as TextContent).text;
    } else {
      // Get all notes based on folder/date range
      // This would require more complex AppleScript
      notesContent = 'Sample action items extraction';
    }

    const actionItems: string[] = [];
    for (const pattern of patterns) {
      const matches = notesContent.matchAll(pattern);
      for (const match of matches) {
        actionItems.push(match[1].trim());
      }
    }

    const result = params.format === 'json'
      ? JSON.stringify(actionItems, null, 2)
      : params.format === 'markdown'
      ? actionItems.map(item => `- [ ] ${item}`).join('\n')
      : actionItems.join('\n');

    return {
      content: [
        {
          type: 'text',
          text: result,
        } as TextContent,
      ],
    };
  }

  private async exportNotes(params: z.infer<typeof ExportNotesSchema>) {
    // This would export notes in the specified format
    // Implementation would depend on the specific format requirements
    const exportData = {
      format: params.format,
      folder: params.folder,
      dateRange: params.dateRange,
      notes: [],
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(exportData, null, 2),
        } as TextContent,
      ],
    };
  }

  private async bulkImport(params: z.infer<typeof BulkImportSchema>) {
    const results = [];

    for (const note of params.notes) {
      try {
        await this.createNote({
          title: note.title,
          content: note.content,
          folder: note.folder || params.targetFolder,
          tags: note.tags,
        });
        results.push({ title: note.title, status: 'success' });
      } catch (error) {
        results.push({ title: note.title, status: 'error', error: String(error) });
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        } as TextContent,
      ],
    };
  }

  // Resource handlers
  private async getRecentNotes() {
    const script = `
      tell application "Notes"
        set recentNotes to {}
        set allNotes to notes
        set sortedNotes to sort allNotes by modification date

        repeat with i from 1 to 10
          if i ≤ count of sortedNotes then
            set aNote to item i of sortedNotes
            set noteInfo to {id:id of aNote, title:name of aNote, modified:modification date of aNote}
            set end of recentNotes to noteInfo
          end if
        end repeat

        return recentNotes
      end tell
    `;

    const result = await execAppleScript(script);

    return {
      contents: [
        {
          uri: 'notes://recent',
          mimeType: 'application/json',
          text: result,
        },
      ],
    };
  }

  private async getFoldersResource() {
    const folders = await this.listFolders({});
    return {
      contents: [
        {
          uri: 'notes://folders',
          mimeType: 'application/json',
          text: (folders.content[0] as TextContent).text,
        },
      ],
    };
  }

  private async getAllActionItems() {
    const actionItems = await this.extractActionItems({ format: 'json' });
    return {
      contents: [
        {
          uri: 'notes://action-items',
          mimeType: 'application/json',
          text: (actionItems.content[0] as TextContent).text,
        },
      ],
    };
  }

  private async getNotesStats() {
    const script = `
      tell application "Notes"
        set totalNotes to count of notes
        set totalFolders to count of folders
        set stats to {totalNotes:totalNotes, totalFolders:totalFolders}
        return stats
      end tell
    `;

    const result = await execAppleScript(script);

    return {
      contents: [
        {
          uri: 'notes://stats',
          mimeType: 'application/json',
          text: result,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('AiDD Apple Notes MCP Server running...');
  }
}

// Start the server
const server = new AiDDAppleNotesMCPServer();
server.run().catch(console.error);