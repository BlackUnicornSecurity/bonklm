# @blackunicorn/bonklm-inngest

Inngest v4 middleware that injects `ctx.bonklm.validateInput / validateOutput / validateToolArgs`
helpers into every function-run context. Each helper wraps the validator pipeline in
`step.run('bonklm-validate-*', ...)` so Inngest's in-run replay machinery + the core
`cachedValidate` cross-run dedupe combine to return cached BLOCK/ALLOW decisions on retry/replay
without re-firing validators.

**Peer dep:** `inngest ^4.4.0`. Node-only.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-inngest inngest
```

## Quick start

```ts
import { Inngest } from 'inngest';
import { bonklmInngestMiddleware } from '@blackunicorn/bonklm-inngest';
import { PromptInjectionValidator, SecretGuard, GuardrailEngine } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator(), new SecretGuard()]
});

// Optional: wire audit telemetry. Sprint 14 cumulative arch X3 part 2
// closure means cached-validate decisions ALSO fire these callbacks.
engine.onIntercept((result, ctx) => {
  if (result.blocked) {
    myAttackLogger.log({ result, ctx });
  }
});

const inngest = new Inngest({
  id: 'my-app',
  middleware: [
    bonklmInngestMiddleware({
      validators: [new PromptInjectionValidator(), new SecretGuard()],
      engine, // optional — share the engine to wire onIntercept
      cache: redisCache // optional — enables cross-run cache dedupe
    })
  ]
});

export const myFn = inngest.createFunction(
  { id: 'my-fn' },
  { event: 'app/user.prompt' },
  async ({ event, ctx }) => {
    const r = await ctx.bonklm.validateInput(event.data.prompt);
    if (r.blocked) {
      throw new Error(`Blocked: ${r.reason}`); // r.reason is sanitized
    }
    // ... downstream LLM call
  }
);
```

## Why a class-based middleware (shape #4)

Inngest v4 requires a class extending `Middleware.BaseMiddleware`.
`bonklmInngestMiddleware(options)` returns that class. The shape is host-constrained: the consumer
cannot pass an `(engine, options?)` pair because Inngest's middleware registration is class-based.

See `docs/user/connector-style-guide.md` §Epic-2 deviations for the ADR amendment retroactively
documenting this.

## Replay + retry survival

The middleware combines TWO mechanisms:

1. **In-run replay (Inngest native).** Each helper wraps its validator dispatch in
   `step.run('bonklm-validate-input', ...)`. Inngest reads step output from history on retry rather
   than re-executing the validator.
2. **Cross-run cache dedupe (`cachedValidate`).** When a `cache` is wired, identical inputs across
   DIFFERENT function runs hit the cache instead of re-validating. Requires the middleware to be
   constructed ONCE per Inngest client (the standard pattern — middleware is registered at client
   boot).

## `engine.onIntercept` integration (Sprint 14 cumulative)

The middleware calls `engine.notifyCachedResult(results, content, 'inngest:<stepId>')` after every
`cachedValidate` so audit telemetry wired via `engine.onIntercept(...)` sees Inngest decisions.
Without this, validator outcomes from Inngest function runs were invisible to engine-wide
observability — closes Sprint 13 carry-over BLOCK `arch X3 part 2`.

## Configuration

See `BonklmInngestMiddlewareOptions` in `src/types.ts` for the full surface. Defaults:

| Option           | Default                           |
| ---------------- | --------------------------------- |
| `engine`         | new engine per middleware factory |
| `cache`          | none (no cross-run dedupe)        |
| `defaultTtlMs`   | 1h                                |
| `blockedTtlMs`   | follows `defaultTtlMs`            |
| `cacheNamespace` | `@blackunicorn/bonklm@0.4`        |
| `stepNamePrefix` | `bonklm-validate`                 |

`validators` is frozen at factory time (sec cross-S2 — Sprint 14 cumulative closure).

## What this connector does NOT validate

- Code OUTSIDE the wrapped helpers. Consumer code in the function body that doesn't call
  `ctx.bonklm.*` bypasses validation.
- The Inngest event payload itself (use `validateInput` on the relevant payload field).
- Tool execution OUTPUTS (use `validateOutput` after the tool returns).

## License

MIT
