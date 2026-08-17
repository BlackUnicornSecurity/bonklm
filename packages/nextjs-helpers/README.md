# @blackunicorn/bonklm-nextjs

BonkLM Next.js helpers — `withBonklm(action)`, `bonklmRouteHandler`, `bonklmEdgeMiddleware` (Story
3.9).

## Installation

```bash
pnpm add @blackunicorn/bonklm-nextjs @blackunicorn/bonklm @blackunicorn/bonklm-web-middleware-utils
```

## Peer dependencies

| Peer                                        | Version       | Optional                |
| ------------------------------------------- | ------------- | ----------------------- |
| `@blackunicorn/bonklm`                      | `workspace:*` | no                      |
| `@blackunicorn/bonklm-web-middleware-utils` | `workspace:*` | no                      |
| `next`                                      | `^16.0.0`     | yes (structural typing) |

The `next` peer is optional because the helpers use structural typing on `Request` / `Response` and
on the Server Action signature — you do not need to install Next.js to build, only at runtime.

## Runtime support

Exports map ships `workerd`, `edge-light`, and `import` conditions, all resolving to the same
edge-safe bundle:

- Node `>=20.0.0` (declared `engines` field)
- Next.js Edge Runtime (edge-light) — for `middleware.ts` and `export const runtime = 'edge'` route
  handlers
- Next.js Node Runtime — for default Server Actions and Route Handlers
- Cloudflare Workers (workerd) deployments via OpenNext / Cloudflare Pages — `nodejs_compat` flag
  required (see
  [edge-string-handlers.md](../../docs/user/migration/edge-string-handlers.md#cloudflare-workers-required-setup))

## Quick start

### Server Action

```ts
'use server';
import { withBonklm } from '@blackunicorn/bonklm-nextjs';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });

export const submitMessage = withBonklm(
  async (formData: FormData) => {
    const msg = formData.get('msg') as string;
    return { ok: true };
  },
  { engine }
);
```

### Route Handler

```ts
// app/api/chat/route.ts
import { bonklmRouteHandler } from '@blackunicorn/bonklm-nextjs';

export const { POST } = bonklmRouteHandler(
  {
    POST: async req => {
      const { msg } = await req.json();
      return Response.json({ echo: msg });
    }
  },
  { engine }
);
```

### Edge Middleware

```ts
// middleware.ts
import { NextResponse } from 'next/server';
import { bonklmEdgeMiddleware } from '@blackunicorn/bonklm-nextjs';

export const middleware = bonklmEdgeMiddleware({
  engine,
  nextResponse: () => NextResponse.next()
});
export const config = { matcher: ['/api/:path*'] };
```

## API reference

| Export                                                                            | Signature                                                                                                      | Purpose                                                                          |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `withBonklm(action, options)`                                                     | `<Args, Result>(action: ServerAction<Args, Result>, options: WithBonklmOptions) => ServerAction<Args, Result>` | Server Action wrapper. Validates serialized args before invoking the action.     |
| `bonklmRouteHandler(handlers, options)`                                           | `(handlers: RouteHandlerMethods, options: BonklmRouteHandlerOptions) => RouteHandlerMethods`                   | Route Handler wrapper. Validates request bodies for POST / PUT / PATCH / DELETE. |
| `bonklmEdgeMiddleware(options)`                                                   | `(options: BonklmEdgeMiddlewareOptions) => (req: Request) => Promise<Response>`                                | `middleware.ts` factory. Validates body-bearing requests pre-route.              |
| `ServerAction` / `RouteHandlerMethods`                                            | types                                                                                                          | Function shapes.                                                                 |
| `WithBonklmOptions` / `BonklmRouteHandlerOptions` / `BonklmEdgeMiddlewareOptions` | interfaces                                                                                                     | Per-helper configuration.                                                        |

### Common options

All three helpers accept:

| Option            | Type                                       | Default                                | Description                                                                                         |
| ----------------- | ------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `engine`          | `GuardrailEngine`                          | required                               | Throws `TypeError` if omitted.                                                                      |
| `onBlock`         | `(event: WebMiddlewareBlockEvent) => void` | -                                      | Telemetry callback.                                                                                 |
| `onError`         | `(err: unknown) => void`                   | -                                      | Error sink for validator exceptions.                                                                |
| `blockedResponse` | `(event) => Response`                      | 403 JSON `{ error, reason, category }` | Customise the BLOCK response (Route Handler + Edge Middleware only — Server Actions throw instead). |

`withBonklm` additionally accepts `shouldValidate(serializedArgs)`. `bonklmEdgeMiddleware`
additionally accepts `shouldValidate(req)` and `nextResponse: () => Response` (REQUIRED on Next.js
14+ for correct pass-through; defaults to a synthetic `200` with `x-bonklm-passthrough: 1` header
for Next.js 13.x).

## Behaviour

- `withBonklm` serializes args via `JSON.stringify` (FormData becomes a plain object first). On
  BLOCK throws `WebMiddlewareBlockedError` — Next.js surfaces it via the Server Actions error
  boundary.
- `bonklmRouteHandler` clones the request before reading, so user handlers can still call
  `req.text()` / `req.json()`. Skips GET / HEAD / OPTIONS.
- `bonklmEdgeMiddleware` validates body-bearing methods only (POST / PUT / PATCH / DELETE), skips
  empty bodies, and returns the `nextResponse()` factory output for pass-through.

## Threat surfaces covered

`text_input` only — all three helpers validate caller-supplied content before route logic runs. See
[threat-surfaces.md](../../docs/user/threat-surfaces.md) for the full taxonomy.

## Edge-runtime caveats

- For Workerd deployments (OpenNext / Cloudflare Pages), see the
  [Workerd setup fragment](../../docs/user/migration/edge-string-handlers.md#cloudflare-workers-required-setup).
  Pin `compatibility_date = "2024-09-23"` and enable `nodejs_compat`.
- Edge hook handlers must be functions (not strings); use `EdgeHookManager` from
  `@blackunicorn/bonklm/edge`.
- On Next.js 14+, you MUST pass `nextResponse: () => NextResponse.next()` to `bonklmEdgeMiddleware`
  — `undefined` no longer reliably passes through.

## Limitations

- Validates REQUEST bodies / Server Action args only. Response validation is not provided.
- Server Action blocks throw rather than returning a typed result — wrap with `try/catch` in client
  components or rely on Next.js error boundaries.
- The Route Handler wrapper does NOT scope validation by `bodyFields` (unlike
  `@blackunicorn/bonklm-hono`); the entire body text is validated.

## Related

- [`@blackunicorn/bonklm`](../core/README.md) — core engine and validators.
- [`@blackunicorn/bonklm-web-middleware-utils`](../web-middleware-utils/README.md) — shared
  `runRequestValidation` primitives.
- [`@blackunicorn/bonklm-hono`](../hono-middleware/README.md),
  [`@blackunicorn/bonklm-elysia`](../elysia-plugin/README.md) — sibling edge connectors.

## Security: rate limiting

These helpers do **not** include rate limiting. Per the BonkLM rate-limiting policy, ingress rate
limiting belongs at the edge (Vercel Edge / Cloudflare Workers when deployed there) or in a
Node-runtime limiter ahead of the guardrails — see
[`docs/user/security/rate-limiting.md`](../../docs/user/security/rate-limiting.md) for the
multi-instance / edge-runtime rationale.

For Vercel-deployed Next.js, `@upstash/ratelimit` (Redis-backed via Vercel KV or Upstash) is the
standard distributed choice. Wire it **before** the guardrails wrapper in a Route Handler or Server
Action:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { withGuardrails } from '@blackunicorn/bonklm-nextjs';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, '15 m')
});

export const POST = withGuardrails(
  async (req: NextRequest) => {
    const ip = req.headers.get('x-forwarded-for') ?? 'anon';
    const { success } = await ratelimit.limit(ip);
    if (!success) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    // Your handler — the guardrails wrapper runs validators before this is invoked.
    return NextResponse.json({ ok: true });
  },
  { validators: [new PromptInjectionValidator()] }
);
```

For Node-runtime Next.js (`runtime: 'nodejs'`), `rate-limiter-flexible` is the standard in-process
choice (still subject to the multi-instance caveats in the policy doc). To suppress the
`bonklm doctor` rate-limiter advisory after acknowledging the policy, add to your project's
`package.json`:

```json
{ "bonklm": { "rateLimit": "documented" } }
```

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn
