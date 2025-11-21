# Installing AiDD MCP with Claude Desktop

## Quick Install (Recommended)

### Via Claude Desktop UI
1. Open **Claude Desktop**
2. Go to **Settings** → **Developer** → **MCP Servers** → **Add Server**
3. Enter package name: `@aidd-app/mcp`
4. Click **Install**
5. Restart Claude Desktop

### Manual Configuration

Add the following to your Claude Desktop config file:

**Config File Location**:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

**Configuration**:
```json
{
  "mcpServers": {
    "AiDD": {
      "command": "npx",
      "args": ["@aidd-app/mcp"],
      "env": {}
    }
  }
}
```

**Then restart Claude Desktop.**

---

## Development Install (Local Testing)

For testing the latest development version or contributing:

### 1. Clone Repository
```bash
git clone https://github.com/AiDD-app/mcp-server.git
cd mcp-server
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Build
```bash
npm run build
```

### 4. Configure Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "AiDD": {
      "command": "node",
      "args": ["/FULL/PATH/TO/mcp-server/dist/index-browser-auth.js"],
      "env": {}
    }
  }
}
```

**Important**: Replace `/FULL/PATH/TO/` with the actual path to your cloned repository.

**Example**:
```json
{
  "mcpServers": {
    "AiDD": {
      "command": "node",
      "args": ["/Users/yourname/projects/mcp-server/dist/index-browser-auth.js"],
      "env": {}
    }
  }
}
```

### 5. Restart Claude Desktop

---

## Verification

After installation, verify the MCP is working:

1. Open Claude Desktop
2. Type: **"connect to AiDD"**
3. You should see a message about opening your browser
4. Browser will open to `http://localhost:54321/`
5. Sign in with your AiDD account

---

## First Time Setup

### 1. Authentication

In Claude, type: **"connect"**

This will:
- Open your browser to the AiDD login page
- Allow you to sign in with:
  - Google
  - Microsoft
  - Apple
  - Email/Password

### 2. Verify Connection

Type: **"status"**

You should see:
```
✅ Connected to AiDD

📧 Email: your-email@example.com
💎 Subscription: FREE/PREMIUM/PRO
🔑 User ID: user_xxxxx
⏰ Token expires in: XX minutes
```

### 3. Start Using

Available commands:
- **"connect"** - Sign in to your AiDD account
- **"status"** - Check authentication status
- **"start workflow"** - Begin importing Apple Notes
- **"disconnect"** - Sign out

---

## Troubleshooting

### Browser Doesn't Open
If the browser doesn't open automatically:
1. Manually visit: `http://localhost:54321/`
2. Sign in with your credentials

### Port Already in Use
If you see "Port 54321 already in use":
1. Check for other running instances
2. Wait a few seconds and try again
3. Restart Claude Desktop

### Authentication Fails
1. Verify your AiDD account credentials
2. Check internet connection
3. Try the **"disconnect"** command and reconnect
4. Check logs in Claude Desktop (Settings → Developer → View Logs)

### MCP Not Loading
1. Verify the config file path is correct
2. Check JSON syntax is valid
3. Ensure all file paths use absolute paths
4. Restart Claude Desktop
5. Check Claude Desktop logs for errors

---

## Requirements

- **macOS**: 10.15+ (for Apple Notes integration)
- **Node.js**: 18.0.0 or higher
- **Claude Desktop**: Latest version
- **AiDD Account**: Free or paid subscription

---

## Getting an AiDD Account

1. Visit: [https://aidd.app](https://aidd.app)
2. Download the iOS app
3. Sign up with:
   - Google
   - Microsoft
   - Apple
   - Email/Password
4. Use the same credentials with the MCP

---

## Updating

### NPM Version
```bash
# The MCP will auto-update when you restart Claude Desktop
# Or manually update:
npm update @aidd-app/mcp -g
```

### Development Version
```bash
cd mcp-server
git pull origin main
npm install
npm run build
# Restart Claude Desktop
```

---

## Uninstalling

### Remove from Config
1. Open `claude_desktop_config.json`
2. Remove the `"AiDD"` entry from `mcpServers`
3. Save the file
4. Restart Claude Desktop

### Clean Up Credentials
```bash
rm -rf ~/.aidd-mcp/
```

---

## Support

- **Issues**: [GitHub Issues](https://github.com/AiDD-app/mcp-server/issues)
- **Email**: support@aidd.app
- **Website**: [https://aidd.app](https://aidd.app)
- **Documentation**: [README.md](README.md)

---

## Privacy & Security

- All authentication tokens are stored locally at `~/.aidd-mcp/auth-credentials.json`
- Apple Notes content is processed temporarily and never permanently stored
- Review our full [Privacy Policy](https://www.aidd.app/privacy)

---

Made with ❤️ by the AiDD Team for the ADHD community
