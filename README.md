# @aidd-app/mcp

Official AiDD MCP Server for Claude Desktop - Seamless integration with Apple Notes, AI-powered task processing, and multi-service synchronization.

## Features

### 🍎 Apple Notes Integration
- **Create Notes**: Create new notes with titles, content, folders, and tags
- **Search Notes**: Search across all notes with advanced filtering options
- **Read Notes**: Read note content with optional metadata
- **Update Notes**: Update existing notes or append content
- **Delete Notes**: Safely delete notes with confirmation
- **Folder Management**: List and organize folders

### 🤖 AI-Powered Processing
- **Action Item Extraction**: Automatically extract TODO items and tasks from notes
- **Smart Prioritization**: AI-powered task prioritization for ADHD optimization
- **Bulk Processing**: Import multiple notes at once for batch processing
- **Intelligent Categorization**: Automatic tagging and organization

### 🔐 OAuth Authentication
- **Browser-Based Login**: Secure authentication through your browser
- **Multiple Providers**: Google, Microsoft, Apple, and Email/Password
- **Automatic Token Refresh**: Stay connected without re-authentication
- **Encrypted Storage**: Secure credential management

### 📱 Multi-Service Sync
- Google Tasks
- Microsoft To Do
- Trello
- Todoist
- Notion
- TickTick
- Evernote

## Installation

### Easy Installation via Claude Desktop UI

1. Open Claude Desktop
2. Go to Settings → MCP Servers → Add Server
3. Enter package name: `@aidd-app/mcp`
4. Click Install
5. Restart Claude Desktop

### Manual Installation

Add the following to your `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "AiDD": {
      "command": "npx",
      "args": ["@aidd-app/mcp"],
      "env": {}
    }
  }
}
```

## Usage

### First Time Setup

1. In Claude, type: `connect`
2. Your browser will open for authentication
3. Sign in with your AiDD account:
   - Google Sign-In
   - Microsoft Sign-In
   - Apple Sign-In
   - Email/Password

### Available Commands

- `connect` - Sign in to your AiDD account
- `status` - Check your connection and subscription status
- `start_workflow` - Begin importing and processing Apple Notes
- `list_notes` - View your Apple Notes
- `import_notes` - Import notes for AI processing
- `extract_action_items` - Extract tasks from your notes
- `sync_tasks` - Sync to your connected services

## Requirements

- macOS (for Apple Notes integration)
- Node.js 18+
- Claude Desktop
- AiDD account (free or premium)

## Subscription Tiers

- **FREE** - Basic features with limited AI processing
- **PREMIUM** - Enhanced AI features and faster processing
- **PRO** - Unlimited processing and priority support

## Security

- OAuth 2.0 authentication
- Encrypted credential storage
- No passwords stored locally
- Automatic token refresh
- Session-based security

## Support

- Website: [https://aidd.app](https://aidd.app)
- Email: support@aidd.app
- Issues: [GitHub Issues](https://github.com/aidd-app/mcp-server/issues)

## License

MIT © AiDD Team

## Privacy

Your notes and tasks are processed securely. We never store your Apple Notes content. All AI processing happens through secure APIs with temporary data handling.

---

Made with ❤️ by the AiDD Team for the ADHD community
