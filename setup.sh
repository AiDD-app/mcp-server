#!/bin/bash

# AiDD Apple Notes MCP Server Setup Script
# This script installs and configures the Apple Notes MCP server for Claude Desktop

set -e

echo "🍎 AiDD Apple Notes MCP Server Setup"
echo "====================================="
echo ""

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ This MCP server only works on macOS (Apple Notes is required)"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Prerequisites checked"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Make the binary executable
chmod +x dist/index.js

echo ""
echo "✅ Installation complete!"
echo ""
echo "📝 Next steps:"
echo ""
echo "1. Add the following configuration to your Claude Desktop config:"
echo ""
echo "   Location: ~/Library/Application Support/Claude/claude_desktop_config.json"
echo ""
cat << 'EOF'
{
  "mcpServers": {
    "aidd-apple-notes": {
      "command": "node",
      "args": ["PATH_TO_THIS_DIRECTORY/dist/index.js"],
      "env": {}
    }
  }
}
EOF
echo ""
echo "   Replace PATH_TO_THIS_DIRECTORY with: $(pwd)"
echo ""
echo "2. Restart Claude Desktop"
echo ""
echo "3. Test the integration by asking Claude to:"
echo "   - 'List my Apple Notes folders'"
echo "   - 'Create a new note titled Test'"
echo "   - 'Search for notes containing TODO'"
echo ""
echo "🎉 Setup complete!"