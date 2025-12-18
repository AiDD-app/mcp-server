# ChatGPT App Store Submission Guide

## App Information

| Field | Value |
|-------|-------|
| **App Name** | AiDD |
| **Display Name** | AiDD - ADHD Task Manager |
| **Version** | 4.4.0 |
| **Category** | Productivity |
| **MCP Endpoint** | `https://mcp.aidd.app/mcp` |

## App Description

### Short Description (100 chars)
ADHD-optimized productivity with AI-powered task management, action item extraction, and smart prioritization.

### Long Description
AiDD helps people with ADHD manage tasks more effectively by breaking down overwhelming projects into manageable pieces.

**Key Features:**
- **AI-Powered Action Item Extraction** - Automatically identify actionable items from notes, emails, or pasted text
- **ADHD-Optimized Task Breakdown** - Convert action items into smaller, manageable tasks with time estimates and energy requirements
- **Smart Task Prioritization** - AI scoring factors in urgency, importance, due dates, and your current energy level
- **Notes Management** - Full-text search, categorization, and tagging
- **Cross-Platform Sync** - Access your tasks from ChatGPT, Claude, iOS app, or web dashboard

**Why AiDD is Different:**
- Designed specifically for ADHD minds - no overwhelming lists
- Energy-aware scheduling - matches tasks to your current state
- Quick wins first - builds momentum with achievable tasks
- Dependency tracking - know what to do and in what order

## Tool Annotations Compliance

All 21 MCP tools are properly annotated per OpenAI guidelines:

### Read-Only Tools (readOnlyHint: true, openWorldHint: false)
| Tool | Description |
|------|-------------|
| `list_notes` | List notes with optional sorting and pagination |
| `read_note` | Read a specific note |
| `list_action_items` | List action items with sorting/pagination |
| `read_action_item` | Read a specific action item |
| `list_tasks` | List tasks with sorting/pagination |
| `read_task` | Read a specific task |
| `check_ai_jobs` | Monitor AI processing job status |
| `session_status` | Check authentication and subscription status |
| `aidd_overview_tutorial` | Get help and tutorial content |

### Write Tools (readOnlyHint: false, destructiveHint: false, openWorldHint: false)
| Tool | Description |
|------|-------------|
| `create_note` | Create a new note |
| `create_action_item` | Create a new action item |
| `create_task` | Create a new task manually |
| `extract_action_items` | AI extraction from notes/text |
| `convert_to_tasks` | Convert action items to ADHD-optimized tasks |
| `score_tasks` | AI scoring for prioritization |
| `update_note` | Update an existing note |
| `update_action_item` | Update an existing action item |
| `update_task` | Update an existing task |

### Destructive Tools (readOnlyHint: false, destructiveHint: true, openWorldHint: false)
| Tool | Description |
|------|-------------|
| `delete_notes` | Delete one or more notes |
| `delete_action_items` | Delete action items (cascades to tasks) |
| `delete_tasks` | Delete one or more tasks |

### openWorldHint Justification
All tools have `openWorldHint: false` because:
- Tools only access the user's private AiDD account data
- No operations post to public platforms or external systems
- No social media sharing or public content creation
- All data stays within the user's authenticated session

## Authentication

| Type | Details |
|------|---------|
| Protocol | OAuth 2.0 with PKCE (S256) |
| Discovery | `https://mcp.aidd.app/.well-known/openid-configuration` |
| OAuth Metadata | `https://mcp.aidd.app/.well-known/oauth-authorization-server` |
| Sign-in Methods | Google, Microsoft, Apple, Email/Password |

### OAuth Flow
1. User clicks "Connect" in ChatGPT
2. Redirect to `https://mcp.aidd.app/oauth/authorize`
3. User authenticates via preferred provider
4. Authorization code returned to ChatGPT
5. Token exchange at `https://mcp.aidd.app/oauth/token`
6. Access token used for MCP requests

## Privacy & Security

| Requirement | Implementation |
|-------------|----------------|
| Privacy Policy | https://aidd.app/privacy |
| Terms of Service | https://aidd.app/terms |
| Data Encryption | AES-256 at rest |
| E2E Encryption | Optional, user-controlled |
| Compliance | GDPR, CCPA, SOC 2 Type II |
| AI Training | User data is NEVER used for AI model training |
| Data Sales | User data is NEVER sold to third parties |

## Pricing Model

| Tier | Price | Features |
|------|-------|----------|
| **Free** | $0 | 1 AI scoring/month, 3 extractions/week |
| **PRO** | $4.99/mo | Unlimited scoring, 200 extractions/week, auto-scoring |
| **Premium** | $9.99/mo | Everything in PRO + advanced features |

Monetization: Users upgrade via external link to https://web.aidd.app/subscription

## Test Scenarios

### Scenario 1: Create and Extract
1. User says: "Create a note about planning a birthday party"
2. Expected: `create_note` called, note created with ID returned
3. User says: "Extract action items from that note"
4. Expected: `extract_action_items` called with noteId, action items extracted

### Scenario 2: Convert and Prioritize
1. User says: "Convert those action items to tasks"
2. Expected: `convert_to_tasks` called with actionItemIds
3. User says: "Score my tasks for today"
4. Expected: `score_tasks` called, job ID returned

### Scenario 3: Read Operations
1. User says: "Show me my tasks"
2. Expected: `list_tasks` called with default parameters
3. User says: "What's my authentication status?"
4. Expected: `session_status` called

### Scenario 4: Update and Delete
1. User says: "Mark that task as completed"
2. Expected: `update_task` called with `isCompleted: true`
3. User says: "Delete all completed tasks"
4. Expected: Confirmation requested, then `delete_tasks` called

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /` | Service info and capabilities |
| `GET /health` | Health check |
| `POST /mcp` | MCP protocol endpoint (SSE) |
| `GET /app-metadata` | App store metadata |
| `GET /icon.png` | App icon (64x64) |
| `GET /.well-known/openid-configuration` | OpenID Connect discovery |
| `GET /.well-known/oauth-authorization-server` | OAuth 2.0 metadata |
| `GET /oauth/authorize` | OAuth authorization |
| `POST /oauth/token` | Token exchange |
| `GET /oauth/userinfo` | User profile info |
| `POST /register` | Dynamic client registration |

## Country Availability

Available worldwide (no geo-restrictions)

## Release Notes (v4.4.0)

### New in This Version
- Full ChatGPT App Store compatibility
- Added `openWorldHint` annotations to all tools
- OpenID Connect discovery endpoint
- UserInfo endpoint for profile retrieval
- App metadata endpoint for store listing
- Enhanced CORS for ChatGPT/OpenAI domains

### Previous Highlights (v4.3.x)
- Async AI processing for large operations
- Auto-scoring for PRO subscribers
- Cascade deletion for action items
- E2E encryption support
- Cross-platform sync (iOS, Web, MCP)

## Contact Information

| Type | Contact |
|------|---------|
| Support Email | support@aidd.app |
| Developer Email | dev@aidd.app |
| Website | https://aidd.app |
| Documentation | https://github.com/AiDD-app/mcp-server |

## Submission Checklist

- [x] Tool annotations correctly set (readOnlyHint, destructiveHint, openWorldHint)
- [x] Privacy policy URL valid and accessible
- [x] Terms of service URL valid and accessible
- [x] OAuth 2.0 with PKCE implemented
- [x] OpenID Connect discovery endpoint
- [x] App icon available (64x64, 128x128)
- [x] All tools tested and functional
- [x] CORS configured for ChatGPT/OpenAI domains
- [x] Rate limiting implemented
- [x] Error handling for all tool calls
- [ ] Submit via OpenAI Developer Platform
