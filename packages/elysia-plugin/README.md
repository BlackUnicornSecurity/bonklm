# @blackunicorn/bonklm-elysia

BonkLM Elysia plugin — `bonklmGuardrails(opts)` middleware (Story 3.9).

## Installation

```bash
pnpm add @blackunicorn/bonklm-elysia @blackunicorn/bonklm @blackunicorn/bonklm-web-middleware-utils
```

## Peer dependencies

| Peer                                        | Version       | Optional                |
| ------------------------------------------- | ------------- | ----------------------- |
| `@blackunicorn/bonklm`                      | `workspace:*` | no                      |
| `@blackunicorn/bonklm-web-middleware-utils` | `workspace:*` | no                      |
| `elysia`                                    | `^1.4.0`      | yes (structural typing) |

The `elysia` peer is optional because the plugin uses structural typing on the
`(app) => app.onBeforeHandle(...)` shape — you do not need to install Elysia to build this package,
only to consume it at runtime.

## Runtime support

Exports map ships `workerd`, `edge-light`, and `import` conditions, all resolving to the same
edge-safe bundle:

- Node `>=20.0.0` (declared `engines` field)
- Bun (Elysia's native target)
- Cloudflare Workers (workerd) — `nodejs_compat` flag required (see
  [edge-string-handlers.md](../../docs/user/migration/edge-string-handlers.md#cloudflare-workers-required-setup))
- Vercel Edge Functions (edge-light)

## Quick start

```ts
import { Elysia } from 'elysia';
import { bonklmGuardrails } from '@blackunicorn/bonklm-elysia';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()]
});

new Elysia()
  .use(bonklmGuardrails({ engine }))
  .post('/chat', ({ body }) => `you said: ${body}`)
  .listen(3000);
```

## API reference

| Export                      | Signature                                        | Purpose                                                                        |
| --------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `bonklmGuardrails(options)` | `(options: BonklmElysiaOptions) => (app) => app` | Elysia plugin factory. Intercepts `beforeHandle` to validate the request body. |
| `BonklmElysiaOptions`       | interface                                        | Plugin configuration.                                                          |

### `BonklmElysiaOptions`

| Option            | Type                                       | Default                                          | Description                                                                             |
| ----------------- | ------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `engine`          | `GuardrailEngine`                          | required                                         | Engine that runs validation. Throws `TypeError` if omitted.                             |
| `shouldValidate`  | `(body: string, ctx) => boolean`           | always validate                                  | Operator allowlist — return `false` to skip a request.                                  |
| `onBlock`         | `(event: WebMiddlewareBlockEvent) => void` | -                                                | Fires on BLOCK before the 403 response is sent.                                         |
| `onError`         | `(err: unknown) => void`                   | -                                                | Error sink for validator exceptions.                                                    |
| `blockedResponse` | `(event) => unknown`                       | `{ error: 'request_blocked', reason, category }` | Customise the BLOCK response payload (status is still set to 403 via `ctx.set.status`). |

## Behaviour

- Skips validation when `ctx.body` is `null` / `undefined` (e.g. GET / HEAD).
- Stringifies non-string bodies via `JSON.stringify` before passing to the validator chain.
- On BLOCK: sets `ctx.set.status = 403` and returns the (custom or default) JSON payload.
- Validator exceptions that are NOT `WebMiddlewareBlockedError` re-throw — Elysia surfaces them via
  its own error handler.

## Threat surfaces covered

`text_input` only — the plugin validates the deserialized request body before the route handler
runs. See [threat-surfaces.md](../../docs/user/threat-surfaces.md) for the full taxonomy.

## Edge-runtime caveats

- Engine construction is the caller's responsibility. On Workerd, call
  `assertAsyncLocalStorageHealthy()` from `@blackunicorn/bonklm/edge` before constructing the engine
  and pin `compatibility_date = "2024-09-23"` + `compatibility_flags = ["nodejs_compat"]` in
  `wrangler.toml`.
- Edge hook handlers must be functions (not strings); see
  [`edge-string-handlers.md`](../../docs/user/migration/edge-string-handlers.md).
- Body stringification uses native `JSON.stringify` — circular refs surface as
  `[unstringifiable:object]` and pass through.

## Limitations

- Validates REQUEST bodies only. Response/stream validation is not provided.
- The plugin relies on Elysia's `onBeforeHandle` lifecycle; if your app overrides this hook,
  ordering matters — register `bonklmGuardrails` first.
- `shouldValidate` receives the already-stringified body — predicate cost scales with payload size.

## Related

- [`@blackunicorn/bonklm`](../core/README.md) — core engine and validators.
- [`@blackunicorn/bonklm-web-middleware-utils`](../web-middleware-utils/README.md) — shared
  `runRequestValidation` / `WebMiddlewareBlockedError` primitives.
- [`@blackunicorn/bonklm-hono`](../hono-middleware/README.md),
  [`@blackunicorn/bonklm-nextjs`](../nextjs-helpers/README.md) — sibling edge connectors.

## Security: rate limiting

This plugin does **not** include rate limiting. Per the BonkLM rate-limiting policy, ingress rate
limiting belongs at the edge / load-balancer layer (or inside a Bun runtime via `elysia-rate-limit`)
ahead of the guardrails — see
[`docs/user/security/rate-limiting.md`](../../docs/user/security/rate-limiting.md) for the
multi-instance / edge-runtime rationale.

Wire `elysia-rate-limit` (or a distributed alternative for production) **before** registering
`bonklmGuardrails`:

```typescript
import { Elysia } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';
import { bonklmGuardrails } from '@blackunicorn/bonklm-elysia';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

new Elysia()
  .use(rateLimit({ max: 100, duration: 15 * 60 * 1000 })) // limiter FIRST
  .use(bonklmGuardrails({ validators: [new PromptInjectionValidator()] }))
  .listen(3000);
```

To suppress the `bonklm doctor` rate-limiter advisory after acknowledging the policy, add to your
project's `package.json`:

```json
{ "bonklm": { "rateLimit": "documented" } }
```

## License

MIT (c) Black Unicorn
