# @aidd-app/mcp - Web Connector Edition

Official AiDD MCP **Web Connector** - Comprehensive ADHD-optimized productivity platform accessible from **Claude web, mobile, and desktop**.

## 🌐 What's New in v4.0

**WEB CONNECTOR MODE** - Now accessible from anywhere:
- ✅ Claude.ai (desktop browsers)
- ✅ Claude.ai (mobile browsers)
- ✅ Claude mobile apps (iOS/Android)
- ✅ Claude Desktop (as before)

**Architecture Change**: HTTP/SSE transport instead of stdio, deployed on Google Cloud Run for global accessibility.

## Features

### 📝 Notes Management
- **List Notes**: Browse all notes from your AiDD account with pagination
- **Read Notes**: Get detailed note content including metadata
- **Create Notes**: Create new notes directly in your AiDD account
- **Import from Apple Notes**: Import Apple Notes into your AiDD account (macOS only)

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
- **Secure Storage**: Credentials stored securely in the cloud

### 📱 Multi-Service Sync
- Google Tasks
- Microsoft To Do
- Trello
- Todoist
- Notion
- TickTick
- Evernote

## Installation & Deployment

### Option 1: Use Hosted Service (Recommended)

Simply connect to the hosted AiDD MCP Web Connector:

**URL**: `https://mcp.aidd.app/mcp`

1. Go to [claude.ai](https://claude.ai) settings
2. Add MCP connector
3. Enter URL: `https://mcp.aidd.app/mcp`
4. Save and start using!

### Option 2: Self-Host on Cloud Run

**Prerequisites**:
- Google Cloud account
- `gcloud` CLI installed
- Docker installed (for local testing)

**Quick Deploy**:

```bash
# Clone repository
git clone https://github.com/aidd-app/mcp-server.git
cd mcp-server

# Make deployment script executable
chmod +x deploy-cloud-run.sh

# Deploy to Cloud Run
./deploy-cloud-run.sh
```

The script will:
1. Build the container image
2. Deploy to Cloud Run
3. Configure auto-scaling (1-10 instances)
4. Set up health checks
5. Return your service URL

**Manual Deploy**:

```bash
# Set your GCP project
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export SERVICE_NAME="aidd-mcp-connector"

# Build and deploy
gcloud builds submit --tag gcr.io/${PROJECT_ID}/${SERVICE_NAME}

gcloud run deploy ${SERVICE_NAME} \
  --image gcr.io/${PROJECT_ID}/${SERVICE_NAME} \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --min-instances 1 \
  --max-instances 10
```

### Option 3: Local Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Or build and run
npm run build
npm start
```

Server runs on `http://localhost:8080`

## Usage

### Connecting from Claude.ai

1. **Open Claude Settings**
   - Go to [claude.ai](https://claude.ai)
   - Click your profile → Settings

2. **Add MCP Connector**
   - Navigate to "Integrations" or "MCP"
   - Click "Add Connector"
   - Enter connector URL: `https://mcp.aidd.app/mcp` (or your self-hosted URL)

3. **Authenticate**
   - In Claude chat, type: `connect`
   - Your browser will open for authentication
   - Sign in with: Google, Microsoft, Apple, or Email/Password
   - Return to Claude

4. **Start Using**
   - Type: `status` to verify connection
   - Type: `list_notes` to see your notes
   - Type: `score_tasks` to prioritize tasks

### Available Tools

#### Authentication & Status
- `connect` - Sign in to your AiDD account via browser
- `disconnect` - Sign out and remove credentials
- `status` - Check connection, subscription, and token expiry
- `check_backend_health` - Verify backend service status

#### Notes Management
- `list_notes` - List all notes with pagination
- `read_note` - Read specific note by ID
- `create_note` - Create new note
- `import_apple_notes` - Import Apple Notes (requires macOS)

#### Action Items Management
- `list_action_items` - List all action items
- `read_action_item` - Read specific action item
- `extract_action_items` - Extract action items using AI

#### Tasks Management
- `list_tasks` - List all tasks
- `read_task` - Read specific task
- `convert_to_tasks` - Convert action items to ADHD-optimized tasks
- `score_tasks` - AI-powered task prioritization

## Architecture

### Backend Infrastructure
- **Platform**: Google Cloud Run (Node.js 20)
- **Database**: Google Cloud Firestore
- **Session Storage**: Google Cloud Memorystore (Redis)
- **AI Models**: Google Gemini (`gemini-3-pro-preview`, `gemini-2.5-flash`)
- **Transport**: HTTP + Server-Sent Events (SSE)
- **API Endpoint**: `https://aidd-backend-prod-739193356129.us-central1.run.app`

### Data Flow
1. **Authentication**: Browser OAuth → Backend JWT → Cloud storage
2. **CRUD Operations**: MCP Tool → HTTP POST → Backend API → Firestore
3. **AI Processing**: Tool Request → Async Job → SSE Updates → Completion
4. **Progress Tracking**: Real-time updates via Server-Sent Events

### Web Connector Endpoints

- `GET /` - Service information
- `GET /health` - Health check
- `POST /mcp` - MCP protocol endpoint (SSE)

## Requirements

- **Client**: Any modern browser or Claude mobile app
- **Server** (self-hosted): Node.js 18+, Docker, GCP account
- **Account**: AiDD account (free or premium)

## Subscription Tiers

- **FREE** - Basic features with rate limits
  - Notes: 100/day
  - Action Items: 50/day
  - AI Extraction: 20/day
  - AI Scoring: 10/day

- **PREMIUM** - Enhanced AI features
  - Notes: 1,000/day
  - Action Items: 500/day
  - AI Extraction: 100/day
  - AI Scoring: 50/day

- **PRO** - Unlimited processing
  - All features unlimited
  - Priority queue
  - Dedicated support

## Security

- OAuth 2.0 authentication with PKCE flow
- JWT tokens with automatic refresh
- HTTPS/TLS for all communication
- CORS configured for Claude domains
- Session-based security with Redis
- Rate limiting per subscription tier

## Deployment Best Practices

### Cloud Run Configuration

**Recommended settings**:
```yaml
Memory: 1Gi
CPU: 1 vCPU
Min instances: 1 (for quick response)
Max instances: 10 (auto-scale)
Timeout: 300s (for AI processing)
Concurrency: 80
```

### Environment Variables

```bash
NODE_ENV=production
PORT=8080
```

### Custom Domain (Optional)

```bash
gcloud run domain-mappings create \
  --service aidd-mcp-connector \
  --domain mcp.yourdomain.com \
  --region us-central1
```

### Monitoring

Cloud Run provides built-in monitoring:
- Request count
- Latency
- Error rate
- Container instances

Access via: [GCP Console → Cloud Run → Your Service → Metrics](https://console.cloud.google.com/run)

## Troubleshooting

### Connection Issues
- Run health check: `curl https://your-url/health`
- Check CORS: Verify claude.ai is in allowed origins
- Test locally: `npm run dev` and test with `http://localhost:8080`

### Authentication Issues
- Use `connect` tool in Claude
- Check browser popup blockers
- Verify redirect URLs in OAuth settings

### Deployment Issues
- Verify `gcloud` authentication: `gcloud auth list`
- Check project ID: `gcloud config get-value project`
- View logs: `gcloud run services logs read --limit 50`

## Migration from Desktop to Web

If you were using the desktop version (v3.x):

**Changes**:
- ❌ No more `claude_desktop_config.json`
- ❌ No more `npx @aidd-app/mcp`
- ✅ Use URL instead: `https://mcp.aidd.app/mcp`

**Benefits**:
- ✅ Works on mobile
- ✅ Works in browser
- ✅ No local installation
- ✅ Always up to date
- ✅ Better performance (cloud infrastructure)

## Development

### Build from Source

```bash
git clone https://github.com/aidd-app/mcp-server.git
cd mcp-server
npm install
npm run build
npm start
```

### Docker Build

```bash
docker build -t aidd-mcp-connector .
docker run -p 8080:8080 aidd-mcp-connector
```

### Testing

```bash
# Test health endpoint
curl http://localhost:8080/health

# Test root endpoint
curl http://localhost:8080/
```

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
- Notes and tasks stored securely in Google Cloud Firestore
- All data encrypted at rest and in transit
- No data shared with third parties
- Full Privacy Policy: [https://www.aidd.app/privacy](https://www.aidd.app/privacy)

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

## Changelog

### Version 4.0.0 (Latest) - Web Connector Edition
- **🌐 Major Architecture Change**: Transitioned from stdio to HTTP/SSE transport
- **📱 Universal Access**: Now works on web, mobile, and desktop Claude
- **☁️ Cloud Deployment**: Deployed on Google Cloud Run for global accessibility
- **🔒 Enhanced Security**: CORS configured for Claude domains
- **📊 Better Monitoring**: Cloud-native observability and metrics
- **⚡ Improved Performance**: Auto-scaling infrastructure

### Version 3.0.0
- Major architecture change to CRUD-based operations
- 11 comprehensive tools for notes, action items, and tasks
- Direct backend integration
- Enhanced AI features
- Improved performance with async processing

### Version 2.0.0
- Browser-based OAuth authentication
- Multi-provider sign-in support
- Encrypted credential storage

### Version 1.0.0
- Initial release
- Apple Notes integration
- Basic AI processing
- Task synchronization

---

Made with ❤️ by the AiDD Team for the ADHD community

**Transform your notes into actionable tasks, from anywhere, on any device.**
