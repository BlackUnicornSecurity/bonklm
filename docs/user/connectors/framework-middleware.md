# Framework Middleware Connectors

Last updated: 2026-05-25

This guide covers BonkLM connectors that plug into HTTP frameworks (Express / Fastify / NestJS /
Hono / Elysia / Next.js) and durable-execution frameworks (Restate / Temporal / Trigger.dev /
Inngest) as middleware or plugins.

For voice + realtime webhooks see
[LLM Provider Connectors → Voice webhooks](./llm-providers.md#voice-webhooks).

## Available Connectors

### Web frameworks

| Connector | Package                        | Peer                               | Status |
| --------- | ------------------------------ | ---------------------------------- | ------ |
| Express   | `@blackunicorn/bonklm-express` | `express ^4.18.0 / ^5.0.0`         | STABLE |
| Fastify   | `@blackunicorn/bonklm-fastify` | `fastify ^4.0.0 / ^5.0.0`          | STABLE |
| NestJS    | `@blackunicorn/bonklm-nestjs`  | `@nestjs/common ^10.0.0 / ^11.0.0` | STABLE |
| Hono      | `@blackunicorn/bonklm-hono`    | `hono ^4.12.0`                     | STABLE |
| Elysia    | `@blackunicorn/bonklm-elysia`  | `elysia ^1.4.0` (optional)         | STABLE |
| Next.js   | `@blackunicorn/bonklm-nextjs`  | `next ^16.0.0` (optional)          | STABLE |

### Durable-execution frameworks

| Connector   | Package                         | Peer                              | Status |
| ----------- | ------------------------------- | --------------------------------- | ------ |
| Restate     | `@blackunicorn/bonklm-restate`  | `@restatedev/restate-sdk ^1.14.0` | STABLE |
| Temporal    | `@blackunicorn/bonklm-temporal` | `@temporalio/worker ^1.16.0`      | STABLE |
| Trigger.dev | `@blackunicorn/bonklm-trigger`  | `@trigger.dev/sdk ^4.0.0`         | STABLE |
| Inngest     | `@blackunicorn/bonklm-inngest`  | `inngest ^4.4.0`                  | STABLE |

All packages are published at `1.0.0-rc.3` against project version `0.5.0`. Edge bundles require
Workerd `nodejs_compat`.

---

## Express Middleware

### Installation

```bash
npm install @blackunicorn/bonklm-express @blackunicorn/bonklm
```

### Basic Usage

```typescript
import express from 'express';
import { createGuardrailsMiddleware } from '@blackunicorn/bonklm-express';
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';

const app = express();
app.use(express.json());

app.use(
  '/api/ai',
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator(), new JailbreakValidator()],
    validateRequest: true,
    validateResponse: false
  })
);

app.post('/api/ai/chat', async (req, res) => {
  const { message } = req.body;
  const response = await callLLM(message);
  res.json({ response });
});

app.listen(3000);
```

### Configuration Options

| Option              | Type          | Default                     | Description                   |
| ------------------- | ------------- | --------------------------- | ----------------------------- |
| `validators`        | `Validator[]` | `[]`                        | Validators to run on requests |
| `guards`            | `Guard[]`     | `[]`                        | Guards to run with context    |
| `validateRequest`   | `boolean`     | `true`                      | Validate incoming requests    |
| `validateResponse`  | `boolean`     | `false`                     | Validate outgoing responses   |
| `paths`             | `string[]`    | `[]`                        | Only process these paths      |
| `excludePaths`      | `string[]`    | `[]`                        | Exclude these paths           |
| `productionMode`    | `boolean`     | `NODE_ENV === 'production'` | Generic errors in production  |
| `validationTimeout` | `number`      | `5000`                      | Timeout in milliseconds       |
| `maxContentLength`  | `number`      | `1048576`                   | Max content length (1MB)      |
| `bodyExtractor`     | `Function`    | Auto-extract                | Custom body extractor         |
| `onError`           | `Function`    | Default                     | Custom error handler          |

### Custom Error Handling

```typescript
app.use(
  '/api/ai',
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator()],
    onError: (result, req, res) => {
      res.status(400).json({
        error: 'Content blocked by safety guardrails',
        risk_level: result.risk_level
      });
    }
  })
);
```

---

## Fastify Plugin

### Installation

```bash
npm install @blackunicorn/bonklm-fastify @blackunicorn/bonklm
```

### Basic Usage

```typescript
import Fastify from 'fastify';
import guardrailsPlugin from '@blackunicorn/bonklm-fastify';
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';

const fastify = Fastify();

await fastify.register(guardrailsPlugin, {
  validators: [new PromptInjectionValidator(), new JailbreakValidator()],
  paths: ['/api/ai', '/api/chat'],
  excludePaths: ['/api/health']
});

fastify.post('/api/ai/chat', async (request, reply) => {
  const { message } = request.body as { message: string };
  return { response: await callLLM(message) };
});

await fastify.listen({ port: 3000 });
```

### Configuration Options

| Option              | Type          | Default                     | Description                   |
| ------------------- | ------------- | --------------------------- | ----------------------------- |
| `validators`        | `Validator[]` | `[]`                        | Validators to run on requests |
| `guards`            | `Guard[]`     | `[]`                        | Guards to run with context    |
| `validateRequest`   | `boolean`     | `true`                      | Validate incoming requests    |
| `validateResponse`  | `boolean`     | `false`                     | Validate outgoing responses   |
| `paths`             | `string[]`    | `[]`                        | Only validate these paths     |
| `excludePaths`      | `string[]`    | `[]`                        | Exclude these paths           |
| `productionMode`    | `boolean`     | `NODE_ENV === 'production'` | Generic errors in production  |
| `validationTimeout` | `number`      | `5000`                      | Timeout in milliseconds       |
| `maxContentLength`  | `number`      | `1048576`                   | Max content length (1MB)      |
| `responseExtractor` | `Function`    | Auto-extract                | Custom response extractor     |
| `onError`           | `Function`    | Default                     | Custom error handler          |

---

## NestJS Module

### Installation

```bash
npm install @blackunicorn/bonklm-nestjs @blackunicorn/bonklm
```

### Module Setup

```typescript
import { Module } from '@nestjs/common';
import { GuardrailsModule } from '@blackunicorn/bonklm-nestjs';
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';

@Module({
  imports: [
    GuardrailsModule.forRoot({
      validators: [new PromptInjectionValidator(), new JailbreakValidator()],
      global: true,
      productionMode: process.env.NODE_ENV === 'production'
    })
  ]
})
export class AppModule {}
```

### Controller Usage

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { UseGuardrails } from '@blackunicorn/bonklm-nestjs';

@Controller('api')
export class AppController {
  @Post('chat')
  @UseGuardrails()
  async chat(@Body() body: { message: string }) {
    return { response: await callLLM(body.message) };
  }

  @Post('generate')
  @UseGuardrails({
    bodyField: 'prompt',
    validateOutput: true,
    responseField: 'text'
  })
  async generate(@Body() body: { prompt: string }) {
    return { text: await generateText(body.prompt) };
  }
}
```

Sprint 49 closed the NestJS session-category parity gap with the rest of the core sweep —
`session-category` is propagated through `GuardrailsExecutionContext` so per-session telemetry
remains consistent across hooks. The public surface (`GuardrailsModule`, `GuardrailsService`,
`@UseGuardrails`, `GuardrailsInterceptor`) is unchanged.

### `GuardrailsService` (Programmatic)

```typescript
import { Injectable } from '@nestjs/common';
import { GuardrailsService } from '@blackunicorn/bonklm-nestjs';

@Injectable()
export class MyService {
  constructor(private guardrails: GuardrailsService) {}

  async processInput(input: string) {
    const result = await this.guardrails.validate(input);
    if (!result.allowed) {
      throw new Error('Input blocked');
    }
    return await this.processSafeInput(input);
  }
}
```

### Decorator Options

| Option             | Type       | Default        | Description                |
| ------------------ | ---------- | -------------- | -------------------------- |
| `validateInput`    | `boolean`  | `true`         | Validate request body      |
| `validateOutput`   | `boolean`  | `false`        | Validate response body     |
| `bodyField`        | `string`   | Auto-detect    | Request field to validate  |
| `responseField`    | `string`   | Auto-detect    | Response field to validate |
| `maxContentLength` | `number`   | Module default | Per-endpoint size limit    |
| `onError`          | `Function` | Module default | Custom error handler       |

---

## Hono Middleware (edge-native)

`honoGuardrails(engine, options?)` is the canonical-shape `MiddlewareHandler` factory.
Edge-runtime-native — the connector imports exclusively from `@blackunicorn/bonklm/edge`.

### Installation

```bash
npm install @blackunicorn/bonklm-hono @blackunicorn/bonklm
```

### Runtime Support

- Node `>=20.4.0` (declared `engines` field)
- Cloudflare Workers (workerd) — `nodejs_compat` flag required
- Vercel Edge Functions (edge-light)
- Deno Deploy
- Bun

Pre-1.0 the Hono peer range is intentionally tight to `4.12.x`; v5 ABI changes will require a range
bump.

### Basic Usage

```typescript
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

The `extractBody(req, bodyFields?)` helper is also exported for callers building custom
integrations.

---

## Elysia Plugin

`bonklmGuardrails(opts)` intercepts `beforeHandle` to run the request validator on the incoming
body. On BLOCK it returns a 403 JSON response (overridable via `onBlock`).

### Installation

```bash
npm install @blackunicorn/bonklm-elysia @blackunicorn/bonklm \
  @blackunicorn/bonklm-web-middleware-utils
```

The `elysia` peer is optional — the plugin uses structural typing on the
`(app) => app.onBeforeHandle(...)` shape.

### Runtime Support

- Node `>=20.0.0`
- Bun (Elysia's native target)
- Cloudflare Workers (workerd) — `nodejs_compat` required
- Vercel Edge Functions (edge-light)

### Basic Usage

```typescript
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

---

## Next.js Helpers

Three surfaces for Next.js `^16.0.0`:

- `withBonklm(action, opts)` — Server Action wrapper.
- `bonklmRouteHandler({ GET, POST, ... }, opts)` — Route Handler wrapper.
- `bonklmEdgeMiddleware(opts)` — `middleware.ts` factory.

All three feed the body through `web-middleware-utils.runRequestValidation`. BLOCK returns a 403
`Response` (overridable via `blockedResponse`).

### Installation

```bash
npm install @blackunicorn/bonklm-nextjs @blackunicorn/bonklm \
  @blackunicorn/bonklm-web-middleware-utils
```

The `next` peer is optional — the helpers use structural typing on `Request` / `Response` and on the
Server Action signature.

### Runtime Support

- Node `>=20.0.0`
- Next.js Edge Runtime (edge-light) — for `middleware.ts` and `runtime = 'edge'` route handlers
- Next.js Node Runtime — for default Server Actions and Route Handlers
- Cloudflare Workers (workerd) via OpenNext / Cloudflare Pages — `nodejs_compat` required

### Server Action

```typescript
'use server';
import { withBonklm } from '@blackunicorn/bonklm-nextjs';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });

export const submitChat = withBonklm(
  async (message: string) => {
    return await callLLM(message);
  },
  { engine }
);
```

### Route Handler

```typescript
import { bonklmRouteHandler } from '@blackunicorn/bonklm-nextjs';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });

export const { POST } = bonklmRouteHandler(
  {
    POST: async req => {
      const body = await req.json();
      return Response.json({ ok: true });
    }
  },
  { engine }
);
```

### Edge Middleware

```typescript
// middleware.ts
import { bonklmEdgeMiddleware } from '@blackunicorn/bonklm-nextjs';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm/edge';

const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });

export default bonklmEdgeMiddleware({ engine });
export const config = { matcher: '/api/:path*' };
```

---

## Restate Middleware

`withRestateGuardrails(handler, opts)` wraps a Restate handler so the input is validated BEFORE the
handler runs. Validator decisions route through `cachedValidate` keyed on the input + journaled via
`ctx.run('bonklm:validation', ...)` so retries / replays return the SAME decision deterministically.

### Installation

```bash
npm install @blackunicorn/bonklm-restate @blackunicorn/bonklm @restatedev/restate-sdk
```

### Basic Usage

```typescript
import { service } from '@restatedev/restate-sdk';
import { withRestateGuardrails } from '@blackunicorn/bonklm-restate';
import { PromptInjectionValidator, CodeInjectionValidator } from '@blackunicorn/bonklm';

const myService = service({
  name: 'myService',
  handlers: {
    chat: withRestateGuardrails(
      async (ctx, input: string) => {
        return `Echo: ${input}`;
      },
      {
        validators: [new PromptInjectionValidator(), new CodeInjectionValidator()],
        onBlock: event => {
          console.warn(`[bonklm-restate] BLOCKED: ${event.reason}`);
        }
      }
    )
  }
});
```

Catch a block via `RestateGuardrailBlockedError`.

---

## Temporal Middleware

**Validators run as ACTIVITIES** per Temporal's non-determinism rule. Workflows are replay-safe —
they only call the activity and throw on BLOCK via `guardrailGate`.

### Installation

```bash
npm install @blackunicorn/bonklm-temporal @blackunicorn/bonklm @temporalio/worker @temporalio/workflow
```

### Activity Registration

```typescript
// activities/guardrails.ts
import { createValidateInputActivity } from '@blackunicorn/bonklm-temporal';
import { PromptInjectionValidator, CodeInjectionValidator } from '@blackunicorn/bonklm';

export const validateInput = createValidateInputActivity({
  validators: [new PromptInjectionValidator(), new CodeInjectionValidator()]
});
```

### Worker Setup

```typescript
import { Worker } from '@temporalio/worker';
import * as activities from './activities/guardrails.js';

const worker = await Worker.create({
  taskQueue: 'my-queue',
  activities,
  workflowsPath: require.resolve('./workflows')
});
await worker.run();
```

### Inside a Workflow

```typescript
import { proxyActivities } from '@temporalio/workflow';
import { guardrailGate, TemporalGuardrailBlockedError } from '@blackunicorn/bonklm-temporal';

const { validateInput } = proxyActivities<typeof activitiesType>({
  startToCloseTimeout: '10 seconds'
});

export async function chatWorkflow(input: string) {
  const result = await validateInput({ input });
  guardrailGate(result); // on BLOCK: fails the workflow terminally (see below)
  return `Echo: ${input}`;
}
```

On a BLOCK decision, `guardrailGate` throws a terminal, non-retryable `ApplicationFailure`
(`type: 'TemporalGuardrailBlockedError'`) so the workflow fails deterministically rather than
retrying the workflow task. A client awaiting the workflow gets a `WorkflowFailedError` whose
`.cause` is that `ApplicationFailure`; the guardrail diagnostics (`validatorName`, `category`,
`severity`, `reason`) ride in `details[0]`, and the public `TemporalGuardrailBlockedError` class is
attached as the failure `cause` for direct in-process callers. Note: `reason` may include a fragment
of the offending input, so treat it as untrusted when logging it or surfacing it to end users.

---

## Trigger.dev Middleware

CRIU-safe handle stored in Trigger.dev's `locals` registry. Retry-survival via `cachedValidate`
keyed by `ctx.run.id` so retries of the SAME run share a cache namespace (no cross-run cache
poisoning).

### Installation

```bash
npm install @blackunicorn/bonklm-trigger @blackunicorn/bonklm @trigger.dev/sdk
```

### Basic Usage

```typescript
import { task, AbortTaskRunError } from '@trigger.dev/sdk/v3';
import { withBonkLM, getBonklmHandle } from '@blackunicorn/bonklm-trigger';
import { PromptInjectionValidator, SecretGuard } from '@blackunicorn/bonklm';

const { middleware, onFailure } = withBonkLM({
  validators: [new PromptInjectionValidator(), new SecretGuard()]
  // cache: redisCache, // optional — enables retry-survival via cachedValidate
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
      throw new AbortTaskRunError('input blocked');
    }
    return await callLLM(payload.prompt);
  }
});
```

The raw `bonklmHandleLocalsKey` is intentionally NOT re-exported — granting consumers raw
`locals.set(...)` access to the handle slot is an attractive footgun (locals-slot squatting).
`getBonklmHandle()` validates the handle's structural shape AND optionally its run-id tag before
returning it.

---

## Inngest Middleware

Injects `ctx.bonklm.validateInput / validateOutput / validateToolArgs` into every function-run
context. Each helper wraps the validator pipeline in `step.run('bonklm-validate-*', ...)` so
Inngest's in-run replay machinery + the core `cachedValidate` cross-run dedupe combine to return
cached BLOCK / ALLOW decisions on retry / replay without re-firing validators.

### Installation

```bash
npm install @blackunicorn/bonklm-inngest @blackunicorn/bonklm inngest
```

### Basic Usage

```typescript
import { Inngest } from 'inngest';
import { bonklmInngestMiddleware } from '@blackunicorn/bonklm-inngest';
import { PromptInjectionValidator, SecretGuard, GuardrailEngine } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator(), new SecretGuard()]
});

const inngest = new Inngest({
  id: 'my-app',
  middleware: [bonklmInngestMiddleware({ engine })]
});

inngest.createFunction(
  { id: 'process-chat' },
  { event: 'chat/sent' },
  async ({ event, step, ctx }) => {
    const validation = await ctx.bonklm.validateInput(event.data.prompt);
    if (validation.blocked) {
      return { blocked: true, reason: validation.reason };
    }
    const response = await step.run('call-llm', () => callLLM(event.data.prompt));
    await ctx.bonklm.validateOutput(response);
    return { response };
  }
);
```

`createBonklmInngestContextSurface(step, options)` is exported as a direct surface constructor for
test harnesses and custom-middleware composition that does not go through Inngest v4's plugin API.

---

## Common Security Features

All framework-middleware connectors share the BonkLM core defences:

- **SEC-001** — Path traversal protection via `path.normalize()`.
- **SEC-007** — Production mode toggle for generic error messages.
- **SEC-008** — Validation timeout via `AbortController`.
- **SEC-010** — Request size limits to prevent DoS.

Durable-execution connectors additionally route validators through `cachedValidate` so retries /
replays return the same BLOCK / ALLOW decision deterministically. Without caching, network-dependent
validators (LLM-backed, time-thresholded) could produce inconsistent decisions on retry and break
durable-execution guarantees.

## Choosing a Web Framework Connector

| If you...                                            | Use                                  |
| ---------------------------------------------------- | ------------------------------------ |
| Run Node + Express in production                     | `bonklm-express`                     |
| Run Node + Fastify                                   | `bonklm-fastify`                     |
| Run NestJS                                           | `bonklm-nestjs` (decorator + module) |
| Target Cloudflare Workers / Vercel Edge / Deno / Bun | `bonklm-hono`                        |
| Run Bun + Elysia                                     | `bonklm-elysia`                      |
| Build a Next.js app (App Router)                     | `bonklm-nextjs`                      |

## Choosing a Durable-Execution Connector

| If you...                           | Use               |
| ----------------------------------- | ----------------- |
| Run Restate handlers                | `bonklm-restate`  |
| Run Temporal workflows + activities | `bonklm-temporal` |
| Run Trigger.dev v3 / v4 tasks       | `bonklm-trigger`  |
| Run Inngest v4 functions            | `bonklm-inngest`  |

## Next Steps

- [AI SDK Connectors](./ai-sdks.md) — OpenAI, Anthropic, Vercel AI SDK, Google GenAI, Mistral, MCP,
  Ollama, HuggingFace, Letta, Mem0, Zep, LiveKit, OpenAI Agents.
- [LLM Provider Connectors](./llm-providers.md) — provider helpers, voice webhooks, inference
  providers.
- [Emerging Framework Connectors](./emerging-frameworks.md) — Mastra, Genkit, CopilotKit, ElizaOS,
  Stagehand, Eko, VoltAgent, Cloudflare Agents.
- [RAG & Vector Store Connectors](./rag-vector-stores.md) — LlamaIndex, LangChain, Pinecone,
  ChromaDB, Weaviate, Qdrant, LanceDB, Turbopuffer.
