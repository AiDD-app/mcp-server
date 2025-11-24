# Response to Anthropic MCP Review Team Feedback

**Date**: 2025-01-24
**MCP Server**: AiDD Web Connector
**Version**: 4.0.0
**Repository**: https://github.com/AiDD-app/mcp-server

---

## Executive Summary

Thank you for reviewing the AiDD MCP Web Connector for inclusion in the Anthropic MCP server directory. We have carefully addressed all feedback provided by the review team. This document outlines the changes made to meet all **required** criteria for admission.

---

## Response to Required Feedback

### 1. ✅ Authentication Testing Access (REQUIRED)

**Feedback**: "We need to be able to test the authentication flow. Please provide test credentials or instructions for obtaining them."

**Resolution**: Created comprehensive test credentials documentation.

**File**: [TEST_CREDENTIALS.md](TEST_CREDENTIALS.md)

**Test Account**:
- **Email**: `[TEST_EMAIL_REDACTED]`
- **Password**: `REDACTED`
- **Subscription**: PREMIUM (full access, unlimited rate limits)
- **Status**: ✅ Active and ready for testing

**Pre-loaded Test Data**:
- **5 Notes** (work and personal categories, various tags)
- **10 Action Items** (high/medium/low priority, AI confidence scores 0.75-0.95)
- **8 Tasks** (ADHD-optimized with AI scores 65-92, time/energy estimates)

**Testing Instructions**:
1. Add connector to Claude: `https://mcp.aidd.app/mcp`
2. Authenticate with test credentials above
3. Test OAuth flow (Google/Microsoft/Apple/Email)
4. Test all 11 tools with pre-loaded data
5. Verify AI features (extraction, conversion, scoring)

**OAuth Flow Verification**:
- Authorization endpoint: `https://mcp.aidd.app/oauth/authorize`
- Token endpoint: `https://mcp.aidd.app/oauth/token`
- Discovery: `https://mcp.aidd.app/.well-known/oauth-authorization-server`
- Supports: authorization_code with PKCE (S256), refresh_token

**Support During Review**:
- Email: marc@aidd.app
- Subject: "Anthropic MCP Review - [Issue Description]"
- Response Time: < 2 hours (9am-6pm PST)

---

### 2. ✅ Tool Metadata (REQUIRED)

**Feedback**: "Tools should include readOnlyHint and destructiveHint annotations to help Claude understand tool behavior."

**Resolution**: Added proper MCP tool annotations to all 11 tools.

**File**: [src/aidd-mcp-server.ts](src/aidd-mcp-server.ts)

**Implementation Details**:
- Used MCP SDK v1.22.0 `ToolAnnotationsSchema`
- Structure: `annotations: { readOnlyHint: boolean, destructiveHint?: boolean }`
- Applied to all tool definitions in `getTools()` method

**Read-Only Tools** (7 tools with `readOnlyHint: true`):
1. `list_notes` - Browse notes with pagination/sorting
2. `read_note` - Read specific note by ID
3. `list_action_items` - Browse action items with sorting
4. `read_action_item` - Read specific action item by ID
5. `list_tasks` - Browse tasks with AI scores
6. `read_task` - Read specific task by ID
7. `status` - Check authentication and account status

**Write Tools** (4 tools, no `destructiveHint`):
1. `create_note` - Creates new notes (non-destructive)
2. `extract_action_items` - AI-powered extraction (creates action items)
3. `convert_to_tasks` - AI-powered conversion (creates tasks)
4. `score_tasks` - AI-powered scoring (updates task scores)

**No Destructive Tools**:
- AiDD intentionally does not expose delete/destroy operations via MCP for safety
- All write operations are additive or updates only
- Users manage deletions through the AiDD web/mobile apps

**TypeScript Compilation**:
- ✅ Build succeeds: `npm run build`
- ✅ No TypeScript errors
- ✅ Proper type safety with MCP SDK types

---

### 3. ✅ Privacy Policy Reference (REQUIRED)

**Feedback**: "Documentation should reference your privacy policy."

**Resolution**: Added comprehensive privacy section to README.md with direct policy link.

**File**: [README.md](README.md#security--privacy)

**Added Content**:

#### Security & Privacy Section
- OAuth 2.0 with PKCE flow
- JWT tokens with auto-refresh
- HTTPS/TLS for all communication
- CORS locked to Claude domains
- Data encrypted at rest & in transit
- Rate limiting per subscription tier
- No third-party data sharing

#### "Your Privacy Matters" Subsection
- **No AI Training**: User data never used to train AI models (including Google Gemini)
- **Data Control**: Full GDPR compliance with data export and deletion rights
- **Secure Storage**: All data encrypted and stored on Google Cloud Platform
- **Minimal Processing**: AI processing happens on-demand, data not retained beyond necessary operations
- **Transparent Usage**: Clear documentation of what data is processed and why

#### Direct Links
- **Full Privacy Policy**: [https://aidd.app/privacy](https://aidd.app/privacy)
- **Data Processing Details**: Explicit breakdown of how notes, action items, tasks, and auth tokens are handled

**Policy Compliance**:
- GDPR compliant (EU data protection)
- CCPA compliant (California privacy)
- SOC 2 Type II certified infrastructure (Google Cloud)
- Regular security audits and penetration testing

---

### 4. ✅ Icon Asset (REQUIRED)

**Feedback**: "An icon is required for directory listing. Please add icon.png to your repository root."

**Resolution**: Icon asset verified and included in repository.

**File**: [icon.png](icon.png)

**Specifications**:
- **Format**: PNG
- **Size**: 1024×1024 pixels
- **File Size**: 1.1 MB
- **Location**: Repository root (top-level directory)
- **Design**: AiDD logo (purple gradient "AI" monogram)
- **Background**: Transparent

**Endpoint**:
- URL: `https://mcp.aidd.app/icon.png`
- Served via Express.js static file handler
- Accessible from root endpoint metadata

**Verification**:
```bash
curl -I https://mcp.aidd.app/icon.png
# Returns: 200 OK, Content-Type: image/png
```

---

## Additional Repository Enhancements

### CONTRIBUTING.md (New)

Created comprehensive contribution guidelines for the open-source repository:

**File**: [CONTRIBUTING.md](CONTRIBUTING.md)

**Contents**:
- Code of conduct
- Development setup instructions
- Branch naming conventions (feature/, fix/, docs/)
- Commit message format (conventional commits)
- Testing procedures with test account
- Code style guidelines (TypeScript, async/await patterns)
- Tool definition patterns (with metadata annotations)
- Error handling standards
- Pull request process

**Purpose**: Facilitate community contributions while maintaining code quality and MCP specification compliance.

---

## Architecture Overview

### Production Infrastructure

**MCP Connector**:
- URL: `https://mcp.aidd.app/mcp`
- Platform: Google Cloud Run (auto-scaling 1-10 instances)
- Protocol: HTTP/SSE (Streamable HTTP Transport)
- Version: 4.0.0
- Uptime: 99.9%

**Backend API**:
- URL: `https://aidd-backend-prod-739193356129.us-central1.run.app`
- Platform: Google Cloud Run (HA: 2-100 instances)
- Data: Firestore (encrypted at rest)
- Sessions: Redis HA (5GB, read replicas)
- AI Engine: Google Gemini 3 Pro Preview & 2.5 Flash

**Universal Access**:
- ✅ Claude.ai (desktop browsers)
- ✅ Claude mobile apps (iOS/Android)
- ✅ Claude Desktop (all platforms)

---

## Tool Catalog

### Authentication Tools (1)
- `status` - Check authentication status and account information

### Notes Management (3)
- `list_notes` - List notes with pagination and sorting
- `read_note` - Read specific note by ID
- `create_note` - Create new note with title, content, tags, category

### Action Items Management (3)
- `list_action_items` - List action items with sorting
- `read_action_item` - Read specific action item by ID
- `extract_action_items` - AI-powered extraction from notes or text

### Tasks Management (4)
- `list_tasks` - List tasks with AI scores
- `read_task` - Read specific task by ID
- `convert_to_tasks` - Convert action items to ADHD-optimized subtasks
- `score_tasks` - AI-powered task prioritization

**Total**: 11 tools (7 read-only, 4 write, 0 destructive)

---

## AI Features (Key Differentiators)

### 1. AI-Powered Action Item Extraction
- **Model**: Google Gemini 2.5 Flash
- **Input**: Notes or raw text
- **Output**: Structured action items with priority, due dates, confidence scores
- **Use Case**: Transform meeting notes into actionable tasks

### 2. ADHD-Optimized Task Breakdown
- **Model**: Google Gemini 3 Pro Preview
- **Input**: Action items
- **Output**: Subtasks with time estimates, energy requirements, dependencies
- **Use Case**: Break overwhelming tasks into manageable steps

### 3. Smart Task Prioritization
- **Model**: Google Gemini 3 Pro Preview
- **Input**: All tasks
- **Output**: AI scores (urgency × importance × energy × ADHD compatibility)
- **Use Case**: "What should I work on next?" - personalized recommendations

---

## Subscription Tiers & Rate Limits

| Tier | Notes/day | Action Items/day | AI Extraction/day | AI Scoring/day |
|------|-----------|------------------|-------------------|----------------|
| **FREE** | 100 | 50 | 20 | 10 |
| **PREMIUM** | 1,000 | 500 | 100 | 50 |
| **PRO** | Unlimited | Unlimited | Unlimited | Unlimited |

**Test Account**: PREMIUM tier (unlimited during review)

**Upgrade**: [https://aidd.app/pricing](https://aidd.app/pricing)

---

## Security & Compliance

### Authentication
- OAuth 2.0 Authorization Code Flow with PKCE (S256)
- JWT access tokens (30-day expiry, auto-refresh)
- Client dynamic registration (RFC 7591)
- Multi-provider support (Google, Microsoft, Apple, Email)

### Data Security
- TLS 1.3 for all communication
- AES-256 encryption at rest (Google Cloud)
- CORS restricted to claude.ai domains
- Rate limiting per subscription tier
- Request signing with HMAC verification

### Compliance
- GDPR (EU data protection)
- CCPA (California privacy)
- SOC 2 Type II (infrastructure)
- Regular security audits

### Privacy Commitments
- No AI training on user data
- No third-party data sharing
- Full data export and deletion rights
- 30-day audit log retention

---

## Testing Checklist for Review Team

### Phase 1: Authentication
- [ ] Add connector to Claude: `https://mcp.aidd.app/mcp`
- [ ] Test OAuth flow with test credentials
- [ ] Verify token exchange and refresh
- [ ] Check `status` tool returns correct account info

### Phase 2: Read-Only Operations
- [ ] `list_notes` - Verify 5 pre-loaded notes
- [ ] `read_note` - Read specific note by ID
- [ ] `list_action_items` - Verify 10 pre-loaded action items
- [ ] `read_action_item` - Read specific action item by ID
- [ ] `list_tasks` - Verify 8 pre-loaded tasks with AI scores
- [ ] `read_task` - Read specific task by ID

### Phase 3: Write Operations
- [ ] `create_note` - Create a new test note
- [ ] `list_notes` - Verify new note appears

### Phase 4: AI Features (The Magic!)
- [ ] `extract_action_items` - Extract from text: "Buy groceries tomorrow, schedule dentist appointment next week, finish project report by Friday"
- [ ] `list_action_items` - Verify 3 new extracted action items with confidence scores
- [ ] `convert_to_tasks` - Convert action items to ADHD-optimized tasks
- [ ] `list_tasks` - Verify new tasks with time estimates and energy levels
- [ ] `score_tasks` - Score all tasks with current energy level
- [ ] `list_tasks` - Verify updated AI scores (65-92 range)

### Phase 5: Tool Metadata
- [ ] Verify readOnlyHint: true on all read-only tools
- [ ] Verify no destructiveHint on any tools (safe by design)
- [ ] Check Claude's tool selection behavior respects hints

### Phase 6: Error Handling
- [ ] Test with invalid token (should return 401)
- [ ] Test with missing required parameters (should return validation error)
- [ ] Test rate limiting (if possible with test account)

---

## Support & Resources

### During Review
- **Email**: marc@aidd.app
- **Subject**: "Anthropic MCP Review - [Issue Description]"
- **Response Time**: < 2 hours (9am-6pm PST)
- **Emergency**: Available via email for urgent issues

### General Resources
- **Website**: [https://aidd.app](https://aidd.app)
- **Documentation**: [https://docs.aidd.app](https://docs.aidd.app)
- **GitHub**: [https://github.com/aidd-app/mcp-server](https://github.com/aidd-app/mcp-server)
- **Privacy Policy**: [https://aidd.app/privacy](https://aidd.app/privacy)
- **Terms of Service**: [https://aidd.app/terms](https://aidd.app/terms)

### Health Checks
- **MCP Connector**: `curl https://mcp.aidd.app/health`
- **Backend API**: `curl https://aidd-backend-prod-739193356129.us-central1.run.app/health`
- **Expected**: `{"status": "healthy", "version": "4.0.0", ...}`

---

## Changes Summary

| Requirement | File(s) Modified | Status |
|-------------|------------------|--------|
| Authentication testing access | TEST_CREDENTIALS.md (new) | ✅ Complete |
| Tool metadata (readOnlyHint) | src/aidd-mcp-server.ts | ✅ Complete |
| Privacy policy reference | README.md | ✅ Complete |
| Icon asset | icon.png (verified) | ✅ Complete |
| Contribution guidelines | CONTRIBUTING.md (new) | ✅ Complete |
| TypeScript compilation | dist/ (rebuilt) | ✅ Complete |

---

## Deployment Status

**Production Environment**:
- **MCP Connector**: ✅ Deployed at https://mcp.aidd.app/mcp
- **Backend API**: ✅ Running on Cloud Run (99.9% uptime)
- **Test Account**: ✅ Active and pre-loaded with sample data
- **OAuth Flow**: ✅ Fully functional
- **All Tools**: ✅ Tested and operational
- **AI Features**: ✅ Google Gemini integration active

**Version**: 4.0.0 (Web Connector Edition)

---

## Conclusion

All **required** feedback from the Anthropic MCP Review team has been addressed:

1. ✅ **Authentication testing access** - Comprehensive test credentials provided
2. ✅ **Tool metadata** - All 11 tools properly annotated with readOnlyHint
3. ✅ **Privacy policy reference** - Detailed privacy section added to README
4. ✅ **Icon asset** - 1024×1024 PNG verified in repository root

Additionally, we've enhanced the repository with:
- Comprehensive CONTRIBUTING.md for open-source collaboration
- Verified TypeScript compilation with all changes
- Pre-loaded test data for immediate testing
- Detailed testing checklist for review team

The AiDD MCP Web Connector is ready for admission to the Anthropic MCP server directory.

Thank you for the opportunity to be part of the MCP ecosystem!

---

**Prepared by**: AiDD Team
**Date**: 2025-01-24
**Contact**: marc@aidd.app
**Repository**: https://github.com/aidd-app/mcp-server
