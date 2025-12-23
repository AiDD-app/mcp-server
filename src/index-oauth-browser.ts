#!/usr/bin/env node

/**
 * AiDD MCP Server with Browser-Based OAuth Authentication
 * Works like GitHub/JIRA MCPs - opens browser for authentication
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
// import { z } from 'zod'; // Not needed for this implementation
import { exec } from 'child_process';
import { promisify } from 'util';
import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// OAuth Configuration
const OAUTH_CONFIG = {
  authUrl: 'https://aidd-backend-prod-739193356129.us-central1.run.app/oauth/authorize',
  tokenUrl: 'https://aidd-backend-prod-739193356129.us-central1.run.app/oauth/token',
  revokeUrl: 'https://aidd-backend-prod-739193356129.us-central1.run.app/oauth/revoke',
  clientId: 'aidd-mcp-client',
  redirectUri: 'http://localhost:54321/callback',
  scope: 'profile email tasks notes'
};

// Authentication state
interface AuthState {
  accessToken?: string;
  refreshToken?: string;
  email?: string;
  userId?: string;
  subscription?: string;
  expiresAt?: number;
}

class AiDDOAuthServer {
  private server: Server;
  private authState: AuthState = {};
  private credentialsPath: string;
  private httpServer?: http.Server;

  constructor() {
    this.server = new Server(
      {
        name: 'AiDD',
        version: '2.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    );

    // Set credentials path
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.credentialsPath = path.join(homeDir, '.aidd-mcp', 'oauth-credentials.json');

    this.setupHandlers();
    this.setupTools();

    // Load saved credentials on startup
    this.loadCredentials();
  }

  private async loadCredentials() {
    try {
      await fs.mkdir(path.dirname(this.credentialsPath), { recursive: true });
      const data = await fs.readFile(this.credentialsPath, 'utf-8');
      const creds = JSON.parse(data);

      // Check if token is expired
      if (creds.expiresAt && Date.now() < creds.expiresAt) {
        this.authState = creds;
        console.error(`✅ Loaded saved authentication for ${creds.email}`);
      } else if (creds.refreshToken) {
        // Try to refresh the token
        console.error('🔄 Token expired, refreshing...');
        await this.refreshAccessToken(creds.refreshToken);
      }
    } catch (error) {
      // No saved credentials or error loading
      console.error('📝 No saved credentials found');
    }
  }

  private async saveCredentials() {
    try {
      await fs.mkdir(path.dirname(this.credentialsPath), { recursive: true });
      await fs.writeFile(
        this.credentialsPath,
        JSON.stringify(this.authState, null, 2),
        'utf-8'
      );
      // Set file permissions to user-only
      await fs.chmod(this.credentialsPath, 0o600);
    } catch (error) {
      console.error('Error saving credentials:', error);
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<void> {
    try {
      const response = await fetch(OAUTH_CONFIG.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: OAUTH_CONFIG.clientId
        })
      });

      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }

      const data = await response.json() as any;

      this.authState = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        email: data.user?.email,
        userId: data.user?.userId,
        subscription: data.user?.subscription,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000
      };

      await this.saveCredentials();
      console.error('✅ Token refreshed successfully');
    } catch (error) {
      console.error('Error refreshing token:', error);
      this.authState = {};
      throw error;
    }
  }

  private async startOAuthFlow(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Generate PKCE challenge
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      // Generate state for CSRF protection
      const state = crypto.randomBytes(16).toString('base64url');

      // Start local server to receive callback
      this.httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url || '', `http://localhost:54321`);

        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>Authentication Failed</title>
                <style>
                  body { font-family: system-ui; padding: 40px; text-align: center; }
                  .error { color: red; }
                </style>
              </head>
              <body>
                <h1 class="error">Authentication Failed</h1>
                <p>${error}</p>
                <p>You can close this window and return to your app.</p>
              </body>
              </html>
            `);
            this.httpServer?.close();
            reject(new Error(error));
            return;
          }

          if (returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('State mismatch - possible CSRF attack');
            this.httpServer?.close();
            reject(new Error('State mismatch'));
            return;
          }

          if (code) {
            try {
              // Exchange code for tokens
              const tokenResponse = await fetch(OAUTH_CONFIG.tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  grant_type: 'authorization_code',
                  code,
                  client_id: OAUTH_CONFIG.clientId,
                  redirect_uri: OAUTH_CONFIG.redirectUri,
                  code_verifier: codeVerifier
                })
              });

              if (!tokenResponse.ok) {
                throw new Error('Token exchange failed');
              }

              const data = await tokenResponse.json() as any;

              // Store authentication state
              this.authState = {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                email: data.user?.email,
                userId: data.user?.userId,
                subscription: data.user?.subscription || 'FREE',
                expiresAt: Date.now() + (data.expires_in || 3600) * 1000
              };

              await this.saveCredentials();

              // Send success response
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                  <title>Authentication Successful</title>
                  <style>
                    body {
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                      padding: 40px;
                      text-align: center;
                      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                      min-height: 100vh;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                    }
                    .container {
                      background: white;
                      padding: 40px;
                      border-radius: 20px;
                      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                      max-width: 400px;
                    }
                    h1 { color: #667eea; margin-bottom: 20px; }
                    .success { color: #22c55e; font-size: 48px; margin-bottom: 20px; }
                    .info { color: #666; margin: 10px 0; }
                    .subscription {
                      display: inline-block;
                      padding: 4px 12px;
                      border-radius: 20px;
                      font-size: 12px;
                      font-weight: bold;
                      margin-left: 10px;
                    }
                    .subscription.free { background: #f3f4f6; color: #6b7280; }
                    .subscription.premium { background: #fef3c7; color: #d97706; }
                    .subscription.pro { background: #dbeafe; color: #2563eb; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="success">✓</div>
                    <h1>Successfully Connected!</h1>
                    <p class="info">
                      Email: ${data.user?.email || 'Unknown'}
                      <span class="subscription ${(data.user?.subscription || 'free').toLowerCase()}">
                        ${data.user?.subscription || 'FREE'}
                      </span>
                    </p>
                    <p>You can now close this window and return to your app.</p>
                    <p style="margin-top: 30px; color: #999; font-size: 14px;">
                      The AiDD MCP is now connected and ready to use.
                    </p>
                  </div>
                </body>
                </html>
              `);

              this.httpServer?.close();
              resolve();
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Authentication failed: ' + (error as Error).message);
              this.httpServer?.close();
              reject(error);
            }
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
      });

      this.httpServer.listen(54321, () => {
        // Build authorization URL
        const authUrl = new URL(OAUTH_CONFIG.authUrl);
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('client_id', OAUTH_CONFIG.clientId);
        authUrl.searchParams.append('redirect_uri', OAUTH_CONFIG.redirectUri);
        authUrl.searchParams.append('scope', OAUTH_CONFIG.scope);
        authUrl.searchParams.append('state', state);
        authUrl.searchParams.append('code_challenge', codeChallenge);
        authUrl.searchParams.append('code_challenge_method', 'S256');

        // Open browser
        const openCommand = process.platform === 'darwin' ? 'open' :
                          process.platform === 'win32' ? 'start' : 'xdg-open';

        exec(`${openCommand} "${authUrl.toString()}"`, (error) => {
          if (error) {
            console.error('Failed to open browser:', error);
            this.httpServer?.close();
            reject(error);
          }
        });

        console.error('🌐 Opening browser for authentication...');
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.httpServer) {
          this.httpServer.close();
          reject(new Error('Authentication timeout'));
        }
      }, 300000);
    });
  }

  private async disconnect(): Promise<void> {
    if (this.authState.refreshToken) {
      try {
        await fetch(OAUTH_CONFIG.revokeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: this.authState.refreshToken,
            client_id: OAUTH_CONFIG.clientId
          })
        });
      } catch (error) {
        console.error('Error revoking token:', error);
      }
    }

    this.authState = {};

    try {
      await fs.unlink(this.credentialsPath);
    } catch (error) {
      // File might not exist
    }
  }

  private setupTools() {
    const tools: Tool[] = [
      {
        name: 'connect',
        description: 'Connect to AiDD account via browser authentication (supports email, Google, Microsoft, Apple sign-in)',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'disconnect',
        description: 'Disconnect from AiDD account and clear stored credentials',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'status',
        description: 'Check current authentication status and subscription level',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'start_workflow',
        description: 'Start the AiDD workflow to import and process Apple Notes',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'import_notes',
        description: 'Import notes from Apple Notes',
        inputSchema: {
          type: 'object',
          properties: {
            folderName: {
              type: 'string',
              description: 'Specific folder to import from (optional)'
            }
          }
        }
      },
      {
        name: 'extract_action_items',
        description: 'Extract action items from imported notes using AI',
        inputSchema: {
          type: 'object',
          properties: {
            noteIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific note IDs to process (optional)'
            }
          }
        }
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
              description: 'Specific action item IDs to convert (optional)'
            }
          }
        }
      },
      {
        name: 'score_tasks',
        description: 'Score and prioritize tasks using AI',
        inputSchema: {
          type: 'object',
          properties: {
            taskIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific task IDs to score (optional)'
            }
          }
        }
      },
      {
        name: 'sync_to_services',
        description: 'Sync tasks to connected services (Google Tasks, Microsoft To Do, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            services: {
              type: 'array',
              items: { type: 'string' },
              description: 'Services to sync to (optional, defaults to all connected)'
            }
          }
        }
      }
    ];

    // Set up single handler for all tool calls
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        // Strip "AiDD:" prefix if present
        const toolName = request.params.name.replace('AiDD:', '');

        // Find the matching tool
        const tool = tools.find(t => t.name === toolName);

        if (tool) {
          return await this.handleToolCall(toolName, request.params.arguments || {});
        }

        return {
          content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }]
        };
      }
    );
  }

  private async handleToolCall(toolName: string, args: any) {
    switch (toolName) {
      case 'connect':
        if (this.authState.accessToken) {
          return {
            content: [{
              type: 'text',
              text: `Already connected as ${this.authState.email} (${this.authState.subscription} subscription)`
            }]
          };
        }

        // Start OAuth flow asynchronously - don't wait for it
        this.startOAuthFlow().then(() => {
          console.error(`✅ OAuth flow completed successfully for ${this.authState.email}`);
        }).catch((error) => {
          console.error(`❌ OAuth flow failed: ${error.message}`);
        });

        // Return immediately with instructions
        return {
          content: [{
            type: 'text',
            text: `🌐 Opening your browser for authentication...\n\n` +
                 `Please:\n` +
                 `1. Sign in with your preferred method (Email/Google/Microsoft/Apple)\n` +
                 `2. Authorize AiDD access\n` +
                 `3. Return here after authentication\n\n` +
                 `Once authenticated, use the "status" command to verify your connection.\n\n` +
                 `If the browser doesn't open, visit:\n` +
                 `https://aidd-backend-prod-739193356129.us-central1.run.app/oauth/authorize?client_id=aidd-mcp-client&redirect_uri=http://localhost:54321/callback`
          }]
        };

      case 'disconnect':
        if (!this.authState.accessToken) {
          return {
            content: [{
              type: 'text',
              text: '⚠️ Not currently connected to AiDD'
            }]
          };
        }

        const email = this.authState.email;
        await this.disconnect();
        return {
          content: [{
            type: 'text',
            text: `✅ Successfully disconnected from AiDD account (${email})`
          }]
        };

      case 'status':
        if (!this.authState.accessToken) {
          return {
            content: [{
              type: 'text',
              text: '❌ Not authenticated\n\nUse the "connect" command to sign in to your AiDD account.'
            }]
          };
        }

        const expiresIn = this.authState.expiresAt
          ? Math.floor((this.authState.expiresAt - Date.now()) / 1000 / 60)
          : 0;

        return {
          content: [{
            type: 'text',
            text: `✅ Connected to AiDD\n\n` +
                 `📧 Email: ${this.authState.email}\n` +
                 `💎 Subscription: ${this.authState.subscription}\n` +
                 `🔑 User ID: ${this.authState.userId}\n` +
                 `⏰ Token expires in: ${expiresIn} minutes\n\n` +
                 `Ready to process your Apple Notes!`
          }]
        };

      case 'start_workflow':
        if (!this.authState.accessToken) {
          return {
            content: [{
              type: 'text',
              text: '❌ Authentication required\n\nPlease use the "connect" command first to sign in to your AiDD account.'
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: `🚀 Starting AiDD Workflow\n\n` +
                 `Authenticated as: ${this.authState.email} (${this.authState.subscription})\n\n` +
                 `This workflow will:\n` +
                 `1. Import your Apple Notes\n` +
                 `2. Extract action items using AI\n` +
                 `3. Convert to ADHD-optimized tasks\n` +
                 `4. Score and prioritize tasks\n` +
                 `5. Sync to your connected services\n\n` +
                 `Continue with "import_notes" to begin...`
          }]
        };

      // Add other tool implementations here...

      default:
        return {
          content: [{
            type: 'text',
            text: `Tool ${toolName} is not yet implemented. Please connect first.`
          }]
        };
    }
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'connect',
          description: 'Connect to AiDD account via browser authentication (supports email, Google, Microsoft, Apple sign-in)',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'disconnect',
          description: 'Disconnect from AiDD account and clear stored credentials',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'status',
          description: 'Check current authentication status and subscription level',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'start_workflow',
          description: 'Start the AiDD workflow to import and process Apple Notes',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'import_notes',
          description: 'Import notes from Apple Notes',
          inputSchema: {
            type: 'object',
            properties: {
              folderName: { type: 'string', description: 'Specific folder to import from (optional)' }
            }
          }
        },
        {
          name: 'extract_action_items',
          description: 'Extract action items from imported notes using AI',
          inputSchema: {
            type: 'object',
            properties: {
              noteIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific note IDs to process (optional)'
              }
            }
          }
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
                description: 'Specific action item IDs to convert (optional)'
              }
            }
          }
        },
        {
          name: 'score_tasks',
          description: 'Score and prioritize tasks using AI',
          inputSchema: {
            type: 'object',
            properties: {
              taskIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific task IDs to score (optional)'
              }
            }
          }
        },
        {
          name: 'sync_to_services',
          description: 'Sync tasks to connected services',
          inputSchema: {
            type: 'object',
            properties: {
              services: {
                type: 'array',
                items: { type: 'string' },
                description: 'Services to sync to (optional)'
              }
            }
          }
        }
      ]
    }));

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'aidd://auth/status',
          name: 'Authentication Status',
          description: 'Current authentication status and subscription info',
          mimeType: 'application/json'
        }
      ]
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      if (request.params.uri === 'aidd://auth/status') {
        return {
          contents: [{
            uri: request.params.uri,
            mimeType: 'application/json',
            text: JSON.stringify(this.authState, null, 2)
          }]
        };
      }
      throw new Error('Resource not found');
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('AiDD MCP Server with OAuth Browser Authentication started');
  }
}

const server = new AiDDOAuthServer();
server.run().catch(console.error);