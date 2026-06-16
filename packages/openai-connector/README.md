# @blackunicorn/bonklm-openai

OpenAI SDK connector for BonkLM that provides security guardrails for OpenAI API calls.

## Features

- **Input Validation**: Validate user messages before sending to OpenAI
- **Output Validation**: Validate AI responses before returning to users
- **Streaming Support**: Incremental validation during streaming responses
- **Complex Content Handling**: Supports multimodal messages (text, images, audio, files)
- **Security Features**:
  - SEC-002: Incremental stream validation with early termination
  - SEC-003: Max buffer size enforcement to prevent DoS
  - SEC-006: Complex message content handling (arrays, images, structured data)
  - SEC-007: Production mode error messages
  - SEC-008: Validation timeout with AbortController

## Installation

```bash
npm install @blackunicorn/bonklm-openai openai
```

```bash
pnpm add @blackunicorn/bonklm-openai openai
```

```bash
yarn add @blackunicorn/bonklm-openai openai
```

## Quick Start

```typescript
import OpenAI from 'openai';
import { createGuardedOpenAI } from '@blackunicorn/bonklm-openai';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

// Create the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Wrap with guardrails
const guardedOpenAI = createGuardedOpenAI(openai, {
  validators: [new PromptInjectionValidator()]
});

// Use like normal OpenAI client
const response = await guardedOpenAI.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: userInput }]
});

console.log(response.choices[0].message.content);
```

## Configuration

```typescript
const guardedOpenAI = createGuardedOpenAI(openai, {
  // Validators to apply
  validators: [new PromptInjectionValidator(), new JailbreakValidator()],

  // Guards to apply (with context)
  guards: [],

  // Streaming validation (SEC-002)
  validateStreaming: true,
  streamingMode: 'incremental', // or 'buffer'

  // Max buffer size for streams (SEC-003)
  maxStreamBufferSize: 1024 * 1024, // 1MB

  // Production mode for generic errors (SEC-007)
  productionMode: process.env.NODE_ENV === 'production',

  // Validation timeout (SEC-008)
  validationTimeout: 30000, // 30 seconds

  // Callbacks
  onBlocked: result => console.log('Blocked:', result.reason),
  onStreamBlocked: accumulated => console.log('Stream blocked')
});
```

## Streaming

```typescript
const stream = await guardedOpenAI.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  process.stdout.write(content);
}
```

With `validateStreaming` enabled, `streamingMode` selects how the stream is validated:

- **`'incremental'` (default)** — chunks are forwarded as they arrive and the accumulated text is
  re-validated every 10 chunks; the stream is terminated early on the first violation. Lower latency
  to first token, but content emitted before a violation is detected has already reached the
  consumer.
- **`'buffer'`** — every chunk is held back, the full response is validated once at stream
  completion, then the buffered chunks are released unchanged only if validation passes. On a
  violation the content is withheld entirely and a single filtered marker chunk is emitted (and
  `onStreamBlocked` fires). One validation pass instead of one per interval, and zero pre-validation
  leakage, at the cost of progressive delivery — nothing reaches the consumer until the full
  response clears.

Both modes enforce `maxStreamBufferSize` (SEC-003).

## Multimodal Content

The connector properly handles complex message content types (SEC-006):

```typescript
const response = await guardedOpenAI.chat.completions.create({
  model: 'gpt-4-vision-preview',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What do you see?' },
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/image.jpg' }
        }
      ]
    }
  ]
});
```

Only text content is validated; images and other media are filtered out during validation.

## Utility Functions

### messagesToText

Extracts text content from complex OpenAI messages:

```typescript
import { messagesToText } from '@blackunicorn/bonklm-openai';

const messages = [
  { role: 'user', content: 'Hello' },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Look at this' },
      { type: 'image_url', image_url: { url: '...' } }
    ]
  }
];

const text = messagesToText(messages);
// Result: "Hello\nLook at this"
```

## Error Handling

```typescript
try {
  const response = await guardedOpenAI.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: userInput }]
  });
} catch (error) {
  if (error.message === 'Content blocked') {
    // Production mode - generic error
    console.log('Request was blocked by guardrails');
  } else if (error.message.startsWith('Content blocked:')) {
    // Development mode - detailed error
    console.log('Blocked reason:', error.message);
  }
}
```

## Security Features

### SEC-002: Incremental Stream Validation

When `validateStreaming` is enabled, streaming responses are validated every N chunks. If a
violation is detected, the stream terminates early, preventing malicious content from being sent.

### SEC-003: Max Buffer Size Enforcement

Prevents DoS attacks via large streaming responses. The stream is terminated when accumulated
content exceeds `maxStreamBufferSize`.

### SEC-006: Complex Message Content Handling

Properly extracts and validates text from multimodal messages containing images, audio, files, or
structured content.

### SEC-007: Production Mode Error Messages

In production mode, returns generic "Content blocked" messages to avoid leaking security
information.

### SEC-008: Validation Timeout

Prevents hanging on slow or malicious inputs. Uses AbortController for timeout enforcement.

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.
