# Rate Limiting

> **Last updated:** 2026-08-14 · **Package version:** `1.0.14`

BonkLM does not ship a built-in rate limiter — that responsibility belongs to the framework or edge
in front of your guardrails. This document walks through the recommended integrations and the
limiter-shaped primitive that DOES live inside the engine (`HookManager.rateLimit`, which throttles
hook execution, NOT request ingress).

## Why rate limiting matters before guardrails

Without an upstream limiter, an attacker can:

- Brute-force prompts looking for patterns that bypass detection.
- Submit complex inputs that exhaust validator CPU (defended by `validationTimeout` +
  `patternTimeout`, but a flood still wastes budget).
- Try to drain override-token guesses.
- Burn streaming buffer until the engine's circuit breaker trips (`circuitBreakerThreshold`, default
  3 violations).

Put the rate limiter ahead of `createGuardrailsMiddleware` so blocked requests never reach the
validator pipeline.

## Why we do not wire a default rate limiter

BonkLM exports `RateLimiter` + `CommonRateLimiters` from `@blackunicorn/bonklm` as an ergonomic
opt-in primitive, but the framework connectors deliberately do NOT instantiate one by default. Three
reasons:

1. **In-process state is fictional in production.** The bundled `RateLimiter` is an in-memory
   `Map<string, RateLimitEntry>` — it would give a per-pod limit in a multi-instance deployment,
   which is strictly worse than no limiter because it creates a false sense of protection. Edge
   runtimes (Workerd, Vercel Edge, Deno Deploy) instantiate per request — the state evaporates
   between calls, so even a "default-on" limiter would functionally be disabled at the edge.
2. **Ingress rate limiting belongs at the edge / load-balancer / API-gateway layer.** Cloudflare,
   ALB, Vercel, fly.io, etc. shed load BEFORE it hits Node — the only place this can scale to the
   multi-tenant reality. BonkLM running its own limiter inside the request pipeline still pays the
   TCP-accept + body-parse cost on every blocked request.
3. **Distributed-state limiters** (Redis-backed `@upstash/ratelimit`, `rate-limiter-flexible` with a
   Redis store, Cloudflare KV) are the right shape for production. The `bonklm doctor` check
   surfaces a WARN when a framework connector is installed without a known limiter dependency —
   nudging consumers toward a real solution rather than a per-pod in-memory limit.

To suppress the doctor advisory after acknowledging the policy, declare in your `package.json`:

```json
{
  "bonklm": { "rateLimit": "documented" }
}
```

Accepted values: `"documented"` (you read this doc), `"external"` (your limiter runs at the edge/LB,
not in your Node code), or `"in-process"` (you explicitly want the bundled `RateLimiter` despite the
multi-instance caveats).

---

## Express — `express-rate-limit`

```typescript
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createGuardrailsMiddleware } from '@blackunicorn/bonklm-express';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const app = express();
app.use(express.json());

const guardrailsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // per IP per window
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false
});

// Limiter BEFORE guardrails
app.use('/api/ai', guardrailsLimiter);

app.use(
  '/api/ai',
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator()]
  })
);
```

### Sliding window + Redis (distributed)

```typescript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

const slidingWindowLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true, // count only blocked requests
  store: new RedisStore({
    // express-rate-limit v7 RedisStore API; for v6 see the package README.
    sendCommand: (...args: string[]) => redisClient.sendCommand(args),
    prefix: 'bonklm:rate:'
  })
});

app.use('/api/ai', slidingWindowLimiter);
```

### Per-user (authenticated) limits

```typescript
const userLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  keyGenerator: req => (req as { user?: { id: string } }).user?.id ?? req.ip
});
```

---

## Fastify — `@fastify/rate-limit`

```typescript
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

export default fp(async fastify => {
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    cache: 10_000,
    allowList: ['127.0.0.1'],
    redis: fastify.redis // optional — distributed limiting
  });
});
```

Register the rate-limit plugin BEFORE `@blackunicorn/bonklm-fastify`.

---

## Edge runtimes (Workerd / Vercel Edge / Deno)

Use the platform's native primitive — Workers KV `cache` API, Vercel Edge rate limiting, Deno
`KvWatcher` — and short-circuit before the edge variant of the engine is invoked. The
`EdgeHookManager` does NOT provide ingress rate limiting; it only enforces per-hook rate limits (see
below). For Cloudflare Agents deployments, place rate limiting in front of the Durable Object entry
point before `withBonklmAgent(...)` invokes the engine.

---

## Recommended limits

| Use case                   | Requests | Window     |
| -------------------------- | -------- | ---------- |
| Development                | 1000     | 15 minutes |
| Production (authenticated) | 100      | 15 minutes |
| Production (anonymous)     | 20       | 15 minutes |
| API-key based              | 1000     | 1 hour     |

Tune to your real traffic. Pair with progressive backoff for repeated violations.

---

## Hook-level rate limiting (inside the engine)

`HookManager` exposes a per-phase rate limiter that throttles hook EXECUTION — not request ingress.
Use it when a hook is expensive to run and you want to bound its invocation rate inside a
long-running process.

```typescript
import { HookManager, HookPhase } from '@blackunicorn/bonklm';

const hooks = new HookManager({
  rateLimit: {
    maxCalls: 100, // up to 100 executions
    windowMs: 60_000, // per 60-second sliding window
    perPhase: true // separate limit per HookPhase
  }
});

hooks.registerHook({
  name: 'expensive-check',
  phase: HookPhase.BEFORE_VALIDATION,
  surface: 'text_input',
  priority: 10,
  enabled: true,
  handler: async ctx => {
    // ... expensive work
    return { success: true, shouldBlock: false };
  }
});

const results = await hooks.executeHooks(HookPhase.BEFORE_VALIDATION, {
  phase: HookPhase.BEFORE_VALIDATION,
  surface: 'text_input',
  content: input
});
```

When the limit is exceeded, `executeHooks` returns a sentinel result
`{ success: false, shouldBlock: false, message: 'Rate limit exceeded for phase: <phase>' }`. Hooks
that were not run still appear absent from the results array.

> This is independent of your ingress limiter. Always keep an ingress limiter in front of guardrails
> — `HookManager.rateLimit` is only a safety belt for the hook subsystem itself.

---

## Monitoring rate-limit violations

Log violations to feed your detection pipeline. Sanitize attacker- controlled fields (URL, user
agent) before they reach a log sink (per CWE-117 sanitization, the BonkLM internals route
attacker-influenced strings through `sanitizeLogString` / `sanitizeMeta`; do the same in your own
ingress logger).

```typescript
import { sanitizeMeta } from '@blackunicorn/bonklm';

const monitoredLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  handler: (req, res) => {
    console.warn('[SECURITY] Rate limit exceeded', {
      ip: req.ip,
      path: sanitizeMeta(req.path),
      userAgent: sanitizeMeta(req.get('user-agent')),
      timestamp: new Date().toISOString()
    });
    res.status(429).json({ error: 'Too many requests' });
  }
});
```

For telemetry, route the event through `TelemetryService` (or your existing OTLP pipeline).
Rate-limit events are NOT one of the typed `TelemetryEventType` values today; ship them under your
own custom event type or via `CallbackTelemetryCollector`.

---

## Checklist

- [ ] Limiter installed BEFORE the guardrails middleware on every LLM-facing route.
- [ ] Separate limits for authenticated vs anonymous users.
- [ ] Distributed store (Redis / KV) when running more than one instance.
- [ ] Progressive backoff for repeated violations.
- [ ] Violation logs reach your SIEM with attacker-controlled fields sanitized.
- [ ] Engine `validationTimeout` + `patternTimeout` set explicitly so individual requests cannot
      starve the worker pool.
- [ ] Engine `maxBufferSize` + `circuitBreakerThreshold` tuned for your streaming budget — the
      breaker is the last-line defence when the limiter is exhausted.

---

## See also

- [Security headers](./security-headers.md)
- [Getting started — production hardening](../../getting-started.md#production-hardening-checklist)
- [Known limitations](../known-limitations.md)
