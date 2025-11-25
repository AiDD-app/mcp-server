# @aidd-app/mcp

**Official AiDD MCP Web Connector** - ADHD-optimized productivity platform accessible from Claude web, mobile, and desktop.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-4.0.2-blue.svg)](https://github.com/aidd-app/mcp-server)

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
✨ Tasks Created (ADHD-Optimized)

Summary:
• Action items converted: 5
• Tasks created: 14
• Average tasks per item: 2.8

Created Tasks:
1. Send reminder email to John about budget report
   • Time: 5 min
   • Energy: low
   • Type: quick_win
   📝 Start here for momentum!

2. Check John's response and review budget numbers
   • Time: 15 min
   • Energy: medium
   • Type: review
   • Depends on: Task 1

3. Look up client's preferred meeting times
   • Time: 10 min
   • Energy: low
   • Type: administrative

4. Send calendar invite for client demo
   • Time: 5 min
   • Energy: low
   • Type: quick_win
   • Depends on: Task 3

5. Check API error logs in monitoring dashboard
   • Time: 15 min
   • Energy: medium
   • Type: investigation

Task Breakdown:
• Quick wins: 4 (start here!)
• Focus required: 3
• Administrative: 4
• Investigation: 2
• Review: 1
```

### Example 4: Weekly Review and Planning

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

### Example 5: Creating and Organizing Notes

**Scenario**: You want to capture ideas and organize them properly.

```
You: "Create a note titled 'Product Roadmap Ideas' with these thoughts:
     - Mobile app redesign for better accessibility
     - Integration with Slack for notifications
     - AI-powered task suggestions based on calendar
     - Dark mode support
     Tag it with 'product' and 'planning', category work"

Claude: [Uses create_note with title, content, tags, category]

Response:
✅ Note Created

Title: Product Roadmap Ideas
ID: note_a1b2c3d4
Category: work
Tags: product, planning

Content:
- Mobile app redesign for better accessibility
- Integration with Slack for notifications
- AI-powered task suggestions based on calendar
- Dark mode support

The note has been saved to your AiDD account.

💡 Tip: Say "extract action items from my Product Roadmap Ideas note"
to turn these ideas into trackable tasks!
```

---

## Available Tools

### Notes (3 tools)
| Tool | Description | Read-Only |
|------|-------------|-----------|
| `list_notes` | Browse notes (sortBy: createdAt/updatedAt/title) | ✅ |
| `read_note` | Read specific note by ID | ✅ |
| `create_note` | Create new note with title, content, tags, category | ❌ |

### Action Items (3 tools)
| Tool | Description | Read-Only |
|------|-------------|-----------|
| `list_action_items` | Browse action items with sorting | ✅ |
| `read_action_item` | Read specific action item by ID | ✅ |
| `extract_action_items` | AI-powered extraction from notes or text | ❌ |

### Tasks (4 tools)
| Tool | Description | Read-Only |
|------|-------------|-----------|
| `list_tasks` | Browse tasks with AI scores | ✅ |
| `read_task` | Read specific task by ID | ✅ |
| `convert_to_tasks` | Convert action items to ADHD-optimized tasks | ❌ |
| `score_tasks` | AI-powered task prioritization | ❌ |

### Authentication (1 tool)
| Tool | Description | Read-Only |
|------|-------------|-----------|
| `status` | Check authentication status and account info | ✅ |

**Total**: 11 tools (7 read-only, 4 write, 0 destructive)

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
- **AI**: Google Gemini 3 Pro Preview & 2.5 Flash

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
| Password | `REDACTED` |
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
