# @blackunicorn/bonklm-ollama

[Ollama](https://ollama.com/) SDK connector for BonkLM. Provides security guardrails for local LLM
inference with Ollama.

## Features

- **Input Validation**: Validates prompts before sending to Ollama
- **Output Validation**: Validates responses after generation
- **Streaming Support**: Incremental validation for streaming responses
- **Buffer Protection**: Prevents memory exhaustion attacks
- **Timeout Protection**: AbortController-based validation timeout
- **Production Mode**: Generic error messages in production

## Installation

```bash
npm install @blackunicorn/bonklm @blackunicorn/bonklm-ollama ollama
```

## Quick Start

```typescript
import { Ollama } from 'ollama';
import { createGuardedOllama } from '@blackunicorn/bonklm-ollama';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

// Create Ollama client
const ollama = new Ollama({ host: 'http://localhost:11434' });

// Wrap with guardrails
const guardedOllama = createGuardedOllama(ollama, {
  validators: [new PromptInjectionValidator()]
});

// Use chat API
const response = await guardedOllama.chat({
  model: 'llama3.1',
  messages: [{ role: 'user', content: 'Hello!' }]
});
console.log(response.message.content);

// Use generate API
const result = await guardedOllama.generate({
  model: 'llama3.1',
  prompt: 'Write a short poem'
});
console.log(result.response);
```

## API Reference

### `createGuardedOllama(client, options)`

Creates a guarded wrapper around the Ollama client.

**Parameters:**

- `client` (`Ollama`): The Ollama client instance
- `options` (`GuardedOllamaOptions`): Configuration options

**Options:**

| Option                | Type                        | Default                                 | Description                               |
| --------------------- | --------------------------- | --------------------------------------- | ----------------------------------------- |
| `validators`          | `Validator[]`               | `[]`                                    | Validators to apply to inputs and outputs |
| `guards`              | `Guard[]`                   | `[]`                                    | Guards to apply to inputs and outputs     |
| `logger`              | `Logger`                    | `createLogger('console')`               | Logger instance for validation events     |
| `validateStreaming`   | `boolean`                   | `false`                                 | Enable incremental stream validation      |
| `streamingMode`       | `'incremental' \| 'buffer'` | `'incremental'`                         | Stream validation mode                    |
| `maxStreamBufferSize` | `number`                    | `1048576`                               | Maximum buffer size in bytes (1MB)        |
| `productionMode`      | `boolean`                   | `process.env.NODE_ENV === 'production'` | Generic errors in production              |
| `validationTimeout`   | `number`                    | `30000`                                 | Validation timeout in milliseconds (30s)  |
| `onBlocked`           | `(result) => void`          | `undefined`                             | Callback when input/output is blocked     |
| `onStreamBlocked`     | `(accumulated) => void`     | `undefined`                             | Callback when stream is blocked           |

### Chat API

```typescript
const response = await guardedOllama.chat({
  model: 'llama3.1',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' }
  ],
  stream: false // Set true for streaming
});
```

### Generate API

```typescript
const result = await guardedOllama.generate({
  model: 'llama3.1',
  prompt: 'Write a haiku',
  stream: false // Set true for streaming
});
```

## Streaming

Enable streaming validation for real-time protection:

```typescript
const guardedOllama = createGuardedOllama(ollama, {
  validators: [new PromptInjectionValidator()],
  validateStreaming: true,
  streamingMode: 'incremental'
});

// Stream chat responses
const stream = await guardedOllama.chat({
  model: 'llama3.1',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.message.content);
}
```

`streamingMode` selects how `chat()` and `generate()` streams are validated:

- **`'incremental'` (default)** — responses are forwarded as they arrive and the accumulated text is
  re-validated every 10 chunks; the stream is terminated early on the first violation.
- **`'buffer'`** — every response is held back, the full text is validated once at stream
  completion, then the buffered responses are released unchanged only if validation passes. On a
  violation the content is withheld entirely and a single filtered marker response is emitted (and
  `onStreamBlocked` fires). One validation pass instead of one per interval, and zero pre-validation
  leakage, at the cost of progressive delivery. Both modes enforce `maxStreamBufferSize`.

## Available Validators

Import validators from `@blackunicorn/bonklm`:

- `PromptInjectionValidator` - Detects prompt injection attempts
- `JailbreakValidator` - Detects jailbreak patterns
- `SecretGuard` - Detects secrets/credentials in content
- `PIIGuard` - Detects personally identifiable information
- `BashSafetyGuard` - Detects bash command injection
- `XSSSafetyGuard` - Detects XSS patterns
- And more...

## Examples

See the `/examples/ollama-example` directory for complete examples.

## Security Considerations

This connector implements several security measures:

- Incremental stream validation with early termination
- Max buffer size enforcement to prevent DoS
- Complex message content handling
- Production mode error messages
- Validation timeout with AbortController

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn
