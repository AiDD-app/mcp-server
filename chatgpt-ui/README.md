# AiDD ChatGPT UI Components

Rich interactive widgets for AiDD task management in ChatGPT Apps.

## Architecture

The UI is served as MCP resources with `text/html+skybridge` MIME type, which ChatGPT loads in a sandboxed iframe:

```
ChatGPT App
    └── Connects to MCP Server: https://mcp.aidd.app
            ├── Discovers tools (list_tasks, score_tasks, etc.)
            │   └── Each tool has _meta.ui_template linking to widget
            └── Discovers resources
                ├── aidd://notes (JSON data)
                ├── aidd://tasks (JSON data)
                └── aidd://widgets/* (text/html+skybridge)
                        └── ChatGPT loads in iframe + injects window.openai
```

## Widget Resources

| Resource URI | Description |
|--------------|-------------|
| `aidd://widgets/app` | Complete app with all widgets |
| `aidd://widgets/task-dashboard` | Task priority dashboard |
| `aidd://widgets/action-items` | Action item extraction preview |
| `aidd://widgets/energy-selector` | Energy-based task selector |
| `aidd://widgets/quick-capture` | Quick task capture form |
| `aidd://widgets/dependencies` | Dependency graph view |
| `aidd://widgets/focus-mode` | Focus mode timer |
| `aidd://widgets/ai-scoring` | AI scoring results |

## Tool-to-Widget Mapping

Tools automatically link to their UI widgets via `_meta.ui_template`:

| Tool | Widget |
|------|--------|
| `list_tasks` | `aidd://widgets/task-dashboard` |
| `score_tasks` | `aidd://widgets/ai-scoring` |
| `extract_action_items` | `aidd://widgets/action-items` |
| `convert_to_tasks` | `aidd://widgets/action-items` |
| `create_task` | `aidd://widgets/quick-capture` |
| `check_ai_jobs` | `aidd://widgets/ai-scoring` |

## Components

### TaskPriorityDashboard
Visual dashboard showing ADHD-optimized task prioritization with AI scores, energy levels, and quick actions.

### ActionItemExtractionPreview
Shows AI-extracted action items from notes/emails with confidence scores and batch conversion to tasks.

### EnergyBasedTaskSelector
Task selection based on current energy level - low, medium, or high - with time-of-day suggestions.

### QuickCaptureForm
Fast task creation with minimal friction. Smart defaults based on keywords in title.

### DependencyGraph
Visual representation of task dependencies with critical path highlighting.

### FocusModeWidget
Pomodoro-style focus timer with distraction-free task view and break reminders.

### AIScoringResultsCard
Displays AI task scoring results with insights, recommendations, and score distribution.

## Development

```bash
# Install dependencies
npm install

# Start dev server (localhost:5173)
npm run dev

# Build for standard deployment (separate hosting)
npm run build

# Build for MCP resources (self-contained HTML)
npm run build:mcp
```

## Deployment Options

### Option 1: MCP Resources (Recommended for ChatGPT App Store)

The UI is bundled as self-contained HTML and served directly from the MCP server:

```bash
# 1. Build MCP resources
cd aidd-mcp-web-connector/chatgpt-ui
npm run build:mcp

# This generates:
# - dist-mcp/index.html (self-contained HTML with inlined CSS/JS)
# - ../src/chatgpt-ui-resources.ts (TypeScript constants for MCP server)

# 2. Build and deploy MCP server
cd ..
npm run build
gcloud run deploy aidd-mcp-web-connector --image gcr.io/PROJECT/aidd-mcp-web-connector
```

ChatGPT fetches UI directly from MCP server via:
- `GET /mcp` → resource `aidd://widgets/app` → returns HTML with `text/html+skybridge`

### Option 2: Backend Static Hosting (Development/Testing)

For development and testing, the UI can also be hosted from the backend:

```bash
# 1. Build the UI
npm run build

# 2. Copy to backend public folder
cp -r dist/* ../../gcp-backend/public/chatgpt-ui/

# 3. Deploy backend
cd ../../gcp-backend
./deploy-production.sh
```

UI available at:
- `https://aidd-backend-prod-739193356129.us-central1.run.app/chatgpt-ui/`

## ChatGPT Developer Mode Testing

1. Enable **Developer Mode** in ChatGPT: Settings → Apps & Connectors → Advanced settings
2. Create a new connector with MCP server URL: `https://mcp.aidd.app`
3. Start a chat and invoke AiDD tools
4. ChatGPT automatically discovers and loads UI widgets from MCP resources

## Hooks

### useOpenAI
Core hook for ChatGPT Apps SDK integration:
- `isReady` - SDK loaded
- `theme` - 'light' | 'dark'
- `callTool()` - Invoke MCP tools
- `requestFullscreen()` / `requestInline()` - Display modes
- `sendMessage()` - Follow-up messages

### useTasks
Task CRUD operations via MCP tools.

### useActionItems
Action item operations including conversion to tasks.

### useAIJobs
AI job status monitoring and task scoring.

## Tech Stack

- React 18
- TypeScript
- Tailwind CSS v4
- Radix UI Primitives
- Vite
- ChatGPT Apps SDK
