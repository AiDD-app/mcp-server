# Anthropic MCP Application Submission

**GitHub Repository**: https://github.com/AiDD-app/mcp-server
**MCP Server URL**: https://mcp.aidd.app
**npm Package**: `@aidd-app/mcp`

---

## Form Field Values

### Basic Information

| Field | Value |
|-------|-------|
| **Tagline** | ADHD-optimized AI for notes, tasks & action items |
| **Character Count** | 50 characters (max 55) |

### MCP Server Description (50-100 words)

> AiDD MCP Server connects Claude to an ADHD-optimized productivity platform. Manage notes, action items, and tasks with AI-powered prioritization. Extract actionable items from text, convert them to ADHD-friendly micro-tasks with energy levels and time estimates, and get AI-scored task recommendations based on your current state. Features include task dependency tracking, batch operations, and seamless sync across devices. Perfect for users who need intelligent task breakdown and prioritization to stay focused and productive.

---

## Authentication Details

| Field | Value |
|-------|-------|
| **Auth Client Type** | Dynamic OAuth Client |
| **Static Client ID** | N/A (dynamically generated via `/register` endpoint) |
| **Static Client Secret** | N/A (dynamically generated via `/register` endpoint) |

The server uses OAuth 2.0 Dynamic Client Registration (RFC 7591). Client credentials are generated at runtime when Claude registers with the MCP server.

---

## Transport Support

| Field | Value |
|-------|-------|
| **Transport Type** | Streamable HTTP |

Uses `StreamableHTTPServerTransport` from the MCP SDK in stateless mode.

---

## Third-party Connections

- [x] Third-party data retrieval

Note: The MCP server does NOT directly invoke AI models. AI processing happens on the backend service, not triggered by the MCP server itself.

---

## Tools (21 total)

```
list_notes, read_note, create_note, update_note, delete_notes, list_action_items, read_action_item, create_action_item, update_action_item, delete_action_items, extract_action_items, list_tasks, read_task, create_task, update_task, delete_tasks, convert_to_tasks, score_tasks, check_ai_jobs, session_status, aidd_overview_tutorial
```

### Tool Categories

| Category | Tools |
|----------|-------|
| **Notes** | list_notes, read_note, create_note, update_note, delete_notes |
| **Action Items** | list_action_items, read_action_item, create_action_item, update_action_item, delete_action_items, extract_action_items |
| **Tasks** | list_tasks, read_task, create_task, update_task, delete_tasks, convert_to_tasks, score_tasks |
| **System** | check_ai_jobs, session_status, aidd_overview_tutorial |

---

## Resources (3 total)

```
aidd://notes, aidd://action-items, aidd://tasks
```

---

## Prompts

None defined.

---

## Data Handling

- [x] All data transmitted over secure connections (HTTPS/TLS)
- [x] No data is stored beyond session requirements
- [x] Data is encrypted at rest
- [x] GDPR and privacy regulation compliance

Note: The MCP server itself is stateless. User data is stored on the AiDD backend with E2E encryption.

---

## Data Processing Agreement

| Field | Value |
|-------|-------|
| **DPA URL** | None |
| **Privacy Policy** | https://aidd.app/privacy |
| **Terms of Service** | https://aidd.app/terms |

---

## Use Cases with Example Prompts

### 1. Note-to-Task Conversion
**Use Case**: Users can capture meeting notes and automatically extract actionable tasks with AI-powered analysis.

**Example Prompt**:
> "Extract action items from my meeting notes and convert them into tasks"

---

### 2. ADHD-Optimized Task Prioritization
**Use Case**: Get personalized task recommendations based on current energy levels and time of day, optimized for ADHD focus patterns.

**Example Prompt**:
> "Score my tasks and tell me what I should work on right now based on my energy level"

---

### 3. Quick Capture and Organization
**Use Case**: Rapidly capture thoughts and automatically organize them into structured notes with extracted follow-up items.

**Example Prompt**:
> "Create a note about the API changes discussed today and extract any follow-up action items"

---

## Server Logo

| Field | Value |
|-------|-------|
| **File** | `icon.svg` |
| **Format** | SVG (128x128) |
| **Aspect Ratio** | 1:1 (square) |
| **Location** | Repository root |

---

## Technical Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Claude.ai     │────▶│  MCP Server     │────▶│  AiDD Backend   │
│  (MCP Client)   │     │  (mcp.aidd.app) │     │  (Cloud Run)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │                        │
                              │ Stateless              │ Stateful
                              │ HTTP Transport         │ User Data
                              │ Dynamic OAuth          │ E2E Encrypted
```

### Key Technical Details

- **OAuth**: Dynamic Client Registration (RFC 7591) via `/register` endpoint
- **Transport**: `StreamableHTTPServerTransport` (stateless mode)
- **Backend**: GCP Cloud Run at `https://aidd-backend-prod-739193356129.us-central1.run.app`
- **AI Processing**: Google Gemini (backend-only, not MCP-triggered)
- **Encryption**: E2E encryption for user data (notes, tasks, action items)

---

## Checklist

- [x] Package published to npm (`@aidd-app/mcp`)
- [x] Stable version (1.0.0+)
- [x] OAuth authentication implemented (Dynamic Client Registration)
- [x] Documentation complete (README.md)
- [x] Tested and working
- [x] Square logo in SVG format (icon.svg)
- [x] Privacy policy available
- [x] HTTPS/TLS for all connections
- [x] Stateless server design
