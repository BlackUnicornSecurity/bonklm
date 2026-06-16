# @blackunicorn/bonklm-fastify

Fastify plugin for LLM security guardrails. Protect your Fastify applications from prompt injection,
jailbreaks, and other LLM security threats.

## Features

- **Request Validation**: Validate incoming requests before they reach your handlers
- **Response Validation**: Optionally validate outgoing responses (buffer mode)
- **Path Filtering**: Apply guardrails only to specific endpoints
- **Security Fixes**: All security issues from SME review addressed
  - SEC-001: Path traversal protection via normalization
  - SEC-007: Production mode for safe error messages
  - SEC-008: Validation timeout with AbortController
  - SEC-010: Request size limits
  - DEV-001: Correct GuardrailEngine API
  - DEV-002: Proper Logger integration
  - DEV-003: Async/await on all validations
  - DEV-006: bodyExtractor normalization

## Installation

```bash
npm install @blackunicorn/bonklm-fastify
npm install @blackunicorn/bonklm
```

## Quick Start

```typescript
import Fastify from 'fastify';
import guardrailsPlugin from '@blackunicorn/bonklm-fastify';
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';

const fastify = Fastify();

await fastify.register(guardrailsPlugin, {
  validators: [new PromptInjectionValidator(), new JailbreakValidator()],
  paths: ['/api/ai', '/api/chat']
});

fastify.post('/api/ai/chat', async (request, reply) => {
  // Content is pre-validated
  const { message } = request.body as { message: string };
  return { response: await callLLM(message) };
});

await fastify.listen({ port: 3000 });
```

## Configuration

### GuardrailsPluginOptions

| Option              | Type                | Default                                 | Description                             |
| ------------------- | ------------------- | --------------------------------------- | --------------------------------------- |
| `validators`        | `Validator[]`       | `[]`                                    | Validators to run on requests           |
| `guards`            | `Guard[]`           | `[]`                                    | Guards to run with context              |
| `validateRequest`   | `boolean`           | `true`                                  | Validate incoming requests              |
| `validateResponse`  | `boolean`           | `false`                                 | Validate outgoing responses             |
| `paths`             | `string[]`          | `[]`                                    | Only validate these paths (empty = all) |
| `excludePaths`      | `string[]`          | `[]`                                    | Exclude these paths from validation     |
| `logger`            | `Logger`            | `console`                               | Custom logger instance                  |
| `productionMode`    | `boolean`           | `process.env.NODE_ENV === 'production'` | Generic errors in production            |
| `validationTimeout` | `number`            | `5000`                                  | Validation timeout in ms                |
| `maxContentLength`  | `number`            | `1048576`                               | Max request body size (1MB)             |
| `onError`           | `ErrorHandler`      | Default handler                         | Custom error handler                    |
| `responseExtractor` | `ResponseExtractor` | Default extractor                       | Custom response extractor               |

## Security Features

### Path Traversal Protection (SEC-001)

The plugin normalizes all paths before matching, preventing path traversal attacks:

```typescript
// Blocks attempts like /api/ai/../chat
paths: ['/api/chat'];
```

### Content Size Limits (SEC-010)

Prevent DoS attacks by limiting request size:

```typescript
{
  maxContentLength: 1024 * 1024; // 1MB
}
```

### Validation Timeout (SEC-008)

Prevent hanging requests with timeout enforcement:

```typescript
{
  validationTimeout: 5000; // 5 seconds
}
```

### Production Mode (SEC-007)

Hide sensitive information in production:

```typescript
{
  productionMode: true; // Generic error messages
}
```

## Security: rate limiting

This plugin does **not** include rate limiting. Per the BonkLM rate-limiting policy, ingress rate
limiting belongs at the edge / load-balancer layer or in a Fastify-native limiter ahead of the
guardrails — see [`docs/user/security/rate-limiting.md`](../../docs/user/security/rate-limiting.md)
for the multi-instance / edge-runtime rationale.

Wire `@fastify/rate-limit` (or a distributed alternative like `@upstash/ratelimit` or
`rate-limiter-flexible` with a Redis store) **before** registering `bonklmPlugin`:

```typescript
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import bonklmPlugin from '@blackunicorn/bonklm-fastify';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const server = Fastify();

await server.register(rateLimit, {
  max: 100,
  timeWindow: '15 minutes'
});

await server.register(bonklmPlugin, {
  validators: [new PromptInjectionValidator()]
});
```

To suppress the `bonklm doctor` rate-limiter advisory after acknowledging the policy, add to your
project's `package.json`:

```json
{ "bonklm": { "rateLimit": "documented" } }
```

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn

---

**BlackUnicorn** •
[github.com/BlackUnicornSecurity/bonklm](https://github.com/BlackUnicornSecurity/bonklm)
