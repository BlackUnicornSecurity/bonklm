# Usage Patterns

> **Last updated:** 2026-08-14 · **Package version:** `1.0.14`

Practical examples for the most common BonkLM patterns. Every snippet
is verified against current source — if you find one that no longer
matches the API, file a docs issue with the package version that
broke it.

## Table of contents

1. [Basic validation](#basic-validation)
2. [Express middleware](#express-middleware)
3. [Streaming LLM responses](#streaming-llm-responses)
4. [Structured-input surfaces (`validateInput`)](#structured-input-surfaces-validateinput)
5. [RAG applications](#rag-applications)
6. [Tool / function calling](#tool--function-calling)
7. [Memory clients (mem0 / zep / letta / ElizaOS)](#memory-clients)
8. [Multi-validator setup](#multi-validator-setup)
9. [Custom error handling](#custom-error-handling)
10. [Production deployment](#production-deployment)

---

## Basic validation

### Function form (one-shot)

```typescript
import { validatePromptInjection } from '@blackunicorn/bonklm';

const result = validatePromptInjection(userInput);
if (!result.allowed) {
  return { error: 'Invalid input', reason: result.reason };
}
```

### Class form (reuse config)

```typescript
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const validator = new PromptInjectionValidator({
  sensitivity: 'strict',
  detectMultiLayerEncoding: true,
});

for (const input of inputs) {
  const result = validator.validate(input);
  if (!result.allowed) {
    console.log('Blocked:', result.reason);
  }
}
```

---

## Express middleware

### AI endpoint protection

```typescript
import express from 'express';
import { createGuardrailsMiddleware } from '@blackunicorn/bonklm-express';
import {
  PromptInjectionValidator,
  JailbreakValidator,
} from '@blackunicorn/bonklm';

const app = express();
app.use(express.json());

app.use(
  '/api/ai',
  createGuardrailsMiddleware({
    validators: [
      new PromptInjectionValidator({ sensitivity: 'strict' }),
      new JailbreakValidator(),
    ],
    validateRequest: true,
    validateResponse: false,
    productionMode: process.env.NODE_ENV === 'production',
    validationTimeout: 5000,
    maxContentLength: 1024 * 1024,
    onError: (_result, _req, res) => {
      res.status(400).json({ error: 'Content blocked by safety guardrails' });
    },
  })
);

app.post('/api/ai/chat', async (req, res) => {
  const response = await callLLM(req.body.message);
  res.json({ response });
});

app.listen(3000);
```

### Path-specific protection

```typescript
app.use(
  '/api/sensitive',
  createGuardrailsMiddleware({ validators: [new PromptInjectionValidator()] })
);

app.use(
  '/api/ai',
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator()],
    excludePaths: ['/api/ai/health', '/api/ai/status'],
  })
);
```

---

## Streaming LLM responses

### OpenAI streaming

The OpenAI connector wraps the SDK and validates incremental chunks
during the stream.

```typescript
import OpenAI from 'openai';
import { createGuardedOpenAI } from '@blackunicorn/bonklm-openai';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const openai = new OpenAI();
const guardedOpenAI = createGuardedOpenAI(openai, {
  validators: [new PromptInjectionValidator()],
  validateStreaming: true,
  streamingMode: 'incremental',
  validationTimeout: 30_000, // ms
  maxStreamBufferSize: 1024 * 1024, // 1MB
  productionMode: process.env.NODE_ENV === 'production',
  onStreamBlocked: (info) => {
    console.warn('Stream blocked:', info);
  },
});

const stream = await guardedOpenAI.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: userInput }],
  stream: true,
});

for await (const chunk of stream as AsyncIterable<{
  choices: { delta?: { content?: string } }[];
}>) {
  const content = chunk.choices[0]?.delta?.content ?? '';
  process.stdout.write(content);
}
```

> Streaming mode is `'incremental'` by default — the accumulated text is
> re-validated every 10 chunks and the stream terminates early on a
> violation. Set `streamingMode: 'buffer'` to instead hold every chunk
> back, validate the full response once at completion, and release the
> buffered chunks only if validation passes (on a violation the content is
> withheld entirely and a single filtered marker chunk is emitted). Buffer
> mode trades progressive delivery for zero pre-validation leakage and a
> single validation pass; both modes enforce `maxStreamBufferSize`.

### Lower-level streaming primitive

For non-OpenAI streams, use the `StreamValidator` class from the
connector-utils surface:

```typescript
import {
  StreamValidator,
  createStreamValidatorState,
  processStreamChunk,
  PromptInjectionValidator,
} from '@blackunicorn/bonklm';

const validator = new StreamValidator({
  validators: [new PromptInjectionValidator()],
  validateEveryN: 5,
  maxBufferSize: 1024 * 1024,
});

let state = createStreamValidatorState();
for await (const chunk of stream) {
  const outcome = await processStreamChunk(validator, state, chunk);
  state = outcome.state;
  if (outcome.blocked) {
    console.warn('Stream blocked:', outcome.reason);
    break;
  }
  process.stdout.write(chunk);
}
```

> The old examples/streaming package subpath no longer exists — the canonical primitive is
> `StreamValidator` in `connector-utils`, re-exported from the root barrel.

---

## Structured-input surfaces (`validateInput`)

`engine.validate(content: string)` is the text-only entry point. For
the other six surfaces in the `HookSurface` taxonomy, use
`engine.validateInput({ kind, ... })`:

```typescript
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()],
});

// tool_call surface
await engine.validateInput({
  kind: 'tool_call',
  toolName: 'web_search',
  args: { query: userQuery, max_results: 5 },
});

// retrieved_docs surface (RAG)
await engine.validateInput({
  kind: 'retrieved_docs',
  docs: [
    { id: 'doc-1', content: ragSnippet, metadata: { source: 'kb' } },
  ],
});

// memory_write surface
await engine.validateInput({
  kind: 'memory_write',
  payload: {
    content: memoryPayload,
    userId: ctx.user.id,
    sessionId: ctx.session.id,
    metadata: { provenance: 'agent_internal' },
  },
});

// composed_context surface — the final composed prompt
await engine.validateInput({
  kind: 'composed_context',
  entries: [systemPrompt, ragContext, userInput],
});
```

The intercept-callback dispatch path is identical to `validate(...)`,
so telemetry coverage is uniform across surfaces.

---

## RAG applications

### LlamaIndex query engine

```typescript
import { createGuardedQueryEngine } from '@blackunicorn/bonklm-llamaindex';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const guardedEngine = createGuardedQueryEngine(queryEngine, {
  validators: [new PromptInjectionValidator()],
  validateRetrievedDocs: true,
  onBlockedDocument: 'filter',
  onQueryBlocked: (result) => {
    console.warn('Query blocked:', result.reason);
  },
});

const response = await guardedEngine.query(question);
```

`createGuardedRetriever(retriever, options?)` accepts the same
`GuardedLlamaIndexOptions` bag except `onResponseBlocked`; use
`onBlockedDocument`, `onQueryBlocked`, and `onDocumentBlocked` for
retriever flows.

### Pinecone vector store

```typescript
import { Pinecone } from '@pinecone-database/pinecone';
import { createGuardedIndex } from '@blackunicorn/bonklm-pinecone';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const pinecone = new Pinecone();
const index = pinecone.index('documents');

const guardedIndex = createGuardedIndex(index, {
  validators: [new PromptInjectionValidator()],
  validateRetrievedVectors: true,
  sanitizeMetadataFilters: true,
});

await guardedIndex.query({
  vector: queryVector,
  topK: 10,
  filter: { category: { $eq: 'article' } },
});
```

---

## Tool / function calling

Tool-call args are a structured surface. Two equivalent patterns:

### Through `engine.validateInput`

```typescript
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()],
});

const result = await engine.validateInput({
  kind: 'tool_call',
  toolName: 'search',
  args: { query: userQuery },
});

if (result.blocked) {
  // refuse before executing the tool
}
```

### Through the OpenAI connector

```typescript
import OpenAI from 'openai';
import { createGuardedOpenAI } from '@blackunicorn/bonklm-openai';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const openai = new OpenAI();
const guardedOpenAI = createGuardedOpenAI(openai, {
  validators: [new PromptInjectionValidator()],
});

const response = await guardedOpenAI.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: userInput }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'search',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
    },
  ],
});
```

The OpenAI connector validates tool-call content through the standard
OpenAI request/response path. Tool allowlists are currently exposed by
the MCP connector (`allowedTools`), not by `createGuardedOpenAI`.

---

## Memory clients

Two patterns ship today.

### `wrapMemoryClient` — generic Proxy wrap (mem0 / zep / letta)

For SDKs that expose a client object with mutation methods:

```typescript
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
import { wrapMemoryClient } from '@blackunicorn/bonklm-memory-utils';
// Per-vendor adapter factory (one of) — each takes the same getTenantId:
import { buildMem0Adapter } from '@blackunicorn/bonklm-mem0';
// import { buildZepAdapter } from '@blackunicorn/bonklm-zep';
// import { buildLettaAdapter } from '@blackunicorn/bonklm-letta';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()],
});

// getTenantId MUST be a function `(ctx) => string` — pass the SAME one to the
// adapter factory and to wrapMemoryClient.
const getTenantId = (ctx) => ctx.userId;

const wrappedClient = wrapMemoryClient(client, {
  adapter: buildMem0Adapter(getTenantId), // or buildZepAdapter / buildLettaAdapter
  engine,
  validators: [new PromptInjectionValidator()], // REQUIRED, non-empty
  getTenantId,
});

// Use the wrapped client exactly like the original — Proxy preserves
// the prototype chain so `instanceof` keeps working.
await wrappedClient.add({ content: memoryPayload, userId: 'user-123' });
```

Notes:
- `validators` MUST be non-empty. An empty array would silently
  fail-OPEN, so the factory throws `ConnectorValidationError` at
  construction.
- `getTenantId` MUST be a function `(ctx) => string`. A literal string
  is rejected.
- Most consumers use the per-vendor convenience wrapper
  (`wrapMem0Client`, `wrapZepClient`, `wrapLettaClient`) instead of
  calling `wrapMemoryClient` directly — see the connector READMEs.

### `wrapMemory` — sealed ElizaOS runtime wrap

ElizaOS exposes a runtime object with `createMemory` / `updateMemory`
methods. The connector seals BOTH via `Object.defineProperty(...,
{ configurable: false, writable: false })` in a single synchronous
block so hostile plugins cannot unwrap or re-wrap.

```typescript
import { installSealedWrapMemory } from '@blackunicorn/bonklm-elizaos';

installSealedWrapMemory(runtime, {
  logger,
  productionMode: process.env.NODE_ENV === 'production',
});
```

Read the
[ElizaOS connector README](../../../packages/elizaos-connector/README.md)
before deploying — the seal has Class-4 risk acknowledgment requirements
for routes that bypass the runtime wrap.

---

## Multi-validator setup

### Comprehensive protection

```typescript
import {
  GuardrailEngine,
  PromptInjectionValidator,
  JailbreakValidator,
  ReformulationDetector,
  BoundaryDetector,
  SecretGuard,
  PIIGuard,
  BashSafetyGuard,
} from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [
    new PromptInjectionValidator({
      sensitivity: 'strict',
      detectMultiLayerEncoding: true,
    }),
    new JailbreakValidator(),
    new ReformulationDetector(),
    new BoundaryDetector(),
  ],
  guards: [new SecretGuard(), new PIIGuard(), new BashSafetyGuard()],
  shortCircuit: true,
});

const result = await engine.validate(content);
if (!result.allowed) {
  console.log(`Blocked: ${result.reason} (${result.risk_level})`);
}
```

### Context for guards

```typescript
const result = await engine.validate(userInput, 'request:/chat');
// `context` is the second arg to `engine.validate(content, context?)`.
// Guards receive the same `context` string via their `validate(content,
// context?)` signature — useful for surfaces like file-path-aware
// SecretGuard ('config.js' etc.).
```

> The previous `engine.validate(input, { context: {...} })` object-arg
> form is not part of the current API. Use the string context above,
> or attach structured context via intercept callbacks.

---

## Custom error handling

### Express error handler

```typescript
app.use(
  '/api/ai',
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator()],
    productionMode: process.env.NODE_ENV === 'production',
    onError: (result, _req, res) => {
      const isDev = process.env.NODE_ENV !== 'production';
      res.status(400).json({
        error: 'Content blocked by safety guardrails',
        ...(isDev && {
          reason: result.reason,
          risk_level: result.risk_level,
          findings: result.findings.map((f) => ({
            type: f.category,
            severity: f.severity,
          })),
        }),
      });
    },
  })
);
```

### Async error narrowing

```typescript
import {
  StreamValidationError,
  ConnectorValidationError,
} from '@blackunicorn/bonklm';

async function safeValidate(content: string) {
  try {
    return await engine.validate(content);
  } catch (err) {
    if (err instanceof StreamValidationError) {
      // buffer overflow / circuit-breaker trip
      console.warn('Stream validation:', err.message);
    } else if (err instanceof ConnectorValidationError) {
      // configuration / runtime contract violation
      console.error('Connector misconfigured:', err.message);
    } else {
      throw err;
    }
    return { allowed: false, reason: 'Validation failed' };
  }
}
```

> The legacy `GuardrailValidationError` name from older docs no longer
> exists. Catch `StreamValidationError` or `ConnectorValidationError`
> from the root barrel.

---

## Production deployment

### Environment-based configuration

```typescript
import {
  GuardrailEngine,
  PromptInjectionValidator,
  MonitoringLogger,
  MonitoringLogLevel,
  createLogger,
} from '@blackunicorn/bonklm';

const isProd = process.env.NODE_ENV === 'production';

const logger = isProd
  ? new MonitoringLogger({
      level: MonitoringLogLevel.INFO,
      json: true,
      metrics: true,
      audit: true,
    })
  : createLogger('console');

const engine = new GuardrailEngine({
  validators: [
    new PromptInjectionValidator({
      sensitivity: isProd ? 'standard' : 'strict',
    }),
  ],
  validationTimeout: 5000,
  patternTimeout: 100,
  maxBufferSize: 1024 * 1024,
  circuitBreakerThreshold: 3,
  logger,
});
```

### Telemetry via `TelemetryService`

```typescript
import {
  TelemetryService,
  TelemetryEventType,
  ConsoleTelemetryCollector,
  BufferedTelemetryCollector,
  CallbackTelemetryCollector,
} from '@blackunicorn/bonklm';

const telemetry = new TelemetryService({
  enabled: true,
  sampleRate: 1.0,
  collectors: [
    new BufferedTelemetryCollector(new ConsoleTelemetryCollector(), 100, 30_000),
    new CallbackTelemetryCollector((event) => {
      // forward to your SIEM / OTLP pipeline
      sendToSiem(event);
    }),
  ],
});

// Most users wire it via OTLP spans:
import { bonklmTrace } from '@blackunicorn/bonklm';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-app');

// bonklmTrace(result, options) is synchronous, emits one OTLP span, and returns
// the result unchanged. Caller provides the tracer (bonklm bundles no SDK).
const result = bonklmTrace(await engine.validate(input), {
  tracer,
  validator: 'prompt-injection',
  surface: 'text_input', // locked vocab
});
```

The OTLP `bonklm.surface` / `bonklm.action` attribute vocabulary is
locked — see
[`docs/user/otel-vendor-recipes.md`](../otel-vendor-recipes.md).

### Circuit breaker

The circuit breaker is built into the engine — there is no separate
`CircuitBreaker` instance to wire. Configure via the engine config:

```typescript
const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()],
  circuitBreakerThreshold: 3,     // open after 3 buffer-overflow violations
  circuitBreakerTimeout: 60_000,  // ms in OPEN state before HALF_OPEN attempt
});

console.log(engine.getCircuitBreakerState());
// { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN', violations: number, ... }
```

The engine no longer takes a `circuitBreaker` config object — use the threshold /
timeout fields above. (The standalone `CircuitBreaker` class is still exported for
connectors that accept one — e.g. the Anthropic SDK connector's `circuitBreaker`
option.)

### Attack logging

```typescript
import { AttackLogger } from '@blackunicorn/bonklm-logger';

const attackLogger = new AttackLogger({
  max_logs: 1000,
  ttl: 30 * 24 * 60 * 60 * 1000, // 30 days
  sanitize_pii: true,
});

engine.onIntercept(attackLogger.getInterceptCallback());

// later — dump a summary
attackLogger.show('summary');
// or export
await attackLogger.exportJSONToFile('./logs/attacks.json');
```

See the [logger README](../../../packages/logger/README.md) for the
full filter / display API.

---

## See also

- [Getting Started](../../getting-started.md) — install + first call
- [Security: rate limiting](../security/rate-limiting.md)
- [Security: headers](../security/security-headers.md)
- [Known limitations](../known-limitations.md)
- [Threat surfaces](../threat-surfaces.md) — 7-surface canonical taxonomy
- [Public API surface](../public-api-surface.md) — API freeze
- [Connector guides](../connectors/) — per-framework setup
