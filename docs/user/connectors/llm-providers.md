# LLM Provider Connectors

Last updated: 2026-05-25

This guide covers BonkLM connectors organised by LLM provider — both provider-native SDK wrappers
and provider-adjacent helpers (voice webhooks, OpenAI-compatible inference providers, VoltAgent's
LLM-routing surface).

For SDK-only wrappers see also [AI SDK Connectors](./ai-sdks.md) — most of these connectors appear
in both guides because they target the same package from different angles.

## Available Connectors

| Connector                                        | Package                                    | Provider scope                                                                           | Status |
| ------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------- | ------ |
| OpenAI                                           | `@blackunicorn/bonklm-openai`              | OpenAI Chat + Responses APIs                                                             | STABLE |
| Anthropic                                        | `@blackunicorn/bonklm-anthropic`           | Claude Messages API                                                                      | STABLE |
| Mistral                                          | `@blackunicorn/bonklm-mistral`             | Mistral chat / agents / fim / embeddings / classifiers                                   | STABLE |
| Google GenAI                                     | `@blackunicorn/bonklm-google-genai`        | Gemini Developer API + Vertex AI                                                         | STABLE |
| HuggingFace                                      | `@blackunicorn/bonklm-huggingface`         | HuggingFace Inference (text-gen, QA, etc.)                                               | STABLE |
| Ollama                                           | `@blackunicorn/bonklm-ollama`              | Local Ollama runtime                                                                     | STABLE |
| Inference providers (Groq + Cerebras + Together) | `@blackunicorn/bonklm-inference-providers` | OpenAI-compatible inference providers                                                    | STABLE |
| VoltAgent                                        | `@blackunicorn/bonklm-voltagent`           | VoltAgent Agent surface (provider-agnostic, routes through whichever LLM the agent uses) | STABLE |
| LiveKit Agents                                   | `@blackunicorn/bonklm-livekit`             | LiveKit voice-agent runtime                                                              | STABLE |
| Voice webhooks (Vapi + Retell)                   | `@blackunicorn/bonklm-voice-webhooks`      | Vapi HTTP webhooks + Retell WebSocket                                                    | STABLE |

The package manifests in this guide are pinned at `1.0.16`.

---

## OpenAI Connector

See [AI SDK Connectors → OpenAI SDK](./ai-sdks.md#openai-sdk-connector) for the canonical recipe.

Quick reference:

```typescript
import OpenAI from 'openai';
import { createGuardedOpenAI } from '@blackunicorn/bonklm-openai';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const guarded = createGuardedOpenAI(new OpenAI(), {
  validators: [new PromptInjectionValidator()]
});
```

Peer: `openai ^4.0.0`. Node-only. Streaming + tool-call validation supported.

---

## Anthropic Connector

See [AI SDK Connectors → Anthropic SDK](./ai-sdks.md#anthropic-sdk-connector).

Quick reference:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { createGuardedAnthropic } from '@blackunicorn/bonklm-anthropic';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const guarded = createGuardedAnthropic(new Anthropic(), {
  validators: [new PromptInjectionValidator()]
});
```

Peer: `@anthropic-ai/sdk` accepts `^0.28.0 / ^0.30.0 / ^0.40.0 / ^0.50.0 / ^0.98.0` (the wrap
surface is stable across each listed major).

---

## Mistral Connector

See [AI SDK Connectors → Mistral SDK](./ai-sdks.md#mistral-sdk-connector).

```typescript
import { Mistral } from '@mistralai/mistralai';
import { wrapMistral } from '@blackunicorn/bonklm-mistral';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });
const client = wrapMistral(new Mistral({ apiKey: '...' }), engine);
```

ESM-only (Mistral SDK v2 constraint). The proxy guards five sub-resources: `chat`, `agents`, `fim`,
`embeddings`, `classifiers`.

---

## Google GenAI Connector

See [AI SDK Connectors → Google GenAI SDK](./ai-sdks.md#google-genai-sdk-connector).

```typescript
import { GoogleGenAI } from '@google/genai';
import { createGuardedGoogleGenAI } from '@blackunicorn/bonklm-google-genai';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const guarded = createGuardedGoogleGenAI(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }), {
  validators: [new PromptInjectionValidator()]
});
```

Mode-agnostic — works with Gemini Developer API and Vertex AI. Covers four entry points:
`wrapGenerateContent`, `wrapGenerateContentStream`, `wrapChat`, `wrapLive` (bidirectional Live API).

Google's built-in `HarmCategory` filters do NOT cover the prompt-injection class — this wrapper
plugs that gap.

---

## HuggingFace Connector

### Installation

```bash
npm install @blackunicorn/bonklm-huggingface @blackunicorn/bonklm @huggingface/inference
```

### Basic Usage

```typescript
import { HfInference } from '@huggingface/inference';
import { createGuardedInference } from '@blackunicorn/bonklm-huggingface';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const hf = new HfInference(process.env.HF_API_KEY);
const guardedHF = createGuardedInference(hf, {
  validators: [new PromptInjectionValidator()],
  allowedModels: ['BAAI/bge-base-en-v1.5']
});

const result = await guardedHF.textGeneration({
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  inputs: userInput
});

const answer = await guardedHF.questionAnswer({
  model: 'deepset/roberta-base-squad2',
  inputs: {
    question: userQuestion,
    context: documentContext
  }
});
```

Peer: `@huggingface/inference ^2.0.0 / ^3.0.0 / ^4.0.0`. Node-only.

---

## Ollama Connector

### Installation

```bash
npm install @blackunicorn/bonklm-ollama @blackunicorn/bonklm ollama
```

### Basic Usage

```typescript
import { Ollama } from 'ollama';
import { createGuardedOllama } from '@blackunicorn/bonklm-ollama';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const ollama = new Ollama({ host: 'http://localhost:11434' });
const guardedOllama = createGuardedOllama(ollama, {
  validators: [new PromptInjectionValidator()]
});

// Chat API
const response = await guardedOllama.chat({
  model: 'llama3.1',
  messages: [{ role: 'user', content: 'Hello!' }]
});

// Generate API
const result = await guardedOllama.generate({
  model: 'llama3.1',
  prompt: 'Write a short poem about programming'
});
```

### Streaming

```typescript
const stream = await guardedOllama.chat({
  model: 'llama3.1',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.message.content);
}
```

### Multimodal Content

```typescript
const response = await guardedOllama.chat({
  model: 'llava',
  messages: [
    {
      role: 'user',
      content: 'What do you see in this image?',
      images: ['https://example.com/image.jpg']
    }
  ]
});
```

### Custom Model Options

```typescript
const response = await guardedOllama.chat({
  model: 'llama3.1',
  messages: [{ role: 'user', content: 'Hello!' }],
  format: 'json',
  options: {
    temperature: 0.7,
    num_predict: 500,
    top_k: 40,
    top_p: 0.9
  },
  keep_alive: '5m'
});
```

### Configuration Options

| Option                | Type                        | Default                     | Description                   |
| --------------------- | --------------------------- | --------------------------- | ----------------------------- |
| `validators`          | `Validator[]`               | `[]`                        | Validators to apply           |
| `guards`              | `Guard[]`                   | `[]`                        | Guards to run                 |
| `validateStreaming`   | `boolean`                   | `false`                     | Enable stream validation      |
| `streamingMode`       | `'incremental' \| 'buffer'` | `'incremental'`             | Stream validation mode        |
| `maxStreamBufferSize` | `number`                    | `1048576`                   | Max buffer size (1MB)         |
| `productionMode`      | `boolean`                   | `NODE_ENV === 'production'` | Generic errors in production  |
| `validationTimeout`   | `number`                    | `30000`                     | Timeout in milliseconds       |
| `onBlocked`           | `Function`                  | —                           | Callback when content blocked |
| `onStreamBlocked`     | `Function`                  | —                           | Callback when stream blocked  |
| `enableRetry`         | `boolean`                   | `true`                      | Enable retries                |
| `maxRetries`          | `number`                    | `3`                         | Max retry attempts            |

Peer: `ollama ^0.6.0`. Node-only.

---

## Inference Providers (Groq + Cerebras + Together)

`@blackunicorn/bonklm-inference-providers` wraps three OpenAI-compatible inference providers via the
shared `wrapOpenAICompatibleClient` helper.

### Installation

All three peer deps are OPTIONAL — install only the SDKs you actually use.

```bash
npm install @blackunicorn/bonklm-inference-providers @blackunicorn/bonklm groq-sdk
# or @cerebras/cerebras_cloud_sdk
# or together-ai
```

### Basic Usage — Groq

```typescript
import Groq from 'groq-sdk';
import { wrapGroq } from '@blackunicorn/bonklm-inference-providers';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });
const client = wrapGroq(new Groq({ apiKey: process.env.GROQ_API_KEY }), { engine });

const response = await client.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: userInput }]
});
```

### Cerebras + Together

```typescript
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import Together from 'together-ai';
import { wrapCerebras, wrapTogether } from '@blackunicorn/bonklm-inference-providers';

const cerebras = wrapCerebras(new Cerebras({ apiKey: '...' }), { engine });
const together = wrapTogether(new Together({ apiKey: '...' }), { engine });
```

### Custom OpenAI-compatible Providers

`wrapOpenAICompatibleClient` is exported for providers not in the built-in list:

```typescript
import { wrapOpenAICompatibleClient } from '@blackunicorn/bonklm-inference-providers';

const myProvider = wrapOpenAICompatibleClient(myClient, { engine }, 'my-provider');
```

---

## VoltAgent Connector

VoltAgent is provider-agnostic — `wrapVoltAgent(agent, options)` runs between your call site and
whichever LLM provider the agent has been configured to use. The wrap therefore guards every
provider the agent routes through.

### Installation

```bash
npm install @blackunicorn/bonklm-voltagent @blackunicorn/bonklm @voltagent/core
```

The `@voltagent/core` peer is optional (structural typing on the `Agent` surface — `generateText`,
`streamText`).

### Basic Usage

```typescript
import { Agent } from '@voltagent/core';
import { wrapVoltAgent, VoltAgentGuardrailBlockedError } from '@blackunicorn/bonklm-voltagent';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });
const agent = wrapVoltAgent(
  new Agent({
    /* ... */
  }),
  { engine }
);

const result = await agent.generateText({ prompt: 'hello' });
// Prompt-injection throws VoltAgentGuardrailBlockedError before the LLM call.
```

The `VoltAgentBlockEvent` telemetry is `kind: 'inference', provider: 'voltagent'`.

Runtime support: Node `>=20.4.0`. The package does not declare Workerd, Deno, Bun, or `edge-light`
conditional exports.

For other agent frameworks see [Emerging Framework Connectors](./emerging-frameworks.md).

---

## LiveKit Agents Connector

See [AI SDK Connectors → LiveKit Agents](./ai-sdks.md#livekit-agents-connector) for the full recipe.

LiveKit is included here because the connector covers a complete voice-agent runtime (STT → LLM →
TTS), which spans more than a single provider SDK. The connector wires the `AudioStreamValidator`
into four voice-agent hooks: `onUserTurnCompleted`, `ttsNode`, `user_input_transcribed`,
`function_tools_executed`.

Peer: `@livekit/agents ^1.4.0`, `@livekit/rtc-node ^0.13.0`. Node-only.

---

## Voice Webhooks (Vapi + Retell)

`@blackunicorn/bonklm-voice-webhooks` ships handlers for two voice-platform webhooks:

- **Vapi (HTTP)** — `createVapiHandler({ engine, hmacSecret })` returns an async `(req) => response`
  handler.
- **Retell (WebSocket)** — `createRetellWsHandler({ engine, hmacSecret })` returns
  `{ verifyHandshake, handleMessage }` for your WebSocket server.

Both use HMAC-SHA256 (`crypto.timingSafeEqual`) with 32-byte minimum secret. Vapi adds a 5-minute
replay window via `X-Vapi-Timestamp`; Retell relies on WSS + per-connection auth tokens.

### Installation

```bash
npm install @blackunicorn/bonklm-voice-webhooks @blackunicorn/bonklm
```

Isomorphic — uses Web `Request` + Node `crypto`. Runs on Node and on edge runtimes that expose
`crypto.subtle`.

### Vapi (Express)

```typescript
import express from 'express';
import { createVapiHandler } from '@blackunicorn/bonklm-voice-webhooks';
import {
  GuardrailEngine,
  PromptInjectionValidator,
  CodeInjectionValidator
} from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator(), new CodeInjectionValidator()]
});

const handler = createVapiHandler({
  engine,
  hmacSecret: process.env.VAPI_HMAC_SECRET!, // >= 32 chars
  onBlock: event => console.warn('[vapi]', event.phase, event.reason),
  onHmacFailure: event => console.warn('[vapi]', 'hmac', event.reason)
});

const app = express();
app.post('/webhooks/vapi', express.text({ type: '*/*' }), async (req, res) => {
  const response = await handler({
    rawBody: req.body,
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)])
    )
  });
  res.status(response.status).json(response.body);
});
```

### Retell (Express + ws)

```typescript
import { WebSocketServer } from 'ws';
import { createRetellWsHandler } from '@blackunicorn/bonklm-voice-webhooks';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()]
});

const { verifyHandshake, handleMessage } = createRetellWsHandler({
  engine,
  hmacSecret: process.env.RETELL_HMAC_SECRET!
});

const wss = new WebSocketServer({ port: 8080, verifyClient: verifyHandshake });
wss.on('connection', ws => {
  ws.on('message', async raw => {
    const out = await handleMessage(raw.toString());
    if (out) ws.send(out);
  });
});
```

### Transcript Caveat

The Vapi `transcript` event is fire-and-forget — Vapi does NOT wait for the handler response.
Validator findings are LOGGED but cannot block the in-flight LLM call. To block on transcript
content, switch to Vapi's "Custom LLM" mode and validate at the LLM proxy layer (use one of the
OpenAI / Anthropic / Mistral connectors above).

### HMAC Primitives

For custom integration shapes, the HMAC primitives are exported directly:

```typescript
import {
  verifyVapiHmac,
  verifyRetellHmac,
  MIN_SECRET_LENGTH,
  DEFAULT_VAPI_REPLAY_WINDOW_MS
} from '@blackunicorn/bonklm-voice-webhooks';
```

---

## Common Security Features

All provider connectors above share the BonkLM core defences:

- Incremental stream validation with early termination.
- Buffer size limits to prevent DoS.
- Complex message content handling (arrays, images, mixed).
- Production mode for generic error messages.
- Validation timeout via `AbortController`.

Voice webhook handlers additionally enforce:

- **HMAC-SHA256** with `crypto.timingSafeEqual` and a 32-byte minimum secret.
- **5-minute replay window** for Vapi (via `X-Vapi-Timestamp`).
- **Fail-closed** on missing / malformed signatures.

LiveKit's `AudioStreamValidator` additionally enforces partial-path interrupt latency budgets
(`maxPartialLatencyMs`, `maxFinalLatencyMs`) so a slow validator cannot wedge the voice loop.

## Provider-Selection Cheatsheet

| You want to call...                                    | Use                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| OpenAI Chat / Responses                                | `bonklm-openai`                                                |
| Anthropic Messages                                     | `bonklm-anthropic`                                             |
| Mistral chat / agents / fim / embeddings / classifiers | `bonklm-mistral`                                               |
| Gemini (Developer API or Vertex AI)                    | `bonklm-google-genai`                                          |
| HuggingFace Inference (text-gen, QA, etc.)             | `bonklm-huggingface`                                           |
| Local Ollama                                           | `bonklm-ollama`                                                |
| Groq / Cerebras / Together (OpenAI-compatible)         | `bonklm-inference-providers`                                   |
| Any other OpenAI-compatible endpoint                   | `wrapOpenAICompatibleClient` from `bonklm-inference-providers` |
| VoltAgent (provider-agnostic agent surface)            | `bonklm-voltagent`                                             |
| LiveKit voice-agent runtime                            | `bonklm-livekit`                                               |
| Vapi webhook                                           | `bonklm-voice-webhooks` (`createVapiHandler`)                  |
| Retell WebSocket                                       | `bonklm-voice-webhooks` (`createRetellWsHandler`)              |

## Next Steps

- [Framework Middleware](./framework-middleware.md) — Express, Fastify, NestJS, Hono, Elysia,
  Next.js, Restate, Temporal, Trigger.dev, Inngest.
- [AI SDK Connectors](./ai-sdks.md) — full SDK wrap recipes including memory-clients (Letta, Mem0,
  Zep) and MCP.
- [Emerging Framework Connectors](./emerging-frameworks.md) — Mastra, Genkit, CopilotKit, ElizaOS,
  Stagehand, Eko, VoltAgent, Cloudflare Agents.
- [RAG & Vector Store Connectors](./rag-vector-stores.md) — LlamaIndex, LangChain, Pinecone,
  ChromaDB, Weaviate, Qdrant, LanceDB, Turbopuffer.
