# @blackunicorn/bonklm-hono

Hono middleware for BonkLM — edge-runtime-native LLM security guardrails.

## Installation

```bash
pnpm add @blackunicorn/bonklm-hono @blackunicorn/bonklm
```

## Peer dependencies

| Peer   | Version   | Optional |
| ------ | --------- | -------- |
| `hono` | `^4.12.0` | no       |

`@blackunicorn/bonklm` is a direct dependency (workspace `*`). Pre-1.0 the Hono peer range is
intentionally tight to `4.12.x`; v5 ABI changes will require a range bump.

## Runtime support

The exports map ships `workerd`, `edge-light`, `deno`, `bun`, and `import` conditions all resolving
to the same edge-safe bundle. Internally the connector imports from `@blackunicorn/bonklm/edge`, so
it runs on:

- Node `>=20.4.0` (declared `engines` field)
- Cloudflare Workers (workerd) — `nodejs_compat` flag required (see
  [edge-string-handlers.md](../../docs/user/migration/edge-string-handlers.md#cloudflare-workers-required-setup))
- Vercel Edge Functions (edge-light)
- Deno Deploy
- Bun

## Quick start

```ts
import { Hono } from 'hono';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm/edge';
import { honoGuardrails } from '@blackunicorn/bonklm-hono';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()]
});

const app = new Hono();
app.use('*', honoGuardrails(engine));
app.post('/chat', async c => {
  const body = await c.req.json();
  return c.json({ ok: true });
});
```

## API reference

| Export                                                   | Signature                                                                             | Purpose                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `honoGuardrails(engine, options?)`                       | `(engine: GuardrailEngine, options?: HonoGuardrailsOptions) => HonoMiddlewareHandler` | Build the per-request Hono middleware.                        |
| `extractBody(req, bodyFields?)`                          | `(req: Request, bodyFields?: string[]) => Promise<ExtractedBody>`                     | Body-extraction helper (re-exported for custom integrations). |
| `ConnectorValidationError`                               | class                                                                                 | Re-export from `@blackunicorn/bonklm/core/connector-utils`.   |
| `HonoContextLike` / `HonoNext` / `HonoMiddlewareHandler` | types                                                                                 | Duck-typed Hono shapes.                                       |
| `HonoGuardrailsOptions`                                  | interface                                                                             | Middleware configuration.                                     |
| `HonoGuardrailsErrorResponse`                            | interface                                                                             | JSON shape returned on block.                                 |
| `ExtractedBody`                                          | interface                                                                             | Result of `extractBody`.                                      |

### `HonoGuardrailsOptions`

| Option            | Type                         | Default                                                          | Description                                                                                                                            |
| ----------------- | ---------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `logger`          | `Logger`                     | `createLogger('console')`                                        | Custom logger.                                                                                                                         |
| `validators`      | `Validator[]`                | engine's validators                                              | Per-middleware override of the engine's validator chain.                                                                               |
| `bodyFields`      | `string[]`                   | unset (validate full body)                                       | Restrict body validation to specific JSON fields. Emits a construction-time warning — fields not in the list pass through unvalidated. |
| `validateMethods` | `ReadonlyArray<string>`      | `['POST', 'PUT', 'PATCH']`                                       | HTTP methods that trigger body validation.                                                                                             |
| `productionMode`  | `boolean`                    | `process.env.NODE_ENV === 'production'` on Node; `false` on edge | Flip error responses to generic strings.                                                                                               |
| `onBlocked`       | `(reason, category) => void` | -                                                                | Telemetry callback fired before the block response.                                                                                    |

## Threat surfaces covered

`text_input` only — the middleware validates the incoming request body before it reaches the route
handler. See [threat-surfaces.md](../../docs/user/threat-surfaces.md) for the full taxonomy.

Body parsing handles `application/json`, `application/x-www-form-urlencoded`, and `text/plain`. JSON
walks every string leaf and concatenates for validation (or only the `bodyFields` subset when set).

## Edge-runtime caveats

- Engine construction is the caller's responsibility. On Workerd, call
  `assertAsyncLocalStorageHealthy()` from `@blackunicorn/bonklm/edge` before constructing the engine
  — see the
  [edge-string-handlers migration guide](../../docs/user/migration/edge-string-handlers.md#cloudflare-workers-required-setup)
  for the required `wrangler.toml` fragment.
- Edge hook handlers must be functions (not strings); use `EdgeHookManager` from the edge subpath.
- Body extraction enforces a 1 MB cap and rejects any `content-type` charset outside `utf-8` /
  `ascii` / `iso-8859-1` with a `415 Unsupported Media Type` response (defeats UTF-16/UTF-32
  mojibake bypass).

## Limitations

- Phase-1 ships REQUEST-body validation only. Response/stream validation (`c.streamSSE` /
  `c.stream`) is the consumer's responsibility — wire `BufferedReleaseGate` from
  `@blackunicorn/bonklm/edge` into your stream writer.
- A `validatedStream` helper is tracked as a v1.0.1 backlog item; no separate roadmap doc ships in
  v1.0.0. Wire incremental validation manually via
  `engine.validate(chunk, { surface: 'text_output' })` inside your stream consumer until the helper
  lands.
- Engine errors surface as HTTP 500 `engine_error`; validation blocks surface as HTTP 400
  `validation_failed`.

## Related

- [`@blackunicorn/bonklm`](../core/README.md) — core engine and validators.
- [`@blackunicorn/bonklm-express`](../express-middleware/README.md),
  [`@blackunicorn/bonklm-fastify`](../fastify-plugin/README.md) — sibling Node-first middleware.
- [`@blackunicorn/bonklm-elysia`](../elysia-plugin/README.md),
  [`@blackunicorn/bonklm-nextjs`](../nextjs-helpers/README.md),
  [`@blackunicorn/bonklm-cloudflare-agents`](../cloudflare-agents-connector/README.md) — sibling
  edge connectors.

## Security: rate limiting

This middleware does **not** include rate limiting. Per the BonkLM rate-limiting policy, ingress
rate limiting belongs at the edge layer (Cloudflare Workers, Vercel, Bun edge, Deno Deploy) where it
can shed load before reaching the validator pipeline. See
[`docs/user/security/rate-limiting.md`](../../docs/user/security/rate-limiting.md) for the
deployment-shape rationale.

For edge deployments, prefer a distributed limiter like
[`@upstash/ratelimit`](https://github.com/upstash/ratelimit-js) (Redis-backed, works in Workers /
edge isolates) wired **before** the guardrails middleware:

```typescript
import { Hono } from 'hono';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { honoGuardrails } from '@blackunicorn/bonklm-hono';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, '15 m')
});

const app = new Hono();

app.use('*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'anon';
  const { success } = await ratelimit.limit(ip);
  if (!success) return c.text('Too many requests', 429);
  await next();
});

app.use('*', honoGuardrails({ validators: [new PromptInjectionValidator()] }));
```

For Node-runtime deployments behind Hono, `hono-rate-limiter` is the standard in-process choice
(still subject to the multi-instance caveats in the policy doc). To suppress the `bonklm doctor`
rate-limiter advisory after acknowledging the policy, add to your project's `package.json`:

```json
{ "bonklm": { "rateLimit": "documented" } }
```

## License

MIT (c) Black Unicorn
