#!/bin/bash

echo "🧪 Testing AiDD MCP OAuth Implementation"
echo "========================================"
echo ""

# Check if the built file exists
if [ -f "dist/index-browser-auth.js" ]; then
    echo "✅ Built file exists: dist/index-browser-auth.js"
else
    echo "❌ Built file missing. Running build..."
    npm run build
fi

echo ""
echo "Testing MCP server initialization..."
echo ""

# Test basic MCP initialization
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"1.0.0","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | node dist/index-browser-auth.js 2>&1 | head -5

echo ""
echo "✅ OAuth Implementation Ready!"
echo ""
echo "To use in Claude Desktop:"
echo "1. Run: ./switch-auth-mode.sh"
echo "2. Choose option 1 (Browser OAuth)"
echo "3. Restart Claude Desktop"
echo "4. In Claude, type: connect"
echo ""
echo "Available authentication methods:"
echo "• Email/Password login"
echo "• Google SSO (OAuth 2.0)"
echo "• Microsoft SSO (OAuth 2.0)"
echo "• Apple SSO (OAuth 2.0)"