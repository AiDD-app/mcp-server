# @aidd-app/mcp

**Official AiDD MCP Web Connector** - ADHD-optimized productivity platform accessible from Claude web, mobile, and desktop.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-4.3.7-blue.svg)](https://github.com/aidd-app/mcp-server)

## 🌐 Universal Access

Works everywhere Claude works:
- ✅ **Claude.ai** (desktop browsers)
- ✅ **Claude mobile apps** (iOS/Android)
- ✅ **Claude Desktop** (all platforms)

Simply connect via URL - no local installation required.

## Features

### 📝 Notes Management
- List, read, create, **update**, and **delete** notes in your AiDD account
- Full-text search and pagination
- Categorization (work/personal) and tags
- Batch delete support

### ✅ Action Items (AI-Powered)
- **AI Extraction**: Extract action items from notes or text using Google Gemini
- List, read, **update**, and **delete** action items with priority/due dates
- Confidence scoring for each extracted item
- Batch delete support

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
- **Full CRUD**: Create, read, **update**, and **delete** tasks
- Batch delete support

### 🚀 Async AI Processing (New in v4.1.0)
- AI operations run in background by default for better UX
- No timeout issues for large data sets
- Check results in 2-3 minutes with `list_tasks`
- Optional `waitForCompletion` parameter for small batches

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

---

## 📚 Realistic Usage Examples

### Example 1: Morning Task Planning with Energy Levels

**Scenario**: You want to plan your workday based on your current energy level.

```
You: "I just woke up and have high energy. What should I work on this morning?"

Claude: [Uses score_tasks with timeOfDay="morning", considerCurrentEnergy=true]

Response:
🎯 Tasks Scored & Prioritized

Top Priority Tasks (Next 2 Hours):
1. Complete quarterly performance reviews (Score: 95/100)
   • Urgency: 9/10
   • Importance: 9/10
   • Energy Match: High ✓
   📝 Best tackled now while your focus is sharp

2. Draft project proposal for Q2 (Score: 89/100)
   • Urgency: 7/10
   • Importance: 9/10
   • Time: 45 min
   📝 Complex task - ideal for morning energy

🌅 Morning Schedule (High Energy):
  • Complete quarterly performance reviews
  • Draft project proposal for Q2
  • Review architecture decisions
```

### Example 2: Meeting Notes to Action Items

**Scenario**: You just finished a team meeting and have raw notes to process.

```
You: "I just finished a team meeting. Here are my notes:
     - John will send the budget report by Friday
     - Need to schedule client demo for next week
     - Sarah mentioned the API is having issues, investigate
     - Book conference room for quarterly planning
     - Follow up with marketing on campaign results"

Claude: [Uses extract_action_items with source="text"]

Response:
🔍 Action Items Extracted

Summary:
• Source: provided text
• Extraction mode: adhd-optimized
• Action items found: 5

Extracted Action Items:
1. Follow up on budget report from John
   • Priority: high
   • Category: work
   • Confidence: 92%
   • Due: Friday

2. Schedule client demo
   • Priority: high
   • Category: work
   • Confidence: 95%
   • Due: Next week

3. Investigate API issues
   • Priority: high
   • Category: work
   • Confidence: 88%
   • Tags: technical, bug

4. Book conference room for quarterly planning
   • Priority: medium
   • Category: work
   • Confidence: 90%

5. Follow up with marketing on campaign results
   • Priority: medium
   • Category: work
   • Confidence: 87%

Action items have been saved to your AiDD account.
```

### Example 3: Converting Action Items to ADHD-Friendly Tasks

**Scenario**: You have action items but need them broken down into manageable steps.

```
You: "Convert my action items to tasks with ADHD-optimized breakdown"

Claude: [Uses convert_to_tasks with breakdownMode="adhd-optimized"]

Response:
🚀 AI Conversion Started

Converting 5 action items to ADHD-optimized tasks in the background.

What's happening:
• AI is breaking down action items into manageable tasks
• Tasks are being optimized for ADHD-friendly execution
• Each action item may generate multiple subtasks

Check your results:
⏱️ Check back in 2-3 minutes - use the `list_tasks` tool to see your converted tasks.
```

### Example 4: Updating and Deleting Items

**Scenario**: You need to modify or clean up your task list.

```
You: "Mark task abc123 as completed and delete the old action items I'm done with"

Claude: [Uses update_task to mark complete, then delete_action_items]

Response:
✅ Task Updated

Updated task: Complete quarterly report
• ID: abc123
• Status: ✅ Completed
• Updated: 11/25/2025, 5:30 PM

🗑️ Action Items Deleted

Successfully deleted 3 action items.

🔗 Also deleted 5 derived tasks.
```

### Example 5: Weekly Review and Planning

**Scenario**: End of week review to see accomplishments and plan ahead.

```
You: "Help me do a weekly review. Show me what I accomplished and what's pending for next week."

Claude: [Uses list_tasks, list_action_items, then score_tasks]

Response:
📊 Weekly Review

✅ Completed This Week:
• 12 tasks completed
• 8 action items resolved
• Highlights:
  - Finished quarterly report (Score: 95)
  - Deployed API fix (Score: 88)
  - Client presentation delivered (Score: 92)

📋 Pending Action Items (7):
• High Priority: 2
• Medium Priority: 4
• Low Priority: 1

🎯 Next Week's Top Priorities:
1. Prepare board presentation (Score: 94/100)
   • Due: Tuesday
   • Energy: High required
   • Time: 2 hours

2. Complete performance reviews (Score: 91/100)
   • Due: Friday
   • Energy: Medium
   • Time: 45 min each

3. Follow up on vendor contracts (Score: 85/100)
   • Due: Wednesday
   • Energy: Low
   • Time: 30 min

💡 Recommendation: Block Tuesday morning for the board
presentation while your energy is highest.
```

---

## Available Tools

### Notes (5 tools)
| Tool | Description | Type |
|------|-------------|------|
| `list_notes` | Browse notes (sortBy: createdAt/updatedAt/title) | Read |
| `read_note` | Read specific note by ID | Read |
| `create_note` | Create new note with title, content, tags, category | Write |
| `update_note` | Update existing note (title, content, tags, category) | Write |
| `delete_notes` | Delete one or more notes by ID | Destructive |

### Action Items (5 tools)
| Tool | Description | Type |
|------|-------------|------|
| `list_action_items` | Browse action items with sorting | Read |
| `read_action_item` | Read specific action item by ID | Read |
| `extract_action_items` | AI-powered extraction from notes or text | Write |
| `update_action_item` | Update existing action item (title, priority, due date, etc.) | Write |
| `delete_action_items` | Delete action items and their derived tasks | Destructive |

### Tasks (6 tools)
| Tool | Description | Type |
|------|-------------|------|
| `list_tasks` | Browse tasks with AI scores | Read |
| `read_task` | Read specific task by ID | Read |
| `create_task` | Create a new task manually | Write |
| `convert_to_tasks` | Convert action items to ADHD-optimized tasks (async) | Write |
| `score_tasks` | AI-powered task prioritization (async) | Write |
| `update_task` | Update existing task (title, energy, time, completed, etc.) | Write |
| `delete_tasks` | Delete one or more tasks by ID | Destructive |

### Authentication (1 tool)
| Tool | Description | Type |
|------|-------------|------|
| `status` | Check authentication status and account info | Read |

**Total**: 17 tools (8 read-only, 6 write, 3 destructive)

---

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
│   AiDD Backend  │ Cloud Run (production HA)
│   - Firestore   │ - Notes, Tasks, Action Items
│   - Redis       │ - Sessions, Cache
│   - Gemini AI   │ - Extraction, Conversion, Scoring
└─────────────────┘
```

### Tech Stack
- **Runtime**: Node.js 20
- **Framework**: Express.js
- **Protocol**: MCP over HTTP/SSE (Streamable HTTP Transport)
- **Transport**: Server-Sent Events
- **Auth**: OAuth 2.0 with PKCE (S256)
- **AI**: Google Gemini 2.5 Pro & 2.5 Flash

---

## Testing the Connector

You can verify the connector is running:

```bash
# Health check
curl https://mcp.aidd.app/health

# MCP endpoint info
curl https://mcp.aidd.app/mcp

# OAuth discovery
curl https://mcp.aidd.app/.well-known/oauth-authorization-server
```

---

## Subscription Tiers

| Tier | AI Scoring | AI Extractions | Task Conversions | Cooldown |
|------|------------|----------------|------------------|----------|
| **FREE** | 1/month | 3/week | 1/week | 5 min |
| **PRO** | 10/day | 200/week | 200/week | None |

**PRO Plans**: $4.99/month or $49.99/year (save $10)

Upgrade at: [https://aidd.app/upgrade](https://aidd.app/upgrade)

---

## Security & Privacy

### Authentication & Data Protection

| Feature | Implementation |
|---------|---------------|
| OAuth 2.0 | Authorization Code Flow with PKCE (S256) |
| Token Security | JWT with 30-day expiry, auto-refresh |
| Transport | HTTPS/TLS 1.3 for all communication |
| CORS | Restricted to `claude.ai`, `*.claude.ai`, `*.anthropic.com` |
| Data at Rest | AES-256 encryption (Google Cloud) |
| Rate Limiting | Token bucket algorithm per subscription tier |
| Request Signing | HMAC verification for API calls |

### Compliance

| Standard | Status |
|----------|--------|
| **GDPR** | ✅ Full compliance (EU data protection) |
| **CCPA** | ✅ Full compliance (California privacy) |
| **SOC 2 Type II** | ✅ Certified infrastructure (Google Cloud) |

### Privacy Policy

AiDD processes your notes, tasks, and action items to provide AI-powered productivity features. We take your privacy seriously:

#### What We Collect
- **Account Information**: Email address, authentication tokens
- **Content Data**: Notes, action items, tasks you create or import
- **Usage Data**: Feature usage for improving the service (anonymized)

#### How We Use Your Data
- **AI Processing**: Notes → Action items → Tasks (on-demand only)
- **Storage**: Encrypted in your personal account
- **Analytics**: Anonymized usage patterns (opt-out available)

#### What We DON'T Do
- ❌ **No AI Training**: Your data is NEVER used to train AI models (including Google Gemini)
- ❌ **No Selling**: Your data is NEVER sold to third parties
- ❌ **No Advertising**: No targeted ads based on your content
- ❌ **No Retention**: AI processing is ephemeral, not stored in AI systems

#### Your Rights
- **Access**: Export all your data at any time
- **Deletion**: Request complete data deletion (GDPR Article 17)
- **Portability**: Download your data in standard formats
- **Correction**: Update or correct your information
- **Objection**: Opt-out of non-essential processing

#### Data Processing Details

| Data Type | Processing | Retention | AI Involvement |
|-----------|------------|-----------|----------------|
| Notes | Stored encrypted | Until deleted | Extraction only (not stored in AI) |
| Action Items | Generated by AI | Until deleted | Created by Gemini, stored in your account |
| Tasks | AI-scored | Until deleted | Scores calculated on-demand |
| Auth Tokens | OAuth 2.0 | 30 days | None |
| Passwords | NOT stored | N/A | None (OAuth only) |

#### Security Measures
- 🔐 End-to-end encryption for sensitive data
- 🔒 Secrets management via Google Secret Manager
- 🛡️ DDoS protection via Cloud Armor
- 📝 Audit logging with 30-day retention
- 🔍 Regular security audits and penetration testing

**📋 Full Privacy Policy**: [https://aidd.app/privacy](https://aidd.app/privacy)
**📜 Terms of Service**: [https://aidd.app/terms](https://aidd.app/terms)

---

## For Anthropic Reviewers

### Test Account

A dedicated test account is available for Anthropic MCP review:

| Field | Value |
|-------|-------|
| Email | `[TEST_EMAIL_REDACTED]` |
| Password | `[REDACTED]` |
| Subscription | PREMIUM (unlimited) |
| Status | ✅ Active |

**Full testing instructions**: [TEST_CREDENTIALS.md](TEST_CREDENTIALS.md)

### Pre-loaded Test Data
- **16 Notes** - Various categories and tags
- **13 Action Items** - Mixed priorities with confidence scores
- **13 Tasks** - All with AI scores (relevance, impact, urgency)

### Support During Review
- **Email**: marc@aidd.app
- **Subject**: "Anthropic MCP Review - [Issue]"
- **Response Time**: < 2 hours (9am-6pm PST)

---

## Troubleshooting

### "Connection Failed"
1. Check health: `curl https://mcp.aidd.app/health`
2. Verify URL: `https://mcp.aidd.app/mcp`
3. Try removing and re-adding the connector

### "Authentication Error"
1. Browser popup blocked? Allow popups for claude.ai
2. Try incognito mode (clear cookies)
3. Check if test account credentials are correct

### "Rate Limit Exceeded"
- Check quota with `status` tool
- Upgrade at [https://aidd.app/upgrade](https://aidd.app/upgrade)

---

## Why Web Connector?

**vs Desktop Extension:**
| Feature | Desktop | Web Connector |
|---------|---------|---------------|
| Platforms | macOS/Windows/Linux only | All platforms |
| Installation | Local install required | Just add URL |
| Updates | Manual | Automatic |
| Mobile | ❌ | ✅ |

**vs Separate MCPs:**
- Combine AiDD with other MCP connectors
- Example: Use with [Apple Notes MCP](https://github.com/gongrzhe/claude-apple-notes-mcp) for macOS
- Claude orchestrates between multiple MCPs automatically

---

## Support

- 🌐 Website: [aidd.app](https://aidd.app)
- 📧 Email: support@aidd.app
- 🐛 Issues: [GitHub](https://github.com/aidd-app/mcp-server/issues)
- 📚 Docs: [docs.aidd.app](https://docs.aidd.app)

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT © AiDD Team

---

## Changelog

### v4.3.18 (2025-11-30)

- 🔗 **Cascade Delete**: `delete_action_items` now automatically deletes all tasks derived from those action items
  - Prevents orphaned tasks when cleaning up action items
  - Response shows count of both deleted action items and derived tasks

### v4.3.7 (2025-11-28)
- 🔒 **Security**: Added MCP safety annotations to all 20 tools
  - `readOnlyHint: true` for read-only operations (list_*, read_*, status)
  - `destructiveHint: true` for delete operations (delete_notes, delete_action_items, delete_tasks)
  - `readOnlyHint: false, destructiveHint: false` for write operations
- 🔐 **OAuth**: Added Claude callback URLs to allowlist (localhost:6274, claude.ai, claude.com)
- 🌐 **HEAD**: Added HEAD request handlers for OAuth endpoints

### v4.1.1 (2025-11-25)
- ✏️ **New**: `update_note` - Update existing notes (title, content, tags, category)
- 🗑️ **New**: `delete_notes` - Delete one or more notes (batch support)
- ✏️ **New**: `update_action_item` - Update action items (title, priority, due date, completed status)
- 🗑️ **New**: `delete_action_items` - Delete one or more action items (batch support)
- ✏️ **New**: `update_task` - Update tasks (title, energy, time, type, completed status)
- 🗑️ **New**: `delete_tasks` - Delete one or more tasks (batch support)
- 📊 **Total tools**: 11 → 17

### v4.1.0 (2025-11-24)
- 🚀 **New**: Async mode for AI operations (default)
- ⚡ **Improved**: `convert_to_tasks` runs in background, no timeout issues
- ⚡ **Improved**: `score_tasks` runs in background, handles large task lists
- 🔧 **New**: `waitForCompletion` parameter for synchronous mode
- 📝 **Improved**: Better response messages with "check in 2-3 minutes" guidance

### v4.0.2 (2025-11-24)
- 📚 **Docs**: Added 5 realistic usage examples for Anthropic review
- 🔒 **Privacy**: Enhanced privacy policy section with full details inline
- 🐛 **Fix**: AI scores display (relevance, impact, urgency)
- 🐛 **Fix**: Task scoring deviceId requirement

### v4.0.0 (2025-01-22) - Web Connector Edition
- 🌐 **Breaking**: Transitioned from stdio to HTTP/SSE transport
- 📱 **New**: Universal access (web, mobile, desktop)
- ☁️ **New**: Hosted service with auto-scaling
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
