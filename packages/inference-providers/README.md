# @blackunicorn/bonklm-inference-providers

BonkLM wrappers for **Groq + Cerebras + Together** inference providers.
All three ship OpenAI-compatible SDKs (`chat.completions.create`), so
this package exposes one shared internal `wrapOpenAICompatibleClient`
helper plus three thin per-provider entry points.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-inference-providers
# Pick whichever providers you use (all 3 are OPTIONAL peer deps):
pnpm add groq-sdk
pnpm add @cerebras/cerebras_cloud_sdk
pnpm add together-ai
```

## Quick start — Groq

```ts
import Groq from 'groq-sdk';
import { wrapGroq } from '@blackunicorn/bonklm-inference-providers';
import { GuardrailEngine, PromptInjectionValidator, CodeInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator(), new CodeInjectionValidator()],
});

const groq = wrapGroq(new Groq({ apiKey: process.env.GROQ_API_KEY }), { engine });

// Validation fires INSIDE the create call — both pre-call on user messages
// AND post-call on assistant content.
const response = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

`wrapCerebras` and `wrapTogether` follow the same shape.

## Streaming

Streaming responses are wrapped — `delta.content` is buffered and
validated every ~500 characters. BLOCK throws
`InferenceProviderBlockedError` mid-stream.

```ts
const stream = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: 'Hi' }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

## Telemetry hooks

```ts
const groq = wrapGroq(new Groq({ apiKey }), {
  engine,
  onBlock: (event) => {
    console.warn(`[${event.provider}] ${event.phase} BLOCKED: ${event.reason}`);
  },
  onError: (err) => {
    console.error('[bonklm] inference validator error:', err);
  },
  skipOutputValidation: false, // default — output IS validated
});
```

## License

MIT. (c) Black Unicorn Security.
