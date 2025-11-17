#!/bin/bash

# AiDD MCP Server - GitHub Repository Setup Script
# This script creates the repository under the aidd-app organization

echo "🚀 Setting up GitHub repository for AiDD MCP Server"
echo "=================================================="

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed."
    echo "Please install it first: brew install gh"
    exit 1
fi

# Check if logged in to GitHub
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub."
    echo "Please run: gh auth login"
    exit 1
fi

echo "📦 Creating repository under aidd-app organization..."

# Create the repository under aidd-app organization
gh repo create aidd-app/mcp-server \
    --public \
    --description "Official AiDD MCP Server for Claude Desktop - Seamless Apple Notes integration with AI-powered task processing" \
    --homepage "https://aidd.app" \
    --clone \
    --add-readme=false

if [ $? -ne 0 ]; then
    echo "❌ Failed to create repository. The repository might already exist."
    echo "Would you like to clone the existing repository instead? (y/n)"
    read -r response
    if [ "$response" = "y" ]; then
        gh repo clone aidd-app/mcp-server
        cd mcp-server
    else
        exit 1
    fi
else
    cd mcp-server
fi

echo "📁 Copying files to repository..."

# Copy all necessary files
cp -r /tmp/aidd-app-mcp-server/* .
cp /tmp/aidd-app-mcp-server/.gitignore .
cp /tmp/aidd-app-mcp-server/.npmignore .

echo "📝 Adding GitHub-specific files..."

# Create a proper LICENSE file if it doesn't exist
if [ ! -f LICENSE ]; then
    cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2024 AiDD

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF
fi

# Create GitHub workflow for npm publishing
mkdir -p .github/workflows
cat > .github/workflows/npm-publish.yml << 'EOF'
name: Publish to npm

on:
  release:
    types: [created]
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{secrets.NPM_TOKEN}}
EOF

echo "🔧 Setting up Git..."

# Initialize git if needed
if [ ! -d .git ]; then
    git init
fi

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: AiDD MCP Server for Claude Desktop

- Apple Notes integration via AppleScript
- OAuth 2.0 browser-based authentication
- AI-powered task processing
- Multi-service sync support
- ADHD-optimized features"

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push -u origin main

echo ""
echo "✅ Repository setup complete!"
echo "=================================================="
echo ""
echo "📦 Repository: https://github.com/aidd-app/mcp-server"
echo "📦 npm Package: @aidd-app/mcp"
echo ""
echo "Next Steps:"
echo "1. ✅ Repository is now live at https://github.com/aidd-app/mcp-server"
echo "2. ✅ The PR to MCP servers list will now have a valid repository link"
echo "3. 📝 Add NPM_TOKEN secret to GitHub repository for automated publishing:"
echo "   - Go to https://github.com/aidd-app/mcp-server/settings/secrets/actions"
echo "   - Add secret named 'NPM_TOKEN' with your npm access token"
echo ""
echo "To update the PR with the correct repository URL:"
echo "  The PR #3009 already references the correct URL!"
echo ""
echo "🎉 Your MCP server is ready for distribution!"