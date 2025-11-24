# 🚀 AiDD MCP Server - Complete Workflow Guide

## ✅ Installation Complete!

The **AiDD MCP Server** has been successfully installed and configured in Claude Desktop!

### What's New in v2.0

This is a **complete redesign** that integrates directly with your AiDD backend services:

- ✅ **Backend Integration**: Uses your production AiDD backend at `https://aidd-backend-prod-739193356129.us-central1.run.app`
- ✅ **Structured Workflow**: Similar to your custom GPT with step-by-step guidance
- ✅ **AI-Powered Processing**: All extraction, conversion, and scoring happens on your backend
- ✅ **ADHD Optimization**: Tasks are broken down and prioritized for ADHD minds
- ✅ **Progress Tracking**: Real-time SSE updates from backend processing
- ✅ **Multi-Service Sync**: Export to Google Tasks, Microsoft To-Do, Trello, Todoist, Notion, TickTick

## 🎯 How to Use AiDD in Claude

### Step 1: Restart Claude Desktop

**Required for changes to take effect:**
```bash
# Either manually close and reopen, or:
osascript -e 'quit app "Claude"' && sleep 2 && open -a "Claude"
```

### Step 2: Start Your Workflow

In Claude, simply say:
```
Start the AiDD workflow
```

Or be more specific:
```
Start AiDD workflow and sync to Google Tasks
```

## 📋 Complete Workflow Example

Here's a typical session showing the structured flow:

```
You: Start the AiDD workflow for Google Tasks

Claude (using AiDD tools):
🚀 **AiDD Workflow Started**
✅ Authenticated with backend
👤 User ID: device-xxx-xxx

Ready to import notes. Next step: Use import_notes

You: Import all my notes from the last week

Claude:
📥 **Notes Imported Successfully**
• Notes imported: 23
• From: All folders

Next step: Process notes to extract action items

You: Process the notes to find action items

Claude:
🔍 **Action Items Extracted**
• Notes processed: 23
• Action items found: 47
• Mode: adhd-optimized

Extracted items include:
1. Schedule dentist appointment (High priority)
2. Review Q4 budget report (Medium priority)
3. Call mom about holiday plans (High priority)
...

Next step: Convert to ADHD-optimized tasks

You: Convert them to tasks

Claude:
✨ **Tasks Created (ADHD-Optimized)**
• Action items converted: 47
• Tasks created: 132 (average 2.8 tasks per item)

Task breakdown:
• Quick wins: 28
• Focus required: 41
• Collaborative: 23
• Creative: 18
• Administrative: 22

Next step: Score and prioritize

You: Score and prioritize for afternoon work

Claude:
🎯 **Tasks Scored & Prioritized**

Top Priority Tasks (Next 2 Hours):
1. Reply to client email (Score: 95/100)
   - Quick win, low energy
2. Update project status doc (Score: 89/100)
   - 15 min task, medium importance

Suggested Schedule:
☀️ Afternoon (Medium Energy):
• Review budget report (break into 3 chunks)
• Team check-in call
• Draft proposal outline

Next step: Sync to Google Tasks

You: Sync to Google Tasks

Claude:
🎉 **Sync Complete!**
✅ Successfully synced 132 tasks to Google Tasks

Summary:
• Notes processed: 23
• Action items: 47
• Tasks created: 132
• All organized by priority and energy level

Open Google Tasks to see your organized tasks!
```

## 🛠 Available Commands

### Main Workflow Tools

| Command | Description | Example |
|---------|-------------|---------|
| `start_workflow` | Begin the AiDD workflow | "Start the AiDD workflow" |
| `import_notes` | Import notes from Apple Notes | "Import notes from my Work folder" |
| `process_notes` | Extract action items using AI | "Process notes to find tasks" |
| `review_action_items` | Review extracted items | "Show me the action items" |
| `convert_to_tasks` | Create ADHD-optimized tasks | "Convert to tasks with detailed breakdown" |
| `score_and_prioritize` | AI task scoring | "Score tasks for morning work" |
| `sync_to_service` | Sync to task manager | "Sync to Microsoft To-Do" |

### Utility Commands

| Command | Description |
|---------|-------------|
| `get_workflow_status` | Check current progress |
| `reset_workflow` | Start fresh |
| `check_backend_health` | Verify backend connection |

## 🎯 Key Features

### 1. Structured Workflow
Unlike basic note tools, AiDD guides you through a complete workflow:
- Import → Extract → Convert → Score → Sync
- Each step builds on the previous
- Clear next-step guidance

### 2. Backend AI Processing
All AI operations use your production backend:
- **Extraction**: Gemini 3 Pro Preview for finding action items
- **Conversion**: ADHD-optimized task breakdown
- **Scoring**: Multi-factor prioritization

### 3. ADHD Optimization
Tasks are specifically optimized for ADHD:
- Break complex tasks into smaller chunks
- Consider energy levels and time of day
- Identify quick wins vs. deep focus tasks
- Smart dependency tracking

### 4. Real-time Progress
Server-Sent Events provide live updates:
- See extraction progress
- Watch conversion happening
- Track sync status

## 🔧 Troubleshooting

### "Tools not working after update"
**Solution**: Restart Claude Desktop completely

### "Authentication failed"
**Solution**: Check internet connection, backend is cloud-based

### "No action items found"
**Solution**: Try different extraction mode:
- `quick` - Fast, basic extraction
- `comprehensive` - Thorough analysis
- `adhd-optimized` - Best for task breakdowns

### "Sync failed"
**Solution**: Ensure you have credentials set up for target service in AiDD app

## 🎨 Customization Options

### Extraction Modes
```
Process notes with extraction mode 'comprehensive'
```

### Task Breakdown Styles
```
Convert to tasks with 'detailed' breakdown
```

### Time-based Scoring
```
Score tasks for 'morning' energy levels
```

### Service-specific Sync
```
Sync to Trello with backup
```

## 📊 Resources Available

You can also access these resources directly:
- `aidd://workflow/status` - Current workflow state
- `aidd://action-items` - Extracted items JSON
- `aidd://tasks` - Converted tasks JSON
- `aidd://backend/metrics` - Backend performance

## 🚀 Quick Start Commands

Just copy and paste these into Claude:

1. **Full Auto Workflow**:
```
Start AiDD workflow with auto-sync to Google Tasks, then import all notes, process them, convert to tasks, score them, and sync
```

2. **Work Notes Only**:
```
Start AiDD workflow, import notes from Work folder, process with comprehensive extraction, convert with ADHD optimization
```

3. **Quick Processing**:
```
Import my recent notes and extract action items quickly
```

## 🎯 Why This is Better Than ChatGPT

1. **Direct Integration**: No copy-pasting, works directly with Apple Notes
2. **Backend Services**: Uses your actual AiDD backend, not generic AI
3. **Structured Flow**: Guides you through each step systematically
4. **Progress Tracking**: See what's happening in real-time
5. **Multi-Service**: Sync to any supported task manager
6. **ADHD-Specific**: Optimizations built into every step

## 📱 Integration with AiDD iOS App

The tasks created here will:
- Appear in your AiDD iOS app if synced to same service
- Include all metadata (priorities, energy levels, dependencies)
- Be compatible with AiDD's task scoring system
- Work with focus mode and notification features

## 🔄 Version Information

- **MCP Server**: v2.0.0 (Backend Integrated)
- **Backend API**: Production (https://aidd-backend-prod-739193356129.us-central1.run.app)
- **AI Models**: Gemini 3 Pro Preview/2.5 Flash
- **Compatibility**: AiDD iOS 3.2.5+

---

## 🎉 You're All Set!

The AiDD MCP server is ready to transform your Apple Notes into actionable, ADHD-optimized tasks. Just restart Claude Desktop and say **"Start the AiDD workflow"** to begin!

For support or questions about the AiDD platform, check your AiDD iOS app or the backend monitoring dashboard.