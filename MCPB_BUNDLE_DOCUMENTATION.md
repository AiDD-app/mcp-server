# AiDD.mcpb Bundle Documentation

## Bundle Created Successfully! ✅

**File**: `AiDD.mcpb`
**Size**: 260 KB
**Format**: MCP Bundle (ZIP archive)
**Version**: 1.0.0

## What is an MCPB File?

An MCPB (Model Context Protocol Bundle) is a self-contained package that includes:
- MCP server implementation
- Manifest with metadata
- Installation scripts
- Configuration templates
- All dependencies and source code

## Bundle Contents

```
AiDD.mcpb/
├── manifest.json          # Bundle metadata and configuration
├── package.json           # npm package configuration
├── install.sh            # Automated installation script
├── config.json           # Default configuration template
├── icon.png              # Extension icon
├── README.md             # Documentation
├── src/                  # TypeScript source files
├── dist/                 # Compiled JavaScript files
├── bin/                  # Executable wrapper
└── tsconfig.json         # TypeScript configuration
```

## Manifest Overview

The bundle includes a comprehensive manifest with:

### Metadata
- **Name**: AiDD
- **Version**: 1.0.0
- **Author**: AiDD Team
- **License**: MIT
- **Homepage**: https://aidd.app

### Runtime Requirements
- **Node.js**: >=18.0.0
- **Platform**: macOS (Darwin)
- **Dependencies**: AppleScript support required

### MCP Configuration
- **Protocol Version**: 1.0.0
- **Command**: `npx @aidd-app/mcp`
- **Installation Type**: npm with local fallback

### Features
1. **Apple Notes Integration** - Full CRUD operations
2. **OAuth Authentication** - Browser-based flow
3. **AI Task Processing** - Action item extraction
4. **Multi-Service Sync** - 7+ integrations

### Available Tools
- `connect` - OAuth authentication
- `disconnect` - Sign out
- `status` - Check connection
- `import` - Import Apple Notes
- `extract` - Extract action items
- `sync` - Sync with services
- `createNote` - Create Apple Note
- `updateNote` - Update Apple Note
- `deleteNote` - Delete Apple Note
- `listNotes` - List all notes

## Installation Methods

### Method 1: Desktop Extension Application

If you're integrating this into a Desktop Extension Application:

```javascript
// Load and install MCPB
const mcpbPath = './AiDD.mcpb';
const bundle = await loadMCPBundle(mcpbPath);
await installBundle(bundle);
```

### Method 2: Manual Installation

Extract and run the installation script:

```bash
# Extract the bundle
unzip AiDD.mcpb

# Navigate to extracted directory
cd AiDD.mcpb

# Run installation
./install.sh
```

### Method 3: Direct Claude Desktop Installation

The bundle automatically configures Claude Desktop by:
1. Installing the npm package
2. Updating `claude_desktop_config.json`
3. Adding MCP server configuration

## Configuration

The bundle includes a default configuration template (`config.json`):

```json
{
  "aidd": {
    "apiEndpoint": "https://api.aidd.app",
    "authPort": 5173,
    "debug": false,
    "features": {
      "appleNotes": true,
      "aiProcessing": true,
      "multiServiceSync": true
    }
  }
}
```

## Permissions Required

The bundle declares these permission requirements:

1. **AppleScript** - Access Apple Notes
2. **Network** - OAuth and API communication
3. **Browser** - OAuth authentication flow

## Distribution Options

### 1. Include in Desktop Extension App
```
YourApp.app/
└── Contents/
    └── Resources/
        └── MCPBundles/
            └── AiDD.mcpb
```

### 2. Standalone Distribution
- Host on CDN or download server
- Direct download link for users
- Include in installer packages

### 3. App Store / Marketplace
- Submit as bundled extension
- Include in app resources
- Auto-install on first launch

## Testing the Bundle

### Verify Bundle Structure
```bash
unzip -l AiDD.mcpb | head -20
```

### Test Installation
```bash
unzip AiDD.mcpb -d /tmp/test-bundle
cd /tmp/test-bundle/AiDD.mcpb
./install.sh
```

### Verify in Claude Desktop
1. Restart Claude Desktop
2. Check Settings → Developer → MCP Servers
3. Verify "AiDD" appears in the list

## Bundle Metadata

### Version Information
- **Bundle Format**: 1.0.0
- **MCP Protocol**: 1.0.0
- **Package Version**: 1.0.0
- **Created**: 2024-11-16

### Compatibility
- **Claude Desktop**: All versions with MCP support
- **macOS**: 10.15+ (Catalina and newer)
- **Node.js**: 18.0.0+

## Support and Updates

### Support Channels
- **GitHub Issues**: https://github.com/aidd-app/mcp-server/issues
- **Email**: support@aidd.app
- **Documentation**: https://aidd.app/docs

### Update Mechanism
The bundle supports both:
1. **npm updates**: Automatic via npm registry
2. **Local updates**: Replace bundle file

## Security Considerations

### OAuth Flow
- Browser-based authentication
- No credentials stored in bundle
- Secure token management

### Data Privacy
- All data processed locally
- Optional cloud sync
- End-to-end encryption available

## Success! 🎉

Your AiDD.mcpb bundle is ready for distribution!

### What You Can Do Now:

1. **Test Installation**
   ```bash
   unzip AiDD.mcpb && cd AiDD.mcpb && ./install.sh
   ```

2. **Include in Your App**
   - Add to your Desktop Extension Application resources
   - Load and install programmatically

3. **Distribute to Users**
   - Direct download
   - Include in installers
   - App store submission

4. **Monitor Usage**
   - Track installations via npm stats
   - Collect feedback via support channels

The bundle provides a complete, self-contained MCP extension that can be easily integrated into any Desktop Extension Application or distributed standalone to users!