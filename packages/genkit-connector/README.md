# @blackunicorn/bonklm-genkit

[![npm version](https://badge.fury.io/js/%40blackunicorn%2Fbonklm-genkit.svg)](https://www.npmjs.com/package/@blackunicorn/bonklm-genkit)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> Google Genkit plugin for BonkLM

## Features

- 🔒 **Flow Input Validation** - Validate flow inputs before execution
- 🔒 **Flow Output Validation** - Validate flow outputs after execution
- 🛠️ **Tool Call Protection** - Validate tool calls and responses (regression)
- 📊 **Structured Content** - Handle complex message formats (regression)
- ⏱️ **Timeout Protection** - Validation timeout with AbortController (regression)
- 📏 **Size Limits** - Configurable content and buffer size limits (regression, regression)
- 🚫 **Production Mode** - Generic error messages in production (regression)
- 🌊 **Streaming Support** - Incremental stream validation (regression)

## Installation

```bash
npm install @blackunicorn/bonklm-genkit @blackunicorn/bonklm
```

## Quick Start

```typescript
import { createGenkitGuardrailsPlugin } from '@blackunicorn/bonklm-genkit';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';
import { configureGenkit } from 'genkit';

// Create the guardrail plugin
const guardrailsPlugin = createGenkitGuardrailsPlugin({
  validators: [new PromptInjectionValidator()],
  validateFlowInput: true,
  validateFlowOutput: true
});

// Use with Genkit configuration
configureGenkit({
  plugins: [guardrailsPlugin]
});
```

## Using wrapFlow (Convenience Wrapper)

For automatic guardrail application, use the `wrapFlow` function:

```typescript
import { wrapFlow } from '@blackunicorn/bonklm-genkit';
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';
import { defineFlow } from 'genkit';

// Define your flow
const myFlow = defineFlow(
  {
    name: 'myFlow',
    inputSchema: z.string(),
    outputSchema: z.string()
  },
  async input => {
    // Your flow logic here
    return `Response to: ${input}`;
  }
);

// Wrap with guardrails
const guardedFlow = wrapFlow(myFlow, {
  validators: [new PromptInjectionValidator(), new JailbreakValidator()],
  validateFlowInput: true,
  validateFlowOutput: true
});

// Use normally - guardrails are applied automatically
const result = await guardedFlow('Hello, how can you help?');
```

## Configuration Options

```typescript
interface GuardedGenkitOptions {
  // Validators and guards
  validators?: Validator[];
  guards?: Guard[];

  // Logging
  logger?: Logger;

  // Feature toggles
  validateFlowInput?: boolean; // Default: true
  validateFlowOutput?: boolean; // Default: true
  validateToolCalls?: boolean; // Default: true
  validateToolResponses?: boolean; // Default: true

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
const guardrails = createGenkitGuardrailsPlugin({
  validators: [new PromptInjectionValidator()],
  validateStreaming: true,
  streamingMode: 'incremental'
});

const validator = guardrails.createStreamValidator();

try {
  for await (const chunk of flowStream) {
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
const toolCall: GenkitToolCall = {
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

### `createGenkitGuardrailsPlugin(options)`

Creates a guardrail plugin object with hook functions.

**Returns:**

- `beforeFlow(input, context?)` - Validate before flow execution
- `afterFlow(response, context?)` - Validate after flow execution
- `validateToolCall(toolCall, context?)` - Validate tool call inputs
- `validateToolResponse(response, context?)` - Validate tool responses
- `createStreamValidator(context?)` - Create a stream validator function

### `wrapFlow(flow, options)`

Wraps a Genkit flow with automatic guardrail hooks.

**Returns:** A wrapped flow with the same interface as the original.

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn

## Support

- GitHub Issues: https://github.com/BlackUnicornSecurity/bonklm/issues
- Documentation: https://github.com/BlackUnicornSecurity/bonklm
