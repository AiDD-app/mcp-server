#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AiDDMCPServer } from './aidd-mcp-server.js';

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://mcp.aidd.app';

// Middleware
app.use(cors({
  origin: [
    'https://claude.ai',
    'https://*.claude.ai',
    'https://*.anthropic.com',
    /^https:\/\/claude\.ai/,
    /^https:\/\/.*\.claude\.ai/,
  ],
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Support form-encoded OAuth requests

// ============================================================================
// OAUTH 2.0 DISCOVERY ENDPOINTS (for Claude.ai integration)
// ============================================================================

// OAuth 2.0 Authorization Server Metadata
// RFC 8414: https://datatracker.ietf.org/doc/html/rfc8414
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    registration_endpoint: `${BASE_URL}/register`,
    scopes_supported: ['profile', 'email', 'tasks', 'notes', 'action_items'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    // Icon/logo fields for Claude connector display
    logo_uri: `${BASE_URL}/icon.png`,
    service_documentation: `${BASE_URL}`,
  });
});

// OAuth 2.0 Protected Resource Metadata
// RFC 9068: https://datatracker.ietf.org/doc/html/rfc9068
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({
    resource: BASE_URL,
    authorization_servers: [BASE_URL],
    scopes_supported: ['profile', 'email', 'tasks', 'notes', 'action_items'],
    bearer_methods_supported: ['header'],
    resource_signing_alg_values_supported: ['RS256'],
  });
});

// Alternative paths with /mcp suffix (Claude tries both)
app.get('/.well-known/oauth-authorization-server/mcp', (req, res) => {
  res.redirect('/.well-known/oauth-authorization-server');
});

app.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
  res.redirect('/.well-known/oauth-protected-resource');
});

// OAuth 2.0 Dynamic Client Registration
// RFC 7591: https://datatracker.ietf.org/doc/html/rfc7591
app.post('/register', (req, res) => {
  const { redirect_uris, client_name } = req.body;

  // For Claude.ai, we auto-approve the registration
  // In production, you'd validate and store this
  const clientId = `claude_${Date.now()}`;
  const clientSecret = Buffer.from(`secret_${Date.now()}`).toString('base64');

  res.json({
    client_id: clientId,
    client_secret: clientSecret,
    client_name: client_name || 'Claude AI',
    redirect_uris: redirect_uris || [],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  });
});

// OAuth signin redirect (Claude.ai sometimes uses /oauth/signin)
app.get('/oauth/signin', (req, res) => {
  console.log('🔄 Redirecting /oauth/signin to /oauth/authorize');
  // Preserve all query parameters
  const queryString = req.url.split('?')[1] || '';
  res.redirect(`/oauth/authorize${queryString ? '?' + queryString : ''}`);
});

// OAuth Authorization Endpoint
app.get('/oauth/authorize', (req, res) => {
  const {
    client_id,
    redirect_uri,
    state,
    response_type,
    scope,
    code_challenge,
    code_challenge_method,
  } = req.query;

  console.log('📝 OAuth authorize request:', { client_id, redirect_uri, state });

  // Redirect to AiDD backend OAuth with Claude's callback in state
  const backendAuthUrl = new URL('https://aidd-backend-prod-739193356129.us-central1.run.app/oauth/authorize');

  // Store Claude's callback info in state for later redirect
  const stateData = {
    claude_redirect: redirect_uri,
    claude_state: state,
    claude_client_id: client_id,
    code_challenge,
    code_challenge_method,
  };
  const encodedState = Buffer.from(JSON.stringify(stateData)).toString('base64url');

  backendAuthUrl.searchParams.append('client_id', 'aidd-mcp-client');  // Use the client_id that backend expects
  backendAuthUrl.searchParams.append('redirect_uri', `${BASE_URL}/oauth/callback`);
  backendAuthUrl.searchParams.append('state', encodedState);
  backendAuthUrl.searchParams.append('response_type', 'code');
  if (scope) {
    backendAuthUrl.searchParams.append('scope', scope as string);
  }

  res.redirect(backendAuthUrl.toString());
});

// OAuth Callback Endpoint (receives code from AiDD backend)
app.get('/oauth/callback', (req, res) => {
  const { code, state } = req.query;

  console.log('🔄 OAuth callback received:', { code: code ? 'present' : 'missing', state });

  try {
    // Decode state to get Claude's original redirect URI
    const stateData = JSON.parse(Buffer.from(state as string, 'base64url').toString());
    const { claude_redirect, claude_state } = stateData;

    // Redirect back to Claude with the authorization code
    const claudeCallbackUrl = new URL(claude_redirect);
    claudeCallbackUrl.searchParams.append('code', code as string);
    claudeCallbackUrl.searchParams.append('state', claude_state);

    console.log('↩️  Redirecting to Claude:', claudeCallbackUrl.toString());
    res.redirect(claudeCallbackUrl.toString());
  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    res.status(400).send('Invalid state parameter');
  }
});

// OAuth Token Endpoint
app.post('/oauth/token', async (req, res) => {
  const { grant_type, code, refresh_token, redirect_uri, client_id, code_verifier } = req.body;

  console.log('🔑 Token request:', { grant_type, code: code ? 'present' : 'missing' });

  try {
    if (grant_type === 'authorization_code') {
      // Exchange code for token via backend OAuth endpoint
      const response = await fetch(
        'https://aidd-backend-prod-739193356129.us-central1.run.app/oauth/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            client_id: 'aidd-mcp-client',  // Backend expects this specific client_id
            redirect_uri: `${BASE_URL}/oauth/callback`,
            code_verifier
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json() as any;
        console.error('❌ Token exchange failed:', response.status, errorData);
        // Pass through the backend's actual error
        return res.status(400).json(errorData || { error: 'invalid_grant' });
      }

      const data = await response.json() as any;
      console.log('✅ Token exchange successful');

      res.json({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: 'Bearer',
        expires_in: 2592000, // 30 days
        scope: 'profile email tasks notes action_items',
      });
    } else if (grant_type === 'refresh_token') {
      // Refresh token via backend OAuth endpoint
      const response = await fetch(
        'https://aidd-backend-prod-739193356129.us-central1.run.app/oauth/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token,
            client_id: 'aidd-mcp-client'  // Backend expects this specific client_id
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json() as any;
        console.error('❌ Refresh token failed:', response.status, errorData);
        // Pass through the backend's actual error
        return res.status(400).json(errorData || { error: 'invalid_grant' });
      }

      const data = await response.json() as any;
      res.json({
        access_token: data.access_token,
        token_type: 'Bearer',
        expires_in: 2592000,
      });
    } else {
      res.status(400).json({ error: 'unsupported_grant_type' });
    }
  } catch (error) {
    console.error('❌ Token endpoint error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

// ============================================================================
// STANDARD ENDPOINTS
// ============================================================================

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'AiDD MCP Web Connector',
    version: '4.0.2',
    buildTimestamp: process.env.BUILD_TIMESTAMP || 'unknown',
    toolCount: 20,
    timestamp: new Date().toISOString(),
  });
});

// Icon endpoint - serve optimized PNG (64x64 for better UI display)
app.get('/icon.png', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow cross-origin for Claude
  res.sendFile('icon-64.png', { root: '.' });
});

// Larger 128x128 icon
app.get('/icon-128.png', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile('icon.png', { root: '.' });
});

// Alternative paths Claude might check
app.get('/logo.png', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile('icon-64.png', { root: '.' });
});

app.get('/.well-known/logo', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'image/png');
  res.sendFile('icon-64.png', { root: '.' });
});

// Favicon endpoint (Claude may look for this)
app.get('/favicon.ico', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'image/png'); // Serve PNG as favicon
  res.sendFile('favicon-32.png', { root: '.' });
});

// Legacy icon endpoint (redirect to new path)
app.get('/icon', (req, res) => {
  res.redirect('/icon.png');
});

// Root endpoint - HEAD support for protocol discovery
app.head('/', (req, res) => {
  res.setHeader('X-MCP-Version', '2024-11-05');
  res.setHeader('X-MCP-Transport', 'sse');
  res.status(200).end();
});

// Root endpoint
app.get('/', (req, res) => {
  res.setHeader('X-MCP-Version', '2024-11-05');
  res.setHeader('X-MCP-Transport', 'sse');
  res.json({
    name: 'AiDD MCP Web Connector',
    version: '4.0.2',
    description: 'ADHD-optimized productivity platform with AI-powered task management',
    icon: `${BASE_URL}/icon.png`,
    endpoints: {
      health: '/health',
      mcp: '/mcp (POST with SSE)',
      icon: '/icon.png',
      oauth: {
        discovery: '/.well-known/oauth-authorization-server',
        register: '/register (POST)',
        authorize: '/oauth/authorize',
        token: '/oauth/token (POST)',
      },
    },
    capabilities: [
      'Notes Management',
      'Action Items Extraction',
      'ADHD-Optimized Task Breakdown',
      'AI-Powered Task Prioritization',
      'Multi-Service Sync',
    ],
  });
});

// MCP endpoint - HEAD support for protocol discovery
app.head('/mcp', (req, res) => {
  res.setHeader('X-MCP-Version', '2024-11-05');
  res.setHeader('X-MCP-Transport', 'sse');
  res.status(200).end();
});

// MCP endpoint - GET support for endpoint verification
app.get('/mcp', (req, res) => {
  res.setHeader('X-MCP-Version', '2024-11-05');
  res.setHeader('X-MCP-Transport', 'sse');
  res.json({
    name: 'AiDD',
    version: '4.0.2',
    protocol: 'mcp',
    protocolVersion: '2024-11-05',
    transport: 'sse',
    description: 'ADHD-optimized productivity platform with AI-powered task management',
    icon: `${BASE_URL}/icon.png`,
    capabilities: [
      'notes',
      'action-items',
      'tasks',
      'ai-extraction',
      'ai-conversion',
      'ai-scoring',
    ],
    authentication: {
      type: 'oauth2',
      methods: ['google', 'microsoft', 'apple', 'email'],
      discoveryUrl: `${BASE_URL}/.well-known/oauth-authorization-server`,
    },
    instructions: 'Use POST to establish SSE connection for MCP protocol communication',
  });
});

// MCP Streamable HTTP endpoint
app.post('/mcp', async (req, res) => {
  console.log('📡 New MCP connection request');
  console.log('📋 Request method:', req.body?.method);
  console.log('📋 Request ID:', req.body?.id);

  // Extract OAuth token from Authorization header
  const authHeader = req.headers.authorization;
  let accessToken: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    accessToken = authHeader.substring(7);
    console.log('🔑 OAuth token detected in request');
  } else {
    console.log('❌ No OAuth token in request - OAuth is required for web connector');

    // Return 401 to force OAuth authentication
    res.status(401).json({
      error: 'unauthorized',
      error_description: 'OAuth authentication required. Please authenticate via the OAuth flow.',
      authentication_required: true,
      authorization_endpoint: `${BASE_URL}/oauth/authorize`,
      token_endpoint: `${BASE_URL}/oauth/token`,
    });
    return;
  }

  try {
    // Create MCP server instance with OAuth token
    console.log('📦 Creating MCP server instance...');
    const mcpServer = new AiDDMCPServer(accessToken);
    console.log('✅ MCP server instance created');

    // Create Streamable HTTP transport (stateless mode for Cloud Run)
    console.log('🔌 Creating Streamable HTTP transport...');
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode for Cloud Run
      enableJsonResponse: true,      // Support both JSON and SSE responses
    });
    console.log('✅ Streamable HTTP transport created');

    // Connect server to transport
    console.log('🔗 Connecting MCP server to transport...');
    await mcpServer.connect(transport);
    console.log('✅ MCP server connected');

    // Handle the request using StreamableHTTPServerTransport
    console.log('📨 Processing MCP request via transport.handleRequest()...');
    await transport.handleRequest(req, res, req.body);
    console.log('✅ MCP request processed successfully');

    // Handle client disconnect
    req.on('close', () => {
      console.log('🔌 Client disconnected');
      try {
        transport.close();
        mcpServer.close();
      } catch (error) {
        console.error('❌ Error closing MCP server:', error);
      }
    });

    // Handle server errors
    req.on('error', (error) => {
      console.error('❌ Request error:', error);
      try {
        transport.close();
        mcpServer.close();
      } catch (err) {
        console.error('❌ Error closing MCP server after request error:', err);
      }
    });
  } catch (error) {
    console.error('❌ MCP error:', error);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');

    // Close the response if not already sent
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal server error',
        },
        id: req.body?.id,
      });
    }
  }
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 AiDD MCP Web Connector                               ║
║                                                            ║
║   Version: 4.0.2                                          ║
║   Port: ${PORT}                                              ║
║   Mode: Web Connector (HTTP/SSE + OAuth)                  ║
║                                                            ║
║   Endpoints:                                              ║
║   • Health: http://localhost:${PORT}/health                  ║
║   • MCP: http://localhost:${PORT}/mcp                        ║
║   • OAuth Discovery: /.well-known/oauth-authorization-server ║
║   • Client Registration: /register                        ║
║                                                            ║
║   Status: ✅ Ready for Claude web & mobile                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully...');
  process.exit(0);
});
