#!/bin/bash

# AiDD MCP Server - GitHub Repository Setup (Personal Account)
# Creates the repository under your personal account for now

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

echo "📦 Creating repository under your personal account..."

# Create the repository under personal account
gh repo create aidd-mcp-server \
    --public \
    --description "Official AiDD MCP Server for Claude Desktop - Seamless Apple Notes integration with AI-powered task processing" \
    --homepage "https://aidd.app" \
    --clone \
    --add-readme=false

if [ $? -ne 0 ]; then
    echo "❌ Failed to create repository. The repository might already exist."
    echo "Attempting to clone existing repository..."
    gh repo clone aidd-mcp-server
    cd aidd-mcp-server
else
    cd aidd-mcp-server
fi

echo "📁 Copying files to repository..."

# Copy all necessary files
cp -r /tmp/aidd-app-mcp-server/* .
cp /tmp/aidd-app-mcp-server/.gitignore .
cp /tmp/aidd-app-mcp-server/.npmignore .

# Update package.json to point to personal repo temporarily
echo "📝 Updating package.json with repository URL..."
GITHUB_USER=$(gh api user --jq .login)
sed -i '' "s|https://github.com/aidd-app/mcp-server|https://github.com/$GITHUB_USER/aidd-mcp-server|g" package.json

echo "📝 Adding GitHub-specific files..."

# Create LICENSE if it doesn't exist
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
- ADHD-optimized features
- Published on npm as @aidd-app/mcp"

# Push to GitHub
echo "📤 Pushing to GitHub..."
git branch -M main
git push -u origin main

echo ""
echo "✅ Repository created successfully!"
echo "=================================================="
echo ""
echo "📦 Repository: https://github.com/$GITHUB_USER/aidd-mcp-server"
echo "📦 npm Package: @aidd-app/mcp"
echo ""
echo "Next Steps:"
echo ""
echo "1. Create the aidd-app organization on GitHub:"
echo "   https://github.com/organizations/new"
echo ""
echo "2. Transfer the repository to the organization:"
echo "   - Go to https://github.com/$GITHUB_USER/aidd-mcp-server/settings"
echo "   - Scroll to 'Danger Zone'"
echo "   - Click 'Transfer ownership'"
echo "   - Enter 'aidd-app' as the new owner"
echo "   - Rename to 'mcp-server'"
echo ""
echo "3. Update the PR #3009:"
echo "   The PR already references https://github.com/aidd-app/mcp-server"
echo "   Once you transfer the repo, the link will be valid!"
echo ""
echo "🎉 Your MCP server repository is ready!"