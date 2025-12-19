# AiDD ChatGPT UI Components

Rich interactive widgets for AiDD task management in ChatGPT Apps.

## Production URL

**Hosted UI**: https://aidd-backend-prod-739193356129.us-central1.run.app/chatgpt-ui/

This is the URL ChatGPT loads in an iframe when rendering AiDD widgets.

## Architecture

```
ChatGPT App (iframe)
    └── Loads UI from: /chatgpt-ui/
            └── Calls MCP tools via window.openai.callTool()
                    └── Routes to: https://mcp.aidd.app (MCP Server)
                            └── Connects to: AiDD Backend API
```

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

# Build for production
npm run build
```

## Deployment

The UI is deployed as part of the GCP backend:

```bash
# 1. Build the UI
cd aidd-mcp-web-connector/chatgpt-ui
npm run build

# 2. Copy to backend public folder
cp -r dist/* ../../gcp-backend/public/chatgpt-ui/

# 3. Deploy backend
cd ../../gcp-backend
./deploy-production.sh
```

The UI will be available at:
- `https://aidd-backend-prod-739193356129.us-central1.run.app/chatgpt-ui/`

## ChatGPT Developer Mode Testing

1. Enable **Developer Mode** in ChatGPT: Settings → Apps & Connectors → Advanced settings
2. Create a new connector with MCP server URL: `https://mcp.aidd.app`
3. Configure UI widget URL: `https://aidd-backend-prod-739193356129.us-central1.run.app/chatgpt-ui/`
4. Start a chat and invoke AiDD tools

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
