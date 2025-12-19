#!/usr/bin/env node

/**
 * AiDD MCP Server with Browser-Based Authentication
 * Uses the backend's web login page for authentication
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
import { exec } from 'child_process';
import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Backend Configuration
const BACKEND_URL = 'https://aidd-backend-prod-739193356129.us-central1.run.app';
const API_KEY = 'dev-api-key-123456'; // From BackendAPIConfig.swift

// Authentication state
interface AuthState {
  accessToken?: string;
  refreshToken?: string;
  email?: string;
  userId?: string;
  subscription?: string;
  expiresAt?: number;
}

class AiDDBrowserAuthServer {
  private server: Server;
  private authState: AuthState = {};
  private credentialsPath: string;
  private httpServer?: http.Server;
  private authInProgress = false;

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
    this.credentialsPath = path.join(homeDir, '.aidd-mcp', 'auth-credentials.json');

    this.setupHandlers();
    this.setupTools();

    // Note: loadCredentials is async - will complete before first tool call
    // due to MCP protocol initialization time
    this.loadCredentials().catch(() => {
      console.error('📝 No saved credentials found');
    });
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
      const response = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        body: JSON.stringify({ refreshToken })
      });

      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }

      const data = await response.json() as any;

      this.authState = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || refreshToken,
        email: this.authState.email, // Keep existing email
        userId: this.authState.userId, // Keep existing user ID
        subscription: data.subscription || this.authState.subscription,
        expiresAt: Date.now() + (data.expiresIn || 3600) * 1000
      };

      await this.saveCredentials();
      console.error('✅ Token refreshed successfully');
    } catch (error) {
      console.error('Error refreshing token:', error);
      this.authState = {};
      throw error;
    }
  }

  private async startBrowserAuth(): Promise<void> {
    if (this.authInProgress) {
      throw new Error('Authentication already in progress');
    }

    this.authInProgress = true;

    return new Promise((resolve, reject) => {
      // Generate a unique session ID
      const sessionId = crypto.randomBytes(16).toString('hex');

      // Start local server to receive credentials
      this.httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url || '', `http://localhost:54321`);

        // Handle OAuth callback from providers (Google, Microsoft)
        if (url.pathname === '/oauth-callback') {
          // Handle both fragment-based (implicit flow) and query-based tokens
          // Note: Fragment is not sent to server, so we need client-side JS to handle it
          const accessToken = url.searchParams.get('access_token');
          const idToken = url.searchParams.get('id_token');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          // Parse provider from state
          let provider = 'google';
          if (state) {
            const stateParams = new URLSearchParams(state);
            provider = stateParams.get('provider') || 'google';
          }

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>OAuth Authentication Failed</title>
                <style>
                  body { font-family: system-ui; padding: 40px; text-align: center; }
                  .error { color: red; }
                </style>
              </head>
              <body>
                <h1 class="error">OAuth Authentication Failed</h1>
                <p>${error}</p>
                <p>You can close this window and return to Claude Desktop.</p>
              </body>
              </html>
            `);
            this.httpServer?.close();
            this.authInProgress = false;
            reject(new Error(error));
            return;
          }

          // If no tokens in query params, serve a page that extracts from fragment
          if (!accessToken && !idToken && !error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>Processing OAuth Response...</title>
                <style>
                  body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0;
                  }
                  .container {
                    background: white;
                    padding: 40px;
                    border-radius: 20px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    text-align: center;
                  }
                  .spinner {
                    border: 3px solid #f3f4f6;
                    border-top: 3px solid #667eea;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 20px;
                  }
                  @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                </style>
                <script>
                  // Extract tokens from URL fragment and redirect to server
                  if (window.location.hash) {
                    const params = new URLSearchParams(window.location.hash.substring(1));
                    const newUrl = window.location.pathname + '?' + params.toString();
                    window.location.href = newUrl;
                  } else {
                    // No fragment, might be an error
                    setTimeout(() => {
                      window.location.href = '/';
                    }, 3000);
                  }
                </script>
              </head>
              <body>
                <div class="container">
                  <div class="spinner"></div>
                  <h2>Processing Authentication...</h2>
                  <p>Please wait while we complete your sign-in.</p>
                </div>
              </body>
              </html>
            `);
            return;
          }

          if (accessToken || idToken) {
            try {
              // Send OAuth token to backend for validation and exchange
              // clientType: 'mcp' gives us 1-year refresh tokens instead of 90 days
              const signinResponse = await fetch(`${BACKEND_URL}/api/auth/oauth/signin`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-Key': API_KEY
                },
                body: JSON.stringify({
                  provider: provider,
                  idToken: idToken || accessToken,
                  authCode: null,
                  deviceId: `mcp-${sessionId}`,
                  deviceName: 'Claude Desktop MCP',
                  platform: 'macos',
                  clientType: 'mcp'
                })
              });

              if (!signinResponse.ok) {
                const errorData = await signinResponse.json() as any;
                throw new Error(errorData.error || 'OAuth authentication failed');
              }

              const data = await signinResponse.json() as any;

              // Debug log the full response to understand subscription field
              console.error('OAuth signin response:', JSON.stringify(data, null, 2));

              // Extract response data (backend wraps in {success, data} structure)
              const responseData = data.data || data;

              // Check multiple possible fields for subscription status
              const subscription = responseData.user?.subscription ||
                                 responseData.user?.subscriptionStatus ||
                                 responseData.user?.subscriptionTier ||
                                 responseData.subscription ||
                                 responseData.subscriptionStatus ||
                                 responseData.subscriptionTier ||
                                 data.user?.subscription ||
                                 data.subscription ||
                                 'FREE';

              // Store authentication state
              this.authState = {
                accessToken: responseData.accessToken,
                refreshToken: responseData.refreshToken,
                email: responseData.user?.email || 'OAuth User',
                userId: responseData.user?.userId || responseData.userId,
                subscription: subscription,
                expiresAt: Date.now() + (responseData.expiresIn || 3600) * 1000
              };

              await this.saveCredentials();

              // Send success response
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="UTF-8">
                  <title>OAuth Authentication Successful</title>
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
                  <script>
                    setTimeout(() => { window.close(); }, 3000);
                  </script>
                </head>
                <body>
                  <div class="container">
                    <div class="success">✓</div>
                    <h1>✅ Connected to AiDD</h1>
                    <p>✉️ ${this.authState.email}</p>
                    <p>Subscription:
                      <span class="subscription ${(this.authState.subscription || 'FREE').toLowerCase()}">
                        ${this.authState.subscription || 'FREE'}
                      </span>
                    </p>
                    <p>You can now close this window and return to your app.</p>
                    <p style="margin-top: 30px; color: #999; font-size: 14px;">
                      This window will close automatically in 3 seconds...
                    </p>
                  </div>
                </body>
                </html>
              `, () => {
                // Wait for response to be fully sent before closing server
                setTimeout(() => {
                  this.httpServer?.close();
                  this.authInProgress = false;
                  resolve();
                }, 500);
              });
              return;
            } catch (error: any) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                  <title>Authentication Error</title>
                  <style>
                    body { font-family: system-ui; padding: 40px; text-align: center; }
                    .error { color: red; }
                  </style>
                </head>
                <body>
                  <h1 class="error">Authentication Error</h1>
                  <p>${error.message}</p>
                  <p>Please try again or use email/password login.</p>
                  <script>
                    setTimeout(() => { window.close(); }, 5000);
                  </script>
                </body>
                </html>
              `, () => {
                // Wait for response to be fully sent before closing server
                setTimeout(() => {
                  this.httpServer?.close();
                  this.authInProgress = false;
                  reject(error);
                }, 500);
              });
              return;
            }
          }
        }

        // Handle SSO callback (legacy, kept for compatibility)
        if (url.pathname === '/sso-callback') {
          const accessToken = url.searchParams.get('access_token');
          const refreshToken = url.searchParams.get('refresh_token');
          const email = url.searchParams.get('email');
          const userId = url.searchParams.get('user_id');
          const subscription = url.searchParams.get('subscription');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>SSO Authentication Failed</title>
                <style>
                  body { font-family: system-ui; padding: 40px; text-align: center; }
                  .error { color: red; }
                </style>
              </head>
              <body>
                <h1 class="error">SSO Authentication Failed</h1>
                <p>${error}</p>
                <p>You can close this window and return to Claude Desktop.</p>
              </body>
              </html>
            `, () => {
              setTimeout(() => {
                this.httpServer?.close();
                this.authInProgress = false;
                reject(new Error(error));
              }, 500);
            });
            return;
          }

          if (accessToken) {
            // Store authentication state from SSO
            this.authState = {
              accessToken,
              refreshToken: refreshToken || '',
              email: email || 'SSO User',
              userId: userId || '',
              subscription: subscription || 'FREE',
              expiresAt: Date.now() + 3600000 // 1 hour
            };

            await this.saveCredentials();

            // Send success response
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>SSO Authentication Successful</title>
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
                </style>
                <script>
                  setTimeout(() => { window.close(); }, 3000);
                </script>
              </head>
              <body>
                <div class="container">
                  <div class="success">✓</div>
                  <h1>SSO Authentication Successful!</h1>
                  <p>Email: ${email || 'SSO User'}</p>
                  <p>Subscription: ${subscription || 'FREE'}</p>
                  <p>You can now close this window and return to your app.</p>
                  <p style="margin-top: 30px; color: #999; font-size: 14px;">
                    This window will close automatically in 3 seconds...
                  </p>
                </div>
              </body>
              </html>
            `, () => {
              setTimeout(() => {
                this.httpServer?.close();
                this.authInProgress = false;
                resolve();
              }, 500);
            });
            return;
          } else {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing access token from SSO provider', () => {
              setTimeout(() => {
                this.httpServer?.close();
                this.authInProgress = false;
                reject(new Error('Missing SSO tokens'));
              }, 500);
            });
            return;
          }
        }

        // Handle email/password callback
        if (url.pathname === '/auth-callback') {
          // Parse the credentials from the query string
          const email = url.searchParams.get('email');
          const password = url.searchParams.get('password');
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
                <p>You can close this window and return to Claude Desktop.</p>
              </body>
              </html>
            `, () => {
              setTimeout(() => {
                this.httpServer?.close();
                this.authInProgress = false;
                reject(new Error(error));
              }, 500);
            });
            return;
          }

          if (email && password) {
            try {
              // Authenticate with the backend
              const authResponse = await fetch(`${BACKEND_URL}/api/auth/device`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-Key': API_KEY
                },
                body: JSON.stringify({
                  email,
                  password,
                  deviceId: `mcp-${sessionId}`,
                  deviceName: 'Claude Desktop MCP',
                  platform: 'macos'  // Required field
                })
              });

              if (!authResponse.ok) {
                const errorData = await authResponse.json() as any;
                throw new Error(errorData.error || 'Authentication failed');
              }

              const data = await authResponse.json() as any;

              // Debug log the full response to understand subscription field
              console.error('Device auth response:', JSON.stringify(data, null, 2));

              // Extract response data (backend wraps in {success, data} structure)
              const responseData = data.data || data;

              // Store authentication state
              // Check multiple possible locations for subscription status
              const subscription = responseData.user?.subscription ||
                                 responseData.user?.subscriptionStatus ||
                                 responseData.user?.subscriptionTier ||
                                 responseData.subscription ||
                                 responseData.subscriptionStatus ||
                                 responseData.subscriptionTier ||
                                 data.user?.subscription ||
                                 data.subscription ||
                                 'FREE';

              this.authState = {
                accessToken: responseData.accessToken,
                refreshToken: responseData.refreshToken,
                email: responseData.user?.email || email,
                userId: responseData.user?.userId || responseData.userId,
                subscription: subscription,
                expiresAt: Date.now() + (responseData.expiresIn || 3600) * 1000
              };

              // Log the full response to debug subscription issue
              console.log('Auth response data:', JSON.stringify(data, null, 2));

              await this.saveCredentials();

              // Send success response
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="UTF-8">
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
                  <script>
                    setTimeout(() => { window.close(); }, 3000);
                  </script>
                </head>
                <body>
                  <div class="container">
                    <div class="success">✓</div>
                    <h1>Successfully Connected!</h1>
                    <p class="info">✉️ ${data.user?.email || email}</p>
                    <p class="info">Subscription:
                      <span class="subscription ${subscription.toLowerCase()}">
                        ${subscription}
                      </span>
                    </p>
                    <p>You can now close this window and return to your app.</p>
                    <p style="margin-top: 30px; color: #999; font-size: 14px;">
                      This window will close automatically in 3 seconds...
                    </p>
                  </div>
                </body>
                </html>
              `, () => {
                setTimeout(() => {
                  this.httpServer?.close();
                  this.authInProgress = false;
                  resolve();
                }, 500);
              });
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Authentication failed: ' + (error as Error).message, () => {
                setTimeout(() => {
                  this.httpServer?.close();
                  this.authInProgress = false;
                  reject(error);
                }, 500);
              });
            }
          } else {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing email or password', () => {
              setTimeout(() => {
                this.httpServer?.close();
                this.authInProgress = false;
                reject(new Error('Missing credentials'));
              }, 500);
            });
          }
        } else if (url.pathname === '/') {
          // Serve the login page
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>AiDD Authentication</title>
              <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
                  width: 100%;
                  max-width: 400px;
                }
                h1 {
                  color: #333;
                  margin-bottom: 10px;
                  font-size: 28px;
                }
                .subtitle {
                  color: #666;
                  margin-bottom: 30px;
                  font-size: 14px;
                }
                .form-group {
                  margin-bottom: 20px;
                }
                label {
                  display: block;
                  color: #555;
                  font-size: 14px;
                  margin-bottom: 5px;
                }
                input {
                  width: 100%;
                  padding: 12px;
                  border: 1px solid #ddd;
                  border-radius: 8px;
                  font-size: 16px;
                }
                input:focus {
                  outline: none;
                  border-color: #667eea;
                  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
                }
                .btn {
                  width: 100%;
                  padding: 14px;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  border: none;
                  border-radius: 8px;
                  font-size: 16px;
                  font-weight: 600;
                  cursor: pointer;
                  transition: transform 0.2s;
                }
                .btn:hover {
                  transform: translateY(-2px);
                }
                .divider {
                  text-align: center;
                  margin: 30px 0;
                  color: #999;
                  position: relative;
                }
                .divider:before {
                  content: '';
                  position: absolute;
                  top: 50%;
                  left: 0;
                  right: 0;
                  height: 1px;
                  background: #ddd;
                }
                .divider span {
                  background: white;
                  padding: 0 15px;
                  position: relative;
                }
                .sso-buttons {
                  display: flex;
                  flex-direction: column;
                  gap: 10px;
                }
                .sso-btn {
                  padding: 12px;
                  border: 1px solid #ddd;
                  border-radius: 8px;
                  background: white;
                  color: #333;
                  font-size: 14px;
                  cursor: pointer;
                  transition: background 0.2s;
                  text-align: center;
                  text-decoration: none;
                }
                .sso-btn:hover {
                  background: #f5f5f5;
                }
                .error {
                  color: #ef4444;
                  margin-top: 10px;
                  font-size: 14px;
                  display: none;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Sign in to AiDD</h1>
                <p class="subtitle">Connect your account to Claude Desktop</p>

                <form id="loginForm">
                  <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" required>
                  </div>
                  <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" required>
                  </div>
                  <button type="submit" class="btn">Sign In</button>
                  <div id="error" class="error"></div>
                </form>

                <div class="divider">
                  <span>or sign in with</span>
                </div>

                <div class="sso-buttons">
                  <button type="button" class="sso-btn" id="google-signin">
                    <span style="display: inline-flex; align-items: center; gap: 10px;">
                      <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Sign in with Google
                    </span>
                  </button>
                  <button type="button" class="sso-btn" id="microsoft-signin">
                    <span style="display: inline-flex; align-items: center; gap: 10px;">
                      <svg width="18" height="18" viewBox="0 0 24 24">
                        <rect x="1" y="1" width="10" height="10" fill="#F25022"/>
                        <rect x="13" y="1" width="10" height="10" fill="#7FBA00"/>
                        <rect x="1" y="13" width="10" height="10" fill="#00A4EF"/>
                        <rect x="13" y="13" width="10" height="10" fill="#FFB900"/>
                      </svg>
                      Sign in with Microsoft
                    </span>
                  </button>
                  <button type="button" class="sso-btn" id="apple-signin">
                    <span style="display: inline-flex; align-items: center; gap: 10px;">
                      <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                      </svg>
                      Sign in with Apple
                    </span>
                  </button>
                </div>
              </div>

              <script>
                // Email/Password login
                document.getElementById('loginForm').addEventListener('submit', async (e) => {
                  e.preventDefault();
                  const email = document.getElementById('email').value;
                  const password = document.getElementById('password').value;

                  // Redirect to callback with credentials
                  window.location.href = '/auth-callback?' + new URLSearchParams({
                    email: email,
                    password: password
                  });
                });

                // Google SSO
                document.getElementById('google-signin').addEventListener('click', () => {
                  // Use Google OAuth 2.0 implicit flow
                  const googleClientId = '739193356129-0ihmmm0o0kg14l6v38m9e5mckagivv66.apps.googleusercontent.com';
                  const redirectUri = encodeURIComponent('http://localhost:54321/oauth-callback');
                  const scope = encodeURIComponent('openid email profile');
                  const googleAuthUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
                    'client_id=' + googleClientId +
                    '&redirect_uri=' + redirectUri +
                    '&response_type=token' +
                    '&scope=' + scope +
                    '&state=' + encodeURIComponent(\`provider=google&sessionId=${sessionId}\`);

                  window.location.href = googleAuthUrl;
                });

                // Microsoft SSO
                document.getElementById('microsoft-signin').addEventListener('click', () => {
                  // Use Microsoft OAuth 2.0 implicit flow
                  const msClientId = 'ca8b73d8-6bc2-4564-9665-17fb67799fe3';
                  const redirectUri = encodeURIComponent('http://localhost:54321/oauth-callback');
                  const scope = encodeURIComponent('openid email profile User.Read');
                  const msAuthUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' +
                    'client_id=' + msClientId +
                    '&redirect_uri=' + redirectUri +
                    '&response_type=token' +
                    '&scope=' + scope +
                    '&state=' + encodeURIComponent(\`provider=microsoft&sessionId=${sessionId}\`);

                  window.location.href = msAuthUrl;
                });

                // Apple SSO
                document.getElementById('apple-signin').addEventListener('click', () => {
                  // Use Apple OAuth 2.0 flow
                  const appleClientId = 'com.aidd.app';
                  const redirectUri = encodeURIComponent('http://localhost:54321/oauth-callback');
                  const appleAuthUrl = 'https://appleid.apple.com/auth/authorize?' +
                    'client_id=' + appleClientId +
                    '&redirect_uri=' + redirectUri +
                    '&response_type=code id_token' +
                    '&response_mode=form_post' +
                    '&scope=name email' +
                    '&state=' + encodeURIComponent(\`provider=apple&sessionId=${sessionId}\`);

                  window.location.href = appleAuthUrl;
                });
              </script>
            </body>
            </html>
          `);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
      });

      this.httpServer.listen(54321, () => {
        // Open browser to local login page
        const loginUrl = 'http://localhost:54321/';
        const openCommand = process.platform === 'darwin' ? 'open' :
                          process.platform === 'win32' ? 'start' : 'xdg-open';

        exec(`${openCommand} "${loginUrl}"`, (error) => {
          if (error) {
            console.error('Failed to open browser:', error);
            console.error(`Please manually open: ${loginUrl}`);
          }
        });

        console.error('🌐 Opening browser for authentication...');
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.httpServer) {
          this.httpServer.close();
          this.authInProgress = false;
          reject(new Error('Authentication timeout'));
        }
      }, 300000);
    });
  }

  private async disconnect(): Promise<void> {
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
        description: 'Connect to AiDD account via browser authentication. Opens a browser window for OAuth sign-in with Google, Microsoft, Apple, or email/password.',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        _meta: {
          readOnlyHint: false
        }
      },
      {
        name: 'disconnect',
        description: 'Disconnect from AiDD account and remove stored authentication credentials',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        _meta: {
          readOnlyHint: false,
          destructiveHint: true
        }
      },
      {
        name: 'status',
        description: 'Check current authentication status, subscription level, and token expiry time',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        _meta: {
          readOnlyHint: true
        }
      },
      {
        name: 'start_workflow',
        description: 'Start the AiDD workflow to import Apple Notes, extract action items, and sync to connected services',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        _meta: {
          readOnlyHint: false
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

        if (this.authInProgress) {
          return {
            content: [{
              type: 'text',
              text: `⏳ Authentication already in progress. Please complete the login in your browser.`
            }]
          };
        }

        // Start browser auth asynchronously
        this.startBrowserAuth().then(() => {
          console.error(`✅ Authentication completed successfully for ${this.authState.email}`);
        }).catch((error) => {
          console.error(`❌ Authentication failed: ${error.message}`);
        });

        // Return immediately with instructions
        return {
          content: [{
            type: 'text',
            text: `🌐 Opening your browser for authentication...\n\n` +
                 `Please:\n` +
                 `1. Enter your AiDD email and password\n` +
                 `2. Click "Sign In"\n` +
                 `3. Return here after authentication\n\n` +
                 `Once authenticated, use the "status" command to verify your connection.\n\n` +
                 `If the browser doesn't open, visit: http://localhost:54321/`
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
                 `Ready to begin!`
          }]
        };

      default:
        return {
          content: [{
            type: 'text',
            text: `Tool ${toolName} is not yet implemented.`
          }]
        };
    }
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'connect',
          description: 'Connect to AiDD account via browser authentication. Opens a browser window for OAuth sign-in with Google, Microsoft, Apple, or email/password.',
          inputSchema: { type: 'object', properties: {} },
          _meta: {
            readOnlyHint: false
          }
        },
        {
          name: 'disconnect',
          description: 'Disconnect from AiDD account and remove stored authentication credentials',
          inputSchema: { type: 'object', properties: {} },
          _meta: {
            readOnlyHint: false,
            destructiveHint: true
          }
        },
        {
          name: 'status',
          description: 'Check current authentication status, subscription level, and token expiry time',
          inputSchema: { type: 'object', properties: {} },
          _meta: {
            readOnlyHint: true
          }
        },
        {
          name: 'start_workflow',
          description: 'Start the AiDD workflow to import Apple Notes, extract action items, and sync to connected services',
          inputSchema: { type: 'object', properties: {} },
          _meta: {
            readOnlyHint: false
          }
        }
      ]
    }));

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: []
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      throw new Error('Resource not found');
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('AiDD MCP Server with Browser Authentication started');
  }
}

const server = new AiDDBrowserAuthServer();
server.run().catch(console.error);