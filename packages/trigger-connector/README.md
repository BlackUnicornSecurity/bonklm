# @blackunicorn/bonklm-trigger

Trigger.dev v3/v4 middleware that wraps `task({...})` with BonkLM security guardrails. CRIU-safe
handle stored in Trigger.dev's `locals` registry; retry-survival via `cachedValidate` keyed by
`ctx.run.id`.

**Peer dep:** `@trigger.dev/sdk ^4.0.0`. Node-only (Trigger.dev runners are Node containers).

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-trigger @trigger.dev/sdk
```

## Quick start

```ts
import { task, AbortTaskRunError } from '@trigger.dev/sdk/v3';
import { withBonkLM, getBonklmHandle } from '@blackunicorn/bonklm-trigger';
import {
  PromptInjectionValidator,
  SecretGuard,
  createMemoryWriteValidator
} from '@blackunicorn/bonklm';

const { middleware, onFailure } = withBonkLM({
  validators: [new PromptInjectionValidator(), new SecretGuard()],
  cache: redisCache // optional — enables retry-survival via cachedValidate
});

export const myTask = task({
  id: 'my-task',
  middleware,
  onFailure,
  retry: { maxAttempts: 3 },
  run: async (payload, { ctx }) => {
    // Pass ctx to detect cross-task locals bleed (recommended).
    const r = await getBonklmHandle(ctx).validateInput(payload.prompt);
    if (r.blocked) {
      // SECURITY: AbortTaskRunError terminates the run immediately
      // (no retry storm). Use a STATIC reason — `r.reason` is
      // attacker-controlled validator output and persists to the
      // Trigger.dev dashboard's run-status field.
      throw new AbortTaskRunError('blocked: guardrail decision');
    }
    // ... downstream LLM call
  }
});
```

## Why a bindings factory (shape #5)

Trigger.dev's `task({...})` accepts named option keys for lifecycle hooks (`middleware`,
`onFailure`, `onStart`, ...). The connector needs to register BOTH `middleware` (to set up the
locals handle) AND `onFailure` (for observability), so it returns a bindings object the consumer
spreads. See `docs/user/connector-style-guide.md` §5 for the canonical shape.

## CRIU + retry survival

`withBonkLM` does TWO things:

1. **CRIU-safe handle.** The middleware builds a `BonklmTriggerHandle` per attempt and stores it in
   Trigger.dev's `locals` registry. After `wait.for(...)` checkpoints the V8 heap + restores
   minutes/hours later, the handle is still in locals.
2. **Retry-survival via cachedValidate.** Each handle's cacheNamespace includes `run-${ctx.run.id}`.
   When Trigger.dev retries the same run (run.id unchanged), the cached BLOCK/ALLOW is served
   without re-firing the validator pipeline. Different runs get distinct namespaces (no cross-run
   poisoning).

## Configuration

See `BonklmTriggerOptions` in `src/types.ts` for the full surface with `@security` notes. Key
options:

- `validators` — required, non-empty. Frozen at factory time (sec S7).
- `cache` — optional. Enables cross-attempt cache dedupe via `cachedValidate`.
- `engine` — optional. Defaults to a fresh engine per factory. Sharing an engine across factories
  collapses cache namespaces.
- `cacheNamespace` — base prefix. MUST NOT contain `::` (reserved for the run-id separator).
- `defaultTtlMs` / `blockedTtlMs` — TTL for cache entries.

## `engine.onIntercept` integration (Sprint 14 cumulative)

The connector calls `engine.notifyCachedResult(results, content, 'trigger:<surface>:run-<id>')`
after every `cachedValidate` so audit telemetry wired via `engine.onIntercept(...)` sees Trigger.dev
decisions. Without this, validator outcomes were invisible to engine-wide observability.

## What this connector does NOT validate

- Code OUTSIDE the wrapped methods. Consumer code in `run()` that doesn't call
  `getBonklmHandle(...)` bypasses validation entirely.
- Direct `locals.set(bonklmHandleLocalsKey, ...)` writes. The `getBonklmHandle()` accessor
  structurally validates the handle shape before returning it (sec S2 — supply-chain locals-slot
  squatting closure), but a malicious peer dep could still observe inputs that flow through the
  handle.

## License

MIT
