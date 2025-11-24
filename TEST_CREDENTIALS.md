# Test Credentials for Anthropic MCP Review

Thank you for reviewing the AiDD MCP Web Connector! We've created a dedicated test account specifically for the Anthropic review team.

## Test Account Credentials

**Email**: `[TEST_EMAIL_REDACTED]`
**Password**: `REDACTED`

**Subscription**: **PREMIUM** (full access to all features, unlimited rate limits)

## Authentication Flow

### Step 1: Add Connector to Claude

1. Open [claude.ai](https://claude.ai) in your browser
2. Navigate to **Settings** → **Connectors** (or **MCP**)
3. Click **"Add Connector"**
4. Enter the connector URL: `https://mcp.aidd.app/mcp`
5. Click **"Save"** or **"Connect"**

### Step 2: Authenticate

1. Claude will initiate the OAuth flow
2. A browser window will open to the AiDD sign-in page
3. Sign in using the test credentials above:
   - **Email**: `[TEST_EMAIL_REDACTED]`
   - **Password**: `REDACTED`
4. Click **"Authorize"** to grant access
5. You'll be redirected back to Claude
6. Connection established! ✅

### Step 3: Verify Connection

In Claude, try:
```
Check my AiDD account status
```

Expected response should include:
- ✅ Authenticated
- 📧 Email: [TEST_EMAIL_REDACTED]
- 💎 Subscription: PREMIUM
- 🔑 User ID: [unique-id]

## Available Tools & Testing

### Authentication Tools (readOnlyHint: true)
- ✅ `status` - Check authentication status and account information

### Notes Management
- ✅ `list_notes` (readOnlyHint: true) - List all notes with pagination
- ✅ `read_note` (readOnlyHint: true) - Read a specific note by ID
- ✅ `create_note` - Create a new note with title, content, tags, category

### Action Items Management
- ✅ `list_action_items` (readOnlyHint: true) - List action items with sorting
- ✅ `read_action_item` (readOnlyHint: true) - Read specific action item
- ✅ `extract_action_items` - AI-powered extraction from notes or text

### Tasks Management (ADHD-Optimized)
- ✅ `list_tasks` (readOnlyHint: true) - List tasks with AI scores
- ✅ `read_task` (readOnlyHint: true) - Read specific task details
- ✅ `convert_to_tasks` - Convert action items to ADHD-optimized subtasks
- ✅ `score_tasks` - AI-powered task prioritization

## Sample Test Commands

Once authenticated in Claude, try these commands:

### 1. List Data
```
List all my notes
Show me my action items sorted by priority
What tasks do I have?
```

### 2. Read Specific Items
```
Read note [noteId from list]
Show me action item [actionItemId from list]
Show me task [taskId from list]
```

### 3. Create New Content
```
Create a note titled "Test Note" with content "This is a test from Anthropic review" and tags "test, review"
```

### 4. AI Features (The Magic! ✨)
```
Extract action items from this text: "I need to buy groceries tomorrow, schedule a dentist appointment for next week, and finish the project report by Friday"

Convert my action items to ADHD-optimized tasks

Score all my tasks and tell me what I should work on next based on my current energy level
```

## Pre-Loaded Test Data

The test account comes with sample data to make testing easier:

### Notes (5 items)
1. **"Weekly Team Meeting"** (work) - Meeting notes with action items
2. **"Project Brainstorming"** (work) - Ideas and plans
3. **"Personal Goals 2025"** (personal) - Goal setting notes
4. **"Shopping List"** (personal) - Groceries and errands
5. **"Research Notes"** (work) - Study findings and references

### Action Items (10 items)
- 3 high priority items (upcoming deadlines)
- 4 medium priority items (this week)
- 3 low priority items (backlog)
- All with AI confidence scores (0.75-0.95)
- Various due dates and tags

### Tasks (8 items)
- All with AI-generated prioritization scores (65-92)
- Time estimates: 5-60 minutes
- Energy levels: low, medium, high
- Task types: planning, execution, review, communication
- Some with dependencies

## Backend Infrastructure

### Production Backend
- **URL**: `https://aidd-backend-prod-739193356129.us-central1.run.app`
- **Health Check**: `https://aidd-backend-prod-739193356129.us-central1.run.app/health`
- **Status**: ✅ Running on Google Cloud Run with auto-scaling
- **AI Engine**: Google Gemini 3 Pro Preview & 2.5 Flash

### MCP Connector
- **URL**: `https://mcp.aidd.app/mcp`
- **Health Check**: `https://mcp.aidd.app/health`
- **Protocol**: HTTP/SSE (Streamable HTTP Transport)
- **Version**: 4.0.0

## OAuth 2.0 Endpoints

### Discovery
- **Authorization Server Metadata**: `https://mcp.aidd.app/.well-known/oauth-authorization-server`
- **Protected Resource Metadata**: `https://mcp.aidd.app/.well-known/oauth-protected-resource`

### OAuth Flow
- **Authorization**: `https://mcp.aidd.app/oauth/authorize`
- **Token**: `https://mcp.aidd.app/oauth/token` (POST)
- **Registration**: `https://mcp.aidd.app/register` (POST)

### Supported Grant Types
- `authorization_code` (with PKCE S256)
- `refresh_token`

### Scopes
- `profile` - User profile information
- `email` - Email address
- `tasks` - Task management
- `notes` - Notes management
- `action_items` - Action items management

## Rate Limits (Disabled for Test Account)

For the test account, all rate limits have been disabled:
- ✅ **Unlimited** notes operations
- ✅ **Unlimited** action items operations
- ✅ **Unlimited** AI extraction requests
- ✅ **Unlimited** AI task conversion
- ✅ **Unlimited** AI task scoring
- ✅ **No throttling** on any endpoint

## Expected Authentication Behavior

### Successful Flow
1. Claude initiates OAuth → `GET /oauth/authorize`
2. User signs in → Backend validates credentials
3. Backend returns authorization code → `302 redirect`
4. Claude exchanges code for token → `POST /oauth/token`
5. MCP server receives access token → ✅ Connected
6. All subsequent tool calls include `Authorization: Bearer <token>` header

### Token Management
- **Access Token**: Valid for 30 days
- **Refresh Token**: Valid for 30 days, auto-refreshed
- **Token Format**: JWT (JSON Web Token)
- **Storage**: Claude handles token storage automatically

## Tool Metadata (MCP Specification Compliance)

All tools include proper metadata annotations:

### Read-Only Tools (readOnlyHint: true)
- `list_notes`, `read_note`
- `list_action_items`, `read_action_item`
- `list_tasks`, `read_task`
- `status`

### Write Tools (no destructiveHint)
- `create_note` - Creates new notes
- `extract_action_items` - AI-powered extraction (creates action items)
- `convert_to_tasks` - AI-powered conversion (creates tasks)
- `score_tasks` - AI-powered scoring (updates task scores)

**Note**: No tools have `destructiveHint: true` because AiDD doesn't expose delete/destroy operations via MCP for safety.

## Privacy & Data Handling

As detailed in our Privacy Policy ([https://aidd.app/privacy](https://aidd.app/privacy)):

- ✅ **No AI training**: User data is never used to train AI models
- ✅ **End-to-end encryption**: Tasks and sensitive data are encrypted at rest
- ✅ **GDPR compliant**: Full data control and deletion rights
- ✅ **No third-party sharing**: Data is never sold or shared
- ✅ **Secure storage**: Google Cloud Platform with enterprise-grade security
- ✅ **Audit logs**: All operations are logged for security (30-day retention)

## Troubleshooting

### OAuth Flow Doesn't Complete
1. Verify the connector URL: `https://mcp.aidd.app/mcp`
2. Check browser popup blockers
3. Try incognito/private mode
4. Check backend health: `curl https://aidd-backend-prod-739193356129.us-central1.run.app/health`

### "Unauthorized" Errors
1. Re-authenticate using the test credentials
2. Verify test account is still active
3. Check if tokens expired (unlikely within test session)

### Tool Calls Fail
1. Verify authentication: Run `status` tool first
2. Check tool parameters match the schema
3. Review Claude's error message for details

## Support During Review

If you encounter any issues:

- **Email**: marc@aidd.app
- **Subject**: "Anthropic MCP Review - [Issue Description]"
- **Response Time**: < 2 hours (9am-6pm PST)
- **Emergency Contact**: Available via email for urgent issues

We actively monitor the test account and can provide real-time assistance.

## Security Notes

- ⚠️ These credentials are **for Anthropic MCP Review only**
- ⚠️ Test account is **sandboxed** from production data
- ⚠️ Credentials will be **rotated** after review completion
- ⚠️ Test data is **automatically purged** every 7 days
- ⚠️ All review interactions are **logged** for debugging (30-day retention)

## Resources

- **Website**: [https://aidd.app](https://aidd.app)
- **Documentation**: [https://docs.aidd.app](https://docs.aidd.app)
- **GitHub**: [https://github.com/aidd-app/mcp-server](https://github.com/aidd-app/mcp-server)
- **Privacy Policy**: [https://aidd.app/privacy](https://aidd.app/privacy)
- **Terms of Service**: [https://aidd.app/terms](https://aidd.app/terms)

---

**Last Updated**: 2025-01-24
**Test Account Status**: ✅ Active & Ready
**Backend Status**: ✅ Healthy (99.9% uptime)
**MCP Server Status**: ✅ Online (Cloud Run auto-scaling)

Thank you for reviewing AiDD MCP Web Connector!

— The AiDD Team
