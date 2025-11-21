#!/bin/bash

# AiDD MCP NPM Publishing Script
# This script publishes the AiDD MCP server to npm registry

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}🚀 AiDD MCP NPM Publishing Script${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check if already logged in to npm
echo -e "${BLUE}ℹ️  Checking npm login status...${NC}"
if ! npm whoami > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Not logged in to npm${NC}"
    echo -e "${BLUE}ℹ️  Please login to npm:${NC}"
    npm login
else
    NPM_USER=$(npm whoami)
    echo -e "${GREEN}✅ Logged in as: $NPM_USER${NC}"
fi

# Check package name availability
PACKAGE_NAME=$(node -p "require('./package.json').name")
echo ""
echo -e "${BLUE}ℹ️  Checking if package name '$PACKAGE_NAME' is available...${NC}"
if npm view "$PACKAGE_NAME" > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Package '$PACKAGE_NAME' already exists on npm${NC}"
    CURRENT_VERSION=$(npm view "$PACKAGE_NAME" version)
    echo -e "${BLUE}ℹ️  Current published version: $CURRENT_VERSION${NC}"
    echo -e "${BLUE}ℹ️  Local version: $(node -p "require('./package.json').version")${NC}"
    echo ""
    read -p "Continue with publish? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}❌ Publishing cancelled${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ Package name is available!${NC}"
fi

# Build the project
echo ""
echo -e "${BLUE}ℹ️  Building distribution files...${NC}"
npm run build
echo -e "${GREEN}✅ Build complete${NC}"

# Run dry-run to see what will be published
echo ""
echo -e "${BLUE}ℹ️  Running dry-run to preview package contents...${NC}"
npm pack --dry-run 2>&1 | tail -20
echo ""

# Ask for confirmation
echo -e "${YELLOW}⚠️  About to publish to npm registry${NC}"
echo -e "${BLUE}Package: $PACKAGE_NAME${NC}"
echo -e "${BLUE}Version: $(node -p "require('./package.json').version")${NC}"
echo ""
read -p "Proceed with publishing? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Publishing cancelled${NC}"
    exit 1
fi

# Publish to npm
echo ""
echo -e "${BLUE}ℹ️  Publishing to npm registry...${NC}"
npm publish --access public

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🎉 Successfully published to npm!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}✅ Package published as: $PACKAGE_NAME${NC}"
echo ""
echo -e "${CYAN}Users can now install in Claude Desktop:${NC}"
echo "  1. Open Claude Desktop"
echo "  2. Settings → MCP Servers → Add Server"
echo "  3. Package name: $PACKAGE_NAME"
echo "  4. Click Install"
echo ""
echo -e "${CYAN}Or manually add to config:${NC}"
echo '  {
    "mcpServers": {
      "AiDD": {
        "command": "npx",
        "args": ["'$PACKAGE_NAME'"],
        "env": {}
      }
    }
  }'
echo ""
echo -e "${GREEN}🚀 Your MCP is now available to the world!${NC}"