# @blackunicorn/bonklm-voice-webhooks

Vapi (HTTP) + Retell (WebSocket) webhook validators for BonkLM. HMAC-SHA256 auth, sync tool-calls /
assistant-request, async transcript observe-only, Retell update_only + response_required.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-voice-webhooks
```

## Quick start — Vapi (Express)

```ts
import express from 'express';
import { createVapiHandler } from '@blackunicorn/bonklm-voice-webhooks';
import {
  GuardrailEngine,
  PromptInjectionValidator,
  CodeInjectionValidator
} from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator(), new CodeInjectionValidator()]
});

const handler = createVapiHandler({
  engine,
  hmacSecret: process.env.VAPI_HMAC_SECRET!, // ≥ 32 chars
  onBlock: event => console.warn('[vapi]', event.phase, event.reason),
  onHmacFailure: event => console.warn('[vapi]', 'hmac', event.reason)
});

const app = express();
app.post('/webhooks/vapi', express.text({ type: '*/*' }), async (req, res) => {
  const response = await handler({
    rawBody: req.body,
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)])
    )
  });
  res.status(response.status).json(response.body);
});
```

## Quick start — Retell (Express + `ws`)

```ts
import { WebSocketServer } from 'ws';
import { createRetellWsHandler } from '@blackunicorn/bonklm-voice-webhooks';
import {
  GuardrailEngine,
  PromptInjectionValidator,
  CodeInjectionValidator
} from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator(), new CodeInjectionValidator()]
});

const handler = createRetellWsHandler({
  engine,
  hmacSecret: process.env.RETELL_HMAC_SECRET!,
  onBlock: event => console.warn('[retell]', event.phase, event.reason)
});

const wss = new WebSocketServer({ port: 8080 });
wss.on('connection', (ws, req) => {
  ws.once('message', async raw => {
    // First message is the handshake.
    const ok = handler.verifyHandshake({
      rawBody: raw.toString(),
      signature: req.headers['x-retell-signature'] as string | undefined
    });
    if (!ok) {
      ws.close(4001, 'unauthorized');
      return;
    }

    ws.on('message', async raw => {
      const msg = JSON.parse(raw.toString());
      for await (const chunk of handler.handleMessage(msg)) {
        ws.send(JSON.stringify(chunk));
      }
      // After the validator chunks: connector author streams the LLM
      // response here (only fires for response_required + benign).
    });
  });
});
```

## What gets blocked

- **Vapi `tool-calls`** with code-injection sinks in `function.arguments` → HTTP 403. Vapi cancels
  the tool call.
- **Vapi `assistant-request`** — pass-through (no user-supplied content to validate). Connector
  author layers their assistant-fetch logic.
- **Vapi `transcript`** — **observe-only**. Validator findings fire `onBlock` telemetry but the
  response is HTTP 200 regardless because Vapi does NOT wait for our response.
- **Retell `update_only`** — observe-only (Retell discards our response). Telemetry fires.
- **Retell `response_required`** with injection in transcript → emits `{type:'block'}` +
  `{type:'text', content:'', end:true}` to terminate the response stream.

## Top-level warning — Vapi transcript

> **`transcript` is fire-and-forget.** Vapi does NOT wait for our response, so we cannot block on
> transcript content from this handler. To enforce on transcript, switch to Vapi's **Custom LLM**
> mode and validate at the LLM proxy layer (e.g. via `@blackunicorn/bonklm-server` +
> `wrapOpenAI`-style connector).

## What does NOT get blocked

- **Vapi transcript**: see warning above.
- **Retell `update_only`**: observe-only (same reason).
- **Cross-vendor replay**: Retell has no timestamp header — replay defence lives at the WSS
  transport layer (per-connection auth tokens rotated by Retell). Vapi uses a 5-minute
  `X-Vapi-Timestamp` window.
- **Audio bytes**: this connector handles webhook PAYLOADS only — the underlying voice stream never
  passes through.

## Security notes

- HMAC secrets **≥ 32 chars** enforced at construction.
- `crypto.timingSafeEqual` for signature comparison; both sides decoded to fixed 32-byte SHA-256
  output before compare.
- HMAC verification runs **BEFORE** `JSON.parse` (route-enumeration- oracle closure inherited from
  `bonklm-server` Story 2.13).
- HMAC failure responses carry opaque `{error:'unauthorized'}` only. Reason detail lives in
  `onHmacFailure` telemetry, not the wire response — defeats semantic-enumeration oracle.
- Validator throws are caught + routed to `config.onError`; 500 + empty body returned to avoid
  leaking validator internals.
- Throwing `onBlock` telemetry hooks do NOT skip the block decision (try/catch wrapping per Sprint
  18 audit closure pattern).
- **Vapi replay window**: one-sided — past-only `replayWindowMs` (default 5 min) + 1 min clock-skew
  tolerance for future timestamps. Previous symmetric `Math.abs` allowed pre-signed-future captures
  to remain valid for ~2× the window.
- **Retell has NO replay window**: relies on the WSS transport + per-connection auth token rotation.
  Connector authors deploying Retell handlers on non-WSS transports MUST add replay defence at the
  transport layer.
- **`verifyHandshake` is advisory**: the connector CANNOT enforce authentication if your WebSocket
  server doesn't close the connection on `verifyHandshake(...) === false`. Always check the return
  value (see Retell Quick Start example).
- **Use distinct HMAC secrets per vendor** — `VAPI_HMAC_SECRET` and `RETELL_HMAC_SECRET` MUST NOT
  share the same value. A compromised secret in one vendor's environment compromises both
  integrations.
- **Vapi tool-call `name` field is NOT validated** — only `function.arguments`. Vapi constrains tool
  names at the vendor side; if you route tool names directly to a downstream executor (subprocess,
  shell), add your own name-field check.
- **Vapi `assistant-request` requires `onAssistantRequest` hook**. Without it the handler returns
  400 — Vapi expects an assistant config object in the response body, NOT `{ok:true}`.
- **Retell multi-turn transcripts**: handler validates ONLY the latest `role:'user'` entry.
  Historical injections from prior turns do NOT re-trigger.

## License

MIT. © Black Unicorn Security.
