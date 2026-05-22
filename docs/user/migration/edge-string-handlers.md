# Migrating to `@blackunicorn/bonklm/edge`

Story 2.1 Phase-1 ships an edge-runtime-compatible subpath of the
BonkLM core. Cloudflare Workers (workerd), Vercel Edge Functions
(edge-light), Deno Deploy, and Bun resolve `@blackunicorn/bonklm`
imports through this subpath automatically via the 5-condition
exports map in `packages/core/package.json`.

## TL;DR

```ts
// Before (Node-only):
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

// After (works on Node + Workerd + edge-light + Deno + Bun):
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm/edge';
```

Or rely on automatic resolution — at deploy time the bundler picks
the right path:

```ts
// Single import, works everywhere via the 5-condition exports map:
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
```

## What's edge-safe (Phase-1)

- Every validator + guard + composite-validator factory
- `StreamValidator` + `BufferedReleaseGate`
- `ConnectorValidationError` + log helpers
- `applyRetrievedDocValidatorToMatches` connector helper
- Engine + types

Internal swaps (transparent to consumers):
- `Buffer.from(s, 'base64'|'hex')` → `atob` + `Uint8Array` +
  `TextDecoder` (`common/edge-codec.ts`).
- `Buffer.byteLength` → `new TextEncoder().encode(s).byteLength`.
- `node:crypto`'s `randomUUID` → `globalThis.crypto.randomUUID`
  with non-crypto-strong Math.random fallback (used only by
  `HookSandbox` execution-id labelling — not security-critical).

## What's NOT edge-safe yet (Phase-2)

Imports through `@blackunicorn/bonklm/edge` deliberately omit these
constructs. Edge consumers MUST NOT import them; Node consumers can
continue using them via the standard root import.

### `HookSandbox` (Node-only)

`HookSandbox` uses `node:vm` to sandbox user-supplied string
handlers. Workerd does not ship `node:vm`. Function-only handlers
ship a small portable subset in Phase-2; for v0.4.0 / Phase-1,
edge consumers MUST register only FUNCTION handlers via
`HookManager.registerHook({ phase, surface, handler: (ctx) => ... })`.
String-handler registration throws at engine construction on the
edge build (deferred).

### `OverrideToken` HMAC validator (Node-only)

The current implementation uses `node:crypto`'s `createHmac` +
`timingSafeEqual` + `Buffer`. The HMAC unified async migration
(deprecating sync `validateToken`, shipping async-only) lands in
Phase-2 of Story 2.1. Until then, override tokens are a Node-only
feature.

### Connectors

Connector packages (`@blackunicorn/bonklm-vercel` /
`@blackunicorn/bonklm-langchain` / etc.) bring their own peer-SDK
constraints and are not in scope for this edge audit. The new Hono
middleware (Story 2.2) ships native edge support.

## Common patterns

### Cloudflare Worker

```ts
import {
  GuardrailEngine,
  PromptInjectionValidator,
  SecretGuard,
} from '@blackunicorn/bonklm/edge';

export default {
  async fetch(request: Request): Promise<Response> {
    const engine = new GuardrailEngine({
      validators: [new PromptInjectionValidator()],
      guards: [new SecretGuard()],
    });
    const body = await request.text();
    const result = await engine.validate(body);
    if (!result.allowed) {
      return new Response('Blocked', { status: 400 });
    }
    // ... call your LLM
    return new Response('ok');
  },
};
```

### Deno Deploy

```ts
import {
  GuardrailEngine,
  PromptInjectionValidator,
} from 'npm:@blackunicorn/bonklm/edge';
// Same surface as Cloudflare. Deno resolves the `deno` export
// condition to the edge build automatically.
```

### Bun

```ts
import {
  GuardrailEngine,
  PromptInjectionValidator,
} from '@blackunicorn/bonklm/edge';
// Bun resolves the `bun` export condition. Bun's runtime supports
// most Node APIs as well — using `@blackunicorn/bonklm` (root)
// would also work, but `/edge` guarantees portable code if you
// later deploy the same logic to Workerd / Deno.
```

## Smoke-test verification

The edge subpath ships a portable codec corpus-identity test at
`packages/core/tests/edge/edge-codec.test.ts`. The test verifies
`base64DecodeToUtf8` / `hexDecodeToUtf8` / `utf8ByteLength` produce
output IDENTICAL to `Buffer.from(...)` / `Buffer.byteLength` on a
representative corpus (ASCII, multi-byte UTF-8, emoji, attack
payloads, 1000-char strings). Since the validators that consumed
`Buffer.from` now consume the portable helpers, output identity at
the codec layer translates to identity at the validator layer.

Real-runtime smoke tests (wrangler dev / deno / bun) defer to
Phase-2 — they require runtime installations not present in CI
today.

## Phase-2 / Story 2.1 Phase-2 follow-ups

Tracked as backlog:
- `HookSandbox` edge variant with function-only handler enforcement
- `OverrideToken` HMAC unified async migration
- `process.env` → engine-config injection refactor
- `node:events` EventEmitter → portable emitter
- Real wrangler / deno / bun runtime tests in CI
