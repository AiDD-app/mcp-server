# Contributing to AiDD MCP Server

Thank you for your interest in contributing to the AiDD MCP Server! This document provides guidelines for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Code Style](#code-style)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

This project follows a standard code of conduct. By participating, you are expected to:

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Respect differing viewpoints
- Accept responsibility for mistakes

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Git
- TypeScript knowledge
- Familiarity with MCP (Model Context Protocol)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/mcp-server.git
   cd mcp-server
   ```
3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/aidd-app/mcp-server.git
   ```

## Development Setup

### Install Dependencies

```bash
npm install
```

### Environment Configuration

Create a `.env` file (optional for development):

```env
NODE_ENV=development
PORT=8080
BASE_URL=http://localhost:8080
```

### Run Development Server

```bash
npm run dev
```

The server will start on `http://localhost:8080`.

### Build for Production

```bash
npm run build
npm start
```

## Making Changes

### Branch Naming

Create a descriptive branch for your changes:

```bash
git checkout -b feature/add-new-tool
git checkout -b fix/oauth-redirect-issue
git checkout -b docs/update-readme
```

### Commit Messages

Follow conventional commit format:

```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(tools): add delete_note tool with proper metadata
fix(oauth): correct redirect URI handling for Claude web
docs(readme): update authentication flow instructions
```

## Testing

### Local Testing

1. **Health Check:**
   ```bash
   curl http://localhost:8080/health
   ```

2. **MCP Endpoint:**
   ```bash
   curl http://localhost:8080/mcp
   ```

3. **OAuth Discovery:**
   ```bash
   curl http://localhost:8080/.well-known/oauth-authorization-server
   ```

### Integration Testing

For local development, you can test changes with Claude Desktop:

1. Update your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "aidd-local": {
         "url": "http://localhost:8080/mcp"
       }
     }
   }
   ```

2. Restart Claude Desktop
3. Test authentication and tool calls

**Note**: This is for development/testing only. Production users should always use the hosted service at `https://mcp.aidd.app/mcp`.

### Test Account

Use the test account documented in `TEST_CREDENTIALS.md`:
- Email: `[TEST_EMAIL_REDACTED]`
- Password: `REDACTED`

## Submitting Changes

### Before Submitting

1. **Sync with upstream:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run build:**
   ```bash
   npm run build
   ```

3. **Test thoroughly:**
   - Test all modified endpoints
   - Verify OAuth flow works
   - Test tool calls return expected results
   - Check error handling

4. **Update documentation:**
   - Update README.md if adding features
   - Update tool descriptions if modifying tools
   - Add JSDoc comments to new functions

### Pull Request Process

1. **Push to your fork:**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create Pull Request:**
   - Go to the [repository](https://github.com/aidd-app/mcp-server)
   - Click "New Pull Request"
   - Select your fork and branch
   - Fill out the PR template

3. **PR Description should include:**
   - What changed and why
   - Testing performed
   - Screenshots/logs if applicable
   - Related issues (if any)

4. **Wait for review:**
   - Maintainers will review your PR
   - Address feedback promptly
   - Be patient and respectful

## Code Style

### TypeScript

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use async/await over promises
- Add types to all function parameters and return values
- Use meaningful variable names

**Good:**
```typescript
async function fetchUserNotes(userId: string, limit: number): Promise<Note[]> {
  const notes = await backendClient.listNotes({ userId, limit });
  return notes;
}
```

**Bad:**
```typescript
function getUserStuff(id, l) {
  return backendClient.listNotes({ userId: id, limit: l });
}
```

### Tool Definitions

All tools must include proper metadata:

```typescript
{
  name: 'tool_name',
  description: 'Clear description of what the tool does',
  readOnlyHint: true, // or false if it writes data
  inputSchema: {
    type: 'object',
    properties: {
      // ... parameters
    },
    required: ['param1', 'param2'],
  },
}
```

### Error Handling

Always handle errors gracefully:

```typescript
try {
  const result = await backendClient.doSomething();
  return {
    content: [{
      type: 'text',
      text: ` Success: ${result.message}`,
    }],
  };
} catch (error) {
  return {
    content: [{
      type: 'text',
      text: `L Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }],
  };
}
```

### Logging

Use descriptive console logs:

```typescript
console.log('=� MCP Request: list_notes');
console.log(' Notes retrieved:', notes.length);
console.error('L OAuth error:', error);
```

## Reporting Issues

### Bug Reports

When reporting bugs, include:

1. **Description**: Clear description of the bug
2. **Steps to Reproduce**: Detailed steps to reproduce
3. **Expected Behavior**: What should happen
4. **Actual Behavior**: What actually happens
5. **Environment**:
   - OS and version
   - Node.js version
   - MCP server version
   - Claude client (web/mobile/desktop)
6. **Logs**: Relevant error messages or logs
7. **Screenshots**: If applicable

### Feature Requests

When requesting features, include:

1. **Use Case**: Why is this feature needed?
2. **Proposed Solution**: How should it work?
3. **Alternatives**: Other approaches considered
4. **Additional Context**: Screenshots, mockups, etc.

## Architecture Guidelines

### Adding New Tools

1. **Define the tool** in `src/aidd-mcp-server.ts`:
   ```typescript
   {
     name: 'new_tool',
     description: 'Description',
     readOnlyHint: true, // Set appropriately
     inputSchema: { /* ... */ },
   }
   ```

2. **Add handler** in the switch statement:
   ```typescript
   case 'new_tool':
     return await this.handleNewTool(args);
   ```

3. **Implement handler method**:
   ```typescript
   private async handleNewTool(args: any) {
     // Implementation
   }
   ```

4. **Update README.md** with the new tool documentation

### Backend Client

When adding backend API calls:

1. Add method to `src/aidd-backend-client.ts`
2. Use proper error handling
3. Include progress events if operation is long-running
4. Add TypeScript types for request/response

### OAuth Flow

Do not modify OAuth flow without understanding:
- RFC 6749 (OAuth 2.0)
- RFC 7636 (PKCE)
- MCP authentication specification
- Claude.ai OAuth requirements

## Questions?

- **Email**: support@aidd.app
- **GitHub Issues**: [Create an issue](https://github.com/aidd-app/mcp-server/issues)
- **Documentation**: [docs.aidd.app](https://docs.aidd.app)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to AiDD MCP Server! <�
