/**
 * Google Analytics 4 Integration for Claude MCP Server
 * Tracks usage of MCP tools and integrations
 */

import fetch from 'node-fetch';
import * as crypto from 'crypto';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

interface GA4Config {
  measurementId: string;
  apiSecret: string;
  enabled?: boolean;
  debug?: boolean;
}

interface EventParams {
  [key: string]: any;
}

interface EventOptions {
  userId?: string;
  sessionId?: string;
  clientId?: string;
}

// Device and locale information for GA4 user properties
interface DeviceInfo {
  platform: string;
  os_version: string;
  device_category: string;
  language: string;
  country: string;
  timezone: string;
  architecture: string;
}

// MCP source type - which AI platform is using the MCP server
export type McpSource = 'claude' | 'chatgpt' | 'other' | 'unknown';

export class GA4Analytics {
  private measurementId: string;
  private apiSecret: string;
  private enabled: boolean;
  private debug: boolean;
  private endpoint: string;
  private debugEndpoint: string;
  // Persistent identifiers for consistent user tracking
  private persistentClientId: string;
  private sessionId: string;
  // Device/locale info for user properties
  private deviceInfo: DeviceInfo;
  private userPropertiesSent: boolean = false;
  // MCP source - which AI platform is using this server
  private mcpSource: McpSource = 'unknown';

  constructor(config?: GA4Config) {
    this.measurementId = config?.measurementId || process.env.GA_MEASUREMENT_ID || 'G-XXXXXXXXXX';
    this.apiSecret = config?.apiSecret || process.env.GA_API_SECRET || '';
    this.enabled = config?.enabled !== false && this.measurementId !== 'G-XXXXXXXXXX' && this.apiSecret !== '';
    this.debug = config?.debug || process.env.NODE_ENV === 'development';
    this.endpoint = 'https://www.google-analytics.com/mp/collect';
    this.debugEndpoint = 'https://www.google-analytics.com/debug/mp/collect';

    // Initialize persistent client ID (consistent across sessions for same machine)
    this.persistentClientId = this.getOrCreatePersistentClientId();
    // Session ID persists for the lifetime of this MCP server instance
    this.sessionId = Date.now().toString();
    // Gather device/locale information
    this.deviceInfo = this.gatherDeviceInfo();
    // Detect MCP source from environment
    this.mcpSource = this.detectMcpSource();

    // Log initialization state (helpful for debugging env var issues)
    console.log('[GA4-MCP] Initialized:', {
      measurementId: this.measurementId?.substring(0, 5) + '...',
      hasApiSecret: !!this.apiSecret,
      enabled: this.enabled,
      debug: this.debug,
      nodeEnv: process.env.NODE_ENV,
      clientId: this.persistentClientId.substring(0, 15) + '...',
      sessionId: this.sessionId,
      mcpSource: this.mcpSource,
      deviceInfo: this.deviceInfo
    });

    // Send user properties on first initialization
    this.sendUserPropertiesOnce();
  }

  /**
   * Detect which AI platform (Claude, ChatGPT, etc.) is using this MCP server
   * Detection is based on environment variables and process characteristics
   */
  private detectMcpSource(): McpSource {
    // Check environment variables that might indicate the source
    const mcpSourceEnv = process.env.MCP_SOURCE?.toLowerCase();
    if (mcpSourceEnv) {
      if (mcpSourceEnv.includes('claude')) return 'claude';
      if (mcpSourceEnv.includes('chatgpt') || mcpSourceEnv.includes('openai')) return 'chatgpt';
      return 'other';
    }

    // Check parent process or command line for hints
    const parentPid = process.ppid;
    const argv = process.argv.join(' ').toLowerCase();

    // Claude Desktop typically runs MCP servers with specific patterns
    if (argv.includes('claude') || process.env.CLAUDE_MCP) {
      return 'claude';
    }

    // ChatGPT/OpenAI patterns
    if (argv.includes('chatgpt') || argv.includes('openai') || process.env.OPENAI_API_KEY) {
      return 'chatgpt';
    }

    // Check if running in a known MCP host environment
    const mcpHost = process.env.MCP_HOST?.toLowerCase();
    if (mcpHost) {
      if (mcpHost.includes('claude')) return 'claude';
      if (mcpHost.includes('chatgpt') || mcpHost.includes('openai')) return 'chatgpt';
    }

    return 'unknown';
  }

  /**
   * Set the MCP source manually (useful when detected via OAuth or other means)
   */
  setMcpSource(source: McpSource): void {
    this.mcpSource = source;
    console.log('[GA4-MCP] MCP source set to:', source);
  }

  /**
   * Get the current MCP source
   */
  getMcpSource(): McpSource {
    return this.mcpSource;
  }

  /**
   * Gather device and locale information from the system
   * This provides context that GA4 Measurement Protocol doesn't auto-detect
   */
  private gatherDeviceInfo(): DeviceInfo {
    // Get locale from environment or system
    const locale = process.env.LANG || process.env.LC_ALL || 'en_US.UTF-8';
    const localeParts = locale.split('.');
    const langCountry = localeParts[0] || 'en_US';
    const [language, country] = langCountry.includes('_')
      ? langCountry.split('_')
      : [langCountry, 'US'];

    // Get timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';

    // Get OS info
    const platform = os.platform(); // 'darwin', 'win32', 'linux'
    const osVersion = os.release();
    const arch = os.arch(); // 'x64', 'arm64', etc.

    // Determine device category
    let deviceCategory = 'desktop';
    if (platform === 'darwin') {
      deviceCategory = 'mac';
    } else if (platform === 'win32') {
      deviceCategory = 'windows';
    } else if (platform === 'linux') {
      deviceCategory = 'linux';
    }

    return {
      platform: platform,
      os_version: osVersion,
      device_category: deviceCategory,
      language: language.toLowerCase(),
      country: country.toUpperCase(),
      timezone: timezone,
      architecture: arch,
    };
  }

  /**
   * Send user properties once per session
   * This helps GA4 understand the user's environment
   */
  private async sendUserPropertiesOnce(): Promise<void> {
    if (this.userPropertiesSent || !this.enabled) return;

    const userProperties: Record<string, { value: string }> = {
      device_platform: { value: this.deviceInfo.platform },
      device_os_version: { value: this.deviceInfo.os_version },
      device_category: { value: this.deviceInfo.device_category },
      device_language: { value: this.deviceInfo.language },
      device_country: { value: this.deviceInfo.country },
      device_timezone: { value: this.deviceInfo.timezone },
      device_architecture: { value: this.deviceInfo.architecture },
      mcp_client_type: { value: 'claude_desktop' },
    };

    // Send a session_start event with user properties
    const payload = {
      client_id: this.persistentClientId,
      user_properties: userProperties,
      events: [{
        name: 'session_start',
        params: {
          session_id: this.sessionId,
          engagement_time_msec: 100,
          platform: 'mcp_server',
          app_name: 'aidd_mcp',
          app_version: '1.0.0',
          // Include device info in event params too for better reporting
          device_platform: this.deviceInfo.platform,
          device_country: this.deviceInfo.country,
          device_language: this.deviceInfo.language,
          device_timezone: this.deviceInfo.timezone,
        }
      }],
      timestamp_micros: Date.now() * 1000,
    };

    const url = this.endpoint;
    const queryParams = `?measurement_id=${this.measurementId}&api_secret=${this.apiSecret}`;

    try {
      await fetch(url + queryParams, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      this.userPropertiesSent = true;
      console.log('[GA4-MCP] User properties sent successfully');
    } catch (error) {
      console.error('[GA4-MCP] Error sending user properties:', error);
    }
  }

  /**
   * Get or create a persistent client ID for consistent GA4 tracking
   * Uses a hash of machine identifiers, stored in a local file for persistence
   */
  private getOrCreatePersistentClientId(): string {
    // Try to load existing client ID from file
    const configDir = path.join(os.homedir(), '.aidd-mcp');
    const clientIdFile = path.join(configDir, 'ga4-client-id');

    try {
      // Check if file exists and read it
      if (fs.existsSync(clientIdFile)) {
        const storedId = fs.readFileSync(clientIdFile, 'utf8').trim();
        if (storedId && storedId.startsWith('mcp.')) {
          return storedId;
        }
      }
    } catch {
      // File read failed, will generate new ID
    }

    // Generate a new persistent client ID based on machine characteristics
    const machineId = this.generateMachineId();
    const clientId = `mcp.${machineId}`;

    // Try to persist it
    try {
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(clientIdFile, clientId, 'utf8');
      console.log('[GA4-MCP] Created new persistent client ID');
    } catch {
      console.log('[GA4-MCP] Could not persist client ID, will use generated ID');
    }

    return clientId;
  }

  /**
   * Generate a stable machine identifier
   */
  private generateMachineId(): string {
    // Combine stable machine characteristics
    const hostname = os.hostname();
    const username = os.userInfo().username;
    const platform = os.platform();
    const arch = os.arch();
    // Use homedir as additional entropy (stable across sessions)
    const homedir = os.homedir();

    const combined = `${hostname}-${username}-${platform}-${arch}-${homedir}`;
    // Create a hash for privacy and consistent length
    return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32);
  }

  /**
   * Generate client ID for consistent tracking
   * Uses persistent client ID by default, or derives from userId if provided
   */
  private generateClientId(userId?: string): string {
    if (userId) {
      return `mcp.${userId}`;
    }
    // Return persistent client ID instead of random one
    return this.persistentClientId;
  }

  /**
   * Send event to GA4
   */
  async sendEvent(eventName: string, params: EventParams = {}, options: EventOptions = {}): Promise<void> {
    // Always log analytics state for debugging
    console.log(`[GA4-MCP] sendEvent called: ${eventName}, enabled=${this.enabled}, measurementId=${this.measurementId?.substring(0, 5)}...`);

    if (!this.enabled) {
      console.log(`[GA4-MCP] Analytics disabled - skipping: ${eventName}`, { measurementId: this.measurementId, hasSecret: !!this.apiSecret });
      return;
    }

    const payload: any = {
      client_id: options.clientId || this.generateClientId(options.userId),
      events: [{
        name: eventName,
        params: {
          ...params,
          engagement_time_msec: 100,
          // Use persistent session ID for consistent session tracking
          session_id: options.sessionId || this.sessionId,
          platform: 'mcp_server',
          app_name: 'aidd_mcp',
          app_version: '1.0.0',
          // MCP source - which AI platform is using this server (claude/chatgpt/other/unknown)
          mcp_source: this.mcpSource,
          // Include device/locale info for better GA4 reporting
          // (Measurement Protocol doesn't auto-detect these like gtag.js does)
          device_platform: this.deviceInfo.platform,
          device_category: this.deviceInfo.device_category,
          device_country: this.deviceInfo.country,
          device_language: this.deviceInfo.language,
          device_timezone: this.deviceInfo.timezone,
        }
      }],
      timestamp_micros: Date.now() * 1000,
    };

    if (options.userId) {
      payload.user_id = options.userId;
    }

    const url = this.debug ? this.debugEndpoint : this.endpoint;
    const queryParams = `?measurement_id=${this.measurementId}&api_secret=${this.apiSecret}`;

    try {
      console.log(`[GA4-MCP] Sending event to ${this.debug ? 'debug' : 'production'} endpoint...`);
      const response = await fetch(url + queryParams, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log(`[GA4-MCP] Event sent: ${eventName}, status=${response.status}`);

      if (this.debug && response.ok) {
        const data = await response.json();
        console.log('[GA4-MCP Debug]', JSON.stringify(data, null, 2));
      }
    } catch (error) {
      console.error('[GA4-MCP] Error sending event:', error);
      // Don't throw - analytics shouldn't break the MCP server
    }
  }

  /**
   * Track MCP tool usage
   */
  async trackToolUsage(toolName: string, success: boolean, executionTime?: number, options?: EventOptions): Promise<void> {
    await this.sendEvent('mcp_tool_usage', {
      tool_name: toolName,
      tool_success: success,
      tool_execution_time_ms: executionTime,
    }, options);
  }

  /**
   * Track Apple Notes operations
   */
  async trackNotesOperation(operation: string, noteCount: number, success: boolean, options?: EventOptions): Promise<void> {
    await this.sendEvent('apple_notes_operation', {
      notes_operation: operation,
      notes_count: noteCount,
      operation_success: success,
    }, options);
  }

  /**
   * Track AI processing through MCP (generic)
   */
  async trackAIProcessing(action: string, itemCount: number, processingTime: number, success: boolean, options?: EventOptions): Promise<void> {
    await this.sendEvent('mcp_ai_processing', {
      ai_action: action,
      ai_item_count: itemCount,
      ai_processing_time_ms: processingTime,
      ai_success: success,
    }, options);
  }

  /**
   * Track AI extraction - action items from notes (matches Web/iOS ai_extraction_completed)
   */
  async trackAIExtraction(data: {
    notes_count: number;
    action_items_extracted: number;
    model: string;
    processing_time: number;
    success: boolean;
  }, options?: EventOptions): Promise<void> {
    await this.sendEvent('ai_extraction_completed', {
      event_category: 'ai_processing',
      notes_count: data.notes_count,
      action_items_extracted: data.action_items_extracted,
      model: data.model,
      processing_time: data.processing_time,
      success: data.success,
    }, options);
  }

  /**
   * Track AI conversion - action items to tasks (matches Web/iOS ai_conversion_completed)
   */
  async trackAIConversion(data: {
    action_items_count: number;
    tasks_generated: number;
    model: string;
    processing_time: number;
    success: boolean;
  }, options?: EventOptions): Promise<void> {
    await this.sendEvent('ai_conversion_completed', {
      event_category: 'ai_processing',
      action_items_count: data.action_items_count,
      tasks_generated: data.tasks_generated,
      model: data.model,
      processing_time: data.processing_time,
      success: data.success,
    }, options);
  }

  /**
   * Track AI scoring - task prioritization (matches Web/iOS ai_scoring_completed)
   */
  async trackAIScoring(data: {
    tasks_count: number;
    model: string;
    processing_time: number;
    success: boolean;
  }, options?: EventOptions): Promise<void> {
    await this.sendEvent('ai_scoring_completed', {
      event_category: 'ai_processing',
      tasks_count: data.tasks_count,
      model: data.model,
      processing_time: data.processing_time,
      success: data.success,
    }, options);
  }

  /**
   * Track OAuth flows in MCP
   */
  async trackOAuthFlow(provider: string, action: string, success: boolean, errorMessage?: string, options?: EventOptions): Promise<void> {
    await this.sendEvent('mcp_oauth_flow', {
      oauth_provider: provider,
      oauth_action: action,
      oauth_success: success,
      oauth_error: errorMessage,
    }, options);
  }

  /**
   * Track integration sync
   */
  async trackIntegrationSync(provider: string, itemsCount: number, direction: 'import' | 'export', success: boolean, options?: EventOptions): Promise<void> {
    await this.sendEvent('mcp_integration_sync', {
      sync_provider: provider,
      sync_items_count: itemsCount,
      sync_direction: direction,
      sync_success: success,
    }, options);
  }

  /**
   * Track MCP server lifecycle
   */
  async trackServerEvent(event: 'start' | 'stop' | 'error', errorMessage?: string, options?: EventOptions): Promise<void> {
    await this.sendEvent('mcp_server_lifecycle', {
      server_event: event,
      server_error: errorMessage,
    }, options);
  }

  /**
   * Track MCP client connections
   */
  async trackClientConnection(event: 'connect' | 'disconnect', clientType?: string, options?: EventOptions): Promise<void> {
    await this.sendEvent('mcp_client_connection', {
      connection_event: event,
      client_type: clientType || 'unknown',
    }, options);
  }

  /**
   * Track task operations
   */
  async trackTaskOperation(operation: string, taskCount: number, success: boolean, options?: EventOptions): Promise<void> {
    await this.sendEvent('mcp_task_operation', {
      task_operation: operation,
      task_count: taskCount,
      task_operation_success: success,
    }, options);
  }

  /**
   * Track action item operations
   */
  async trackActionItemOperation(operation: string, itemCount: number, success: boolean, options?: EventOptions): Promise<void> {
    await this.sendEvent('mcp_action_item_operation', {
      action_item_operation: operation,
      action_item_count: itemCount,
      action_item_operation_success: success,
    }, options);
  }

  /**
   * Track errors
   */
  async trackError(errorType: string, errorMessage: string, fatal: boolean = false, options?: EventOptions): Promise<void> {
    await this.sendEvent('exception', {
      description: `${errorType}: ${errorMessage}`,
      fatal: fatal,
      error_type: errorType,
      error_source: 'mcp_server',
    }, options);
  }

  /**
   * Set user properties for better segmentation
   */
  async setUserProperties(userId: string, properties: Record<string, any>): Promise<void> {
    if (!this.enabled) return;

    const events = Object.entries(properties).map(([key, value]) => ({
      name: 'user_property_set',
      params: {
        user_property_name: key,
        user_property_value: String(value),
      }
    }));

    const payload = {
      client_id: this.generateClientId(userId),
      user_id: userId,
      user_properties: properties,
      events: events,
    };

    const url = this.endpoint;
    const queryParams = `?measurement_id=${this.measurementId}&api_secret=${this.apiSecret}`;

    try {
      await fetch(url + queryParams, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error('[GA4-MCP] Error setting user properties:', error);
    }
  }
}

// Singleton instance
let analyticsInstance: GA4Analytics | null = null;

/**
 * Initialize GA4 analytics for MCP server
 */
export function initializeAnalytics(config?: GA4Config): GA4Analytics {
  if (!analyticsInstance) {
    analyticsInstance = new GA4Analytics(config);
  }
  return analyticsInstance;
}

/**
 * Get analytics instance
 */
export function getAnalytics(): GA4Analytics {
  if (!analyticsInstance) {
    analyticsInstance = new GA4Analytics();
  }
  return analyticsInstance;
}

/**
 * Track MCP tool execution with timing
 */
export async function trackWithTiming<T>(
  toolName: string,
  operation: () => Promise<T>,
  options?: EventOptions
): Promise<T> {
  const analytics = getAnalytics();
  const startTime = Date.now();
  let success = false;

  try {
    const result = await operation();
    success = true;
    return result;
  } catch (error) {
    await analytics.trackError('mcp_tool_error', `${toolName}: ${error}`, false, options);
    throw error;
  } finally {
    const executionTime = Date.now() - startTime;
    await analytics.trackToolUsage(toolName, success, executionTime, options);
  }
}