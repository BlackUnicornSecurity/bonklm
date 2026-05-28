# Security Headers

> **Last updated:** 2026-05-25 · **Package version:** `1.0.0-rc.3`

BonkLM does not set HTTP response headers — header policy belongs to your web framework. This guide
shows the recommended `helmet` configuration for Express / Fastify in front of the guardrails
middleware, plus how to use `XSSGuard` for content-level XSS detection when validating LLM input or
output.

Server-level headers (CSP, HSTS, X-Frame-Options, etc.) and content- level XSS detection are
complementary: headers protect the browser context; `XSSGuard` protects the LLM context (e.g.,
refusing to send a payload with a script tag through a model that will echo it back).

---

## Essential headers

### Content Security Policy (CSP)

Restricts which resources the browser may load. For pure API endpoints that never serve HTML, the
script / style directives can be locked down to `'none'`.

```typescript
import express from 'express';
import helmet from 'helmet';

const app = express();

app.use(
  '/api/ai',
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  })
);
```

### HTTP Strict Transport Security (HSTS)

Forces HTTPS for the configured `maxAge`. Set `preload: true` only after submitting your domain to
the HSTS preload list.

```typescript
app.use(
  helmet.hsts({
    maxAge: 31_536_000, // 1 year
    includeSubDomains: true,
    preload: true
  })
);
```

### X-Frame-Options (clickjacking)

```typescript
app.use(helmet.frameguard({ action: 'deny' })); // or 'sameorigin'
```

### X-Content-Type-Options

```typescript
app.use(helmet.noSniff());
```

### X-XSS-Protection (legacy)

Modern browsers ignore this and use CSP — keep it set for older clients and crawlers.

```typescript
app.use(helmet.xssFilter());
```

---

## Complete Express setup

```typescript
import express from 'express';
import helmet from 'helmet';
import { createGuardrailsMiddleware } from '@blackunicorn/bonklm-express';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const app = express();

// 1. Browser-level headers on all routes.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:']
      }
    },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    noSniff: true,
    xssFilter: true,
    frameguard: { action: 'deny' }
  })
);

// 2. Extra cache + referrer + permissions headers for sensitive routes.
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// 3. Guardrails middleware.
app.use(
  '/api/ai',
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator()],
    productionMode: process.env.NODE_ENV === 'production'
  })
);
```

---

## CORS

```typescript
import cors from 'cors';

const allowedOrigins = ['https://yourdomain.com', 'https://app.yourdomain.com'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // server-side / curl
      if (!allowedOrigins.includes(origin)) {
        return callback(new Error('CORS policy: origin not allowed'), false);
      }
      callback(null, true);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 600
  })
);
```

---

## Fastify

```typescript
import fastifyHelmet from '@fastify/helmet';

await fastify.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31_536_000,
    includeSubDomains: true,
    preload: true
  }
});
```

Register before `@blackunicorn/bonklm-fastify`.

---

## API-response headers

For JSON-only endpoints, lock down content-type sniffing and disable caching of sensitive payloads:

```typescript
app.use('/api', (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, no-cache');
  next();
});
```

`X-Requested-With: XMLHttpRequest` is a deprecated marker — modern clients use CORS preflight; you
do not need to set it on responses.

---

## Content-level XSS — `XSSGuard`

Browser headers protect the rendering surface. If your LLM is going to echo user input back into a
context that may render as HTML (chat transcript, support ticket, etc.), pair the headers with
content-level detection:

```typescript
import { XSSGuard, GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()],
  guards: [new XSSGuard()]
});

const result = await engine.validate(userInput);
if (!result.allowed) {
  // findings include the matched XSS pattern + line
}
```

`XSSGuard` (class) and `checkXSS` / `detectXSS` (function-form helpers) all ship from the root
barrel. See
[`packages/core/src/guards/xss-safety.ts`](../../../packages/core/src/guards/xss-safety.ts) for the
configuration interface.

---

## Headers checklist

- [ ] `Content-Security-Policy` configured (lock down `scriptSrc` for API routes)
- [ ] `Strict-Transport-Security` (HSTS) enabled with a 1-year `max-age`
- [ ] `X-Frame-Options: DENY` or `SAMEORIGIN`
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-XSS-Protection: 1; mode=block` (legacy clients)
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Permissions-Policy` set to deny unused powerful APIs
- [ ] `Cache-Control: no-store, no-cache` on sensitive endpoints
- [ ] CORS allowlist configured (no wildcard `*` in production)
- [ ] `XSSGuard` wired into the engine when LLM output is rendered as HTML downstream

---

## Verifying headers

```bash
# Quick check from CLI
curl -sI https://your-api.com/api/ai | grep -iE '^(content-security|strict|x-|referrer|permissions|cache)'

# Online scanner
# https://securityheaders.com/
```

Expected response (representative):

```
Content-Security-Policy: default-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

---

## See also

- [Rate limiting](./rate-limiting.md)
- [Getting started — production hardening](../../getting-started.md#production-hardening-checklist)
- [Known limitations](../known-limitations.md)
- [Threat surfaces](../threat-surfaces.md)
