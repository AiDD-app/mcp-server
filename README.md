# @aidd-app/mcp

**Official AiDD MCP Web Connector** - ADHD-optimized productivity platform accessible from Claude web, mobile, and desktop.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-4.0.0-blue.svg)](https://github.com/aidd-app/mcp-server)

## 🌐 Universal Access

Works everywhere Claude works:
- ✅ **Claude.ai** (desktop browsers)
- ✅ **Claude mobile apps** (iOS/Android)
- ✅ **Claude Desktop** (all platforms)

Simply connect via URL - no local installation required.

## Features

### 📝 Notes Management
- List, read, and create notes in your AiDD account
- Full-text search and pagination
- Categorization (work/personal) and tags

### ✅ Action Items (AI-Powered)
- **AI Extraction**: Extract action items from notes or text using Google Gemini
- List and read action items with priority/due dates
- Confidence scoring for each extracted item

### 🎯 ADHD-Optimized Tasks
- **AI Task Breakdown**: Convert action items into manageable subtasks
  - Automatic time estimates
  - Energy level requirements
  - Dependency tracking
  - Task type classification
- **AI Prioritization**: Smart task scoring
  - Urgency × Importance × Energy × ADHD compatibility
  - Time-of-day optimization
  - Personalized recommendations

### 🔐 Authentication
- Browser-based OAuth (Google, Microsoft, Apple)
- Email/password sign-in
- Automatic token refresh
- Secure cloud storage

### 📱 Integrations
- Google Tasks
- Microsoft To Do
- Trello, Todoist, Notion
- TickTick, Evernote

## Quick Start

### Using Hosted Service (Recommended)

**Production URL**: `https://mcp.aidd.app/mcp`

1. Open [claude.ai](https://claude.ai) → Settings
2. Navigate to "Connectors" or "MCP"
3. Click "Add Connector"
4. Enter URL: `https://mcp.aidd.app/mcp`
5. Save

That's it! Now use it:

```
You: connect
Claude: [opens browser for authentication]

You: list my tasks
Claude: [shows your AiDD tasks]

You: score my tasks and tell me what to work on next
Claude: [AI analyzes and prioritizes your tasks]
```

### Self-Hosting on Google Cloud Run

**Prerequisites**:
- Google Cloud account with billing enabled
- `gcloud` CLI installed

**One-Command Deploy**:

```bash
git clone https://github.com/aidd-app/mcp-server.git
cd mcp-server
chmod +x deploy-cloud-run.sh
./deploy-cloud-run.sh
```

Your service will be live at: `https://aidd-mcp-connector-<hash>.run.app`

## Available Tools

### Authentication
- `connect` - Sign in via browser OAuth
- `disconnect` - Sign out
- `status` - Check authentication status
- `check_backend_health` - Verify backend connectivity

### Notes
- `list_notes` - Browse notes (sortBy: createdAt/updatedAt/title)
- `read_note(noteId)` - Read specific note
- `create_note(title, content, tags?, category?)` - Create new note

### Action Items
- `list_action_items` - Browse action items
- `read_action_item(id)` - Read details
- `extract_action_items(source, noteIds?, text?)` - AI extraction
  - From notes: `source="notes", noteIds=["id1", "id2"]`
  - From text: `source="text", text="Your content..."`

### Tasks
- `list_tasks` - Browse tasks (sortBy: score/dueDate/createdAt)
- `read_task(taskId)` - Read task details
- `convert_to_tasks(actionItemIds?)` - AI task breakdown
- `score_tasks(considerCurrentEnergy?, timeOfDay?)` - AI prioritization

## Architecture

```
┌─────────────────┐
│   Claude        │ (web/mobile/desktop)
│   User          │
└────────┬────────┘
         │ HTTPS/SSE
         ↓
┌─────────────────┐
│   AiDD MCP      │ Cloud Run (auto-scale 1-10)
│   Web Connector │ Node.js 20, Express, CORS
└────────┬────────┘
         │ REST API
         ↓
┌─────────────────┐
│   AiDD Backend  │ Cloud Run (production)
│   - Firestore   │ - Notes, Tasks, Action Items
│   - Redis       │ - Sessions, Cache
│   - Gemini AI  │ - Extraction, Conversion, Scoring
└─────────────────┘
```

### Tech Stack
- **Runtime**: Node.js 20
- **Framework**: Express.js
- **Protocol**: MCP over HTTP/SSE
- **Transport**: Server-Sent Events
- **Auth**: OAuth 2.0 + JWT
- **AI**: Google Gemini (pro & flash)

## Development

### Local Testing

```bash
npm install
npm run dev
```

Server runs on `http://localhost:8080`

**Test endpoints**:
```bash
curl http://localhost:8080/health
curl http://localhost:8080/
```

### Docker Build

```bash
docker build -t aidd-mcp-connector .
docker run -p 8080:8080 aidd-mcp-connector
```

### Production Build

```bash
npm run build
npm start
```

## Subscription Tiers

| Tier | Notes/day | Action Items/day | AI Extraction/day | AI Scoring/day |
|------|-----------|------------------|-------------------|----------------|
| **FREE** | 100 | 50 | 20 | 10 |
| **PREMIUM** | 1,000 | 500 | 100 | 50 |
| **PRO** | Unlimited | Unlimited | Unlimited | Unlimited |

Upgrade at: [https://aidd.app/pricing](https://aidd.app/pricing)

## Security & Privacy

### Data Protection
- ✅ OAuth 2.0 with PKCE flow
- ✅ JWT tokens with auto-refresh
- ✅ HTTPS/TLS for all communication
- ✅ CORS locked to Claude domains
- ✅ Data encrypted at rest & in transit
- ✅ Rate limiting per subscription tier
- ✅ No third-party data sharing

### Your Privacy Matters

AiDD processes your notes, tasks, and action items to provide AI-powered productivity features. We take your privacy seriously:

- **No AI Training**: Your data is never used to train AI models (including Google Gemini)
- **Data Control**: Full GDPR compliance with data export and deletion rights
- **Secure Storage**: All data encrypted and stored on Google Cloud Platform
- **Minimal Processing**: AI processing happens on-demand, data is not retained beyond necessary operations
- **Transparent Usage**: Clear documentation of what data is processed and why

**📋 Full Privacy Policy**: [https://aidd.app/privacy](https://aidd.app/privacy)

**🔒 Data Processing Details**:
- Notes content: Processed for AI extraction, never stored in AI systems
- Action items: Generated by AI, stored encrypted in your account
- Tasks: AI-scored for prioritization, scores stored with task data
- Authentication: OAuth tokens stored securely, no passwords retained

## Production Deployment

### Cloud Run Best Practices

```yaml
Service: aidd-mcp-connector
Region: us-central1
Memory: 1Gi
CPU: 1 vCPU
Min instances: 1    # Warm instance for low latency
Max instances: 10   # Auto-scale under load
Timeout: 300s       # 5min for AI operations
Concurrency: 80     # Requests per container
```

### Environment Variables

```bash
NODE_ENV=production
PORT=8080
```

### Custom Domain

```bash
gcloud run domain-mappings create \
  --service aidd-mcp-connector \
  --domain mcp.yourdomain.com \
  --region us-central1
```

### Monitoring

View metrics in [GCP Console](https://console.cloud.google.com/run):
- Request count & latency
- Error rates
- Container instances
- Memory/CPU usage

## Troubleshooting

### "Connection Failed"
1. Check health: `curl https://your-url/health`
2. Verify CORS: claude.ai must be in allowed origins
3. Check logs: `gcloud run services logs read --limit 50`

### "Authentication Error"
1. Use `connect` tool in Claude
2. Allow popup windows
3. Try incognito mode (clear cookies)

### "Rate Limit Exceeded"
- Upgrade subscription tier
- Check quota: `status` tool shows limits

## Why Web Connector?

**vs Desktop Extension:**
- ❌ Desktop: macOS/Windows/Linux only, local install required
- ✅ Web: Works everywhere (mobile, web, desktop)

**vs Separate MCPs:**
- You can combine AiDD with other MCP connectors
- Example: Use with [Apple Notes MCP](https://github.com/gongrzhe/claude-apple-notes-mcp) for macOS users
- Claude orchestrates between multiple MCPs automatically

## Combining with Apple Notes MCP

**For macOS users who want Apple Notes integration:**

1. Install AiDD MCP (web connector - this repo)
2. Install [Apple Notes MCP](https://github.com/gongrzhe/claude-apple-notes-mcp) (desktop-only)

Then Claude can orchestrate:

```
You: Import my Apple Notes into AiDD and prioritize them

Claude will:
1. Use Apple Notes MCP to read your notes (macOS)
2. Use AiDD MCP to save them to your account (web)
3. Use AiDD MCP's AI to extract action items (web)
4. Use AiDD MCP's AI to prioritize tasks (web)
```

This modular approach keeps AiDD cross-platform while allowing optional platform-specific features.

## Support

- 🌐 Website: [aidd.app](https://aidd.app)
- 📧 Email: support@aidd.app
- 🐛 Issues: [GitHub](https://github.com/aidd-app/mcp-server/issues)
- 📚 Docs: [docs.aidd.app](https://docs.aidd.app)

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT © AiDD Team

## Changelog

### v4.0.0 (2025-01-22) - Web Connector Edition
- 🌐 **Breaking**: Transitioned from stdio to HTTP/SSE transport
- 📱 **New**: Universal access (web, mobile, desktop)
- ☁️ **New**: Cloud Run deployment with auto-scaling
- 🔒 **Enhanced**: CORS for Claude domains
- ❌ **Removed**: Apple Notes integration (use separate MCP)
- ⚡ **Improved**: Cloud-native observability

### v3.0.0 (2025-01-15)
- CRUD-based architecture
- 11 comprehensive tools
- Direct backend integration
- Enhanced AI features

### v2.0.0 (2025-01-10)
- Browser-based OAuth
- Multi-provider sign-in

### v1.0.0 (2025-01-05)
- Initial release

---

**Made with ❤️ by the AiDD Team for the ADHD community**

*Transform your notes into actionable tasks, from anywhere, on any device.*
