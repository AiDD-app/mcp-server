/**
 * E2E Encryption Manager for MCP Server
 *
 * Implements Account-Locked Key Wrapping for true end-to-end encryption.
 *
 * Architecture:
 * 1. Backend generates DEK (Data Encryption Key) and wraps it with password-derived key
 * 2. Client fetches wrapped DEK from backend
 * 3. Client derives KWK (Key Wrapping Key) from password/OAuth token
 * 4. Client unwraps DEK locally - server never sees unwrapped DEK
 * 5. Client encrypts/decrypts data using DEK
 *
 * Multi-device sync:
 * - Each login fetches wrapped DEK → unwrap with password → access data
 * - Same password = same DEK = can decrypt data from any device
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Configuration (must match backend and iOS)
const CONFIG = {
  PBKDF2_ITERATIONS: 100000,
  PBKDF2_HASH: 'sha256',
  DEK_SIZE: 32, // 256 bits for AES-256
  KWK_SIZE: 32, // 256 bits
  IV_SIZE: 12,  // 96 bits (recommended for GCM)
  AUTH_TAG_SIZE: 16, // 128 bits
};

interface WrappedKeyData {
  wrappedKey: string;
  iv: string;
  authTag: string;
  salt: string;
  algorithm: string;
  kdfIterations: number;
  kdfHash: string;
  version: number;
}

interface E2ESetupResponse {
  success: boolean;
  wrappedKeyData: WrappedKeyData;
}

interface E2EStatusResponse {
  hasEncryption: boolean;
  version?: number;
}

// Migration types
interface MigrationStatus {
  needsMigration: boolean;
  hasE2E: boolean;
  hasLegacyData: boolean;
  legacyDataCounts?: {
    tasks?: { total: number; encrypted: number };
    actionItems?: { total: number; encrypted: number };
    notes?: { total: number; encrypted: number };
  };
  message?: string;
}

interface MigrationStartResponse {
  success: boolean;
  migrationId?: string;
  wrappedKeyData?: WrappedKeyData;
  decryptedData?: {
    tasks: DecryptedTask[];
    actionItems: DecryptedActionItem[];
    notes: DecryptedNote[];
  };
  message?: string;
  error?: string;
  code?: string;
}

interface DecryptedTask {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  isCompleted?: boolean;
  score?: number;
  dueDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface DecryptedActionItem {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  isCompleted?: boolean;
  priority?: string;
  dueDate?: string;
  category?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface DecryptedNote {
  id: string;
  title: string;
  content?: string;
  tags?: string[];
  category?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class E2EEncryptionManager {
  private baseUrl: string;
  private dek: Buffer | null = null;
  private isEnabled: boolean = false;
  private keyStorePath: string;

  constructor(baseUrl: string = 'https://aidd-backend-prod-739193356129.us-central1.run.app') {
    this.baseUrl = baseUrl;
    // Store key in user's home directory (secure for single-user systems)
    const configDir = path.join(os.homedir(), '.aidd');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { mode: 0o700 });
    }
    this.keyStorePath = path.join(configDir, 'e2e-key.enc');
  }

  // MARK: - Public API

  /**
   * Check if E2E encryption is enabled
   */
  get e2eEnabled(): boolean {
    return this.isEnabled && this.dek !== null;
  }

  /**
   * Setup E2E encryption for the current user
   * @param accessToken - User's access token
   * @param password - User's password or OAuth token hash
   */
  async setupEncryption(accessToken: string, password: string): Promise<boolean> {
    try {
      console.log('[E2E] Setting up encryption...');

      const response = await fetch(`${this.baseUrl}/api/e2e/setup`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        throw new Error(`Setup failed: ${response.status}`);
      }

      const result = await response.json() as E2ESetupResponse;

      // Unwrap the DEK locally
      this.dek = await this.unwrapKey(result.wrappedKeyData, password);

      // Store encrypted DEK for persistence
      await this.storeDEK(password);

      this.isEnabled = true;
      console.log('[E2E] Encryption setup complete');
      return true;
    } catch (error) {
      console.error('[E2E] Setup failed:', error);
      throw error;
    }
  }

  /**
   * Unlock E2E encryption with password (for login/new device)
   * @param accessToken - User's access token
   * @param password - User's password or OAuth token hash
   */
  async unlockWithPassword(accessToken: string, password: string): Promise<boolean> {
    try {
      console.log('[E2E] Unlocking encryption...');

      // First, try to load from local cache
      if (await this.loadCachedDEK(password)) {
        this.isEnabled = true;
        console.log('[E2E] Loaded DEK from local cache');
        return true;
      }

      // Fetch wrapped key from backend
      const response = await fetch(`${this.baseUrl}/api/e2e/wrapped-key`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (response.status === 404) {
        console.log('[E2E] No encryption set up for this user');
        this.isEnabled = false;
        return false;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch key: ${response.status}`);
      }

      const wrappedKeyData = await response.json() as WrappedKeyData;

      // Unwrap DEK locally
      this.dek = await this.unwrapKey(wrappedKeyData, password);

      // Cache for future use
      await this.storeDEK(password);

      this.isEnabled = true;
      console.log('[E2E] Encryption unlocked successfully');
      return true;
    } catch (error) {
      console.error('[E2E] Unlock failed:', error);
      throw error;
    }
  }

  /**
   * Unlock using OAuth stored password (for OAuth users: Apple, Google, Microsoft)
   * Fetches the stored random password from backend - NOT derived from token
   * This ensures consistent encryption key across sessions/devices
   * @param accessToken - User's access token
   */
  async unlockWithOAuthStoredPassword(accessToken: string): Promise<boolean> {
    try {
      console.log('[E2E] Fetching stored OAuth password...');
      const response = await fetch(`${this.baseUrl}/api/encryption/oauth-password`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        console.log('[E2E] No stored OAuth password found - user needs E2E setup');
        return false;
      }

      const result = await response.json() as { success: boolean; data: { password: string | null } };
      if (!result.success || !result.data?.password) {
        console.log('[E2E] No stored OAuth password found');
        return false;
      }

      return this.unlockWithPassword(accessToken, result.data.password);
    } catch (error) {
      console.error('[E2E] Failed to fetch OAuth password:', error);
      throw error;
    }
  }

  /**
   * Setup encryption for OAuth users (Apple, Google, Microsoft)
   * Generates a random password, stores it on backend, then uses it for E2E
   * This ensures the same password is available across all devices
   * @param accessToken - User's access token
   */
  async setupEncryptionForOAuthUser(accessToken: string): Promise<boolean> {
    try {
      console.log('[E2E] Setting up E2E for OAuth user...');

      // Generate a cryptographically secure random password
      const randomBytes = crypto.randomBytes(32);
      const password = randomBytes.toString('base64');

      // Store the password on backend FIRST (so it's available on other devices)
      const storeResponse = await fetch(`${this.baseUrl}/api/encryption/oauth-password`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      if (!storeResponse.ok) {
        throw new Error(`Failed to store OAuth password: ${storeResponse.status}`);
      }

      console.log('[E2E] Stored OAuth encryption password on backend');

      // Now setup E2E with this password
      return this.setupEncryption(accessToken, password);
    } catch (error) {
      console.error('[E2E] OAuth E2E setup failed:', error);
      throw error;
    }
  }

  /**
   * @deprecated Use unlockWithOAuthStoredPassword() instead
   * Kept for backward compatibility but token derivation is NOT stable across sessions
   */
  async unlockWithOAuthToken(accessToken: string, oauthToken: string): Promise<boolean> {
    console.warn('[E2E] unlockWithOAuthToken is deprecated - tokens change between sessions');
    // First try to use stored password (correct approach)
    try {
      return await this.unlockWithOAuthStoredPassword(accessToken);
    } catch {
      // Fallback to token derivation (legacy, may fail)
      const password = this.derivePasswordFromToken(oauthToken);
      return this.unlockWithPassword(accessToken, password);
    }
  }

  /**
   * @deprecated Use setupEncryptionForOAuthUser() instead
   * Kept for backward compatibility but token derivation is NOT stable across sessions
   */
  async setupEncryptionWithOAuthToken(accessToken: string, oauthToken: string): Promise<boolean> {
    console.warn('[E2E] setupEncryptionWithOAuthToken is deprecated - use setupEncryptionForOAuthUser');
    // Use the correct approach: generate random password and store it
    return this.setupEncryptionForOAuthUser(accessToken);
  }

  /**
   * Check if E2E encryption is set up for current user
   */
  async checkEncryptionStatus(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/e2e/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        return false;
      }

      const result = await response.json() as E2EStatusResponse;
      return result.hasEncryption;
    } catch (error) {
      console.error('[E2E] Status check failed:', error);
      return false;
    }
  }

  // MARK: - Migration Methods

  /**
   * Check if user needs migration from legacy encryption to E2E
   */
  async checkMigrationStatus(accessToken: string): Promise<MigrationStatus> {
    const response = await fetch(`${this.baseUrl}/api/e2e/migration/status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Migration status check failed: ${response.status}`);
    }

    return await response.json() as MigrationStatus;
  }

  /**
   * Migrate from legacy encryption to E2E encryption
   * @param accessToken - User's access token
   * @param password - Password for E2E encryption (login password or OAuth stored password)
   * @param legacySalt - Salt used for legacy encryption (if available)
   * @param legacyPassword - Password used for legacy encryption (defaults to password if not provided)
   * @param isOAuthUser - True if user signed in via Apple/Google/Microsoft
   * @param onProgress - Progress callback (0.0 to 1.0)
   */
  async migrateToE2E(
    accessToken: string,
    password: string,
    legacySalt?: string,
    legacyPassword?: string,
    isOAuthUser: boolean = false,
    onProgress?: (progress: number, message: string) => void
  ): Promise<boolean> {
    try {
      onProgress?.(0.1, 'Checking migration status...');

      // Check if migration is needed
      const status = await this.checkMigrationStatus(accessToken);

      if (status.hasE2E) {
        console.log('[E2E Migration] User already has E2E encryption');
        onProgress?.(1.0, 'Already using E2E encryption');
        return true;
      }

      if (!status.needsMigration && !status.hasLegacyData) {
        // No legacy data - just set up E2E directly
        console.log('[E2E Migration] No legacy data found, setting up E2E directly');
        onProgress?.(0.3, 'Setting up E2E encryption...');

        if (isOAuthUser) {
          await this.setupEncryptionForOAuthUser(accessToken);
        } else {
          await this.setupEncryption(accessToken, password);
        }

        onProgress?.(1.0, 'E2E encryption enabled');
        return true;
      }

      onProgress?.(0.2, 'Starting migration...');

      // Start migration on backend
      const startResponse = await fetch(`${this.baseUrl}/api/e2e/migration/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password,
          legacySalt,
          legacyPassword,
        }),
      });

      if (!startResponse.ok) {
        throw new Error(`Migration start failed: ${startResponse.status}`);
      }

      const startResult = await startResponse.json() as MigrationStartResponse;

      if (!startResult.success || !startResult.migrationId) {
        throw new Error(startResult.error || 'Migration start failed');
      }

      onProgress?.(0.4, 'Decrypted legacy data. Setting up E2E...');

      // Unwrap the new DEK
      if (startResult.wrappedKeyData) {
        this.dek = await this.unwrapKey(startResult.wrappedKeyData, password);
        await this.storeDEK(password);
        this.isEnabled = true;
      }

      onProgress?.(0.5, 'Encrypting data with E2E...');

      // Re-encrypt the decrypted data and sync back
      if (startResult.decryptedData) {
        const { tasks, actionItems, notes } = startResult.decryptedData;
        const totalItems = tasks.length + actionItems.length + notes.length;
        let processedItems = 0;

        // Encrypt and sync tasks
        for (const task of tasks) {
          await this.syncEncryptedTask(accessToken, task);
          processedItems++;
          const progress = 0.5 + (0.4 * processedItems / Math.max(1, totalItems));
          onProgress?.(progress, 'Encrypting tasks...');
        }

        // Encrypt and sync action items
        for (const actionItem of actionItems) {
          await this.syncEncryptedActionItem(accessToken, actionItem);
          processedItems++;
          const progress = 0.5 + (0.4 * processedItems / Math.max(1, totalItems));
          onProgress?.(progress, 'Encrypting action items...');
        }

        // Encrypt and sync notes
        for (const note of notes) {
          await this.syncEncryptedNote(accessToken, note);
          processedItems++;
          const progress = 0.5 + (0.4 * processedItems / Math.max(1, totalItems));
          onProgress?.(progress, 'Encrypting notes...');
        }
      }

      onProgress?.(0.95, 'Completing migration...');

      // Complete migration
      const completeResponse = await fetch(`${this.baseUrl}/api/e2e/migration/complete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ migrationId: startResult.migrationId }),
      });

      if (!completeResponse.ok) {
        throw new Error(`Migration complete failed: ${completeResponse.status}`);
      }

      console.log('[E2E Migration] Migration completed successfully');
      onProgress?.(1.0, 'Migration complete!');

      return true;
    } catch (error) {
      console.error('[E2E Migration] Failed:', error);
      throw error;
    }
  }

  /**
   * Sync an encrypted task to the backend
   */
  private async syncEncryptedTask(accessToken: string, task: DecryptedTask): Promise<void> {
    const encryptedTitle = this.encrypt(task.title);
    const encryptedDescription = task.description ? this.encrypt(task.description) : undefined;
    const encryptedTags = task.tags ? this.encrypt(JSON.stringify(task.tags)) : undefined;

    const syncData: Record<string, unknown> = {
      id: task.id,
      encryptedTitle,
      encrypted: true,
      e2eMode: true,
    };

    if (encryptedDescription) syncData.encryptedDescription = encryptedDescription;
    if (encryptedTags) syncData.encryptedTags = encryptedTags;
    if (task.isCompleted !== undefined) syncData.isCompleted = task.isCompleted;
    if (task.score !== undefined) syncData.score = task.score;
    if (task.dueDate) syncData.dueDate = task.dueDate;

    const response = await fetch(`${this.baseUrl}/api/sync/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tasks: [syncData], e2eMode: true }),
    });

    if (!response.ok) {
      throw new Error(`Failed to sync task: ${response.status}`);
    }
  }

  /**
   * Sync an encrypted action item to the backend
   */
  private async syncEncryptedActionItem(accessToken: string, actionItem: DecryptedActionItem): Promise<void> {
    const encryptedTitle = this.encrypt(actionItem.title);
    const encryptedDescription = actionItem.description ? this.encrypt(actionItem.description) : undefined;
    const encryptedTags = actionItem.tags ? this.encrypt(JSON.stringify(actionItem.tags)) : undefined;

    const syncData: Record<string, unknown> = {
      id: actionItem.id,
      encryptedTitle,
      encrypted: true,
      e2eMode: true,
    };

    if (encryptedDescription) syncData.encryptedDescription = encryptedDescription;
    if (encryptedTags) syncData.encryptedTags = encryptedTags;
    if (actionItem.isCompleted !== undefined) syncData.isCompleted = actionItem.isCompleted;
    if (actionItem.priority) syncData.priority = actionItem.priority;
    if (actionItem.dueDate) syncData.dueDate = actionItem.dueDate;
    if (actionItem.category) syncData.category = actionItem.category;

    const response = await fetch(`${this.baseUrl}/api/sync/action-items`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ actionItems: [syncData], e2eMode: true }),
    });

    if (!response.ok) {
      throw new Error(`Failed to sync action item: ${response.status}`);
    }
  }

  /**
   * Sync an encrypted note to the backend
   */
  private async syncEncryptedNote(accessToken: string, note: DecryptedNote): Promise<void> {
    const encryptedTitle = this.encrypt(note.title);
    const encryptedContent = note.content ? this.encrypt(note.content) : undefined;
    const encryptedTags = note.tags ? this.encrypt(JSON.stringify(note.tags)) : undefined;

    const syncData: Record<string, unknown> = {
      id: note.id,
      encryptedTitle,
      encrypted: true,
      e2eMode: true,
    };

    if (encryptedContent) syncData.encryptedContent = encryptedContent;
    if (encryptedTags) syncData.encryptedTags = encryptedTags;
    if (note.category) syncData.category = note.category;

    const response = await fetch(`${this.baseUrl}/api/sync/notes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notes: [syncData], e2eMode: true }),
    });

    if (!response.ok) {
      throw new Error(`Failed to sync note: ${response.status}`);
    }
  }

  /**
   * Encrypt data using the DEK
   * @param plaintext - Data to encrypt
   * @returns Base64 encoded encrypted data (IV + AuthTag + Ciphertext)
   */
  encrypt(plaintext: string): string {
    if (!this.dek) {
      throw new Error('E2E encryption not unlocked');
    }

    const iv = crypto.randomBytes(CONFIG.IV_SIZE);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.dek, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Combine: IV (12) + AuthTag (16) + Ciphertext
    const result = Buffer.concat([iv, authTag, encrypted]);
    return result.toString('base64');
  }

  /**
   * Decrypt data using the DEK
   * @param ciphertext - Base64 encoded encrypted data
   * @returns Decrypted plaintext
   */
  decrypt(ciphertext: string): string {
    if (!this.dek) {
      throw new Error('E2E encryption not unlocked');
    }

    const data = Buffer.from(ciphertext, 'base64');

    // Extract components
    const iv = data.subarray(0, CONFIG.IV_SIZE);
    const authTag = data.subarray(CONFIG.IV_SIZE, CONFIG.IV_SIZE + CONFIG.AUTH_TAG_SIZE);
    const encrypted = data.subarray(CONFIG.IV_SIZE + CONFIG.AUTH_TAG_SIZE);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.dek, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Encrypt JSON-encodable object
   */
  encryptObject<T>(object: T): string {
    const jsonString = JSON.stringify(object);
    return this.encrypt(jsonString);
  }

  /**
   * Decrypt to JSON-decodable object
   */
  decryptObject<T>(ciphertext: string): T {
    const jsonString = this.decrypt(ciphertext);
    return JSON.parse(jsonString);
  }

  /**
   * Clear cached DEK (for logout)
   */
  clearKeys(): void {
    this.dek = null;
    this.isEnabled = false;

    // Remove cached key file
    if (fs.existsSync(this.keyStorePath)) {
      fs.unlinkSync(this.keyStorePath);
    }

    console.log('[E2E] Keys cleared');
  }

  // MARK: - Private Methods

  /**
   * Derive KWK from password and salt using PBKDF2
   */
  private deriveKWK(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        password,
        salt,
        CONFIG.PBKDF2_ITERATIONS,
        CONFIG.KWK_SIZE,
        CONFIG.PBKDF2_HASH,
        (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        }
      );
    });
  }

  /**
   * Unwrap (decrypt) DEK using KWK
   */
  private async unwrapKey(wrappedKeyData: WrappedKeyData, password: string): Promise<Buffer> {
    const salt = Buffer.from(wrappedKeyData.salt, 'base64');
    const iv = Buffer.from(wrappedKeyData.iv, 'base64');
    const authTag = Buffer.from(wrappedKeyData.authTag, 'base64');
    const wrappedKey = Buffer.from(wrappedKeyData.wrappedKey, 'base64');

    // Derive KWK from password
    const kwk = await this.deriveKWK(password, salt);

    // Unwrap DEK using AES-GCM
    const decipher = crypto.createDecipheriv('aes-256-gcm', kwk, iv);
    decipher.setAuthTag(authTag);

    const dek = Buffer.concat([
      decipher.update(wrappedKey),
      decipher.final(),
    ]);

    return dek;
  }

  /**
   * Store DEK encrypted with password-derived key
   */
  private async storeDEK(password: string): Promise<void> {
    if (!this.dek) return;

    // Generate new salt for local storage
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(CONFIG.IV_SIZE);

    // Derive key for local storage
    const storageKey = await this.deriveKWK(password, salt);

    // Encrypt DEK
    const cipher = crypto.createCipheriv('aes-256-gcm', storageKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(this.dek),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Store as JSON
    const stored = {
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      encryptedKey: encrypted.toString('base64'),
      version: 1,
    };

    fs.writeFileSync(this.keyStorePath, JSON.stringify(stored), { mode: 0o600 });
    console.log('[E2E] DEK cached locally');
  }

  /**
   * Load cached DEK from local storage
   */
  private async loadCachedDEK(password: string): Promise<boolean> {
    try {
      if (!fs.existsSync(this.keyStorePath)) {
        return false;
      }

      const stored = JSON.parse(fs.readFileSync(this.keyStorePath, 'utf8'));

      const salt = Buffer.from(stored.salt, 'base64');
      const iv = Buffer.from(stored.iv, 'base64');
      const authTag = Buffer.from(stored.authTag, 'base64');
      const encryptedKey = Buffer.from(stored.encryptedKey, 'base64');

      // Derive storage key
      const storageKey = await this.deriveKWK(password, salt);

      // Decrypt DEK
      const decipher = crypto.createDecipheriv('aes-256-gcm', storageKey, iv);
      decipher.setAuthTag(authTag);

      this.dek = Buffer.concat([
        decipher.update(encryptedKey),
        decipher.final(),
      ]);

      return true;
    } catch (error) {
      console.log('[E2E] Failed to load cached DEK:', error);
      return false;
    }
  }

  /**
   * Derive password from OAuth token
   */
  private derivePasswordFromToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}

// Export singleton instance
let e2eManagerInstance: E2EEncryptionManager | null = null;

export function getE2EManager(): E2EEncryptionManager {
  if (!e2eManagerInstance) {
    e2eManagerInstance = new E2EEncryptionManager();
  }
  return e2eManagerInstance;
}

export function resetE2EManager(): void {
  if (e2eManagerInstance) {
    e2eManagerInstance.clearKeys();
  }
  e2eManagerInstance = null;
}
