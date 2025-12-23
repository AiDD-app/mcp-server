#!/usr/bin/env node

/**
 * AiDD MCP Server v2.0 - With Integrated Authentication
 * Handles authentication through MCP configuration or interactive prompts
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { AiDDBackendClient } from './aidd-backend-client.js';

// Tool schemas
const SignInToolSchema = z.object({
  email: z.string().email().describe('Your AiDD account email'),
  password: z.string().describe('Your AiDD account password'),
});

const ConfigureAuthToolSchema = z.object({
  method: z.enum(['email', 'google', 'microsoft', 'dev']).describe('Authentication method'),
  credentials: z.object({
    email: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
  }).optional(),
});

const StartWorkflowToolSchema = z.object({
  targetService: z.enum(['google-tasks', 'microsoft-todo', 'trello', 'todoist', 'notion', 'ticktick', 'apple-reminders'])
    .optional()
    .describe('Target service for task sync'),
  autoSync: z.boolean().optional().default(false).describe('Automatically sync at the end'),
});

interface AuthCredentials {
  method?: 'email' | 'google' | 'microsoft' | 'dev';
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  subscription?: string;
  expiresAt?: number;
}

class AiDDMCPServerWithAuth {
  private server: Server;
  private backendClient: AiDDBackendClient;
  private credentials: AuthCredentials = {};
  private credentialsPath: string;
  private isAuthenticated: boolean = false;

  constructor() {
    // Check for credentials in environment variables first
    const email = process.env.AIDD_EMAIL;
    const password = process.env.AIDD_PASSWORD;
    const method = process.env.AIDD_AUTH_METHOD || 'email';

    // Store credentials path
    const configDir = path.join(os.homedir(), '.aidd-mcp');
    this.credentialsPath = path.join(configDir, 'credentials.json');

    // Initialize MCP server
    this.server = new Server(
      {
        name: 'AiDD',
        version: '2.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
          prompts: {},
        },
      }
    );

    this.backendClient = new AiDDBackendClient();

    // Auto-authenticate if credentials provided in environment
    if (email && password) {
      this.autoAuthenticate(email, password, method as any);
    } else {
      this.loadStoredCredentials();
    }

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private async autoAuthenticate(email: string, password: string, method: 'email' | 'google' | 'microsoft' | 'dev') {
    try {
      if (method === 'email') {
        await this.signInWithEmail(email, password);
      } else if (method === 'dev') {
        this.credentials = {
          method: 'dev',
          email: 'dev@aidd.app',
          userId: 'dev-user',
          subscription: 'DEV',
        };
        this.isAuthenticated = true;
      }
    } catch (error) {
      console.error('Auto-authentication failed:', error);
    }
  }

  private async loadStoredCredentials() {
    try {
      const data = await fs.readFile(this.credentialsPath, 'utf-8');
      const decrypted = this.decrypt(data);
      this.credentials = JSON.parse(decrypted);
      this.isAuthenticated = true;

      // Check if token needs refresh
      if (this.credentials.expiresAt && Date.now() >= this.credentials.expiresAt) {
        await this.refreshToken();
      }
    } catch {
      // No stored credentials
      this.isAuthenticated = false;
    }
  }

  private async saveCredentials() {
    try {
      const dir = path.dirname(this.credentialsPath);
      await fs.mkdir(dir, { recursive: true });

      const encrypted = this.encrypt(JSON.stringify(this.credentials));
      await fs.writeFile(this.credentialsPath, encrypted, 'utf-8');
      await fs.chmod(this.credentialsPath, 0o600);
    } catch (error) {
      console.error('Failed to save credentials:', error);
    }
  }

  private encrypt(text: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync('aidd-mcp-key', 'salt', 32);
    const iv = Buffer.alloc(16, 0);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  private decrypt(encrypted: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync('aidd-mcp-key', 'salt', 32);
    const iv = Buffer.alloc(16, 0);
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private async signInWithEmail(email: string, password: string): Promise<boolean> {
    try {
      const response = await fetch('https://aidd-backend-prod-739193356129.us-central1.run.app/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error(`Sign-in failed: ${response.statusText}`);
      }

      const data = await response.json() as any;

      this.credentials = {
        method: 'email',
        email: data.email,
        userId: data.userId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + (data.expiresIn * 1000),
        subscription: data.subscription,
      };

      this.isAuthenticated = true;
      await this.saveCredentials();
      return true;
    } catch (error) {
      console.error('Sign-in error:', error);
      return false;
    }
  }

  private async refreshToken(): Promise<boolean> {
    if (!this.credentials.refreshToken) return false;

    try {
      const response = await fetch('https://aidd-backend-prod-739193356129.us-central1.run.app/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.credentials.refreshToken }),
      });

      if (!response.ok) {
        this.isAuthenticated = false;
        return false;
      }

      const data = await response.json() as any;
      this.credentials.accessToken = data.accessToken;
      this.credentials.expiresAt = Date.now() + (data.expiresIn * 1000);

      await this.saveCredentials();
      return true;
    } catch {
      return false;
    }
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getAvailableTools(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Authentication tools
      if (name === 'sign_in') {
        return await this.handleSignIn(args);
      }

      if (name === 'configure_auth') {
        return await this.handleConfigureAuth(args);
      }

      if (name === 'check_auth_status') {
        return await this.handleCheckAuthStatus();
      }

      if (name === 'sign_out') {
        return await this.handleSignOut();
      }

      // Check authentication before allowing other tools
      if (!this.isAuthenticated) {
        return {
          content: [
            {
              type: 'text',
              text: `⚠️ Authentication Required

Please sign in to your AiDD account first:

Option 1: Use the sign_in tool:
  sign_in(email: "your@email.com", password: "yourpassword")

Option 2: Configure authentication in your MCP client settings:
  Add to your MCP config file (e.g., claude_desktop_config.json):
  "env": {
    "AIDD_EMAIL": "your@email.com",
    "AIDD_PASSWORD": "yourpassword"
  }

Option 3: Use development mode:
  configure_auth(method: "dev")

Your subscription level will determine available features.`,
            },
          ],
        };
      }

      // Workflow tools (require authentication)
      if (name === 'start_workflow') {
        return await this.handleStartWorkflow(args);
      }

      if (name === 'import_notes') {
        return await this.handleImportNotes(args);
      }

      // Add other authenticated tools here...

      return {
        content: [
          { type: 'text', text: `Unknown tool: ${name}` },
        ],
      };
    });

    // Resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'aidd://auth/status',
          name: 'Authentication Status',
          description: 'Current authentication status and user info',
          mimeType: 'application/json',
        },
        {
          uri: 'aidd://auth/guide',
          name: 'Authentication Guide',
          description: 'How to authenticate with AiDD',
          mimeType: 'text/markdown',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'aidd://auth/status') {
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({
                authenticated: this.isAuthenticated,
                method: this.credentials.method,
                email: this.credentials.email,
                userId: this.credentials.userId,
                subscription: this.credentials.subscription || 'NONE',
              }, null, 2),
            },
          ],
        };
      }

      if (uri === 'aidd://auth/guide') {
        return {
          contents: [
            {
              uri,
              mimeType: 'text/markdown',
              text: `# AiDD Authentication Guide

## Quick Start

### Option 1: Sign in with email/password
\`\`\`
Use the sign_in tool:
sign_in(email: "your@email.com", password: "yourpassword")
\`\`\`

### Option 2: Configure in your MCP client settings
Add to your MCP config file (e.g., ~/.config/claude/claude_desktop_config.json):
\`\`\`json
{
  "mcpServers": {
    "AiDD": {
      "command": "node",
      "args": ["path/to/index-aidd-auth.js"],
      "env": {
        "AIDD_EMAIL": "your@email.com",
        "AIDD_PASSWORD": "yourpassword"
      }
    }
  }
}
\`\`\`

### Option 3: Development Mode
\`\`\`
Use the configure_auth tool:
configure_auth(method: "dev")
\`\`\`

## Subscription Levels
- **FREE**: 3 AI extractions/week
- **PREMIUM**: 20 AI extractions/week
- **PRO**: Unlimited AI extractions`,
            },
          ],
        };
      }

      throw new Error(`Resource not found: ${uri}`);
    });

    // Prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'authenticate',
          description: 'Authenticate with AiDD account',
        },
      ],
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name === 'authenticate') {
        return {
          prompt: {
            name: 'authenticate',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: 'Please help me authenticate with my AiDD account to use the MCP server.',
                },
              },
            ],
          },
        };
      }
      throw new Error('Prompt not found');
    });
  }

  private getAvailableTools(): Tool[] {
    const authTools: Tool[] = [
      {
        name: 'sign_in',
        description: 'Sign in to your AiDD account with email and password',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Your AiDD account email' },
            password: { type: 'string', description: 'Your AiDD account password' },
          },
          required: ['email', 'password'],
        },
      },
      {
        name: 'configure_auth',
        description: 'Configure authentication method (email, google, microsoft, or dev mode)',
        inputSchema: {
          type: 'object',
          properties: {
            method: {
              type: 'string',
              enum: ['email', 'google', 'microsoft', 'dev'],
              description: 'Authentication method'
            },
            credentials: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                password: { type: 'string' },
                token: { type: 'string' },
              },
            },
          },
          required: ['method'],
        },
      },
      {
        name: 'check_auth_status',
        description: 'Check current authentication status',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'sign_out',
        description: 'Sign out of AiDD account',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    // Only show workflow tools if authenticated
    const workflowTools: Tool[] = this.isAuthenticated ? [
      {
        name: 'start_workflow',
        description: 'Start the AiDD workflow for processing notes',
        inputSchema: {
          type: 'object',
          properties: {
            targetService: {
              type: 'string',
              enum: ['google-tasks', 'microsoft-todo', 'trello', 'todoist', 'notion', 'ticktick', 'apple-reminders'],
              description: 'Target service for task sync'
            },
            autoSync: { type: 'boolean', description: 'Automatically sync at the end' },
          },
        },
      },
      {
        name: 'import_notes',
        description: 'Import notes from Apple Notes',
        inputSchema: {
          type: 'object',
          properties: {
            folder: { type: 'string', description: 'Specific folder to import from' },
            limit: { type: 'number', description: 'Maximum number of notes' },
          },
        },
      },
      // Add other workflow tools...
    ] : [];

    return [...authTools, ...workflowTools];
  }

  private async handleSignIn(args: any) {
    const validated = SignInToolSchema.parse(args);
    const success = await this.signInWithEmail(validated.email, validated.password);

    if (success) {
      return {
        content: [
          {
            type: 'text',
            text: `✅ Successfully signed in!
Email: ${this.credentials.email}
User ID: ${this.credentials.userId}
Subscription: ${this.credentials.subscription || 'FREE'}

You can now use all AiDD workflow tools. Start with: start_workflow()`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Sign-in failed. Please check your credentials and try again.

If you don't have an account, visit https://aidd.app to sign up.
For testing, you can use: configure_auth(method: "dev")`,
          },
        ],
      };
    }
  }

  private async handleConfigureAuth(args: any) {
    const validated = ConfigureAuthToolSchema.parse(args);

    if (validated.method === 'dev') {
      this.credentials = {
        method: 'dev',
        email: 'dev@aidd.app',
        userId: 'dev-user',
        subscription: 'DEV',
      };
      this.isAuthenticated = true;
      await this.saveCredentials();

      return {
        content: [
          {
            type: 'text',
            text: `⚠️ Development mode activated
- Limited to 3 AI extractions per week
- No access to saved integrations
- Tasks won't sync to mobile app

For full features, sign in with: sign_in(email, password)`,
          },
        ],
      };
    }

    // Handle other auth methods...
    return {
      content: [
        {
          type: 'text',
          text: `Authentication method ${validated.method} configured.
For Google/Microsoft OAuth, additional setup required.`,
        },
      ],
    };
  }

  private async handleCheckAuthStatus() {
    if (!this.isAuthenticated) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Not authenticated

Sign in with: sign_in(email: "your@email.com", password: "yourpassword")
Or use dev mode: configure_auth(method: "dev")`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ Authenticated
Method: ${this.credentials.method}
Email: ${this.credentials.email}
User ID: ${this.credentials.userId}
Subscription: ${this.credentials.subscription || 'FREE'}`,
        },
      ],
    };
  }

  private async handleSignOut() {
    this.credentials = {};
    this.isAuthenticated = false;

    try {
      await fs.unlink(this.credentialsPath);
    } catch {
      // File might not exist
    }

    return {
      content: [
        {
          type: 'text',
          text: '✅ Signed out successfully. Credentials removed.',
        },
      ],
    };
  }

  private async handleStartWorkflow(args: any) {
    const validated = StartWorkflowToolSchema.parse(args);

    // Pass user credentials to backend client
    if (this.credentials.accessToken) {
      // Backend client will use these credentials
      await this.backendClient.authenticate();
    }

    return {
      content: [
        {
          type: 'text',
          text: `🚀 AiDD Workflow Started
✅ Authenticated as: ${this.credentials.email} (${this.credentials.subscription})
👤 User ID: ${this.credentials.userId}

Ready to import notes. Use: import_notes()`,
        },
      ],
    };
  }

  private async handleImportNotes(args: any) {
    // Implementation for importing notes...
    return {
      content: [
        {
          type: 'text',
          text: `📥 Importing notes from Apple Notes...
(Implementation continues with authenticated backend calls)`,
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
    console.error('AiDD MCP Server with Authentication running on stdio');
  }
}

// Run the server
const server = new AiDDMCPServerWithAuth();
server.run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});