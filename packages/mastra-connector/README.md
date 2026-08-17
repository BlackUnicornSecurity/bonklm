# @blackunicorn/bonklm-mastra

[![npm version](https://badge.fury.io/js/%40blackunicorn%2Fbonklm-mastra.svg)](https://www.npmjs.com/package/@blackunicorn/bonklm-mastra)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> Mastra framework connector for BonkLM

## Features

- 🔒 **Input Validation** - Validate agent inputs before execution
- 🔒 **Output Validation** - Validate agent outputs after execution
- 🛠️ **Tool Call Protection** - Validate tool calls and results (regression)
- 📊 **Structured Content** - Handle complex message formats (regression)
- ⏱️ **Timeout Protection** - Validation timeout with AbortController (regression)
- 📏 **Size Limits** - Configurable content and buffer size limits (regression, regression)
- 🚫 **Production Mode** - Generic error messages in production (regression)
- 🌊 **Streaming Support** - Incremental stream validation (regression)

## Installation

```bash
npm install @blackunicorn/bonklm-mastra @blackunicorn/bonklm
```

## Quick Start

```typescript
import { createGuardedMastra } from '@blackunicorn/bonklm-mastra';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';
import { Mastra } from '@mastra/core';

// Create the guardrail integration
const guardrails = createGuardedMastra({
  validators: [new PromptInjectionValidator()],
  validateAgentInput: true,
  validateAgentOutput: true
});

// Use with Mastra agents
const mastra = new Mastra({
  // ... your Mastra configuration
});

// Apply guardrails to agent execution
const agent = mastra.getAgent('my-agent');

// Before execution
const beforeResult = await guardrails.beforeAgentExecution([{ role: 'user', content: userInput }]);

if (!beforeResult.allowed) {
  throw new Error(beforeResult.blockedReason);
}

// Execute agent
const response = await agent.execute(userInput);

// After execution
const afterResult = await guardrails.afterAgentExecution(response);
if (!afterResult.allowed) {
  // Handle blocked response
  return '[Content filtered]';
}
```

## Using wrapAgent (Convenience Wrapper)

For automatic guardrail application, use the `wrapAgent` function:

```typescript
import { wrapAgent } from '@blackunicorn/bonklm-mastra';
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';

const guardedAgent = wrapAgent(myAgent, {
  validators: [new PromptInjectionValidator(), new JailbreakValidator()],
  validateAgentInput: true,
  validateAgentOutput: true
});

// Use normally - guardrails are applied automatically
const result = await guardedAgent.execute('Hello, how can you help?');
```

## Configuration Options

```typescript
interface GuardedMastraOptions {
  // Validators and guards
  validators?: Validator[];
  guards?: Guard[];

  // Logging
  logger?: Logger;

  // Feature toggles
  validateAgentInput?: boolean; // Default: true
  validateAgentOutput?: boolean; // Default: true
  validateToolCalls?: boolean; // Default: true
  validateToolResults?: boolean; // Default: true

  // Streaming
  validateStreaming?: boolean; // Default: false
  streamingMode?: 'incremental' | 'buffer'; // Default: 'incremental'

  // Security limits
  maxStreamBufferSize?: number; // Default: 1MB
  maxContentLength?: number; // Default: 100KB

  // Production mode
  productionMode?: boolean; // Default: NODE_ENV === 'production'

  // Timeout
  validationTimeout?: number; // Default: 30000ms (30s)

  // Callbacks
  onBlocked?: (result, context?) => void;
  onStreamBlocked?: (accumulated, context?) => void;
  onToolCallBlocked?: (toolCall, result, context?) => void;
}
```

## Streaming Validation

For streaming responses, use the stream validator:

```typescript
const guardrails = createGuardedMastra({
  validators: [new PromptInjectionValidator()],
  validateStreaming: true,
  streamingMode: 'incremental'
});

const validator = guardrails.createStreamValidator();

try {
  for await (const chunk of agentStream) {
    const validated = await validator(chunk);
    if (validated) {
      process.stdout.write(validated);
    }
  }
} catch (error) {
  if (error.name === 'StreamValidationError') {
    console.error('Stream blocked:', error.reason);
  }
}
```

## Tool Call Validation

Tool calls are validated to prevent injection attacks:

```typescript
const toolCall: MastraToolCall = {
  id: 'tool-123',
  name: 'search',
  input: { query: userInput }
};

const result = await guardrails.validateToolCall(toolCall);
if (!result.allowed) {
  // Block the tool call
  return;
}

// Execute tool call
const toolResult = await executeTool(toolCall);
```

## Security Features

### regression: Path Traversal Protection

Path normalization using `path.normalize()` for any path-based operations.

### regression: Stream Validation

Buffer-and-validate-before-send pattern with early termination on violations.

### regression: Buffer Overflow Protection

Configurable max buffer size (default 1MB) to prevent DoS attacks.

### regression: Tool Call Injection

Schema validation for tool arguments to prevent injection attacks.

### regression: Structured Content Handling

Proper extraction of text from complex message formats (arrays, images, etc.).

### regression: Production Mode

Generic error messages in production to avoid information leakage.

### regression: Validation Timeout

AbortController-based timeout to prevent hanging on slow inputs.

### regression: Request Size Limits

Configurable max content length to prevent DoS via large inputs.

## API Reference

### `createGuardedMastra(options)`

Creates a guardrail integration object with hook functions.

**Returns:**

- `beforeAgentExecution(messages, context?)` - Validate before agent execution
- `afterAgentExecution(response, context?)` - Validate after agent execution
- `validateToolCall(toolCall, context?)` - Validate tool call inputs
- `validateToolResult(result, toolCall, context?)` - Validate tool results
- `createStreamValidator(context?)` - Create a stream validator function

### `wrapAgent(agent, options)`

Wraps a Mastra agent with automatic guardrail hooks.

**Returns:** A wrapped agent with the same interface as the original.

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn

## Support

- GitHub Issues: https://github.com/BlackUnicornSecurity/bonklm/issues
- Documentation: https://github.com/BlackUnicornSecurity/bonklm
