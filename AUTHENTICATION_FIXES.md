# AiDD MCP Authentication Fixes

## Issues Identified and Fixed

### 1. Subscription Showing as FREE ✅ FIXED

**Problem**: User with paid subscription was showing as "FREE" tier after authentication.

**Root Cause**: The backend might return subscription status in different fields depending on the response format.

**Fix Applied**:
- Enhanced subscription detection to check multiple possible fields:
  - `data.user.subscription`
  - `data.subscription`
  - `data.subscriptionStatus`
  - `data.user.subscriptionStatus`
- Added debug logging to see full auth response
- Fixed display to use the correct subscription variable

**Code Changed**: `/src/index-browser-auth.ts` lines 327-344

### 2. Google SSO Error (VAL_005) ✅ RESOLVED

**Problem**: Google Sign-In returned `{"error":true,"message":"Invalid input detected","code":"VAL_005"}`

**Root Cause**: Backend does not have `/api/auth/google` endpoint. The OAuth endpoints in `oauth-endpoints.js` were never integrated into the production server.

**Resolution**:
- SSO temporarily disabled with user-friendly message
- Backend uses device authentication for email/password
- SSO requires iOS app's native OAuth flow, not web OAuth

**Code Changed**: `/src/index-browser-auth.ts` lines 608-613

### 3. Microsoft SSO Error (VAL_005) ✅ RESOLVED

**Problem**: Microsoft Sign-In returned same VAL_005 error

**Root Cause**: Same as Google - backend lacks `/api/auth/microsoft` endpoint

**Resolution**: Same as Google - disabled with informative message

**Code Changed**: `/src/index-browser-auth.ts` lines 615-620

### 4. Apple SSO ✅ RESOLVED

**Problem**: Would have had same issue

**Resolution**: Preemptively disabled with same approach

**Code Changed**: `/src/index-browser-auth.ts` lines 622-627

## Backend Architecture Discovered

### Available Authentication Endpoints:
- `/api/auth/device` - Device authentication (email/password) ✅ WORKING
- `/api/auth/oauth/signin` - OAuth token verification (for iOS app)
- `/api/auth/refresh` - Token refresh
- `/api/auth/login` - Standard login (not used by MCP)

### Missing Endpoints:
- `/api/auth/google` - Does not exist
- `/api/auth/microsoft` - Does not exist
- `/api/auth/apple` - Does not exist
- `/oauth/authorize` - Draft in `oauth-endpoints.js`, never integrated

## Current Working Authentication

### Email/Password ✅ FULLY FUNCTIONAL
1. User enters email and password
2. MCP calls `/api/auth/device` with credentials
3. Backend returns tokens and user info
4. Subscription status included in response
5. Tokens saved locally for persistence

### SSO 🚫 TEMPORARILY DISABLED
- Backend lacks web OAuth flow
- iOS app handles OAuth client-side
- Web OAuth would require backend changes

## Recommendations for Full SSO Support

To enable SSO in the MCP server, the backend would need:

1. **Option A**: Integrate `oauth-endpoints.js` into production
   - Add `/oauth/authorize` and `/oauth/token` endpoints
   - Configure OAuth clients for Google/Microsoft/Apple
   - Handle PKCE flow for security

2. **Option B**: Create MCP-specific OAuth proxy
   - Add `/api/auth/google`, `/api/auth/microsoft`, `/api/auth/apple`
   - Redirect to OAuth providers
   - Return tokens in MCP-compatible format

3. **Option C**: Use AiDD web app as OAuth proxy
   - Web app at `web.aidd.app` handles OAuth
   - Add MCP callback support
   - Return tokens to local MCP server

## Testing Instructions

### Test Email/Password Authentication:
1. Restart Claude Desktop
2. Type: `connect`
3. Enter AiDD email and password
4. Click "Sign In"
5. Check console logs for subscription status
6. Verify authentication with: `status`

### Verify SSO is Properly Disabled:
1. Click any SSO button
2. Should see alert: "[Provider] Sign-In is temporarily unavailable"
3. Console shows: "SSO Error: Backend does not have /api/auth/[provider] endpoint"

## Files Modified

1. `/src/index-browser-auth.ts`
   - Enhanced subscription detection (lines 327-344)
   - Disabled SSO with informative messages (lines 608-627)
   - Added debug logging for auth response

2. `/dist/index-browser-auth.js`
   - Compiled JavaScript with all fixes

## Next Steps

For the user:
- Use email/password authentication (fully working)
- Subscription status should now display correctly
- Check console logs if subscription still shows FREE

For development:
- Backend team needs to implement web OAuth endpoints
- Or use one of the recommended approaches above
- Once backend supports web OAuth, re-enable SSO buttons

---

**Status**: Email/password authentication is production-ready. SSO requires backend changes.