# @blackunicorn/bonklm-vercel

> Vercel AI SDK connector for BonkLM with streaming validation support

[![npm version](https://badge.fury.io/js/%40blackunicorn%2Fbonklm-vercel.svg)](https://www.npmjs.com/package/@blackunicorn/bonklm-vercel)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Features

- **Drop-in protection** for Vercel AI SDK applications
- **Streaming validation** with incremental checks
- **Complex content handling** for messages with images and structured data
- **Production-ready** security features
- **TypeScript** support with full type definitions

## Installation

```bash
npm install @blackunicorn/bonklm @blackunicorn/bonklm-vercel
```

## Quick Start

```typescript
import { createOpenAI } from '@ai-sdk/openai';
import { createGuardedAI } from '@blackunicorn/bonklm-vercel';
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';

// Create the guarded AI wrapper
const openai = createOpenAI();
const guardedAI = createGuardedAI({
  validators: [new PromptInjectionValidator(), new JailbreakValidator()],
  validateStreaming: true,
  streamingMode: 'incremental'
});

// Use with generateText
const result = await guardedAI.generateText({
  model: openai('gpt-4'),
  messages: [{ role: 'user', content: userInput }]
});

console.log(result.text);
```

## Streaming with Validation

```typescript
// Enable streaming validation
const stream = await guardedAI.streamText({
  model: openai('gpt-4'),
  messages: [{ role: 'user', content: userInput }]
});

// Stream is validated incrementally to prevent malicious content
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

## Configuration Options

### `validators`

Array of validators to apply to inputs and outputs.

```typescript
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';

const guardedAI = createGuardedAI({
  validators: [new PromptInjectionValidator(), new JailbreakValidator()]
});
```

### `guards`

Array of guards to apply (context-aware validators).

```typescript
import { SecretGuard } from '@blackunicorn/bonklm';

const guardedAI = createGuardedAI({
  guards: [new SecretGuard()]
});
```

### `validateStreaming`

Enable validation for streaming responses.

- **Type**: `boolean`
- **Default**: `false`

```typescript
const guardedAI = createGuardedAI({
  validateStreaming: true
});
```

### `streamingMode`

Stream validation mode.

- **Type**: `'incremental' | 'buffer'`
- **Default**: `'incremental'`

**`'incremental'`**: Validates every N chunks during streaming. Early terminates when violation
detected.

**`'buffer'`**: Accumulates entire stream before validating (faster, less secure).

```typescript
const guardedAI = createGuardedAI({
  validateStreaming: true,
  streamingMode: 'incremental' // Recommended for security
});
```

### `maxStreamBufferSize`

Maximum buffer size for stream accumulation (prevents DoS).

- **Type**: `number`
- **Default**: `1048576` (1MB)

```typescript
const guardedAI = createGuardedAI({
  validateStreaming: true,
  maxStreamBufferSize: 1024 * 1024 // 1MB
});
```

### `productionMode`

Controls error message verbosity.

- **Type**: `boolean`
- **Default**: `process.env.NODE_ENV === 'production'`

When `true`, error messages are generic to avoid leaking security information.

```typescript
const guardedAI = createGuardedAI({
  productionMode: true
});

// Error: "Content blocked" (generic)

const guardedAI = createGuardedAI({
  productionMode: false
});

// Error: "Content blocked: Prompt injection detected" (detailed)
```

### `validationTimeout`

Validation timeout in milliseconds.

- **Type**: `number`
- **Default**: `30000` (30 seconds)

```typescript
const guardedAI = createGuardedAI({
  validationTimeout: 10000 // 10 seconds
});
```

### `onBlocked`

Callback invoked when input or output is blocked.

```typescript
const guardedAI = createGuardedAI({
  onBlocked: result => {
    console.log('Blocked:', result.reason);
    // Log to monitoring service
    logSecurityEvent({
      type: 'guardrail_block',
      reason: result.reason,
      severity: result.severity
    });
  }
});
```

### `onStreamBlocked`

Callback invoked when stream is blocked during validation.

```typescript
const guardedAI = createGuardedAI({
  validateStreaming: true,
  onStreamBlocked: accumulated => {
    console.log('Stream blocked after:', accumulated.length, 'chars');
  }
});
```

## Complex Message Content

The connector handles complex message content including images and structured data:

```typescript
const messages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'What do you see in this image?' },
      { type: 'image', image: 'https://example.com/image.png' }
    ]
  }
];

// Only text content is validated
const result = await guardedAI.generateText({
  model: openai('gpt-4-vision-preview'),
  messages
});
```

## Result Format

### Successful Result

```typescript
{
  text: 'The AI response',
  usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  finishReason: 'stop',
  filtered: false,
  raw: <original AI SDK result>
}
```

### Filtered Result

```typescript
{
  text: '[Content filtered by guardrails]',
  usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  finishReason: 'filtered',
  filtered: true,
  raw: <original AI SDK result>
}
```

## Security Features

This connector addresses critical security vulnerabilities:

- **SEC-002**: Incremental stream validation prevents bypass
- **SEC-003**: Buffer size limits prevent DoS attacks
- **SEC-006**: Complex content handling prevents validation bypass
- **SEC-007**: Production mode prevents information leakage
- **SEC-008**: Timeout enforcement prevents hanging

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn

## Support

- GitHub: [BlackUnicornSecurity/bonklm](https://github.com/BlackUnicornSecurity/bonklm)
- Documentation: [bonklm.dev](https://bonklm.dev)
