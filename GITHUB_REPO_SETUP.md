# 🚀 GitHub Repository Setup for AiDD MCP Server

## Repository Status
- **Target URL**: https://github.com/aidd-app/mcp-server
- **Organization**: aidd-app
- **Visibility**: Public
- **Purpose**: Official MCP server repository for PR #3009

## Quick Setup (Automated)

Run the provided script to automatically create and configure the repository:

```bash
cd /tmp/aidd-app-mcp-server
./setup-github-repo.sh
```

This script will:
1. ✅ Create the repository under aidd-app organization
2. ✅ Copy all necessary files
3. ✅ Set up GitHub Actions for npm publishing
4. ✅ Push everything to GitHub
5. ✅ Make the PR reference valid

## Manual Setup (Alternative)

### Step 1: Create Repository on GitHub

1. Go to https://github.com/organizations/aidd-app/repositories/new
2. Repository name: `mcp-server`
3. Description: `Official AiDD MCP Server for Claude Desktop - Seamless Apple Notes integration with AI-powered task processing`
4. Public repository
5. Do NOT initialize with README
6. Click "Create repository"

### Step 2: Push Local Repository

```bash
cd /tmp/aidd-app-mcp-server
git init
git add .
git commit -m "Initial commit: AiDD MCP Server for Claude Desktop"
git branch -M main
git remote add origin https://github.com/aidd-app/mcp-server.git
git push -u origin main
```

### Step 3: Configure GitHub Secrets

1. Go to https://github.com/aidd-app/mcp-server/settings/secrets/actions
2. Add secret: `NPM_TOKEN`
3. Value: Your npm access token (get from https://www.npmjs.com/settings/~/tokens)

## Repository Contents

### Core Files
- `package.json` - npm package configuration
- `README.md` - Documentation
- `LICENSE` - MIT License
- `.gitignore` - Git ignore rules
- `.npmignore` - npm publish ignore rules

### Source Code
- `src/` - TypeScript source files
- `dist/` - Compiled JavaScript (ES modules)
- `bin/` - CLI executable wrapper

### GitHub Configuration
- `.github/workflows/npm-publish.yml` - Automated npm publishing

## Verification Checklist

After setup, verify:

- [ ] Repository exists at https://github.com/aidd-app/mcp-server
- [ ] All files are present in the repository
- [ ] README is properly displayed
- [ ] Package.json has correct repository URL
- [ ] GitHub Actions workflow is present

## PR Status

Your PR #3009 to modelcontextprotocol/servers already references the correct URL:
- Entry: `**[AiDD](https://github.com/aidd-app/mcp-server)**`
- This will be valid once the repository is created

## npm Package

The package is already published:
- Package: `@aidd-app/mcp`
- Version: 1.0.0
- URL: https://www.npmjs.com/package/@aidd-app/mcp

## Next Steps

1. **Create the repository** using either method above
2. **Monitor PR #3009** for maintainer feedback
3. **Announce** your MCP server availability
4. **Track usage** via npm stats

## Support

- GitHub Issues: https://github.com/aidd-app/mcp-server/issues
- Email: support@aidd.app
- Website: https://aidd.app

## Success! 🎉

Once the repository is created, your MCP server will be:
1. ✅ Published on npm as `@aidd-app/mcp`
2. ✅ Listed in the official MCP servers repository (pending PR approval)
3. ✅ Installable via Claude Desktop UI
4. ✅ Available to all Claude Desktop users worldwide