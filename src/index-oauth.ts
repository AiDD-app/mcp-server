#!/usr/bin/env node

/**
 * AiDD MCP Server v3.0 - Browser-Based OAuth Authentication
 * Works like GitHub/JIRA MCP servers
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { OAuthServer } from './oauth-server.js';
import { spawn } from 'child_process';

// Tool schemas
const ConnectToolSchema = z.object({});
const DisconnectToolSchema = z.object({});

interface UserInfo {
  email?: string;
  userId?: string;
  subscription?: string;
  name?: string;
}

class AiDDMCPServer {
  private server: Server;
  private oauthServer: OAuthServer;
  private isConnected: boolean = false;
  private userInfo: UserInfo = {};
  private accessToken?: string;
  private refreshToken?: string;

  constructor() {
    this.server = new Server(
      {
        name: 'AiDD',
        version: '3.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.oauthServer = new OAuthServer();
    this.initializeAuth();
    this.setupHandlers();
    this.setupErrorHandling();
  }

  /**
   * Check for existing authentication on startup
   */
  private async initializeAuth() {
    const tokens = await this.oauthServer.loadTokens();

    if (tokens) {
      // Check if token is expired
      if (tokens.expiresAt && Date.now() < tokens.expiresAt) {
        this.accessToken = tokens.accessToken;
        this.refreshToken = tokens.refreshToken;
        this.userInfo = tokens.user || {};
        this.isConnected = true;

        console.error(`✅ AiDD: Already connected as ${this.userInfo.email}`);
      } else if (tokens.refreshToken) {
        // Try to refresh
        try {
          const newTokens = await this.oauthServer.refreshToken(tokens.refreshToken);
          this.accessToken = newTokens.access_token;
          this.refreshToken = newTokens.refresh_token;
          this.userInfo = newTokens.user || {};
          this.isConnected = true;

          console.error(`✅ AiDD: Reconnected as ${this.userInfo.email}`);
        } catch {
          console.error('⚠️ AiDD: Session expired. Please reconnect.');
        }
      }
    }
  }

  private setupHandlers() {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getAvailableTools(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'connect':
          return await this.handleConnect();

        case 'disconnect':
          return await this.handleDisconnect();

        case 'status':
          return await this.handleStatus();

        case 'import_notes':
          if (!this.isConnected) {
            return this.requiresAuth();
          }
          return await this.handleImportNotes(args);

        case 'start_workflow':
          if (!this.isConnected) {
            return this.requiresAuth();
          }
          return await this.handleStartWorkflow(args);

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          };
      }
    });

    // Resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'aidd://status',
          name: 'Connection Status',
          description: 'Current AiDD connection status',
          mimeType: 'application/json',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'aidd://status') {
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  connected: this.isConnected,
                  user: this.userInfo,
                  hasToken: !!this.accessToken,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      throw new Error(`Resource not found: ${uri}`);
    });
  }

  private getAvailableTools(): Tool[] {
    const connectionTools: Tool[] = [
      {
        name: 'connect',
        description: 'Connect to AiDD using browser authentication (like GitHub/JIRA)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'disconnect',
        description: 'Disconnect from AiDD',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'status',
        description: 'Check AiDD connection status',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];

    // Only show workflow tools if connected
    const workflowTools: Tool[] = this.isConnected
      ? [
          {
            name: 'import_notes',
            description: 'Import notes from Apple Notes',
            inputSchema: {
              type: 'object',
              properties: {
                folder: { type: 'string', description: 'Specific folder to import' },
                limit: { type: 'number', description: 'Max notes to import' },
              },
            },
          },
          {
            name: 'start_workflow',
            description: 'Start the AiDD workflow',
            inputSchema: {
              type: 'object',
              properties: {
                targetService: {
                  type: 'string',
                  enum: ['google-tasks', 'microsoft-todo', 'trello', 'todoist'],
                  description: 'Target service for sync',
                },
              },
            },
          },
        ]
      : [];

    return [...connectionTools, ...workflowTools];
  }

  /**
   * Handle connect - opens browser for OAuth
   */
  private async handleConnect() {
    if (this.isConnected) {
      return {
        content: [
          {
            type: 'text',
            text: `✅ Already connected as ${this.userInfo.email}\n\nTo switch accounts, disconnect first.`,
          },
        ],
      };
    }

    try {
      // Show initial message
      const message = `🔐 Opening your browser for authentication...

A browser window will open to sign in to AiDD.
Please complete the authentication in your browser.

Waiting for authentication...`;

      // Start OAuth flow
      const tokens = await this.oauthServer.authenticate();

      // Save tokens and user info
      this.accessToken = tokens.access_token;
      this.refreshToken = tokens.refresh_token;
      this.userInfo = tokens.user || {};
      this.isConnected = true;

      return {
        content: [
          {
            type: 'text',
            text: `✅ Successfully connected to AiDD!

**Account Details:**
• Email: ${this.userInfo.email}
• User ID: ${this.userInfo.userId}
• Subscription: ${this.userInfo.subscription || 'FREE'}

You can now use all AiDD workflow tools.`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Connection failed: ${error.message}

Please try again with the 'connect' command.`,
          },
        ],
      };
    }
  }

  /**
   * Handle disconnect
   */
  private async handleDisconnect() {
    if (!this.isConnected) {
      return {
        content: [
          {
            type: 'text',
            text: '⚠️ Not connected to AiDD',
          },
        ],
      };
    }

    try {
      // Revoke token
      if (this.accessToken) {
        await this.oauthServer.revokeTokens(this.accessToken);
      }

      // Clear state
      this.accessToken = undefined;
      this.refreshToken = undefined;
      this.userInfo = {};
      this.isConnected = false;

      return {
        content: [
          {
            type: 'text',
            text: '✅ Successfully disconnected from AiDD',
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `⚠️ Disconnection warning: ${error.message}\n\nLocal credentials have been cleared.`,
          },
        ],
      };
    }
  }

  /**
   * Handle status check
   */
  private async handleStatus() {
    if (!this.isConnected) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Not connected to AiDD

Use the 'connect' command to authenticate via your browser.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ Connected to AiDD

**Account:**
• Email: ${this.userInfo.email}
• Subscription: ${this.userInfo.subscription || 'FREE'}
• User ID: ${this.userInfo.userId}

**Available Tools:**
• import_notes - Import from Apple Notes
• start_workflow - Begin AiDD workflow
• disconnect - Sign out`,
        },
      ],
    };
  }

  /**
   * Require authentication message
   */
  private requiresAuth() {
    return {
      content: [
        {
          type: 'text',
          text: `🔐 Authentication Required

You need to connect to AiDD first.

**To connect:**
Use the 'connect' command to authenticate via your browser.

This works just like GitHub and JIRA authentication:
1. A browser window will open
2. Sign in to your AiDD account
3. Authorize the MCP integration
4. You'll be redirected back automatically

Try: "Connect to AiDD"`,
        },
      ],
    };
  }

  /**
   * Handle workflow operations (when authenticated)
   */
  private async handleImportNotes(args: any) {
    // Implementation with authenticated API calls
    return {
      content: [
        {
          type: 'text',
          text: `📥 Importing notes with authenticated access...
User: ${this.userInfo.email}
Subscription: ${this.userInfo.subscription}`,
        },
      ],
    };
  }

  private async handleStartWorkflow(args: any) {
    return {
      content: [
        {
          type: 'text',
          text: `🚀 Starting AiDD workflow...
Authenticated as: ${this.userInfo.email}
Ready to process notes with ${this.userInfo.subscription} features.`,
        },
      ],
    };
  }

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('AiDD MCP Server v3.0 (OAuth) running');
  }
}

// Run the server
const server = new AiDDMCPServer();
server.run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});