/**
 * OAuth Server for Browser-Based Authentication
 * Handles the OAuth flow like GitHub/JIRA MCPs
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface OAuthConfig {
  clientId?: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  scope?: string;
}

// Claude MCP client uses port 6274 for OAuth callbacks
const CLAUDE_OAUTH_CALLBACK_PORT = 6274;
// Fallback ports if 6274 is unavailable
const FALLBACK_PORTS = [6274, 6275, 3001, 0];

export class OAuthServer {
  private server?: http.Server;
  private port: number = 0;
  private state: string;
  private codeVerifier?: string;
  private codeChallenge?: string;
  private credentialsPath: string;

  constructor() {
    this.state = crypto.randomBytes(32).toString('base64url');

    // Generate PKCE challenge
    this.codeVerifier = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(this.codeVerifier).digest();
    this.codeChallenge = hash.toString('base64url');

    // Credentials path
    const configDir = path.join(os.homedir(), '.aidd-mcp');
    this.credentialsPath = path.join(configDir, 'oauth-tokens.json');
  }

  /**
   * Start OAuth flow - opens browser for authentication
   */
  async authenticate(): Promise<any> {
    return new Promise(async (resolve, reject) => {
      // Start local server to receive callback
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url!, `http://localhost:${this.port}`);

        // Handle both /callback and /oauth/callback paths for Claude compatibility
        if (url.pathname === '/callback' || url.pathname === '/oauth/callback' || url.pathname === '/oauth/callback/debug') {
          // Handle OAuth callback
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: system-ui; padding: 40px; text-align: center;">
                  <h1>❌ Authentication Failed</h1>
                  <p>Error: ${error}</p>
                  <p>You can close this window and try again.</p>
                </body>
              </html>
            `);
            reject(new Error(`OAuth error: ${error}`));
            this.cleanup();
            return;
          }

          if (state !== this.state) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: system-ui; padding: 40px; text-align: center;">
                  <h1>❌ Security Error</h1>
                  <p>Invalid state parameter. Please try again.</p>
                </body>
              </html>
            `);
            reject(new Error('Invalid state parameter'));
            this.cleanup();
            return;
          }

          if (code) {
            // Exchange code for tokens
            try {
              const tokens = await this.exchangeCodeForTokens(code);

              // Save tokens
              await this.saveTokens(tokens);

              // Send success response
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <head>
                    <meta charset="utf-8">
                    <style>
                      body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        padding: 40px;
                        text-align: center;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        height: 100vh;
                        margin: 0;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                      }
                      .container {
                        background: rgba(255, 255, 255, 0.1);
                        backdrop-filter: blur(10px);
                        padding: 40px;
                        border-radius: 20px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                      }
                      h1 { font-size: 48px; margin-bottom: 20px; }
                      .checkmark {
                        font-size: 72px;
                        animation: bounce 0.5s;
                      }
                      @keyframes bounce {
                        0%, 100% { transform: scale(1); }
                        50% { transform: scale(1.2); }
                      }
                      .message {
                        font-size: 18px;
                        margin-top: 20px;
                        opacity: 0.9;
                      }
                      .close-hint {
                        margin-top: 30px;
                        font-size: 14px;
                        opacity: 0.7;
                      }
                    </style>
                    <script>
                      setTimeout(() => window.close(), 3000);
                    </script>
                  </head>
                  <body>
                    <div class="container">
                      <div class="checkmark">✅</div>
                      <h1>Authentication Successful!</h1>
                      <p class="message">You're now connected to AiDD</p>
                      <p class="close-hint">You can close this window and return to Claude Desktop</p>
                    </div>
                  </body>
                </html>
              `);

              resolve(tokens);
              setTimeout(() => this.cleanup(), 1000);
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: system-ui; padding: 40px; text-align: center;">
                    <h1>❌ Token Exchange Failed</h1>
                    <p>${error}</p>
                  </body>
                </html>
              `);
              reject(error);
              this.cleanup();
            }
          }
        } else {
          // Default response
          res.writeHead(404);
          res.end('Not found');
        }
      });

      // Try Claude's preferred port first (6274), then fallbacks
      await this.tryListenOnPorts(FALLBACK_PORTS);
    });
  }

  /**
   * Try to listen on preferred ports in order
   */
  private async tryListenOnPorts(ports: number[]): Promise<void> {
    for (const port of ports) {
      try {
        await new Promise<void>((resolve, reject) => {
          this.server!.once('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
              console.error(`Port ${port} in use, trying next...`);
              reject(err);
            } else {
              reject(err);
            }
          });

          this.server!.listen(port, '127.0.0.1', () => {
            const address = this.server!.address();
            this.port = (address as any).port;
            console.error(`OAuth callback server listening on port ${this.port}`);
            resolve();
          });
        });

        // Successfully bound to port, open browser
        this.openAuthUrl();
        return;
      } catch {
        // Try next port
        continue;
      }
    }
    throw new Error('Could not bind to any available port');
  }

  /**
   * Open browser with OAuth authorization URL
   */
  private async openAuthUrl() {
    const authUrl = new URL('https://aidd-backend-prod-739193356129.us-central1.run.app/oauth/authorize');

    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', 'aidd-mcp-client');
    // Use Claude-compatible callback path
    authUrl.searchParams.append('redirect_uri', `http://localhost:${this.port}/oauth/callback`);
    authUrl.searchParams.append('state', this.state);
    authUrl.searchParams.append('code_challenge', this.codeChallenge!);
    authUrl.searchParams.append('code_challenge_method', 'S256');
    authUrl.searchParams.append('scope', 'profile email subscriptions tasks');

    const url = authUrl.toString();

    // Open in default browser
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      command = 'open';
    } else if (platform === 'win32') {
      command = 'start';
    } else {
      command = 'xdg-open';
    }

    console.error(`Opening browser for authentication: ${url}`);
    spawn(command, [url], { detached: true });
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<any> {
    const response = await fetch('https://aidd-backend-prod-739193356129.us-central1.run.app/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: `http://localhost:${this.port}/oauth/callback`,
        client_id: 'aidd-mcp-client',
        code_verifier: this.codeVerifier,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Save tokens to disk
   */
  private async saveTokens(tokens: any) {
    const configDir = path.dirname(this.credentialsPath);
    await fs.mkdir(configDir, { recursive: true });

    const data = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in * 1000),
      tokenType: tokens.token_type,
      scope: tokens.scope,
      user: tokens.user,
    };

    // Encrypt and save
    const encrypted = this.encrypt(JSON.stringify(data));
    await fs.writeFile(this.credentialsPath, encrypted, 'utf-8');
    await fs.chmod(this.credentialsPath, 0o600);
  }

  /**
   * Load saved tokens
   */
  async loadTokens(): Promise<any | null> {
    try {
      const encrypted = await fs.readFile(this.credentialsPath, 'utf-8');
      const decrypted = this.decrypt(encrypted);
      return JSON.parse(decrypted);
    } catch {
      return null;
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<any> {
    const response = await fetch('https://aidd-backend-prod-739193356129.us-central1.run.app/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: 'aidd-mcp-client',
      }),
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const tokens = await response.json();
    await this.saveTokens(tokens);
    return tokens;
  }

  /**
   * Revoke tokens (sign out)
   */
  async revokeTokens(token: string): Promise<void> {
    await fetch('https://aidd-backend-prod-739193356129.us-central1.run.app/oauth/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: token,
        client_id: 'aidd-mcp-client',
      }),
    });

    // Delete local tokens
    try {
      await fs.unlink(this.credentialsPath);
    } catch {
      // File might not exist
    }
  }

  private encrypt(text: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync('aidd-oauth-key', 'salt', 32);
    const iv = Buffer.alloc(16, 0);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  private decrypt(encrypted: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync('aidd-oauth-key', 'salt', 32);
    const iv = Buffer.alloc(16, 0);
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private cleanup() {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }
}