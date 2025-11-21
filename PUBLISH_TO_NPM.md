# Publishing AiDD MCP for Easy Installation

## Goal: Install Like Commercial MCPs
Users should be able to install via Claude Desktop's UI, just like GitHub/JIRA/Slack MCPs.

## Steps to Publish to NPM

### 1. Prepare Package for Publishing

```bash
# Update package.json with proper metadata
npm version 1.0.0

# Build distribution
npm run build

# Create .npmignore
echo "src/
*.ts
tsconfig.json
test-*
*.md
!README.md
.env*
credentials/
switch-auth-mode.sh
install.sh" > .npmignore
```

### 2. Publish to NPM Registry

```bash
# Login to npm (one-time)
npm login

# Publish the package
npm publish --access public
```

### 3. After Publishing

Users can install directly in Claude Desktop:

#### Via Claude Desktop UI:
1. Open Claude Desktop
2. Settings → MCP Servers → Add Server
3. Package name: `@aidd/mcp`
4. Click Install

#### Or Via Config (Auto-Generated):
```json
{
  "mcpServers": {
    "aidd": {
      "command": "npx",
      "args": ["@aidd/mcp"],
      "env": {}
    }
  }
}
```

## What Makes This Work

### No Technical Steps Because:
1. **Pre-compiled** - JavaScript already built
2. **npx** - Runs directly from npm, no local install
3. **Auto-updates** - Always gets latest version
4. **No paths** - npm handles everything

### User Experience:
1. Type package name in Claude Desktop
2. Click Install
3. Type `connect` in Claude
4. Sign in via browser
5. Done!

## Package Structure for NPM

```
@aidd/mcp/
├── package.json
├── README.md
├── LICENSE
├── dist/
│   ├── index-browser-auth.js  # Main entry
│   └── *.js                    # All compiled JS
└── bin/
    └── aidd-mcp               # Executable wrapper
```

### bin/aidd-mcp (Executable Wrapper):
```javascript
#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainScript = join(__dirname, '..', 'dist', 'index-browser-auth.js');

const child = spawn('node', [mainScript], {
  stdio: 'inherit',
  env: process.env
});

child.on('exit', process.exit);
```

## Alternative: Claude Desktop Marketplace

Claude is working on an MCP marketplace where users can:
1. Browse available MCPs
2. Click "Install" button
3. No config needed at all

## For Enterprise Deployment

### Custom Registry:
```bash
# Publish to private registry
npm publish --registry https://your-company.registry.com

# Users install via:
npm config set registry https://your-company.registry.com
# Then use Claude Desktop UI normally
```

### Pre-configured Deployment:
IT can push config via MDM:
```json
{
  "mcpServers": {
    "aidd": {
      "command": "npx",
      "args": ["--registry=https://company.com", "@company/aidd-mcp"]
    }
  }
}
```

## Current Workaround (Until NPM Publish)

For non-technical users RIGHT NOW, create a one-click installer:

### macOS App Bundle:
```bash
# Create AiDD-MCP.app
mkdir -p AiDD-MCP.app/Contents/MacOS
cp install.sh AiDD-MCP.app/Contents/MacOS/run.sh
chmod +x AiDD-MCP.app/Contents/MacOS/run.sh

# Create Info.plist
cat > AiDD-MCP.app/Contents/Info.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>run.sh</string>
  <key>CFBundleIdentifier</key>
  <string>com.aidd.mcp-installer</string>
  <key>CFBundleName</key>
  <string>AiDD MCP Installer</string>
</dict>
</plist>
EOF

# Users just double-click AiDD-MCP.app
```

## Timeline

1. **Now**: Local install with script (current state)
2. **Next Week**: Publish to npm as `@aidd/mcp`
3. **Future**: Available in Claude Desktop Marketplace

Once published to npm, it will be EXACTLY like GitHub/JIRA/Slack MCPs - just type the package name and click install!