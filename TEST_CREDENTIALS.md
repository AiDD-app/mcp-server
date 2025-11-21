# Test Credentials for Anthropic MCP Review

Thank you for reviewing the AiDD MCP Server! We've created dedicated test accounts for your review.

## Test Account Credentials

### Email/Password Authentication
- **Email**: `[TEST_EMAIL_REDACTED]`
- **Password**: `REDACTED`
- **Subscription**: PREMIUM (full access to all features)

### What You Can Test

1. **Authentication Flow**:
   - Run the `connect` tool
   - Your browser will open to `http://localhost:54321/`
   - Use the credentials above to sign in
   - You'll be redirected back to confirm authentication

2. **Available Tools**:
   - `connect` - Opens browser for OAuth authentication
   - `status` - Check authentication status and subscription level
   - `disconnect` - Clear credentials (for testing re-authentication)
   - `start_workflow` - Initiate the Apple Notes import workflow

3. **OAuth Providers**:
   The test account can also authenticate via:
   - Google Sign-In
   - Microsoft Sign-In
   - Apple Sign-In

## Backend API Details

- **Backend URL**: `https://aidd-backend-prod-739193356129.us-central1.run.app`
- **API Key**: `dev-api-key-123456` (automatically handled by the MCP server)
- **Authentication Endpoint**: `POST /api/auth/oauth/signin`

## Expected Behavior

### Successful Authentication
After signing in, you should see:
```
✅ Connected to AiDD

📧 Email: [TEST_EMAIL_REDACTED]
💎 Subscription: PREMIUM
🔑 User ID: [unique-id]
⏰ Token expires in: 60 minutes

Ready to process your Apple Notes!
```

### Token Management
- Access tokens are valid for 60 minutes
- Refresh tokens are valid for 30 days
- Tokens are automatically refreshed when expired
- Credentials are stored securely at: `~/.aidd-mcp/auth-credentials.json`

## Troubleshooting

### If Browser Doesn't Open
Visit manually: http://localhost:54321/

### If Authentication Fails
1. Check that the MCP server is running
2. Ensure port 54321 is available
3. Try the `disconnect` tool and reconnect

### For Issues or Questions
- **Email**: support@aidd.app
- **GitHub Issues**: https://github.com/aidd-app/mcp-server/issues
- **Backend Status**: https://aidd-backend-prod-739193356129.us-central1.run.app/health

## Security Note

These test credentials are for review purposes only. They provide access to a sandboxed test environment with limited functionality and no access to production user data.

---

Thank you for reviewing AiDD MCP Server!
The AiDD Team
