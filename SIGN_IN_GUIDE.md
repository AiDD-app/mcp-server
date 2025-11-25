# 🔐 AiDD MCP Sign-In Guide

## Why Sign In?

The AiDD MCP server needs your AiDD account to:
- ✅ Access your subscription features (FREE, PREMIUM, or PRO)
- ✅ Use your saved integration credentials (Google Tasks, Microsoft To-Do, etc.)
- ✅ Apply your account's API limits (not dev limits)
- ✅ Sync tasks with your mobile app

Without signing in, you'll be in **Development Mode** with:
- ⚠️ Limited to 3 AI extractions per week
- ⚠️ No access to your saved credentials
- ⚠️ No subscription features
- ⚠️ Tasks won't sync to your mobile app

## How to Sign In

### Step 1: Run the Sign-In Tool

```bash
cd /Users/marcfridson/Documents/AiDD/claude-apple-notes-mcp
node sign-in.js
```

### Step 2: Choose Your Sign-In Method

```
🚀 AiDD MCP Sign-In
═══════════════════════

Choose sign-in method:

1. Email & Password
2. Google Account (OAuth)
3. Microsoft Account (OAuth)
4. Use Development Mode (No sign-in)
5. Exit
```

### Step 3: Enter Your Credentials

#### Option 1: Email & Password (Recommended)
- Enter your AiDD account email
- Enter your password (hidden input)
- Credentials are encrypted and stored locally

#### Option 2: Google/Microsoft OAuth
- Currently requires browser integration
- Use email/password for now

#### Option 4: Development Mode
- No sign-in required
- Limited features (3 extractions/week)
- Good for testing

### Step 4: Verify Success

After successful sign-in, you'll see:
```
✅ Successfully signed in!
   Email: your.email@example.com
   User ID: usr_xxxxx
   Subscription: PREMIUM
```

### Step 5: Restart Claude Desktop

The MCP server will automatically use your credentials:
```bash
# Restart Claude Desktop
osascript -e 'quit app "Claude"' && sleep 2 && open -a "Claude"
```

## Using the Authenticated MCP Server

Once signed in, the workflow will show your account:

```
You: Start the AiDD workflow

Claude:
🚀 AiDD Workflow Started
✅ Authenticated as: your.email@example.com (PREMIUM)
👤 User ID: usr_xxxxx

Ready to import notes...
```

## Security

Your credentials are:
- 🔒 **Encrypted** using AES-256-CBC
- 📁 **Stored locally** in `~/.aidd-mcp/credentials.json`
- 🛡️ **Protected** with 600 permissions (owner-only)
- 🔄 **Auto-refreshed** when tokens expire
- ❌ **Never sent** to third parties

## Subscription Features

Based on your subscription level:

### FREE (3 extractions/week)
- Basic AI extraction
- Standard task conversion
- Limited API calls

### PREMIUM (20 extractions/week)
- Enhanced AI models
- Priority processing
- Advanced ADHD optimization
- All integrations

### PRO (Unlimited)
- Unlimited AI processing
- Fastest models
- Priority support
- Advanced features

## Troubleshooting

### "Authentication failed"
- Check your email and password
- Ensure your account is active
- Try resetting your password at aidd.app

### "Rate limit exceeded"
- Check your subscription level
- Wait for weekly reset (Monday)
- Upgrade at aidd.app/upgrade

### "No credentials found"
- Run `node sign-in.js` first
- Check `~/.aidd-mcp/` directory exists
- Ensure file permissions are correct

### Sign Out

To sign out and remove credentials:
```bash
rm -rf ~/.aidd-mcp/credentials.json
```

## Support

- Email: support@aidd.app
- Documentation: aidd.app/docs
- iOS App: Check Settings > Account

---

Remember: Signing in gives you access to your full AiDD account features, not just dev mode!