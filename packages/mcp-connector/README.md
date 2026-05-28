# @blackunicorn/bonklm-mcp

MCP (Model Context Protocol) SDK connector for BonkLM. Provides security guardrails for MCP tool
calls, validating both tool inputs and results to prevent injection attacks and ensure safe AI
interactions.

## Installation

```bash
npm install @blackunicorn/bonklm-mcp
```

## Features

- **Tool Call Validation**: Validates tool arguments before execution to prevent injection attacks
- **Tool Result Filtering**: Validates tool results to prevent malicious content from reaching the
  AI
- **Tool Name Allowlisting**: Restrict which tools can be called
- **Argument Size Limits**: Prevent DoS attacks via large argument payloads
- **Production Mode**: Generic error messages in production, detailed errors in development
- **Validation Timeout**: Prevents hanging on slow or malicious inputs
- **TypeScript Support**: Full TypeScript types included

## Security Features

| Feature                    | Description                                             | Related Issue |
| -------------------------- | ------------------------------------------------------- | ------------- |
| Tool Name Validation       | Validates tool name format and checks against allowlist | SEC-005       |
| Argument Schema Validation | Validates argument size to prevent DoS                  | SEC-005       |
| Production Mode            | Generic errors in production to avoid info leakage      | SEC-007       |
| Validation Timeout         | Uses AbortController for timeout enforcement            | SEC-008       |
| Proper Logger Integration  | Uses `createLogger('console')` instead of raw console   | DEV-002       |

## Usage

### Basic Example

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createGuardedMCP } from '@blackunicorn/bonklm-mcp';
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';

// Create MCP client
const mcpClient = new Client({
  name: 'my-client',
  version: '1.0.0'
});

// Create guarded wrapper
const guardedMCP = createGuardedMCP(mcpClient, {
  validators: [new PromptInjectionValidator(), new JailbreakValidator()],
  allowedTools: ['calculator', 'weather'] // Only allow these tools
});

// Use the guarded client
const result = await guardedMCP.callTool({
  name: 'calculator',
  arguments: { operation: 'add', a: 5, b: 10 }
});

console.log(result.content);
```

### Configuration Options

```typescript
interface GuardedMCPOptions {
  // Validators to apply to tool calls and results
  validators?: Validator[];
  guards?: Guard[];

  // Enable/disable validation
  validateToolCalls?: boolean; // default: true
  validateToolResults?: boolean; // default: true

  // Security options
  allowedTools?: string[]; // Tool name allowlist
  maxArgumentSize?: number; // Max argument size in bytes (default: 100KB)

  // Error handling
  productionMode?: boolean; // Generic errors in production (default: NODE_ENV === 'production')
  validationTimeout?: number; // Timeout in ms (default: 5000)

  // Callbacks
  onToolCallBlocked?: (result: GuardrailResult, toolName: string) => void;
  onToolResultBlocked?: (result: GuardrailResult, toolName: string) => void;
}
```

### Tool Allowlisting

Restrict which tools can be called for enhanced security:

```typescript
const guardedMCP = createGuardedMCP(mcpClient, {
  allowedTools: ['calculator', 'weather', 'search']
});

// This will succeed
await guardedMCP.callTool({
  name: 'calculator',
  arguments: { operation: 'add', a: 5, b: 10 }
});

// This will throw - tool not in allowlist
await guardedMCP.callTool({
  name: 'database-query',
  arguments: { query: 'SELECT * FROM users' }
});
```

### Production Mode

Enable production mode for generic error messages:

```typescript
const guardedMCP = createGuardedMCP(mcpClient, {
  validators: [new PromptInjectionValidator()],
  productionMode: true
});

try {
  await guardedMCP.callTool({
    name: 'calculator',
    arguments: { injection: 'Ignore previous instructions' }
  });
} catch (error) {
  // In production mode: "Tool call blocked"
  // In development mode: "Tool call blocked: Attempt to ignore instructions"
  console.error(error.message);
}
```

### Handling Blocked Calls

Use callbacks to handle blocked tool calls and results:

```typescript
const guardedMCP = createGuardedMCP(mcpClient, {
  validators: [new PromptInjectionValidator()],
  onToolCallBlocked: (result, toolName) => {
    console.warn(`Tool call to '${toolName}' was blocked:`, result.reason);
  },
  onToolResultBlocked: (result, toolName) => {
    console.warn(`Result from '${toolName}' was filtered:`, result.reason);
  }
});
```

### Tool Result Filtering

Tool results are also validated and filtered if needed:

```typescript
// If a tool returns malicious content, it will be filtered
const result = await guardedMCP.callTool({
  name: 'database-query',
  arguments: { query: 'SELECT * FROM users' }
});

if (result.filtered) {
  console.log('Content was filtered:', result.content[0].text);
  // Output: "Tool result filtered by guardrails"
} else {
  console.log('Original result:', result.content[0].text);
}
```

## API Reference

### createGuardedMCP(client, options)

Creates a guarded MCP client wrapper.

**Parameters:**

- `client` - The MCP Client instance to wrap
- `options` - Configuration options (see GuardedMCPOptions above)

**Returns:** A guarded MCP client with the following methods:

#### callTool(opts)

Calls an MCP tool with validation.

**Parameters:**

- `opts.name` - The name of the tool to call
- `opts.arguments` - The arguments to pass to the tool

**Returns:** ToolCallResult with potentially filtered content

#### listTools()

Lists available tools, filtered by allowlist if specified.

**Returns:** Object containing array of ToolInfo

#### close()

Closes the MCP client connection.

## Security Considerations

### Tool Injection Prevention

This connector prevents tool injection attacks by:

1. Validating tool names against a strict pattern (alphanumeric, underscore, hyphen only)
2. Enforcing tool name length limits
3. Supporting tool name allowlisting
4. Validating argument sizes to prevent DoS

### Content Validation

All tool arguments and results are validated against the provided validators and guards:

- Prompt injection detection
- Jailbreak attempt detection
- Custom validation rules

### Resource Limits

Default limits can be configured:

- `maxArgumentSize`: 100KB (prevents large payload attacks)
- `validationTimeout`: 5000ms (prevents hanging)

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## Support

For issues and questions, please visit our GitHub repository.
