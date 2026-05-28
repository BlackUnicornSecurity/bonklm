/**
 * `@blackunicorn/bonklm-voice-webhooks` — Vapi (HTTP) + Retell (WebSocket)
 * webhook validators for BonkLM.
 *
 * Two distinct integration shapes:
 *
 *   - `createVapiHandler({engine, hmacSecret})` returns an async
 *     `(req) => response` handler. Wire into Express / Fastify /
 *     Next.js Route Handler / Hono / Vercel Edge.
 *   - `createRetellWsHandler({engine, hmacSecret})` returns
 *     `{verifyHandshake, handleMessage}`. Wire into your WebSocket
 *     server.
 *
 * Both use HMAC-SHA256 (`crypto.timingSafeEqual`). 32-byte minimum
 * secret. Vapi adds a 5-minute replay window via `X-Vapi-Timestamp`;
 * Retell relies on WSS + per-connection auth tokens for replay
 * defence.
 *
 * **Transcript caveat (Vapi)**: the `transcript` event is fire-and-
 * forget — Vapi does NOT wait for our response. Validator findings
 * are LOGGED but cannot block the in-flight LLM call. To block on
 * transcript content, switch to Vapi's "Custom LLM" mode and validate
 * at the LLM proxy layer.
 */
export { createVapiHandler } from './vapi/index.js';
export { createRetellWsHandler, type RetellHandshakeRequest, type RetellOutboundChunk } from './retell/index.js';
export {
  verifyVapiHmac,
  verifyRetellHmac,
  MIN_SECRET_LENGTH,
  DEFAULT_VAPI_REPLAY_WINDOW_MS,
  type VapiHmacOptions,
  type RetellHmacOptions,
  type HmacVerifyResult,
  type HmacFailureReason
} from './hmac.js';
export type {
  VapiHandlerConfig,
  RetellHandlerConfig,
  VoiceWebhookBlockEvent,
  VoiceWebhookHmacFailureEvent,
  VoiceWebhookPhase,
  WebhookRequest,
  WebhookResponse
} from './types.js';
