/**
 * Google Analytics 4 Integration for Claude MCP Server
 * Tracks usage of MCP tools and integrations
 */

import fetch from 'node-fetch';

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

export class GA4Analytics {
  private measurementId: string;
  private apiSecret: string;
  private enabled: boolean;
  private debug: boolean;
  private endpoint: string;
  private debugEndpoint: string;

  constructor(config?: GA4Config) {
    this.measurementId = config?.measurementId || process.env.GA_MEASUREMENT_ID || 'G-XXXXXXXXXX';
    this.apiSecret = config?.apiSecret || process.env.GA_API_SECRET || '';
    this.enabled = config?.enabled !== false && this.measurementId !== 'G-XXXXXXXXXX' && this.apiSecret !== '';
    this.debug = config?.debug || process.env.NODE_ENV === 'development';
    this.endpoint = 'https://www.google-analytics.com/mp/collect';
    this.debugEndpoint = 'https://www.google-analytics.com/debug/mp/collect';

    // Log initialization state (helpful for debugging env var issues)
    console.log('[GA4-MCP] Initialized:', {
      measurementId: this.measurementId?.substring(0, 5) + '...',
      hasApiSecret: !!this.apiSecret,
      enabled: this.enabled,
      debug: this.debug,
      nodeEnv: process.env.NODE_ENV
    });
  }

  /**
   * Generate client ID for consistent tracking
   */
  private generateClientId(userId?: string): string {
    if (userId) {
      return `mcp.${userId}`;
    }
    return `mcp.${Date.now()}.${Math.random().toString(36).substring(2)}`;
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
          session_id: options.sessionId || Date.now().toString(),
          platform: 'mcp_server',
          app_name: 'aidd_mcp',
          app_version: '1.0.0',
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