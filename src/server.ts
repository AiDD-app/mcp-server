#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { AiDDMCPServer } from './aidd-mcp-server.js';

const app = express();
const PORT = process.env.PORT || 8080;

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'AiDD MCP Web Connector',
    version: '4.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'AiDD MCP Web Connector',
    version: '4.0.0',
    description: 'ADHD-optimized productivity platform with AI-powered task management',
    endpoints: {
      health: '/health',
      mcp: '/mcp (POST with SSE)',
    },
    capabilities: [
      'Notes Management',
      'Action Items Extraction',
      'ADHD-Optimized Task Breakdown',
      'AI-Powered Task Prioritization',
      'Multi-Service Sync',
      'Apple Notes Integration (macOS only)',
    ],
  });
});

// MCP SSE endpoint
app.post('/mcp', async (req, res) => {
  console.log('📡 New MCP connection request');

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Create MCP server instance
  const mcpServer = new AiDDMCPServer();

  // Create SSE transport
  const transport = new SSEServerTransport('/mcp', res);

  // Connect server to transport
  await mcpServer.connect(transport);

  console.log('✅ MCP server connected via SSE');

  // Handle client disconnect
  req.on('close', () => {
    console.log('🔌 Client disconnected');
    mcpServer.close();
  });
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
║   Version: 4.0.0                                          ║
║   Port: ${PORT}                                              ║
║   Mode: Web Connector (HTTP/SSE)                          ║
║                                                            ║
║   Endpoints:                                              ║
║   • Health: http://localhost:${PORT}/health                  ║
║   • MCP: http://localhost:${PORT}/mcp                        ║
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
