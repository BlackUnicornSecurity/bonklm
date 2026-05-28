# @blackunicorn/bonklm-copilotkit

[![npm version](https://badge.fury.io/js/%40blackunicorn%2Fbonklm-copilotkit.svg)](https://www.npmjs.com/package/@blackunicorn/bonklm-copilotkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> CopilotKit integration for BonkLM

## Features

- 🔒 **User Message Validation** - Validate user messages before sending to LLM
- 🔒 **Assistant Message Validation** - Validate assistant responses after LLM
- 🛠️ **Action Call Protection** - Validate action calls and results (SEC-005)
- 📊 **Structured Content** - Handle complex message formats (SEC-006)
- ⏱️ **Timeout Protection** - Validation timeout with AbortController (SEC-008)
- 📏 **Size Limits** - Configurable content and buffer size limits (SEC-003, SEC-010)
- 🚫 **Production Mode** - Generic error messages in production (SEC-007)
- 🌊 **Streaming Support** - Incremental stream validation (SEC-002)

## Installation

```bash
npm install @blackunicorn/bonklm-copilotkit @blackunicorn/bonklm
```

## Quick Start

```typescript
import { createGuardedCopilotKit } from '@blackunicorn/bonklm-copilotkit';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';
import { CopilotKit } from '@copilotkit/react-core';

// Create the guardrail integration
const guardrails = createGuardedCopilotKit({
  validators: [new PromptInjectionValidator()],
  validateUserMessages: true,
  validateAssistantMessages: true,
});

// Use with CopilotKit
function App() {
  return (
    <CopilotKit
      guardrails={guardrails}
    >
      {/* Your app */}
    </CopilotKit>
  );
}
```

## Configuration Options

```typescript
interface GuardedCopilotKitOptions {
  // Validators and guards
  validators?: Validator[];
  guards?: Guard[];

  // Logging
  logger?: Logger;

  // Feature toggles
  validateUserMessages?: boolean; // Default: true
  validateAssistantMessages?: boolean; // Default: true
  validateActionCalls?: boolean; // Default: true
  validateActionResults?: boolean; // Default: true

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
  onActionCallBlocked?: (action, result, context?) => void;
}
```

## Streaming Validation

For streaming responses, use the stream validator:

```typescript
const guardrails = createGuardedCopilotKit({
  validators: [new PromptInjectionValidator()],
  validateStreaming: true,
  streamingMode: 'incremental'
});

const validator = guardrails.createStreamValidator();

try {
  for await (const chunk of stream) {
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

## Security Features

### SEC-001: Path Traversal Protection

Path normalization using `path.normalize()` for any path-based operations.

### SEC-002: Stream Validation

Buffer-and-validate-before-send pattern with early termination on violations.

### SEC-003: Buffer Overflow Protection

Configurable max buffer size (default 1MB) to prevent DoS attacks.

### SEC-005: Action Call Injection

Schema validation for action arguments to prevent injection attacks.

### SEC-006: Structured Content Handling

Proper extraction of text from complex message formats (arrays, images, etc.).

### SEC-007: Production Mode

Generic error messages in production to avoid information leakage.

### SEC-008: Validation Timeout

AbortController-based timeout to prevent hanging on slow inputs.

### SEC-010: Request Size Limits

Configurable max content length to prevent DoS via large inputs.

## API Reference

### `createGuardedCopilotKit(options)`

Creates a guardrail integration object with hook functions.

**Returns:**

- `beforeSendMessage(messages, context?)` - Validate before sending messages
- `afterReceiveMessage(message, context?)` - Validate after receiving messages
- `validateActionCall(action, context?)` - Validate action calls
- `validateActionResult(result, context?)` - Validate action results
- `createStreamValidator(context?)` - Create a stream validator function

## License

MIT

## Support

- GitHub Issues: https://github.com/blackunicorn/bonklm/issues
- Documentation: https://github.com/blackunicorn/bonklm
