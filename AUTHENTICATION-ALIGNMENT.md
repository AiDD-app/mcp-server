# Authentication Alignment with AiDD Web App

## Overview

The AiDD MCP Web Connector v4.0.0 now uses **browser-based OAuth authentication** that matches the AiDD web app's authentication flow.

## Changes Made

### 1. Browser-Based OAuth Flow (NEW)

**File**: `src/oauth-flow.ts`

- Implements browser-based OAuth for universal access
- Opens browser for user authentication
- Local callback server receives OAuth tokens
- Supports Google, Microsoft, and Apple Sign-In
- 5-minute timeout for authentication

**How it works**:
1. MCP server starts local HTTP server on port 8765
2. Opens browser to backend OAuth URL
3. User signs in with provider of choice
4. Backend redirects to local callback with tokens
5. MCP server stores tokens securely

### 2. Updated AuthManager

**File**: `src/auth-manager.ts`

**Fixed OAuth Endpoints**:
- ❌ **Before**: Called `/api/auth/google`, `/api/auth/microsoft` (wrong endpoints)
- ✅ **After**: Uses browser-based OAuth flow with `/oauth/signin?provider=...&redirect_uri=...`

**Added Apple Sign-In Support**:
- `signInWithApple()` - Browser-based Apple OAuth
- Matches iOS app's Apple Sign-In implementation

**Updated Methods**:
- `signInWithGoogle()` - Now browser-based (was token exchange)
- `signInWithMicrosoft()` - Now browser-based (was token exchange)
- `signInWithApple()` - NEW method for Apple Sign-In
- `signInWithOAuth(provider?)` - Generic OAuth with optional provider

### 3. Updated Connect Tool

**File**: `src/aidd-mcp-server.ts`

**New Features**:
- Browser automatically opens for authentication
- Optional `provider` parameter to specify OAuth provider
- Checks if already authenticated before opening browser
- Better error messages for authentication failures

**Usage**:
```javascript
// Generic OAuth (user chooses provider)
connect()

// Specific provider
connect({ provider: 'google' })
connect({ provider: 'microsoft' })
connect({ provider: 'apple' })
```

## Backend Compatibility

### OAuth Endpoints Used

**Production Backend**: `https://aidd-backend-prod-739193356129.us-central1.run.app`

**OAuth Flow**:
1. Browser opens to: `/oauth/signin?provider={provider}&redirect_uri={callback}&response_type=token`
2. User authenticates with chosen provider
3. Backend redirects to: `http://localhost:8765/oauth/callback?accessToken=...&refreshToken=...&userId=...&email=...&subscription=...`

**Supported Providers**:
- `google` - Google Sign-In
- `microsoft` - Microsoft OAuth
- `apple` - Apple Sign-In

### Token Management

**Tokens Received**:
- `accessToken` - JWT access token (30 days default)
- `refreshToken` - Refresh token (90 days)
- `userId` - User ID
- `email` - User email
- `subscription` - Subscription tier (FREE/PREMIUM/PRO)

**Token Storage**:
- Location: `~/.aidd-mcp/credentials.json`
- Encryption: AES-256-CBC
- Permissions: 0600 (owner read/write only)

**Token Refresh**:
- Auto-refresh when token expires
- Uses `/api/auth/refresh` endpoint
- Maintains subscription tier

## Security Features

1. **Encrypted Storage**: Credentials encrypted with AES-256-CBC
2. **Local Callback**: OAuth callback uses localhost (port 8765)
3. **Secure Permissions**: Credentials file restricted to owner only
4. **Timeout Protection**: 5-minute authentication timeout
5. **Token Refresh**: Automatic token refresh on expiry

## Migration from v3.x

### Old Authentication (v3.x)
- Required OAuth tokens from external sources
- Called wrong backend endpoints
- No Apple Sign-In support
- Token exchange only (not browser-based)

### New Authentication (v4.0)
- Browser-based OAuth flow
- Matches AiDD web app authentication
- Full Apple Sign-In support
- Universal access (web, mobile, desktop)

## Testing Authentication

### Test Browser OAuth Flow

```bash
# Build and start server
npm run build
npm start

# In Claude:
# User: connect
# [Browser opens for authentication]
# User signs in with Google/Microsoft/Apple
# [Returns to Claude with success message]

# Check status
# User: status
# Claude shows: email, subscription, user ID
```

### Test Provider-Specific OAuth

```bash
# Google
connect({ provider: 'google' })

# Microsoft
connect({ provider: 'microsoft' })

# Apple
connect({ provider: 'apple' })
```

### Expected Behavior

1. **First Time**:
   - Browser opens to authentication page
   - User selects provider and signs in
   - Browser shows success message
   - MCP stores tokens locally
   - Claude shows connected status

2. **Subsequent Times**:
   - MCP checks stored tokens
   - If valid, uses existing session
   - If expired, auto-refreshes token
   - If refresh fails, prompts re-authentication

## Web App Alignment

The MCP web connector now matches the AiDD web app authentication in these ways:

1. ✅ **OAuth Flow**: Browser-based with provider selection
2. ✅ **Providers**: Google, Microsoft, Apple (same as web app)
3. ✅ **Endpoints**: Uses correct OAuth endpoints
4. ✅ **Token Format**: Same JWT access/refresh tokens
5. ✅ **Security**: Encrypted storage, auto-refresh
6. ✅ **User Experience**: Seamless browser authentication

## Troubleshooting

### "Browser didn't open"
- URL is printed to console
- Manually copy/paste URL to browser
- Common on Linux/headless systems

### "Authentication timeout"
- User has 5 minutes to complete sign-in
- Restart authentication if timeout occurs
- Check browser popup blockers

### "Failed to connect"
- Check backend health: `check_backend_health`
- Verify network connectivity
- Check browser console for errors
- Try different provider

### "Token expired"
- Should auto-refresh automatically
- If refresh fails, re-run `connect`
- Check `~/.aidd-mcp/credentials.json` permissions

## Summary

The AiDD MCP Web Connector v4.0.0 now provides:
- ✅ Browser-based OAuth authentication
- ✅ Same authentication flow as AiDD web app
- ✅ Support for Google, Microsoft, and Apple
- ✅ Secure token storage and auto-refresh
- ✅ Universal access (web, mobile, desktop)
- ✅ Production-ready security

This ensures a consistent authentication experience across all AiDD platforms.
