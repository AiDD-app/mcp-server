# ✅ AiDD Apple Notes MCP Server - Setup Complete!

## 🎉 Installation Status

The AiDD Apple Notes MCP server has been successfully installed and configured for Claude Desktop! Here's what was set up:

### ✅ Completed Setup Steps

1. **Created MCP Server** (`/Users/marcfridson/Documents/AiDD/claude-apple-notes-mcp/`)
   - Full TypeScript implementation with 9 tools
   - Resource endpoints for quick access
   - AppleScript integration for native Apple Notes control

2. **Installed Dependencies**
   - @modelcontextprotocol/sdk for MCP protocol
   - TypeScript build system configured
   - AppleScript utilities for macOS integration

3. **Built Project**
   - TypeScript compiled to JavaScript
   - Executable server ready at `dist/index.js`

4. **Configured Claude Desktop**
   - Added to `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Server name: `aidd-apple-notes`
   - Ready for immediate use

## 🚀 Quick Start

### Step 1: Restart Claude Desktop
**This is required for the changes to take effect!**

```bash
# Either close and reopen Claude Desktop, or run:
osascript -e 'quit app "Claude"' && sleep 2 && open -a "Claude"
```

### Step 2: Test Basic Functionality

Try these commands in Claude:

1. **List your folders**:
   "Show me all my Apple Notes folders"

2. **Search notes**:
   "Search my notes for TODO items"

3. **Create a test note**:
   "Create a new note titled 'Claude Test' with content 'Testing MCP integration'"

4. **Extract action items**:
   "Extract all action items and tasks from my notes"

## 📋 Available Features

### Core Tools
| Command | Example Usage |
|---------|--------------|
| Create Note | "Create a note titled 'Meeting Notes' in my Work folder" |
| Search Notes | "Find all notes containing 'project deadline'" |
| Read Note | "Read my note titled 'Weekly Tasks'" |
| Update Note | "Append 'Call client at 3pm' to my Tasks note" |
| Delete Note | "Delete the note titled 'Old Draft'" |
| List Folders | "Show me all my Apple Notes folders" |
| Extract Action Items | "Extract all TODO items from my notes" |
| Export Notes | "Export all notes from last week as Markdown" |
| Bulk Import | "Import these meeting notes into my Work folder" |

### Resource Access
You can ask Claude to access these resources directly:
- **Recent Notes**: "Show me my recently modified notes"
- **Folders**: "List all my note folders"
- **Action Items**: "Get all action items from my notes"
- **Statistics**: "Show me statistics about my notes"

## 🔧 Troubleshooting

### If Claude doesn't recognize Apple Notes commands:

1. **Check Claude Desktop is restarted**
   - Must restart after configuration changes

2. **Verify configuration**:
   ```bash
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | grep aidd-apple-notes
   ```

3. **Check permissions**:
   - Go to System Settings > Privacy & Security > Automation
   - Ensure Terminal/iTerm has permission to control Notes

4. **Test the server directly**:
   ```bash
   cd /Users/marcfridson/Documents/AiDD/claude-apple-notes-mcp
   node test-server.js
   ```

### Common Issues

**"Apple Notes not responding"**
- Open Apple Notes manually first
- Grant automation permissions when prompted

**"MCP server not found"**
- Restart Claude Desktop
- Check the path in config is correct

**"Permission denied"**
- macOS requires explicit permission for automation
- Check System Settings > Privacy & Security

## 🎯 AiDD Integration Features

This MCP server is specifically designed for AiDD integration:

### Action Item Processing
- Automatically extracts TODOs, TASKs, and ACTION items
- Recognizes markdown task lists `- [ ] Task`
- Identifies priority indicators and due dates
- Formats output for AiDD's Gemini AI backend

### Task Synchronization
- Import notes as AiDD action items
- Convert notes to ADHD-optimized task breakdowns
- Maintain sync between Apple Notes and AiDD app

### Batch Operations
- Bulk import from various sources
- Export in formats compatible with AiDD (JSON, Markdown)
- Process multiple notes for action item extraction

## 📁 File Locations

- **MCP Server**: `/Users/marcfridson/Documents/AiDD/claude-apple-notes-mcp/`
- **Configuration**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Logs**: Check Console.app for "Claude" or "Notes" entries

## 🔄 Updates & Maintenance

### To update the server:
```bash
cd /Users/marcfridson/Documents/AiDD/claude-apple-notes-mcp
git pull  # If using git
npm install
npm run build
# Restart Claude Desktop
```

### To modify features:
1. Edit TypeScript files in `src/`
2. Run `npm run build`
3. Restart Claude Desktop

## 💡 Pro Tips

1. **Use natural language** - Claude understands context:
   - "Add a reminder to buy milk to my shopping list note"
   - "Find all notes from last week about the project"

2. **Combine operations**:
   - "Search for all TODO items and create a new note with them"
   - "Export my Work folder notes and extract action items"

3. **Leverage resources**:
   - "What are my most recent notes?" (uses `notes://recent`)
   - "Show me my notes statistics" (uses `notes://stats`)

## 🎉 You're All Set!

The AiDD Apple Notes MCP server is ready to use. Just restart Claude Desktop and start managing your notes with natural language commands!

For more advanced usage, check the [README.md](./README.md) file.

---

**Need Help?** The server includes comprehensive error handling and will guide you through any permission or setup issues as they arise.