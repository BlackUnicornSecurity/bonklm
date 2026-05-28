# @blackunicorn/bonklm-web-middleware-utils

> Shared web-framework middleware primitives for BonkLM — `runRequestValidation`,
> `runResponseValidation`, framework-agnostic `getRequestBody`.

## Audience

**Building-block — consumed by connectors.** Direct end-users should reach for a per-framework
wrapper: `@blackunicorn/bonklm-elysia`, `@blackunicorn/bonklm-nextjs`, `@blackunicorn/bonklm-hono`,
`@blackunicorn/bonklm-express`, `@blackunicorn/bonklm-fastify`. This package provides the shared
validation + body-extraction primitives those connectors build on. Per Story 3.9 / Sprint 22 scope,
Express + Fastify were intentionally NOT retrofitted to avoid touching production-hardened code.

## Installation

```bash
pnpm add @blackunicorn/bonklm-web-middleware-utils @blackunicorn/bonklm
```

## Peer Dependencies

| Package                | Version       | Notes                                                                         |
| ---------------------- | ------------- | ----------------------------------------------------------------------------- |
| `@blackunicorn/bonklm` | `workspace:*` | Required peer.                                                                |
| Node.js                | `>=20.0.0`    | Edge-runtime conditions (`workerd`, `edge-light`) resolve to the same bundle. |

## Quick Start (writing a framework adapter)

```typescript
import {
  runRequestValidation,
  getRequestBody,
  WebMiddlewareBlockedError
} from '@blackunicorn/bonklm-web-middleware-utils';
import type { GuardrailEngine } from '@blackunicorn/bonklm';

export function myFrameworkMiddleware(engine: GuardrailEngine) {
  return async (req, next) => {
    const body = await getRequestBody(req, 'web'); // or 'elysia' | 'next-action' | 'node'
    try {
      await runRequestValidation({ engine }, body);
    } catch (err) {
      if (err instanceof WebMiddlewareBlockedError) {
        return new Response(JSON.stringify({ error: err.message }), { status: 400 });
      }
      throw err;
    }
    return next();
  };
}
```

## API Reference

### `runRequestValidation(options, body)` / `runResponseValidation(options, body)`

Validate a raw body string through `engine.validate(body)`. Identical semantics; only the telemetry
`phase` tag differs (`'request'` vs `'response'`).

Returns `Promise<RunValidationResult>`. Throws `WebMiddlewareBlockedError` on BLOCK unless
`returnInsteadOfThrow: true`.

Early-exit short-circuits (no engine call):

- `body.trim().length === 0` → `{ blocked: false }`.
- `shouldValidate(body) === false` → `{ blocked: false, skipped: true }`.

TypeErrors:

- `body` not a string.
- `options.engine` missing.

### `RunValidationOptions`

| Option                 | Type                                       | Default | Description                                             |
| ---------------------- | ------------------------------------------ | ------- | ------------------------------------------------------- |
| `engine`               | `GuardrailEngine`                          | —       | Required.                                               |
| `returnInsteadOfThrow` | `boolean`                                  | `false` | Return the BLOCK result instead of throwing.            |
| `shouldValidate`       | `(body: string) => boolean`                | —       | Operator allowlist; returning `false` skips engine.     |
| `onBlock`              | `(event: WebMiddlewareBlockEvent) => void` | —       | Telemetry sink; fail-safe (errors routed to `onError`). |
| `onError`              | `(err: unknown) => void`                   | —       | Error sink for validator + `onBlock` exceptions.        |

### `RunValidationResult`

`{ blocked, reason?, category?, severity?, excerpt?, skipped? }`. The `excerpt` is the first 200
chars of the blocked body.

### `getRequestBody(req, framework)`

Framework-shape-aware raw-body extractor. Returns `Promise<string>`.

| `framework`     | Source                                                                                   | Behaviour                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `'web'`         | Web `Request` (Fetch API; Next.js Route Handlers, Hono, Vercel Edge, Cloudflare Workers) | `await req.text()`; throws TypeError if `req.text` is missing.                                                                     |
| `'elysia'`      | Elysia `Context.body` (pre-parsed)                                                       | Strings pass through; objects → `JSON.stringify` (circular-ref-safe via `safeStringify`); `URLSearchParams`/`FormData` serialised. |
| `'next-action'` | Next.js Server Action — pass the parsed object                                           | Same serialisation rules as `'elysia'`.                                                                                            |
| `'node'`        | Legacy Node `IncomingMessage`                                                            | Caller MUST have pre-buffered the body (e.g. via `bodyParser`); reads `req.body`.                                                  |

Detection is intentionally narrow — the operator passes the framework tag rather than duck-typing
the request shape (avoids false positives for proxies/mocks).

### `WebMiddlewareBlockedError`

```ts
class WebMiddlewareBlockedError extends Error {
  readonly phase: 'request' | 'response';
  readonly category?: string;
  readonly severity?: string;
}
```

### `WebMiddlewareBlockEvent`

```ts
{
  kind: 'web-middleware'; // Sprint 21 cross-package observability tag
  phase: 'request' | 'response';
  reason: string;
  category?: string;
  severity?: string;
  excerpt?: string; // first 200 chars
}
```

### Other types

`WebMiddlewarePhase`, `SupportedFramework`, `RequestLike`.

## Threat Surfaces Covered

See [`docs/user/threat-surfaces.md`](../../docs/user/threat-surfaces.md). This package routes
through:

- **`text_input`** — `runRequestValidation` (request bodies).
- **`text_output`** — `runResponseValidation` (response bodies).

Note: the engine determines the actual finding categories — these primitives only feed `body` into
`engine.validate(body)` and surface the structured result.

## Limitations

- `'node'` framework requires pre-buffered `req.body` — this package does not stream-buffer raw
  `IncomingMessage`.
- `getRequestBody` returns a `string`; binary/multipart bodies are out of scope.
- `onBlock` callbacks are fail-safe (their throws route to `onError`); validator exceptions DO
  propagate after `onError` fires.
- Block events ship `kind: 'web-middleware'` for cross-package telemetry (mirrors `BonklmBlockEvent`
  unification — Sprint 21 architect C1).
- No CHANGELOG file ships with this package — see git history.

## Related

- [`@blackunicorn/bonklm-elysia`](../elysia-plugin/),
  [`@blackunicorn/bonklm-nextjs`](../nextjs-helpers/) — connectors built on these primitives (Story
  3.9).
- [`@blackunicorn/bonklm-hono`](../hono-middleware/),
  [`@blackunicorn/bonklm-express`](../express-middleware/),
  [`@blackunicorn/bonklm-fastify`](../fastify-plugin/) — sibling per-framework middleware.
- [`@blackunicorn/bonklm`](../core/) — core engine + validators.

## License

MIT
