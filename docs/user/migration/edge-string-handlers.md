# Migrating to `@blackunicorn/bonklm/edge`

Phase-1 ships an edge-runtime-compatible subpath of the BonkLM core. Cloudflare Workers (workerd,
with `nodejs_compat`), Deno Deploy, and Bun resolve `@blackunicorn/bonklm` imports through this
subpath automatically via the exports map in `packages/core/package.json`. The subpath is NOT
strictly Vercel-Edge (`edge-light`) safe — it transitively uses Node built-ins
(`node:fs`/`node:path`/`node:crypto`), so the `edge-light` condition is not declared (see the
runtime caveat in `packages/core/src/edge/index.ts`).

## TL;DR

```ts
// Before (Node-only):
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

// After (works on Node + Workerd (nodejs_compat) + Deno + Bun):
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm/edge';
```

Or rely on automatic resolution — at deploy time the bundler picks the right path:

```ts
// Single import; the bundler picks the right path per the exports map:
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
```

## What's edge-safe (Phase-1)

- Every validator + guard + composite-validator factory
- `StreamValidator` + `BufferedReleaseGate`
- `ConnectorValidationError` + log helpers
- `applyRetrievedDocValidatorToMatches` connector helper
- Engine + types

> **Caveat (see the header above):** "edge-safe" here means these APIs avoid `Buffer` / `node:vm` at
> their own call sites. The `/edge` subpath as a whole still transitively pulls `node:fs` /
> `node:path` (via `common/index`) and `node:crypto` / `Buffer` (via `GuardrailEngine` → the
> internal `override-token` module), so it requires a Node-compatible edge runtime (Cloudflare
> `workerd` with `nodejs_compat`, Deno, Bun) — NOT the strict Vercel Edge Runtime (`edge-light`).

Internal swaps (transparent to consumers):

- `Buffer.from(s, 'base64'|'hex')` → `atob` + `Uint8Array` + `TextDecoder` (`common/edge-codec.ts`).
- `Buffer.byteLength` → `new TextEncoder().encode(s).byteLength`.
- `node:crypto`'s `randomUUID` → `globalThis.crypto.randomUUID` with non-crypto-strong Math.random
  fallback (used only by `HookSandbox` execution-id labelling — not security-critical).

## What's NOT edge-safe yet (Phase-2)

Imports through `@blackunicorn/bonklm/edge` deliberately omit these constructs. Edge consumers MUST
NOT import them; Node consumers can continue using them via the standard root import.

> **End-to-end edge-light is still Phase-2.** Packages that declare the `edge-light` condition (e.g.
> `-elysia`, `-nextjs`, `-web-middleware-utils`) are edge-light-safe only as packages — actually
> running them requires constructing a `GuardrailEngine`, which transitively uses Node built-ins
> (`node:crypto` / `node:fs`, as noted in the caveat above). A fully Web-only engine for strict
> Vercel Edge is the remaining Phase-2 work.

### `HookSandbox` (Node-only)

`HookSandbox` uses `node:vm` to sandbox user-supplied string handlers. Workerd does not ship
`node:vm`. Function-only handlers ship a small portable subset in Phase-2; for v0.4.0 / Phase-1,
edge consumers MUST register only FUNCTION handlers via
`HookManager.registerHook({ phase, surface, handler: (ctx) => ... })`. String-handler registration
throws at engine construction on the edge build (deferred).

### `OverrideToken` HMAC validator (Node-only)

The current implementation uses `node:crypto`'s `createHmac` + `timingSafeEqual` + `Buffer`. The
HMAC unified async migration (deprecating sync `validateToken`, shipping async-only) lands in
Phase-2. Until then, override tokens are a Node-only feature.

### Connectors

Connector packages (`@blackunicorn/bonklm-vercel` / `@blackunicorn/bonklm-langchain` / etc.) bring
their own peer-SDK constraints and are not in scope for this edge audit. The new Hono middleware
ships native edge support.

## Common patterns

### Cloudflare Worker

```ts
import { GuardrailEngine, PromptInjectionValidator, SecretGuard } from '@blackunicorn/bonklm/edge';

export default {
  async fetch(request: Request): Promise<Response> {
    const engine = new GuardrailEngine({
      validators: [new PromptInjectionValidator()],
      guards: [new SecretGuard()]
    });
    const body = await request.text();
    const result = await engine.validate(body);
    if (!result.allowed) {
      return new Response('Blocked', { status: 400 });
    }
    // ... call your LLM
    return new Response('ok');
  }
};
```

### Deno Deploy

```ts
import { GuardrailEngine, PromptInjectionValidator } from 'npm:@blackunicorn/bonklm/edge';
// Same surface as Cloudflare. Deno resolves the `deno` export
// condition to the edge build automatically.
```

### Bun

```ts
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm/edge';
// Bun resolves the `bun` export condition. Bun's runtime supports
// most Node APIs as well — using `@blackunicorn/bonklm` (root)
// would also work, but `/edge` guarantees portable code if you
// later deploy the same logic to Workerd / Deno.
```

## Smoke-test verification

The edge subpath ships a portable codec corpus-identity test at
`packages/core/tests/edge/edge-codec.test.ts`. The test verifies `base64DecodeToUtf8` /
`hexDecodeToUtf8` / `utf8ByteLength` produce output IDENTICAL to `Buffer.from(...)` /
`Buffer.byteLength` on a representative corpus (ASCII, multi-byte UTF-8, emoji, attack payloads,
1000-char strings). Since the validators that consumed `Buffer.from` now consume the portable
helpers, output identity at the codec layer translates to identity at the validator layer.

Real-runtime smoke tests (wrangler dev / deno / bun) defer to Phase-2 — they require runtime
installations not present in CI today.

## Cloudflare Workers required setup

> **Canonical fragment** — every Workerd-shipping BonkLM guide (Cloudflare Agents, Elysia/Next on
> Workerd, etc.) references THIS section by URL anchor. Do not duplicate the snippet elsewhere;
> drift breaks cross-guide consistency.

BonkLM's edge build uses `AsyncLocalStorage` (via `node:async_hooks`) to propagate call-context
across async boundaries (sealed `runtime.bonklm.currentCallContext`). Workerd ONLY exposes
`AsyncLocalStorage` when the `nodejs_compat` compatibility flag is set.

Required `wrangler.toml` fragment:

```toml
name = "your-worker"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
```

The `compatibility_date` is pinned to `2024-09-23` — the first Workerd release shipping
`AsyncLocalStorage` via `nodejs_compat`. Bump only after auditing the workerd CHANGELOG
(`https://github.com/cloudflare/workerd/blob/main/CHANGELOG.md`) for ALS / `async_hooks` /
`nodejs_compat` regressions. Release-prep rituals re-audit on every BonkLM release.

BonkLM ALSO ships an inline guard at engine construction that throws `AsyncLocalStorageCanaryError`
synchronously when ALS is absent OR non-functional (poisoned stub, broken polyfill, prototype
pollution). The error message names this anchor explicitly — consumers hitting it in deployment know
exactly which `wrangler.toml` field to add.

```ts
import { assertAsyncLocalStorageHealthy } from '@blackunicorn/bonklm/edge';

// Engine construction calls this once. You can also call it directly
// from your Worker's `fetch` handler the first time it runs to surface
// the misconfiguration in your own observability stack before BonkLM's
// engine sees it.
assertAsyncLocalStorageHealthy();
```

## envBindings migration from v0.3

This migration replaces direct `process.env` reads in `packages/core/src/guards/production.ts` (and
follow-on: `security/override-token.ts`, `engine/CircuitBreaker.ts` if applicable) with an explicit
`envBindings` parameter. v0.3 Node-only consumers keep working transparently (the function falls
back to `process.env` when `envBindings` is omitted). v0.5 edge consumers MUST pass `envBindings`
explicitly.

| v0.3 env var                     | v0.5 `envBindings` field                     | Edge runtime impact                      |
| -------------------------------- | -------------------------------------------- | ---------------------------------------- |
| `NODE_ENV`                       | `envBindings.NODE_ENV`                       | Auto-read on Node; explicit on edge.     |
| `RAILS_ENV`                      | `envBindings.RAILS_ENV`                      | Same.                                    |
| `FLASK_ENV`                      | `envBindings.FLASK_ENV`                      | Same.                                    |
| `BONKLM_OVERRIDE_SECRET`         | `envBindings.BONKLM_OVERRIDE_SECRET`         | Override-token validator reads.          |
| `LLM_GUARDRAILS_OVERRIDE_SECRET` | `envBindings.LLM_GUARDRAILS_OVERRIDE_SECRET` | Same — legacy alias.                     |
| `BONKLM_SKIP_RUNTIME_PROBE`      | `envBindings.BONKLM_SKIP_RUNTIME_PROBE`      | ElizaOS probe escape-hatch (connectors). |

**Forward policy**: ALL future env-var reads in any `@blackunicorn/bonklm/edge`-reachable file MUST
flow through `envBindings`, NOT bare `process.env`. The `@blackunicorn/eslint-plugin-edge` ESLint
plugin enforces this at ERROR severity from v0.5.0 final. New env-var additions in v0.6+ connectors
that need ambient host-environment data MUST extend the `EnvBindings` shape AND add a row to this
migration table.

## EdgeHookManager — function-only handler enforcement

```ts
import { EdgeHookManager } from '@blackunicorn/bonklm/edge';

const hooks = new EdgeHookManager();
await hooks.initialize();

// ✅ Function handlers — execute directly (no VM sandbox needed).
const ok = await hooks.executeHook(ctx => ({ scrubbed: String(ctx.input).slice(0, 1024) }), {
  input: '...'
});

// ❌ String handlers — REJECTED at the executeHook boundary.
// throws ConnectorValidationError('configuration_error')
try {
  await hooks.executeHook('return ctx.input.toUpperCase()', { input: '...' });
} catch (e) {
  // Caught here — error.category === 'configuration_error'
  // Message names EdgeHookManager + string-handler so the
  // diagnostic is unambiguous in production logs.
}
```

The Node-only `HookSandbox` from `@blackunicorn/bonklm` (root) accepts both function and string
handlers via `node:vm`. Edge-deployed code MUST import `EdgeHookManager` from
`@blackunicorn/bonklm/edge` instead. Trying to use string handlers on edge surfaces a clear
configuration error instead of a silent silent execution-time failure.

## Phase-2 status (2026-05-22)

Shipped at this commit:

- ✅ `EdgeHookManager` (function-only handler enforcement).
- ✅ `assertAsyncLocalStorageHealthy()` ALS canary guard.
- ✅ `envBindings` injection — `production.ts` (test + production env detection).
- ✅ `node:events` EventEmitter → `PortableEventEmitter`.
- ✅ Canonical Workerd `wrangler.toml` fragment (this section).

Deferred to follow-on commits (require v0.5 release coordination):

- ⏳ `OverrideToken` HMAC unified async migration — sync `validateToken` becomes a `@deprecated`
  proxy that THROWS `TypeError` synchronously in v0.5. Implementation lands alongside other v0.5
  breaking changes.
- ⏳ `process.env` migration for `security/override-token.ts` + `engine/CircuitBreaker.ts` —
  coordinated with the HMAC async swap so the file-touches happen in a single coherent diff.
- ⏳ Real wrangler / deno / bun runtime tests in `.github/workflows/ci-edge.yml` — requires runtime
  pinning + the workspace `pnpm test:edge` script.
