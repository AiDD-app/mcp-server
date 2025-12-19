# ChatGPT UI Widgets Documentation

**Status**: DISABLED (v4.9.0) - Reverted to text-only responses
**Last Updated**: 2025-12-19
**Location**: `/aidd-mcp-web-connector/chatgpt-ui/`

---

## Overview

A complete React-based UI widget system was built for rich interactive task management within ChatGPT. The system includes 7 fully-functional components with dark/light theme support, OpenAI Apps SDK integration, and a build pipeline that generates self-contained HTML bundles.

### Why It Was Disabled

The UI widget system was disabled because adding `_meta` and `structuredContent` fields to MCP tool responses broke ChatGPT's ability to recognize task data. ChatGPT would respond with "I can't list your tasks from here because I don't have access to any task source" despite tasks being present in the raw JSON response.

**Root Cause**: Non-standard fields in MCP responses. The standard MCP response format is:
```typescript
{ content: [{ type: 'text', text: '...' }] }
```

Adding `_meta.ui` or `structuredContent` fields caused ChatGPT to misinterpret the response.

---

## Components Built

### 1. TaskPriorityDashboard
**File**: `src/components/TaskPriorityDashboard.tsx`
**Purpose**: Visual dashboard showing ADHD-optimized task prioritization

**Features**:
- Tasks sorted by AI score with visual priority indicators
- Energy level icons (low/medium/high)
- Task type labels (Quick Win, Focus, Creative, Admin, Collab)
- Score progress bars with color coding
- Dependency indicators
- Re-score button to trigger AI analysis
- Checkbox to mark tasks complete
- Fullscreen expand capability

### 2. EnergyBasedTaskSelector
**File**: `src/components/EnergyBasedTaskSelector.tsx`
**Purpose**: ADHD-optimized task selection based on current energy level

**Features**:
- Three energy level cards (Low/Medium/High) with emoji indicators
- Time-of-day based suggestions
- Filtered task list matching selected energy
- Focus mode launch button
- Score display for each task

### 3. ActionItemExtractionPreview
**File**: `src/components/ActionItemExtractionPreview.tsx`
**Purpose**: Shows AI-extracted action items from notes/emails

**Features**:
- Grouped by source (email, note, etc.)
- Confidence score display
- Priority badges (urgent/high/medium/low)
- Batch selection with select all/deselect all
- Convert to tasks button
- Extraction progress indicator
- Tag display

### 4. QuickCaptureForm
**File**: `src/components/QuickCaptureForm.tsx`
**Purpose**: Fast task creation with smart defaults

**Features**:
- Title input with auto-focus
- Description textarea
- Energy level selector (radio buttons)
- Task type dropdown
- Estimated time input
- Quick submit

### 5. FocusModeWidget
**File**: `src/components/FocusModeWidget.tsx`
**Purpose**: Pomodoro-style focus timer with task view

**Features**:
- Visual countdown timer
- Task details display
- Complete/pause/exit controls
- Session tracking

### 6. DependencyGraph
**File**: `src/components/DependencyGraph.tsx`
**Purpose**: Visual representation of task dependencies

**Features**:
- Task relationship visualization
- Blocking task indicators
- Click to select tasks

### 7. AIScoringResultsCard
**File**: `src/components/AIScoringResultsCard.tsx`
**Purpose**: AI task scoring insights and recommendations

**Features**:
- Average score display
- Score distribution chart (High/Med/Low)
- Top 3 priority tasks
- Quick win counter
- AI-generated insights (blocked tasks, energy recommendations)
- Re-score button with progress indicator
- Last scored timestamp

---

## Architecture

### Project Structure
```
chatgpt-ui/
├── src/
│   ├── components/
│   │   ├── index.ts              # Export all components
│   │   ├── TaskPriorityDashboard.tsx
│   │   ├── EnergyBasedTaskSelector.tsx
│   │   ├── ActionItemExtractionPreview.tsx
│   │   ├── QuickCaptureForm.tsx
│   │   ├── FocusModeWidget.tsx
│   │   ├── DependencyGraph.tsx
│   │   └── AIScoringResultsCard.tsx
│   ├── hooks/
│   │   └── useOpenAI.ts          # SDK integration hooks
│   ├── types/
│   │   └── openai.d.ts           # Type definitions
│   ├── utils/
│   │   └── cn.ts                 # className utility
│   ├── App.tsx                   # Demo app with navigation
│   ├── main.tsx                  # Entry point
│   └── index.css                 # Tailwind styles
├── scripts/
│   └── generate-mcp-resources.js # Build pipeline script
├── package.json
├── vite.config.mcp.ts            # MCP build config
├── tsconfig.json
└── tailwind.config.js
```

### Dependencies
```json
{
  "@openai/apps-sdk-ui": "^0.1.0",
  "@radix-ui/react-checkbox": "^1.0.4",
  "@radix-ui/react-dialog": "^1.0.5",
  "@radix-ui/react-dropdown-menu": "^2.0.6",
  "@radix-ui/react-progress": "^1.0.3",
  "@radix-ui/react-radio-group": "^1.1.3",
  "@radix-ui/react-select": "^2.0.0",
  "@radix-ui/react-tabs": "^1.0.4",
  "@radix-ui/react-tooltip": "^1.0.7",
  "clsx": "^2.1.0",
  "date-fns": "^3.0.0",
  "lucide-react": "^0.303.0",
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "tailwind-merge": "^2.2.0"
}
```

### React Hooks

**useOpenAI()** - Core SDK integration:
```typescript
const {
  isReady,           // SDK loaded
  theme,             // 'light' | 'dark'
  locale,            // e.g., 'en-US'
  callTool,          // Call MCP tools
  requestFullscreen, // Expand widget
  requestInline,     // Shrink widget
  sendMessage,       // Send follow-up to ChatGPT
  getWidgetState,    // Persistent state
  setWidgetState,    // Save state
  toolInput,         // Input from tool call
  toolOutput,        // Pre-populated data
} = useOpenAI();
```

**useTasks()** - Task operations:
```typescript
const {
  tasks,
  loading,
  error,
  fetchTasks,
  createTask,
  updateTask,
  completeTask,
  deleteTasks,
} = useTasks();
```

**useActionItems()** - Action item operations:
```typescript
const {
  actionItems,
  loading,
  error,
  fetchActionItems,
  convertToTasks,
} = useActionItems();
```

**useAIJobs()** - AI job monitoring:
```typescript
const {
  jobs,
  loading,
  fetchJobs,
  scoreTasks,
} = useAIJobs();
```

---

## Build System

### Build Commands
```bash
cd chatgpt-ui

# Development server
npm run dev

# Standard build
npm run build

# MCP resource build (self-contained HTML)
npm run build:mcp
```

### MCP Build Pipeline

The `build:mcp` command:
1. Compiles TypeScript
2. Builds with Vite using `vite.config.mcp.ts`
3. Uses `vite-plugin-singlefile` to inline all CSS/JS
4. Outputs to `dist-mcp/index.html`
5. Runs `generate-mcp-resources.js` to create TypeScript constants

**Output**: `src/chatgpt-ui-resources.ts`
```typescript
export const CHATGPT_UI_WIDGETS_HTML = "<!DOCTYPE html>...";

export const WIDGET_RESOURCES = [
  {
    uri: 'ui://widget/aidd-app.html',
    name: 'AiDD ChatGPT App',
    description: 'Complete AiDD task management interface',
    mimeType: 'text/html+skybridge',
  },
  // ... more widget URIs
];

export const TOOL_WIDGET_MAP: Record<string, string> = {
  'list_tasks': 'ui://widget/task-dashboard.html',
  'score_tasks': 'ui://widget/ai-scoring.html',
  // ... more mappings
};
```

---

## How to Safely Re-Enable

### Prerequisites

Before attempting to re-enable UI widgets, verify:

1. **OpenAI Apps SDK Documentation** - Confirm the exact response format required
2. **MCP Protocol Version** - Ensure compatibility with current MCP spec
3. **ChatGPT App Store Requirements** - Check current submission guidelines

### Safe Implementation Approach

1. **Keep Standard MCP Response Primary**
   ```typescript
   // ALWAYS return standard format as the main response
   return {
     content: [{ type: 'text', text: formattedTextResponse }]
   };
   ```

2. **Use Separate Widget Endpoint** (if supported)
   Instead of embedding UI in tool responses, create a dedicated resource endpoint:
   ```typescript
   // MCP resource handler (not tool response)
   server.setRequestHandler('resources/read', async (request) => {
     if (request.params.uri === 'ui://widget/task-dashboard.html') {
       return {
         contents: [{ uri: request.params.uri, text: WIDGET_HTML, mimeType: 'text/html' }]
       };
     }
   });
   ```

3. **Test Incrementally**
   - Deploy text-only version first
   - Add ONE widget at a time
   - Verify ChatGPT still processes tasks correctly
   - Only proceed if text recognition works

4. **Feature Flag**
   ```typescript
   const UI_WIDGETS_ENABLED = process.env.ENABLE_CHATGPT_WIDGETS === 'true';

   if (UI_WIDGETS_ENABLED && supportsWidgets) {
     // Include widget reference
   }
   ```

### What NOT To Do

1. **DO NOT** add `_meta` field to tool responses
2. **DO NOT** add `structuredContent` field to tool responses
3. **DO NOT** modify the primary `content` array structure
4. **DO NOT** use undocumented OpenAI response formats
5. **DO NOT** deploy without testing task recognition

---

## Testing Checklist

Before re-enabling, verify these scenarios work:

- [ ] "List my tasks" returns actual task data
- [ ] "Show my action items" displays items correctly
- [ ] "Create a task called X" creates the task
- [ ] "Score my tasks" triggers AI scoring
- [ ] ChatGPT can summarize task contents
- [ ] ChatGPT can answer questions about specific tasks
- [ ] Widget renders (if enabled) without breaking text parsing

---

## Related Files

- **MCP Server**: `/aidd-mcp-web-connector/src/aidd-mcp-server.ts`
- **Generated Resources**: `/aidd-mcp-web-connector/src/chatgpt-ui-resources.ts`
- **Dockerfile**: `/aidd-mcp-web-connector/Dockerfile`
- **Package**: `/aidd-mcp-web-connector/package.json`

---

## Version History

| Version | Date | Status | Notes |
|---------|------|--------|-------|
| v4.9.0 | 2025-12-19 | Current | Reverted to text-only, widgets disabled |
| v4.8.0 | 2025-12-19 | Broken | Attempted fix with modified _meta |
| v4.7.0 | 2025-12-19 | Broken | Tried removing structuredContent |
| v4.5.0-4.6.0 | 2025-12-19 | Broken | Initial UI widget integration |
| v4.4.0 | 2025-12-18 | Working | Last known good version (text-only) |

---

## Contact

For questions about the UI widget system or re-enabling it, review the git history for commit `452674e` (ChatGPT App Store compatibility v4.4.0) which contains the last working text-only format.
