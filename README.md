# @aidd-app/mcp

Official AiDD MCP Server for Claude Desktop - Comprehensive ADHD-optimized productivity platform with AI-powered task management, action item extraction, Apple Notes integration, and multi-service synchronization.

## Features

### 📝 Notes Management
- **List Notes**: Browse all notes from your AiDD account with pagination
- **Read Notes**: Get detailed note content including metadata
- **Create Notes**: Create new notes directly in your AiDD account
- **Import from Apple Notes**: Import Apple Notes into your AiDD account

### ✅ Action Items Management
- **List Action Items**: View all extracted action items with filtering
- **Read Action Items**: Get detailed information about specific action items
- **AI Extraction**: Extract action items from notes using Gemini AI
  - Extract from all notes at once
  - Extract from a specific note
  - Extract from user-provided text

### 🎯 Tasks Management (ADHD-Optimized)
- **List Tasks**: View all tasks with flexible sorting (by score, due date)
- **Read Tasks**: Get detailed task information including subtasks
- **AI Conversion**: Convert action items to ADHD-optimized task breakdowns
  - Automatic task decomposition into manageable steps
  - Energy level estimation
  - Dependency tracking
  - Time estimates
- **AI Scoring**: Intelligent task prioritization using Gemini AI
  - ADHD-optimized scoring algorithm
  - Considers urgency, importance, energy, and context
  - Automatic rescoring of all tasks

### 🤖 AI-Powered Intelligence
- **Google Gemini Integration**: All AI processing powered by Gemini models
  - `gemini-3-pro-preview` for complex scoring and prioritization
  - `gemini-2.5-flash` for fast extraction and conversion
- **Real-time Progress Tracking**: Server-sent events for live updates
- **Async Job Processing**: Handle large datasets efficiently

### 🔐 OAuth Authentication
- **Browser-Based Login**: Secure authentication through your browser
- **Multiple Providers**: Google, Microsoft, Apple, and Email/Password
- **Automatic Token Refresh**: Stay connected without re-authentication
- **Encrypted Storage**: Secure credential management at `~/.aidd-mcp/auth-credentials.json`

### 📱 Multi-Service Sync
- Google Tasks
- Microsoft To Do
- Trello
- Todoist
- Notion
- TickTick
- Evernote

### 🏥 Backend Health Monitoring
- Real-time backend service status
- Connection health checks
- Subscription tier verification

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
4. Check your status: `status`

### Available Tools

#### Authentication & Status
- `connect` - Sign in to your AiDD account via browser
- `disconnect` - Sign out and remove credentials
- `status` - Check connection, subscription, and token expiry
- `check_backend_health` - Verify backend service status

#### Notes Management
- `list_notes` - List all notes with pagination
  - Optional: `limit`, `offset`, `search` parameters
- `read_note` - Read specific note by ID
- `create_note` - Create new note with title and content
  - Optional: `tags`, `category`, `priority`
- `import_apple_notes` - Import Apple Notes into AiDD
  - Optional: `folder` to import from specific folder

#### Action Items Management
- `list_action_items` - List all action items
  - Optional: `limit`, `offset`, `status` filters
- `read_action_item` - Read specific action item by ID
- `extract_action_items` - Extract action items using AI
  - From all notes: `extract_action_items`
  - From specific note: `extract_action_items(noteId="abc123")`
  - From text: `extract_action_items(text="Your content here")`

#### Tasks Management
- `list_tasks` - List all tasks
  - Optional: `sortBy` ("score" or "dueDate"), `limit`, `offset`
- `read_task` - Read specific task by ID
- `convert_to_tasks` - Convert action items to ADHD-optimized tasks
  - Convert all: `convert_to_tasks`
  - Convert specific: `convert_to_tasks(actionItemIds=["id1", "id2"])`
- `score_tasks` - AI-powered task prioritization
  - Rescores all tasks using Gemini AI
  - Returns updated scores and rationale

## Architecture

### Backend Infrastructure
- **Platform**: Google Cloud Run (Node.js 20)
- **Database**: Google Cloud Firestore
- **Session Storage**: Google Cloud Memorystore (Redis)
- **AI Models**: Google Gemini (`gemini-3-pro-preview`, `gemini-2.5-flash`)
- **Authentication**: OAuth 2.0 with JWT tokens
- **API Endpoint**: `https://aidd-backend-prod-739193356129.us-central1.run.app`

### Data Flow
1. **Authentication**: Browser OAuth → Backend JWT → Secure storage
2. **CRUD Operations**: MCP Tool → Backend API → Firestore
3. **AI Processing**: Tool Request → Async Job → SSE Updates → Completion
4. **Progress Tracking**: Real-time updates via Server-Sent Events

## Requirements

- macOS (for Apple Notes import feature)
- Node.js 18+
- Claude Desktop
- AiDD account (free or premium)

## Subscription Tiers

- **FREE** - Basic features with rate limits
  - Notes: 100/day
  - Action Items: 50/day
  - AI Extraction: 20/day
  - AI Scoring: 10/day

- **PREMIUM** - Enhanced AI features and faster processing
  - Notes: 1,000/day
  - Action Items: 500/day
  - AI Extraction: 100/day
  - AI Scoring: 50/day

- **PRO** - Unlimited processing and priority support
  - All features unlimited
  - Priority queue for AI processing
  - Dedicated support

## Security

- OAuth 2.0 authentication with PKCE flow
- JWT tokens with automatic refresh
- Encrypted credential storage locally
- No passwords stored in plain text
- HTTPS/TLS for all API communication
- Session-based security with Redis
- Rate limiting per subscription tier

## API Resources

The MCP server exposes the following resources that Claude can access:

- `aidd://notes` - All notes from your account (JSON)
- `aidd://action-items` - All action items (JSON)
- `aidd://tasks` - All ADHD-optimized tasks (JSON)
- `aidd://backend/health` - Backend service health status (JSON)

## Development

### Build from Source

```bash
git clone https://github.com/aidd-app/mcp-server.git
cd mcp-server
npm install
npm run build
npm start
```

### Testing

```bash
npm test
```

## Troubleshooting

### Connection Issues
- Run `check_backend_health` to verify backend status
- Check `status` to see if your auth token is expired
- Try `disconnect` followed by `connect` to refresh authentication

### Apple Notes Import
- Ensure you have granted Apple Notes permissions
- Check System Settings → Privacy & Security → Automation
- AiDD MCP must have permission to access Apple Notes

### AI Processing Timeouts
- Large batches may take several minutes
- Progress updates are sent via Server-Sent Events
- Check your subscription tier for rate limits

## Support

- Website: [https://aidd.app](https://aidd.app)
- Email: support@aidd.app
- Issues: [GitHub Issues](https://github.com/aidd-app/mcp-server/issues)
- Documentation: [https://docs.aidd.app](https://docs.aidd.app)

## License

MIT © AiDD Team

## Privacy

Your data privacy is our top priority.

### Data Processing
- Notes and tasks are stored securely in Google Cloud Firestore
- Apple Notes content is only accessed when you explicitly import
- AI processing happens on secure backend servers with encryption in transit
- Authentication tokens stored locally at `~/.aidd-mcp/auth-credentials.json`
- No data is shared with third parties except as outlined in our Privacy Policy
- All data encrypted at rest and in transit

### Data Retention
- Notes, action items, and tasks persist in your account
- Session data expires after 30 days of inactivity
- You can delete your data anytime via the app or by contacting support

For detailed information, please review our [Privacy Policy](https://www.aidd.app/privacy).

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

## Changelog

### Version 3.0.0 (Latest)
- **Major Architecture Change**: Transitioned from workflow-based to CRUD-based operations
- **New Tools**: Added 11 comprehensive tools for notes, action items, and tasks management
- **Direct Backend Integration**: All operations now directly interact with AiDD backend API
- **Enhanced AI Features**: Separate tools for extraction, conversion, and scoring
- **Improved Performance**: Async processing with real-time progress updates
- **Resource Access**: Exposed 4 MCP resources for data access

### Version 2.0.0
- Browser-based OAuth authentication
- Multi-provider sign-in support
- Encrypted credential storage
- Automatic token refresh

### Version 1.0.0
- Initial release
- Apple Notes integration
- Basic AI processing
- Task synchronization

---

Made with ❤️ by the AiDD Team for the ADHD community

**Transform your notes into actionable tasks, optimized for how your brain works.**
