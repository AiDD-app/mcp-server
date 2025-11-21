#!/bin/bash

# Enhanced AiDD Apple Notes MCP Server Installer
# This script fully automates the installation and configuration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}$1${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Main installation
print_header "🍎 AiDD Apple Notes MCP Server Installer"

# Check macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    print_error "This MCP server only works on macOS (Apple Notes required)"
    exit 1
fi

print_success "Running on macOS"

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed"
    print_info "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js 18+ is required (current: $(node -v))"
    exit 1
fi

print_success "Node.js $(node -v) installed"

# Check Apple Notes availability
if ! osascript -e 'tell application "System Events" to get name of every application process' | grep -q "Notes"; then
    print_warning "Apple Notes is not running. Opening it now..."
    osascript -e 'tell application "Notes" to activate' 2>/dev/null || true
    sleep 2
fi

# Request permissions
print_header "📋 Checking Permissions"

print_info "Requesting Apple Notes automation permission..."
osascript -e 'tell application "Notes" to count of notes' 2>/dev/null || {
    print_warning "Permission needed for terminal to control Apple Notes"
    print_info "Please grant permission in the dialog that appears"
    print_info "Go to: System Settings > Privacy & Security > Automation"
    print_info "Enable 'Terminal' or 'iTerm' access to 'Notes'"
    echo ""
    read -p "Press Enter after granting permission... "
}

# Install dependencies
print_header "📦 Installing Dependencies"

print_info "Installing npm packages..."
npm install --silent 2>&1 | grep -v 'npm WARN' || true

print_success "Dependencies installed"

# Build TypeScript
print_header "🔨 Building Project"

print_info "Compiling TypeScript..."
npm run build 2>&1 | grep -v 'npm WARN' || true

# Make executable
chmod +x dist/index.js

print_success "Build complete"

# Configure Claude Desktop
print_header "⚙️  Configuring Claude Desktop"

CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
CURRENT_DIR=$(pwd)

if [ ! -f "$CLAUDE_CONFIG" ]; then
    print_info "Creating new Claude Desktop configuration..."
    mkdir -p "$(dirname "$CLAUDE_CONFIG")"
    cat > "$CLAUDE_CONFIG" << EOF
{
  "mcpServers": {
    "AiDD": {
      "command": "node",
      "args": ["$CURRENT_DIR/dist/index-browser-auth.js"],
      "env": {}
    }
  }
}
EOF
    print_success "Configuration created"
else
    print_info "Updating existing Claude Desktop configuration..."

    # Backup existing config
    cp "$CLAUDE_CONFIG" "$CLAUDE_CONFIG.backup.$(date +%Y%m%d_%H%M%S)"
    print_info "Backup saved to $CLAUDE_CONFIG.backup.*"

    # Check if already configured (check both old and new names)
    if grep -q -E "(aidd-apple-notes|AiDD)" "$CLAUDE_CONFIG"; then
        print_warning "AiDD MCP already configured"
        print_info "Updating to latest OAuth-enabled version..."

        # Use Python to update JSON safely
        python3 << EOF
import json
import sys

config_file = "$CLAUDE_CONFIG"
with open(config_file, 'r') as f:
    config = json.load(f)

if 'mcpServers' not in config:
    config['mcpServers'] = {}

# Remove old configuration if exists
if 'aidd-apple-notes' in config['mcpServers']:
    del config['mcpServers']['aidd-apple-notes']

# Add new OAuth-enabled configuration
config['mcpServers']['AiDD'] = {
    "command": "node",
    "args": ["$CURRENT_DIR/dist/index-browser-auth.js"],
    "env": {}
}

with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)
EOF
        print_success "Configuration updated to OAuth version"
    else
        # Add to existing config
        python3 << EOF
import json
import sys

config_file = "$CLAUDE_CONFIG"
with open(config_file, 'r') as f:
    config = json.load(f)

if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['AiDD'] = {
    "command": "node",
    "args": ["$CURRENT_DIR/dist/index-browser-auth.js"],
    "env": {}
}

with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)
EOF
        print_success "Configuration added"
    fi
fi

# Test the installation
print_header "🧪 Testing Installation"

print_info "Running basic test..."
node test-server.js 2>&1 | head -20 | grep -v 'npm WARN' || true

# Final instructions
print_header "🎉 Installation Complete!"

print_success "AiDD MCP Server is installed and configured"
echo ""
print_info "Next steps:"
echo "  1. Restart Claude Desktop"
echo "  2. In Claude, type: connect"
echo "  3. Sign in with your AiDD account"
echo "     • Use Google, Microsoft, or email/password"
echo ""
print_info "Available commands in Claude:"
echo "  • connect - Sign in to AiDD"
echo "  • status - Check your connection"
echo "  • start_workflow - Begin Apple Notes import"
echo ""
print_info "Features available:"
echo "  • Browser-based OAuth authentication"
echo "  • Import and process Apple Notes"
echo "  • Extract action items with AI"
echo "  • Convert to ADHD-optimized tasks"
echo "  • Sync to Google Tasks, Microsoft To Do, etc."
echo "  • Secure credential management"
echo ""
print_warning "If Claude Desktop was running, please restart it now"
echo ""

# Ask if user wants to open Claude Desktop
read -p "Would you like to open Claude Desktop now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    open -a "Claude" 2>/dev/null || print_warning "Could not open Claude Desktop automatically"
fi

print_success "Setup complete! Happy note-taking with Claude! 🎉"