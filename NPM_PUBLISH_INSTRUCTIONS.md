# NPM Publishing Instructions for @aidd/mcp

## ✅ Package is Ready for Publishing!

Your npm package is fully prepared and ready to be published to the npm registry.

## Package Details
- **Name**: @aidd/mcp
- **Version**: 1.0.0
- **Size**: ~60.7 kB packed
- **Files**: 43 files included

## Publishing Steps

### 1. Login to npm

First, you need to be logged into npm:

```bash
npm login
```

You'll be prompted for:
- Username
- Password
- Email
- One-time password (if 2FA is enabled)

### 2. Publish the Package

Once logged in, you have two options:

#### Option A: Use the Publish Script (Recommended)
```bash
./publish-to-npm.sh
```

This script will:
- Check your npm login status
- Verify package name availability
- Build the distribution
- Show a preview of what will be published
- Ask for confirmation before publishing

#### Option B: Publish Directly
```bash
npm publish --access public
```

Note: The `--access public` flag is required for scoped packages like `@aidd/mcp`.

## After Publishing

Once published successfully, users can install your MCP in two ways:

### 1. Via Claude Desktop UI (Easy Way)
1. Open Claude Desktop
2. Settings → MCP Servers → Add Server
3. Package name: `@aidd/mcp`
4. Click Install

### 2. Manual Configuration
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "AiDD": {
      "command": "npx",
      "args": ["@aidd/mcp"],
      "env": {}
    }
  }
}
```

## Package Structure

Your package includes:
- ✅ TypeScript distribution files (`dist/`)
- ✅ Executable wrapper (`bin/aidd-mcp`)
- ✅ Comprehensive README
- ✅ Proper package.json metadata
- ✅ .npmignore to exclude development files

## Testing the Published Package

After publishing, test installation:

```bash
# Test global installation
npx @aidd/mcp

# Or test in a new directory
mkdir test-aidd-mcp
cd test-aidd-mcp
npm init -y
npm install @aidd/mcp
```

## Updating the Package

To release updates:

1. Make your changes
2. Update version in package.json:
   ```bash
   npm version patch  # for bug fixes (1.0.0 → 1.0.1)
   npm version minor  # for new features (1.0.0 → 1.1.0)
   npm version major  # for breaking changes (1.0.0 → 2.0.0)
   ```
3. Build: `npm run build`
4. Publish: `npm publish`

## Important Notes

- The package name `@aidd/mcp` requires the `aidd` organization to exist on npm
- If the organization doesn't exist, you can:
  1. Create it: `npm org create aidd`
  2. Or publish under your personal scope: `@your-username/aidd-mcp`
- First-time publishers may need to verify their email with npm

## Troubleshooting

### If "aidd" organization doesn't exist:
```bash
# Create the organization
npm org create aidd

# Or change package name to your username
# Edit package.json: "name": "@your-username/aidd-mcp"
```

### If publish fails with permissions error:
```bash
# Make sure you're logged in
npm whoami

# Check your npm account has publish rights
npm access ls-packages
```

## Success!

Once published, your MCP will be available to all Claude Desktop users worldwide! 🎉

They can simply type `@aidd/mcp` in the Claude Desktop UI and start using it immediately - no technical knowledge required!