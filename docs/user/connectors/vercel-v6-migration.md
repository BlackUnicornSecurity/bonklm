# Migrating @blackunicorn/bonklm-vercel to Vercel AI SDK v5/v6

This guide covers the migration path from `ai@3.x`/`ai@4.x` to `ai@5.x` / `ai@6.x` while keeping
BonkLM guardrails in place.

## TL;DR

```bash
npm install ai@latest @blackunicorn/bonklm-vercel@latest
```

The connector now supports `ai ^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0` in a single package. Existing
v3/v4 code continues to work; new projects should adopt the v5/v6 middleware pattern via
`bonkMiddleware`.

## What changed in `ai` v5/v6

The Vercel AI SDK underwent two breaking changes between v4 and v6:

1. **`CoreMessage` → `ModelMessage`** (v5). The shape is largely compatible — both carry `role` +
   `content` — but the type identity differs. Code that types variables as `CoreMessage[]` needs
   updating to `ModelMessage[]` (or accept the structural-only shape).
2. **Middleware-first architecture** (v5). The new `wrapLanguageModel({ model, middleware })`
   pattern moves input / output validation into a composable middleware object rather than wrapping
   `generateText` / `streamText` directly.

## Migration recipes

### Old (v3/v4) — `createGuardedAI` wrap

```ts
import { createOpenAI } from '@ai-sdk/openai';
import { createGuardedAI } from '@blackunicorn/bonklm-vercel';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const openai = createOpenAI();
const guardedAI = createGuardedAI({
  validators: [new PromptInjectionValidator()],
  validateStreaming: true
});

const result = await guardedAI.generateText({
  model: openai('gpt-4'),
  messages: [{ role: 'user', content: userInput }]
});
```

### New (v5/v6) — `bonkMiddleware` + `wrapLanguageModel`

```ts
import { openai } from '@ai-sdk/openai';
import { generateText, wrapLanguageModel } from 'ai';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
import { bonkMiddleware } from '@blackunicorn/bonklm-vercel';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()]
});

const guardedModel = wrapLanguageModel({
  model: openai('gpt-4'),
  middleware: bonkMiddleware(engine, { productionMode: true })
});

const result = await generateText({
  model: guardedModel,
  messages: [{ role: 'user', content: userInput }]
});
```

The advantage of the middleware pattern is composition: BonkLM stacks naturally alongside other
v5/v6 middlewares (e.g. caching, extraction-reasoning, custom telemetry) without each wrapping the
others' API surfaces.

### Streaming under v5/v6

```ts
import { streamText, wrapLanguageModel } from 'ai';

const guardedModel = wrapLanguageModel({
  model: openai('gpt-4'),
  middleware: bonkMiddleware(engine)
});

const result = await streamText({
  model: guardedModel,
  messages: [{ role: 'user', content: userInput }]
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

The middleware accumulates the stream text internally and validates the tail at finish. Future
Phase-2 work will add per-event validation across all 20 v5/v6 stream-part types (`text-delta`,
`tool-input-delta`, `reasoning-delta`, etc.) — track Story 1.4 follow-up PRs.

### Tool-loop agents (v5/v6) — `wrapAgent`

Phase-1 stub. Wraps the agent's `.generate` entry point with input + output validation. Tool-call
validation per-tool via `onInputAvailable` and tool-approval persistence (two-call `approvalId`
pattern) ship in a follow-up PR.

```ts
import { ToolLoopAgent } from 'ai'; // (or ai/agent — check your SDK version)
import { wrapAgent } from '@blackunicorn/bonklm-vercel';

const agent = new ToolLoopAgent({
  /* ... */
});
const guardedAgent = wrapAgent(agent, engine);

await guardedAgent.generate({ prompt: userMessage });
```

### MCP clients (v5/v6) — `wrapMCPClient`

Phase-1: validates `readResource` results via `createRetrievedDocValidator` in `drop` mode (flagged
docs are silently filtered from the result).

```ts
import { experimental_createMCPClient as createMCPClient } from 'ai';
import { wrapMCPClient } from '@blackunicorn/bonklm-vercel';

const client = await createMCPClient({
  /* ... */
});
const guarded = wrapMCPClient(client, engine);

const resource = await guarded.readResource({ uri: 'doc://foo' });
// resource.contents has been filtered through RetrievedDocValidator
```

## Helpers retained for back-compat

- `messagesToText(messages)` — the original v3/v4 extractor; still works against `CoreMessage` and
  produces matching output for `ModelMessage` shapes (structurally compatible).
- `messagesToTextLegacy(messages)` — Story 1.4 alias for `messagesToText`. When the v3/v4 type drop
  lands in a future PR, `messagesToText` will switch to `ModelMessage` and `messagesToTextLegacy`
  will retain the original `CoreMessage` shape.
- `messagesToTextDucked(messages)` — duck-typed extractor used internally by `bonkMiddleware`; works
  against any v3/v4/v5/v6 shape.

## Phase-2+ follow-ups (tracked in Story 1.4 backlog)

The full Story 1.4 acceptance criteria include items NOT yet shipped in Phase-1 — these will land as
follow-up PRs against the same package:

- Full 20 v5/v6 stream-part-type handling in the middleware
- `onInputAvailable` per-tool → `ToolCallArgsValidator` (Story 1.1)
- Tool-approval two-call pattern persistence via `approvalId`
- Real integration tests against the `ai-v5` and `latest` npm tags
- Drop v3/v4 type imports and switch the primary `messagesToText` signature to `ModelMessage`
