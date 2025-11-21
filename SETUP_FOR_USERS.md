# AiDD Setup Guide for Claude Desktop

## For Regular Users

### What This Does
Adds AiDD capabilities to Claude Desktop so you can:
- Import and process your Apple Notes
- Extract action items and tasks
- Sync with Google Tasks, Microsoft To Do, and more
- Get AI-powered task prioritization

### Quick Setup (Ask someone technical to help with this part)

1. **Download the AiDD MCP package** (provided by your admin)

2. **Double-click the setup file** (coming soon)
   - OR have someone run this one command:
   ```
   npm install && npm run setup
   ```

3. **Restart Claude Desktop**

4. **You're ready!**

### How to Use AiDD in Claude

#### First Time - Connect Your Account
1. In Claude, type: `connect`
2. Your browser will open
3. Sign in with your AiDD account (use Google, Microsoft, or email)
4. Browser will close automatically when done
5. You're connected!

#### Check Your Connection
Type: `status`
- Shows your email and subscription level

#### Start Working with Your Notes
Type: `start_workflow`
- Claude will guide you through importing Apple Notes
- Extract action items
- Convert to tasks
- Sync to your apps

#### If You Get Disconnected
Just type `connect` again - it takes 30 seconds!

### Common Questions

**Q: Do I need to connect every time?**
A: No! Once connected, it remembers you for weeks.

**Q: Browser didn't open?**
A: Claude will show you a link to click instead.

**Q: Which sign-in should I use?**
A: Use whatever you normally use for AiDD - Google is usually easiest.

**Q: Can I use this offline?**
A: You need internet to connect initially, then some features work offline.

### Need Help?
- Type `status` to check your connection
- Type `connect` to sign in again
- Ask Claude "How do I use AiDD?" for guidance

---

## For IT Administrators

### Automated Deployment

Create this config file for your users:

**Location:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "AiDD": {
      "command": "node",
      "args": ["/path/to/aidd-mcp/dist/index-browser-auth.js"],
      "env": {}
    }
  }
}
```

### Mass Deployment Script

```bash
#!/bin/bash
# Deploy to all users
USERS_DIR="/Users"
for user in $USERS_DIR/*; do
  if [ -d "$user" ]; then
    CONFIG_DIR="$user/Library/Application Support/Claude"
    mkdir -p "$CONFIG_DIR"
    cp claude_desktop_config.json "$CONFIG_DIR/"
    chown -R $(basename $user) "$CONFIG_DIR"
  fi
done
```

### Security Notes
- OAuth tokens are encrypted locally
- No passwords stored in config
- Users authenticate through secure browser flow
- Supports your organization's SSO

---

## Making It Even Easier

We're working on:
1. **Auto-installer** - Double-click to set up everything
2. **IT deployment package** - Push via MDM/SCCM
3. **Auto-connect** - Sign in once, never think about it again