import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

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

  constructor() {
    // Store credentials in user's home directory
    const configDir = path.join(os.homedir(), '.aidd-mcp');
    this.credentialsPath = path.join(configDir, 'credentials.json');
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

      const data = await response.json() as AuthResponse;

      this.credentials = {
        email: data.email,
        userId: data.userId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + (data.expiresIn * 1000),
        subscription: data.subscription as 'FREE' | 'PREMIUM' | 'PRO'
      };

      await this.saveCredentials();
      return true;
    } catch (error) {
      console.error('Sign-in error:', error);
      return false;
    }
  }

  /**
   * Sign in with Google OAuth
   */
  async signInWithGoogle(googleIdToken: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken: googleIdToken }),
      });

      if (!response.ok) {
        throw new Error(`Google sign-in failed: ${response.statusText}`);
      }

      const data = await response.json() as AuthResponse;

      this.credentials = {
        email: data.email,
        userId: data.userId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + (data.expiresIn * 1000),
        subscription: data.subscription as 'FREE' | 'PREMIUM' | 'PRO'
      };

      await this.saveCredentials();
      return true;
    } catch (error) {
      console.error('Google sign-in error:', error);
      return false;
    }
  }

  /**
   * Sign in with Microsoft OAuth
   */
  async signInWithMicrosoft(microsoftAccessToken: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/microsoft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accessToken: microsoftAccessToken }),
      });

      if (!response.ok) {
        throw new Error(`Microsoft sign-in failed: ${response.statusText}`);
      }

      const data = await response.json() as AuthResponse;

      this.credentials = {
        email: data.email,
        userId: data.userId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + (data.expiresIn * 1000),
        subscription: data.subscription as 'FREE' | 'PREMIUM' | 'PRO'
      };

      await this.saveCredentials();
      return true;
    } catch (error) {
      console.error('Microsoft sign-in error:', error);
      return false;
    }
  }

  /**
   * Get current access token (refreshing if needed)
   */
  async getAccessToken(): Promise<string | null> {
    // Check if we have valid credentials
    if (!this.credentials.accessToken) {
      return null;
    }

    // Check if token is expired
    if (this.credentials.expiresAt && Date.now() >= this.credentials.expiresAt) {
      // Try to refresh
      if (this.credentials.refreshToken) {
        await this.refreshToken();
      } else {
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
        // Refresh failed, clear credentials
        this.credentials = {};
        await this.saveCredentials();
        return false;
      }

      const data = await response.json() as { accessToken: string; expiresIn: number };

      this.credentials.accessToken = data.accessToken;
      this.credentials.expiresAt = Date.now() + (data.expiresIn * 1000);

      await this.saveCredentials();
      return true;
    } catch (error) {
      console.error('Token refresh error:', error);
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