import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { BrowserOAuthFlow } from './oauth-flow.js';

interface UserCredentials {
  email?: string;
  userId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  subscription?: 'FREE' | 'PREMIUM' | 'PRO';
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  subscription: string;
  expiresIn: number;
}

export class AuthManager {
  private baseUrl = 'https://aidd-backend-prod-739193356129.us-central1.run.app';
  private credentials: UserCredentials = {};
  private credentialsPath: string;
  private oauthFlow: BrowserOAuthFlow;

  constructor() {
    // Store credentials in user's home directory
    const configDir = path.join(os.homedir(), '.aidd-mcp');
    this.credentialsPath = path.join(configDir, 'credentials.json');
    this.oauthFlow = new BrowserOAuthFlow();
    this.loadCredentials();
  }

  /**
   * Sign in with email and password
   */
  async signInWithEmail(email: string, password: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Sign-in failed: ${error}`);
      }

      const data = await response.json() as any;

      this.credentials = {
        email: data.user?.email || data.email,
        userId: data.user?.userId || data.userId,
        accessToken: data.tokens?.accessToken || data.accessToken,
        refreshToken: data.tokens?.refreshToken || data.refreshToken,
        expiresAt: Date.now() + ((data.tokens?.expiresIn || data.expiresIn) * 1000),
        subscription: (data.user?.subscription || data.subscription || 'FREE') as 'FREE' | 'PREMIUM' | 'PRO'
      };

      await this.saveCredentials();
      return true;
    } catch (error) {
      console.error('Sign-in error:', error);
      return false;
    }
  }

  /**
   * Sign in with OAuth (browser-based)
   * Opens browser for authentication
   * Supports Google, Microsoft, and Apple
   */
  async signInWithOAuth(provider?: 'google' | 'microsoft' | 'apple'): Promise<boolean> {
    try {
      console.log(`\n🔐 Starting ${provider || 'OAuth'} sign-in...`);
      const result = await this.oauthFlow.authenticate(provider);

      this.credentials = {
        email: result.email,
        userId: result.userId,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: Date.now() + (result.expiresIn * 1000),
        subscription: result.subscription as 'FREE' | 'PREMIUM' | 'PRO'
      };

      await this.saveCredentials();
      return true;
    } catch (error) {
      console.error('OAuth sign-in error:', error);
      return false;
    }
  }

  /**
   * Sign in with Google OAuth (browser-based)
   */
  async signInWithGoogle(): Promise<boolean> {
    return this.signInWithOAuth('google');
  }

  /**
   * Sign in with Microsoft OAuth (browser-based)
   */
  async signInWithMicrosoft(): Promise<boolean> {
    return this.signInWithOAuth('microsoft');
  }

  /**
   * Sign in with Apple OAuth (browser-based)
   */
  async signInWithApple(): Promise<boolean> {
    return this.signInWithOAuth('apple');
  }

  /**
   * Get current access token (refreshing proactively if needed)
   */
  async getAccessToken(): Promise<string | null> {
    // Check if we have valid credentials
    if (!this.credentials.accessToken) {
      return null;
    }

    // Proactive refresh: refresh if token expires in less than 24 hours
    // This prevents token expiry during active sessions
    const REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000; // 24 hours
    const shouldRefresh = this.credentials.expiresAt &&
      Date.now() >= (this.credentials.expiresAt - REFRESH_BUFFER_MS);

    if (shouldRefresh) {
      if (this.credentials.refreshToken) {
        const refreshed = await this.refreshToken();
        if (!refreshed) {
          // Refresh failed - session expired, user needs to re-authenticate
          return null;
        }
      } else {
        // No refresh token available
        return null;
      }
    }

    return this.credentials.accessToken || null;
  }

  /**
   * Refresh access token
   */
  async refreshToken(): Promise<boolean> {
    if (!this.credentials.refreshToken) {
      console.error('⚠️ No refresh token available. Please re-authenticate using the "connect" command.');
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refreshToken: this.credentials.refreshToken
        }),
      });

      if (!response.ok) {
        // Parse error response for better messaging
        let errorReason = 'Unknown error';
        try {
          const errorData = await response.json() as { error?: string };
          errorReason = errorData.error || `HTTP ${response.status}`;
        } catch {
          errorReason = `HTTP ${response.status} ${response.statusText}`;
        }

        console.error('\n' + '='.repeat(60));
        console.error('⚠️  SESSION EXPIRED - Re-authentication Required');
        console.error('='.repeat(60));
        console.error(`Reason: ${errorReason}`);
        console.error('');
        console.error('Your session has expired. To continue using AiDD:');
        console.error('  1. Use the "connect" command to sign in again');
        console.error('  2. Or restart Claude and re-authenticate');
        console.error('='.repeat(60) + '\n');

        // Clear expired credentials
        this.credentials = {};
        await this.saveCredentials();
        return false;
      }

      const data = await response.json() as { accessToken: string; expiresIn: number };

      this.credentials.accessToken = data.accessToken;
      this.credentials.expiresAt = Date.now() + (data.expiresIn * 1000);

      await this.saveCredentials();
      console.error('✅ Session refreshed successfully');
      return true;
    } catch (error) {
      console.error('\n⚠️ Token refresh failed:', error);
      console.error('   Please use the "connect" command to re-authenticate.\n');
      return false;
    }
  }

  /**
   * Sign out
   */
  async signOut(): Promise<void> {
    this.credentials = {};
    await this.saveCredentials();
  }

  /**
   * Check if user is signed in
   */
  isSignedIn(): boolean {
    return !!(this.credentials.userId && this.credentials.accessToken);
  }

  /**
   * Get current user info
   */
  getUserInfo(): { email?: string; userId?: string; subscription?: string } {
    return {
      email: this.credentials.email,
      userId: this.credentials.userId,
      subscription: this.credentials.subscription
    };
  }

  /**
   * Get detailed session status for user visibility
   */
  getSessionStatus(): {
    isAuthenticated: boolean;
    email?: string;
    userId?: string;
    subscription?: string;
    tokenExpiresAt?: number;
    tokenExpiresInDays?: number;
    tokenExpiresInHours?: number;
    needsRefreshSoon: boolean;
    isExpired: boolean;
  } {
    const now = Date.now();
    const expiresAt = this.credentials.expiresAt;
    const isExpired = expiresAt ? now >= expiresAt : true;
    const msUntilExpiry = expiresAt ? expiresAt - now : 0;
    const hoursUntilExpiry = Math.max(0, Math.floor(msUntilExpiry / (1000 * 60 * 60)));
    const daysUntilExpiry = Math.max(0, Math.floor(msUntilExpiry / (1000 * 60 * 60 * 24)));
    const needsRefreshSoon = hoursUntilExpiry < 24;

    return {
      isAuthenticated: this.isSignedIn() && !isExpired,
      email: this.credentials.email,
      userId: this.credentials.userId,
      subscription: this.credentials.subscription,
      tokenExpiresAt: expiresAt,
      tokenExpiresInDays: daysUntilExpiry,
      tokenExpiresInHours: hoursUntilExpiry,
      needsRefreshSoon,
      isExpired
    };
  }

  /**
   * Load saved credentials from disk
   */
  private async loadCredentials(): Promise<void> {
    try {
      const encrypted = await fs.readFile(this.credentialsPath, 'utf-8');
      const decrypted = this.simpleDecrypt(encrypted);
      this.credentials = JSON.parse(decrypted);
    } catch (error) {
      // No saved credentials or file doesn't exist
      this.credentials = {};
    }
  }

  /**
   * Save credentials to disk (encrypted)
   */
  private async saveCredentials(): Promise<void> {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(this.credentialsPath);
      await fs.mkdir(dir, { recursive: true });

      // Simple encryption for stored credentials
      const data = JSON.stringify(this.credentials);
      const encrypted = this.simpleEncrypt(data);

      await fs.writeFile(this.credentialsPath, encrypted, 'utf-8');

      // Set restrictive permissions (owner read/write only)
      await fs.chmod(this.credentialsPath, 0o600);
    } catch (error) {
      console.error('Failed to save credentials:', error);
    }
  }

  /**
   * Simple encryption for credentials
   */
  private simpleEncrypt(text: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync('aidd-mcp-key', 'salt', 32);
    const iv = Buffer.alloc(16, 0);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return encrypted;
  }

  /**
   * Simple decryption for credentials
   */
  private simpleDecrypt(encrypted: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync('aidd-mcp-key', 'salt', 32);
    const iv = Buffer.alloc(16, 0);

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}