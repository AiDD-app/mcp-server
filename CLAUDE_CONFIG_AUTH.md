# 🔐 AiDD MCP Authentication Configuration

## Authentication Works Like Figma & Other MCP Services

The AiDD MCP server now has **built-in authentication** that works directly within Claude Desktop. You have three options:

## Option 1: Configure in Claude Desktop Settings (Recommended)

Edit your Claude Desktop configuration file:

**Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "AiDD": {
      "command": "node",
      "args": ["/Users/marcfridson/Documents/AiDD/claude-apple-notes-mcp/dist/index-aidd-auth.js"],
      "env": {
        "AIDD_EMAIL": "your.email@example.com",
        "AIDD_PASSWORD": "your-password",
        "AIDD_AUTH_METHOD": "email"
      }
    }
  }
}
```

### Available Environment Variables:
- `AIDD_EMAIL`: Your AiDD account email
- `AIDD_PASSWORD`: Your AiDD account password
- `AIDD_AUTH_METHOD`: Authentication method (`email`, `google`, `microsoft`, `dev`)

**After adding credentials:**
1. Save the config file
2. Restart Claude Desktop
3. The MCP server will auto-authenticate on startup

## Option 2: Sign In Through Claude Chat

If you don't configure credentials in settings, you can sign in directly in Claude:

```
You: Sign in to AiDD

Claude: I'll help you sign in to your AiDD account. Let me authenticate you.

[Uses sign_in tool]

You'll see:
✅ Successfully signed in!
Email: your.email@example.com
Subscription: PREMIUM
```

### Available Authentication Commands in Claude:

```javascript
// Sign in with email/password
sign_in(email: "your@email.com", password: "yourpassword")

// Use development mode (no account needed)
configure_auth(method: "dev")

// Check authentication status
check_auth_status()

// Sign out
sign_out()
```

## Option 3: Development Mode (No Account Required)

For testing without an account:

### In Configuration:
```json
{
  "mcpServers": {
    "AiDD": {
      "command": "node",
      "args": ["/Users/marcfridson/Documents/AiDD/claude-apple-notes-mcp/dist/index-aidd-auth.js"],
      "env": {
        "AIDD_AUTH_METHOD": "dev"
      }
    }
  }
}
```

### Or in Claude:
```
You: Use AiDD in development mode

Claude: [Uses configure_auth(method: "dev")]
```

**Dev Mode Limitations:**
- 3 AI extractions per week
- No saved integrations
- No mobile app sync

## How It Works (Like Figma MCP)

1. **On Startup**: Server checks for environment credentials
2. **Auto-Authentication**: If credentials provided, signs in automatically
3. **Secure Storage**: Credentials encrypted and stored locally
4. **Token Management**: Auto-refreshes expired tokens
5. **In-Chat Auth**: Can sign in/out without restarting Claude

## Authentication States

### Not Authenticated
```
You: Start AiDD workflow

Claude: ⚠️ Authentication Required

Please sign in to your AiDD account first:
- Use sign_in(email, password)
- Or configure in settings
- Or use dev mode
```

### Authenticated
```
You: Start AiDD workflow

Claude: 🚀 AiDD Workflow Started
✅ Authenticated as: your@email.com (PREMIUM)
Ready to import notes...
```

## Security Features

- ✅ **Encrypted Storage**: Credentials encrypted with AES-256
- ✅ **Local Only**: Never sent to third parties
- ✅ **Auto-Refresh**: Tokens refreshed automatically
- ✅ **Secure Config**: Claude Desktop config is user-only readable

## Checking Authentication

### In Claude:
```
You: Check my AiDD authentication status

Claude: [Uses check_auth_status()]
✅ Authenticated
Email: your@email.com
Subscription: PREMIUM
```

### Via Resources:
```
You: Read aidd://auth/status

Claude: Shows current auth status in JSON format
```

## Subscription Features by Auth Level

| Feature | Dev Mode | FREE | PREMIUM | PRO |
|---------|----------|------|---------|-----|
| AI Extractions/Week | 3 | 3 | 20 | Unlimited |
| Task Conversion | Basic | Standard | Enhanced | Advanced |
| Integrations | None | Basic | All | All + Priority |
| Mobile Sync | ❌ | ✅ | ✅ | ✅ |
| Support | None | Email | Priority | Phone |

## Troubleshooting

### "Authentication Required" in Claude
- You haven't signed in yet
- Run: `sign_in(email: "your@email.com", password: "yourpassword")`

### "Invalid Credentials"
- Check email/password spelling
- Ensure account is active at aidd.app
- Try resetting password

### "Rate Limit Exceeded"
- Check your subscription level
- Upgrade at aidd.app/pricing

### Credentials Not Persisting
- Check file permissions on `~/.aidd-mcp/`
- Ensure Claude has write access
- Try signing in again

## Complete Configuration Example

```json
{
  "mcpServers": {
    "AiDD": {
      "command": "node",
      "args": ["/Users/marcfridson/Documents/AiDD/claude-apple-notes-mcp/dist/index-aidd-auth.js"],
      "env": {
        "AIDD_EMAIL": "john.doe@example.com",
        "AIDD_PASSWORD": "SecurePassword123!",
        "AIDD_AUTH_METHOD": "email"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/Users/marcfridson/Documents"]
    }
  }
}
```

After saving this configuration and restarting Claude Desktop, the AiDD MCP will automatically authenticate with your account!

## Migration from Standalone Sign-In

If you previously used the `sign-in.js` script:
1. Your credentials in `~/.aidd-mcp/credentials.json` will still work
2. The new MCP server reads the same credential file
3. No need to re-authenticate

---

The AiDD MCP now works just like Figma and other professional MCP services - configure once, use everywhere in Claude!