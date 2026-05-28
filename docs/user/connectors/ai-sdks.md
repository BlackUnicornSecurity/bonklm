# AI SDK Connectors

Last updated: 2026-05-25

This guide covers BonkLM connectors that wrap an LLM provider's own SDK (or an AI-platform SDK that
exposes its own client) so guardrails fire inside the request path without changing your call sites.

For broader provider helpers see [LLM Provider Connectors](./llm-providers.md); for agent frameworks
see [Emerging Framework Connectors](./emerging-frameworks.md).

## Available Connectors

| Connector                                        | Package                                    | Peer SDK                                                            | Status |
| ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------- | ------ |
| OpenAI SDK                                       | `@blackunicorn/bonklm-openai`              | `openai ^4.0.0`                                                     | STABLE |
| Anthropic SDK                                    | `@blackunicorn/bonklm-anthropic`           | `@anthropic-ai/sdk ^0.28.0 / ^0.30.0 / ^0.40.0 / ^0.50.0 / ^0.98.0` | STABLE |
| Vercel AI SDK                                    | `@blackunicorn/bonklm-vercel`              | `ai ^3.0.0 / ^4.0.0 / ^5.0.0 / ^6.0.0`                              | STABLE |
| Google GenAI SDK                                 | `@blackunicorn/bonklm-google-genai`        | `@google/genai ^2.0.0`                                              | STABLE |
| Mistral SDK                                      | `@blackunicorn/bonklm-mistral`             | `@mistralai/mistralai ^2.2.0` (ESM-only)                            | STABLE |
| MCP SDK                                          | `@blackunicorn/bonklm-mcp`                 | `@modelcontextprotocol/sdk ^1.0.0`                                  | STABLE |
| Ollama SDK                                       | `@blackunicorn/bonklm-ollama`              | `ollama ^0.6.0`                                                     | STABLE |
| HuggingFace Inference                            | `@blackunicorn/bonklm-huggingface`         | `@huggingface/inference ^2.0.0 / ^3.0.0 / ^4.0.0`                   | STABLE |
| Inference providers (Groq + Cerebras + Together) | `@blackunicorn/bonklm-inference-providers` | optional: `groq-sdk`, `@cerebras/cerebras_cloud_sdk`, `together-ai` | STABLE |
| OpenAI Agents SDK                                | `@blackunicorn/bonklm-openai-agents`       | `@openai/agents ^0.11.0`                                            | STABLE |
| LiveKit Agents                                   | `@blackunicorn/bonklm-livekit`             | `@livekit/agents ^1.4.0`, `@livekit/rtc-node ^0.13.0`               | STABLE |
| Letta memory-client                              | `@blackunicorn/bonklm-letta`               | `@letta-ai/letta-client ^1.11.0`                                    | STABLE |
| Mem0 memory-client                               | `@blackunicorn/bonklm-mem0`                | `mem0ai ^3.0.0`                                                     | STABLE |
| Zep memory-client                                | `@blackunicorn/bonklm-zep`                 | `@getzep/zep-cloud ^3.0.0`                                          | STABLE |

All packages are published at `1.0.0-rc.3` against project version `0.5.0`. Packages are pinned
together via Changesets `linked` config.

---

## OpenAI SDK Connector

### Installation

```bash
npm install @blackunicorn/bonklm-openai @blackunicorn/bonklm openai
```

### Basic Usage

```typescript
import OpenAI from 'openai';
import { createGuardedOpenAI } from '@blackunicorn/bonklm-openai';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const guardedOpenAI = createGuardedOpenAI(openai, {
  validators: [new PromptInjectionValidator()]
});

const response = await guardedOpenAI.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: userInput }]
});

console.log(response.choices[0].message.content);
```

### Streaming

```typescript
const stream = await guardedOpenAI.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: userInput }],
  stream: true
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  process.stdout.write(content);
}
```

### Configuration Options

| Option                | Type                        | Default                     | Description                   |
| --------------------- | --------------------------- | --------------------------- | ----------------------------- |
| `validators`          | `Validator[]`               | `[]`                        | Validators to apply           |
| `guards`              | `Guard[]`                   | `[]`                        | Guards to run with context    |
| `validateStreaming`   | `boolean`                   | `false`                     | Enable stream validation      |
| `streamingMode`       | `'incremental' \| 'buffer'` | `'incremental'`             | Stream validation mode        |
| `maxStreamBufferSize` | `number`                    | `1048576`                   | Max buffer size (1MB)         |
| `productionMode`      | `boolean`                   | `NODE_ENV === 'production'` | Generic errors in production  |
| `validationTimeout`   | `number`                    | `30000`                     | Timeout in milliseconds       |
| `onBlocked`           | `Function`                  | —                           | Callback when content blocked |
| `onStreamBlocked`     | `Function`                  | —                           | Callback when stream blocked  |

### Tool Call Validation

```typescript
const guardedOpenAI = createGuardedOpenAI(openai, {
  validators: [new PromptInjectionValidator()],
  allowedTools: ['search', 'calculator'],
  maxToolArgumentSize: 100 * 1024 // 100KB
});
```

---

## Anthropic SDK Connector

### Installation

```bash
npm install @blackunicorn/bonklm-anthropic @blackunicorn/bonklm @anthropic-ai/sdk
```

### Basic Usage

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { createGuardedAnthropic } from '@blackunicorn/bonklm-anthropic';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const guarded = createGuardedAnthropic(anthropic, {
  validators: [new PromptInjectionValidator()]
});

const response = await guarded.messages.create({
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: userInput }],
  max_tokens: 1024
});

console.log(response.content[0].text);
```

### Streaming

```typescript
const stream = await guarded.messages.create({
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: userInput }],
  stream: true,
  max_tokens: 1024
});

for await (const chunk of stream) {
  if (chunk.type === 'content_block_delta') {
    process.stdout.write(chunk.delta.text);
  }
}
```

### Configuration Options

| Option                | Type                        | Default                     | Description                  |
| --------------------- | --------------------------- | --------------------------- | ---------------------------- |
| `validators`          | `Validator[]`               | `[]`                        | Validators to apply          |
| `guards`              | `Guard[]`                   | `[]`                        | Guards to run                |
| `validateStreaming`   | `boolean`                   | `false`                     | Enable stream validation     |
| `streamingMode`       | `'incremental' \| 'buffer'` | `'incremental'`             | Stream validation mode       |
| `maxStreamBufferSize` | `number`                    | `1048576`                   | Max buffer size (1MB)        |
| `productionMode`      | `boolean`                   | `NODE_ENV === 'production'` | Generic errors in production |
| `validationTimeout`   | `number`                    | `30000`                     | Timeout in milliseconds      |
| `enableRetry`         | `boolean`                   | `true`                      | Enable retries               |
| `maxRetries`          | `number`                    | `3`                         | Max retry attempts           |
| `telemetry`           | `TelemetryService`          | —                           | Optional telemetry           |
| `circuitBreaker`      | `CircuitBreaker`            | —                           | Optional circuit breaker     |

The Anthropic peer disjunction `^0.28.0 / ^0.30.0 / ^0.40.0 / ^0.50.0 / ^0.98.0` exists because the
SDK's wrap surface has been stable across each listed major; any of these majors will satisfy peer
resolution.

---

## Vercel AI SDK Connector

### Installation

```bash
npm install @blackunicorn/bonklm-vercel @blackunicorn/bonklm ai
```

Two integration shapes ship in parallel for Vercel AI SDK majors:

- **v3 / v4** — `createGuardedAI()` wraps `generateText` / `streamText`.
- **v5 / v6** — `bonkMiddleware()` is a `LanguageModelV2Middleware` factory consumed via
  `wrapLanguageModel({ model, middleware })`.
- **Agent + MCP** — `wrapAgent()` and `wrapMCPClient()` ship for both major lines.

### Basic Usage (v3 / v4)

```typescript
import { createGuardedAI } from '@blackunicorn/bonklm-vercel';
import { openai } from '@ai-sdk/openai';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const guardedAI = createGuardedAI({
  validators: [new PromptInjectionValidator()],
  validateStreaming: true
});

const result = await guardedAI.generateText({
  model: openai('gpt-4o'),
  messages: [{ role: 'user', content: userInput }]
});

console.log(result.text);
```

### Middleware Pattern (v5 / v6)

```typescript
import { wrapLanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { bonkMiddleware } from '@blackunicorn/bonklm-vercel';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: bonkMiddleware({
    validators: [new PromptInjectionValidator()]
  })
});
```

For v6 upgrade notes see [vercel-v6-migration.md](../vercel-v6-migration.md).

### Configuration Options (createGuardedAI)

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

> Sprint 26 v1.0-RC1 API freeze removed the `messagesToTextLegacy` alias; rename to
> `messagesToText`.

---

## Google GenAI SDK Connector

### Installation

```bash
npm install @blackunicorn/bonklm-google-genai @blackunicorn/bonklm @google/genai
```

Mode-agnostic — works with both Gemini Developer API and Vertex AI.

### Basic Usage — Gemini Developer API

```typescript
import { GoogleGenAI } from '@google/genai';
import { createGuardedGoogleGenAI } from '@blackunicorn/bonklm-google-genai';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const guarded = createGuardedGoogleGenAI(client, {
  validators: [new PromptInjectionValidator()]
});

const r = await guarded.models.generateContent({
  model: 'gemini-2.0-flash',
  contents: userMessage
});
```

### Vertex AI mode

```typescript
const client = new GoogleGenAI({
  vertexai: true,
  project: 'my-project',
  location: 'us-central1'
});
const guarded = createGuardedGoogleGenAI(client, {
  validators: [new PromptInjectionValidator()]
});
```

The wrapper covers four entry points: `wrapGenerateContent` (non-stream),
`wrapGenerateContentStream`, `wrapChat` (multi-turn), and `wrapLive` (bidirectional Live API with
audio transcription). Google's built-in `HarmCategory` filters do NOT cover the prompt-injection
class — this wrapper plugs that gap.

---

## Mistral SDK Connector

### Installation

```bash
npm install @blackunicorn/bonklm-mistral @blackunicorn/bonklm @mistralai/mistralai
```

**ESM-only.** Mistral SDK v2 is ESM-only; the connector inherits that constraint. CJS-only stacks
should pin `@mistralai/mistralai@^1.x` (older API surface) or migrate the consumer build to ESM.

### Basic Usage

```typescript
import { Mistral } from '@mistralai/mistralai';
import { wrapMistral, MistralGuardrailBlockedError } from '@blackunicorn/bonklm-mistral';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });
const client = wrapMistral(new Mistral({ apiKey: process.env.MISTRAL_API_KEY }), engine);

try {
  const result = await client.chat.complete({
    model: 'mistral-large-latest',
    messages: [{ role: 'user', content: userInput }]
  });
} catch (err) {
  if (err instanceof MistralGuardrailBlockedError) {
    // ...
  }
}
```

The proxy guards the five sub-resources: `chat`, `agents`, `fim`, `embeddings`, `classifiers`.
Everything else passes through untouched.

---

## MCP SDK Connector

### Installation

```bash
npm install @blackunicorn/bonklm-mcp @blackunicorn/bonklm @modelcontextprotocol/sdk
```

### Basic Usage

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createGuardedMCP } from '@blackunicorn/bonklm-mcp';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const mcpClient = new Client({ name: 'my-client', version: '1.0.0' });

const guardedMCP = createGuardedMCP(mcpClient, {
  validators: [new PromptInjectionValidator()],
  allowedTools: ['calculator', 'weather']
});

const result = await guardedMCP.callTool({
  name: 'calculator',
  arguments: { operation: 'add', a: 5, b: 10 }
});
```

### Configuration Options

| Option                | Type          | Default                     | Description                     |
| --------------------- | ------------- | --------------------------- | ------------------------------- |
| `validators`          | `Validator[]` | `[]`                        | Validators to apply             |
| `guards`              | `Guard[]`     | `[]`                        | Guards to run                   |
| `validateToolCalls`   | `boolean`     | `true`                      | Validate tool call arguments    |
| `validateToolResults` | `boolean`     | `true`                      | Validate tool results           |
| `allowedTools`        | `string[]`    | `[]`                        | Tool name allowlist             |
| `maxArgumentSize`     | `number`      | `102400`                    | Max argument size (100KB)       |
| `productionMode`      | `boolean`     | `NODE_ENV === 'production'` | Generic errors in production    |
| `validationTimeout`   | `number`      | `5000`                      | Timeout in milliseconds         |
| `onToolCallBlocked`   | `Function`    | —                           | Callback when tool call blocked |
| `onToolResultBlocked` | `Function`    | —                           | Callback when result blocked    |

---

## Ollama SDK Connector

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

const response = await guardedOllama.chat({
  model: 'llama3.1',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

See [LLM Provider Connectors](./llm-providers.md#ollama-connector) for the full Ollama recipe
(streaming, multimodal, custom options).

---

## HuggingFace Inference Connector

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
```

See [RAG & Vector Store Connectors](./rag-vector-stores.md) for HF use in retrieval pipelines.

---

## Inference Providers (Groq + Cerebras + Together)

### Installation

Install only the SDKs you actually use — all three peer deps are optional. Each is
OpenAI-compatible.

```bash
npm install @blackunicorn/bonklm-inference-providers @blackunicorn/bonklm groq-sdk
# or @cerebras/cerebras_cloud_sdk
# or together-ai
```

### Basic Usage

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

Equivalent wrappers ship for Cerebras (`wrapCerebras`) and Together (`wrapTogether`). All three are
thin adapters over the shared `wrapOpenAICompatibleClient` helper, which is exported for non-listed
OpenAI-compatible providers.

---

## OpenAI Agents SDK Connector

### Installation

```bash
npm install @blackunicorn/bonklm-openai-agents @blackunicorn/bonklm @openai/agents
```

> **Pre-1.0 peer pin.** `@openai/agents` is pre-1.0; signatures shift between minors. This connector
> pins `^0.11.0` and re-aligns on every peer bump.

### Basic Usage — Wrap an Agent

```typescript
import { Agent, run } from '@openai/agents';
import { GuardrailEngine, PromptInjectionValidator, SecretGuard } from '@blackunicorn/bonklm';
import { wrapAgent } from '@blackunicorn/bonklm-openai-agents';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()],
  guards: [new SecretGuard()]
});

const supportAgent = wrapAgent(
  new Agent({
    name: 'support',
    instructions: 'Help the customer.',
    tools: [lookupCustomerTool, sendEmailTool]
  }),
  engine,
  { productionMode: true }
);

await run(supportAgent, 'I need help with my order #1234');
```

`wrapAgent` installs four guardrails on the wrapped agent:

- `defineInputGuardrail` — fires `InputGuardrailTripwireTriggered` on injection / secret / etc. in
  the raw user input.
- `defineOutputGuardrail` — fires `OutputGuardrailTripwireTriggered` on injection in the final agent
  response.
- `defineToolInputGuardrail` — args walked via the core `createToolCallArgsValidator` so per-leaf
  strings AND the tool name itself are scanned.
- `defineToolOutputGuardrail` — mitigates the "tool-result-as-carrier" class where compromised tool
  output carries injection back into the agent loop.

### Wrap a Handoff

```typescript
import { handoff } from '@openai/agents';
import { wrapHandoff } from '@blackunicorn/bonklm-openai-agents';

const escalationHandoff = wrapHandoff(handoff(escalationAgent, { toolName: 'escalate' }), engine);
```

### Wrap a RealtimeSession

```typescript
import { wrapRealtime } from '@blackunicorn/bonklm-openai-agents';

const guardedSession = wrapRealtime(realtimeSession, engine, {
  productionMode: true
});
```

The handoff and realtime wrappers reuse the same guardrail definitions so callers do not need to
re-declare validators per surface.

---

## LiveKit Agents Connector

### Installation

```bash
npm install @blackunicorn/bonklm-livekit @blackunicorn/bonklm \
  @livekit/agents @livekit/rtc-node
```

Node-only. Wires the `AudioStreamValidator` (Story 3.1) into the four AC-mandated voice-agent hooks:
`onUserTurnCompleted` (final-path), `ttsNode` (pre-TTS echo defence), `user_input_transcribed`
(partial-path → `session.interrupt({force:true})` BEFORE the LLM call), and
`function_tools_executed` (tool-args validation).

### Basic Usage

```typescript
import { defineAgent, voice } from '@livekit/agents';
import { AudioStreamValidator } from '@blackunicorn/bonklm/validators';
import { BonklmAgent, wrapLiveKitAgentSession } from '@blackunicorn/bonklm-livekit';

export default defineAgent({
  entry: async ctx => {
    // ONE AudioStreamValidator PER session — the validator carries
    // mutable AC + gate state. Fresh-construct (or call .fork()) per
    // session to prevent cross-session leakage.
    const audioStreamValidator = new AudioStreamValidator();

    const agent = new BonklmAgent({
      instructions: 'You are a helpful voice assistant.',
      bonklm: {
        audioStreamValidator,
        maxPartialLatencyMs: 100,
        maxFinalLatencyMs: 500
      }
    });

    const session = new voice.AgentSession({
      /* ... */
    });
    wrapLiveKitAgentSession(session, {
      audioStreamValidator,
      onBlock: event => console.warn('[livekit]', event.phase)
    });

    await session.start({ agent });
  }
});
```

Pass the SAME `audioStreamValidator` instance to both `BonklmAgent` and `wrapLiveKitAgentSession` so
partial-path AC state flows into the final-path `validateFinal` call.

See [LLM Provider Connectors](./llm-providers.md#voice-providers) for provider-adjacent voice
integrations (Vapi + Retell webhooks).

---

## Letta Memory-Client Connector

### Installation

```bash
npm install @blackunicorn/bonklm-letta @blackunicorn/bonklm @letta-ai/letta-client
```

Wraps the `@letta-ai/letta-client` SDK with a nested `Proxy` that routes `agents.messages.*` and
`agents.archival_memory.*` through BonkLM. Writes fire the `memory_write` surface; recall paths
(`list`) fire `composed_context` post-call. Tenant scoping is enforced by rewriting the first
positional `agentId` with `getTenantId(ctx)` and stripping the bypass fields `humanId`, `personaId`,
`userId`, `organizationId`. The outer proxy is **fail-closed** — unknown top-level or sub-namespace
properties throw `ConnectorValidationError`.

### Basic Usage

```typescript
import { LettaClient } from '@letta-ai/letta-client';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
import { wrapLettaClient } from '@blackunicorn/bonklm-letta';

const validators = [new PromptInjectionValidator()];
const engine = new GuardrailEngine({ validators });
const client = new LettaClient({ baseUrl: '...' });

const guarded = wrapLettaClient(client, engine, {
  getTenantId: ctx => ctx.agentId, // REQUIRED — must be a function
  getSessionContext: () => requestLocal.get('session'),
  validators
});

await guarded.agents.messages.create({
  agentId: 'IGNORED', // overwritten with getTenantId(ctx)
  messages: [{ role: 'user', content: 'hello' }]
});
```

`getTenantId` is required; a non-function value throws `ConnectorValidationError` at construction.
`buildLettaAdapter` is also exported for advanced callers composing custom flows over
`@blackunicorn/bonklm-memory-utils`.

---

## Mem0 Memory-Client Connector

### Installation

```bash
npm install @blackunicorn/bonklm-mem0 @blackunicorn/bonklm mem0ai
```

Wraps the Mem0 TypeScript SDK with a `Proxy` that routes memory writes through BonkLM's
`memory_write` surface and recall calls through the `composed_context` surface. Multi-tenant scoping
is enforced by overwriting `user_id` with `getTenantId(ctx)` on every routed call and stripping
alternative Mem0 scoping fields (`agent_id`, `run_id`, `app_id`, `org_id`, `project_id`).

### Basic Usage

```typescript
import { Memory } from 'mem0ai';
import { GuardrailEngine, PromptInjectionValidator, SecretGuard } from '@blackunicorn/bonklm';
import { wrapMem0Client } from '@blackunicorn/bonklm-mem0';

const validators = [new PromptInjectionValidator(), new SecretGuard()];
const engine = new GuardrailEngine({ validators });
const client = new Memory();

const guarded = wrapMem0Client(client, engine, {
  getTenantId: ctx => ctx.userId, // REQUIRED — must be a function
  getSessionContext: () => requestLocal.get('session'),
  validators
});

await guarded.add('user authored content', { user_id: 'IGNORED' });
await guarded.search('what did I say earlier?', { user_id: 'IGNORED' });
```

The `mem0Adapter` module-scope export is a guard placeholder — invoking it without a tenant binding
throws `ConnectorValidationError`.

---

## Zep Memory-Client Connector

### Installation

```bash
npm install @blackunicorn/bonklm-zep @blackunicorn/bonklm @getzep/zep-cloud
```

Wraps the `@getzep/zep-cloud` SDK with a top-level `Proxy` that intercepts `.thread` and `.graph`
accesses. Writes (`thread.addMessages`, `graph.add`) fire the `memory_write` surface; recall paths
(`thread.getUserContext`, `graph.search`) fire `composed_context` post-call. Tenant scoping on
`graph.*` is enforced by overwriting `graphId` with `getTenantId(ctx)` and stripping the bypass
fields `graphIds`, `userId`, `userIds`, `sessionId`. The outer proxy is **fail-closed** for unknown
callable namespaces.

### Basic Usage

```typescript
import { ZepClient } from '@getzep/zep-cloud';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
import { wrapZepClient } from '@blackunicorn/bonklm-zep';

const validators = [new PromptInjectionValidator()];
const engine = new GuardrailEngine({ validators });
const client = new ZepClient({ apiKey: process.env.ZEP_API_KEY });

const guarded = wrapZepClient(client, engine, {
  getTenantId: ctx => ctx.userId, // REQUIRED — must be a function
  getSessionContext: () => requestLocal.get('session'),
  validators
});

await guarded.thread.addMessages({
  threadId: 't-1',
  messages: [{ role: 'user', content: 'hi' }]
});
await guarded.graph.search({ graphId: 'IGNORED', query: '...' });
```

> The package intentionally does NOT export `wrapZepGraphRetriever` — the graph-as-retrieved-docs
> separate-factory pattern is documented as illustrative-only in the connector style guide and was
> not implemented in Story 2.5.

---

## Common Security Features

All SDK connectors above share the BonkLM core defences:

- **SEC-002** — Incremental stream validation with early termination.
- **SEC-003** — Buffer size limits to prevent DoS.
- **SEC-006** — Complex message content handling (arrays, images, mixed).
- **SEC-007** — Production mode for generic error messages.
- **SEC-008** — Validation timeout via `AbortController`.

Memory-client connectors (Letta, Mem0, Zep) additionally enforce:

- **Tenant scoping** — `getTenantId(ctx)` rewrites the first scoping field and strips alternative
  scoping fields per vendor.
- **Sealed write** — `memory_write` surface validation BEFORE the SDK call returns.
- **Composed-context recall** — `composed_context` surface validation on the recall response BEFORE
  it reaches the LLM.
- **Fail-closed proxy** — unknown top-level callables throw `ConnectorValidationError` so a future
  vendor SDK addition cannot silently bypass scoping.

## Next Steps

- [Framework Middleware](./framework-middleware.md) — Express, Fastify, NestJS, Hono, Elysia,
  Next.js, Restate, Temporal, Inngest, Trigger.dev.
- [LLM Provider Connectors](./llm-providers.md) — voice webhooks, inference-providers, broader
  provider helpers.
- [Emerging Framework Connectors](./emerging-frameworks.md) — Mastra, Genkit, CopilotKit, ElizaOS,
  Stagehand, Eko, VoltAgent, Cloudflare Agents, browser-agents-core.
- [RAG & Vector Store Connectors](./rag-vector-stores.md) — LlamaIndex, LangChain, Pinecone,
  ChromaDB, Weaviate, Qdrant, LanceDB, Turbopuffer.
