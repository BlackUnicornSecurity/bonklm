/**
 * tsd type-surface suite — @blackunicorn/bonklm-voice-webhooks (ST-04-240).
 *
 * Locks the published public type surface across ALL THREE entry points —
 * the main barrel plus the `./vapi` and `./retell` subpath exports — so a
 * regression in any `exports` map entry fails this suite. Imports by package
 * name (+ subpath) so it resolves the `types` entries exactly as a consumer
 * would. Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
// Main barrel.
import {
  createVapiHandler,
  createRetellWsHandler,
  verifyVapiHmac,
  verifyRetellHmac,
  MIN_SECRET_LENGTH,
  DEFAULT_VAPI_REPLAY_WINDOW_MS,
  type VapiHmacOptions,
  type RetellHmacOptions,
  type HmacVerifyResult,
  type HmacFailureReason,
  type VapiHandlerConfig,
  type RetellHandlerConfig,
  type VoiceWebhookBlockEvent,
  type VoiceWebhookHmacFailureEvent,
  type VoiceWebhookPhase,
  type WebhookRequest,
  type WebhookResponse,
  type RetellHandshakeRequest,
  type RetellOutboundChunk
} from '@blackunicorn/bonklm-voice-webhooks';
// Subpath exports — prove the `./vapi` + `./retell` `exports` entries resolve by name.
import { createVapiHandler as createVapiHandlerSub } from '@blackunicorn/bonklm-voice-webhooks/vapi';
import {
  createRetellWsHandler as createRetellWsHandlerSub,
  type RetellHandshakeRequest as RetellHandshakeRequestSub,
  type RetellOutboundChunk as RetellOutboundChunkSub
} from '@blackunicorn/bonklm-voice-webhooks/retell';

declare const engine: GuardrailEngine;
const SECRET = 'x'.repeat(32); // type is `string`; the 32-char min is a runtime check

// --- createVapiHandler (main + ./vapi subpath identical) --------------------
expectType<(req: WebhookRequest) => Promise<WebhookResponse>>(createVapiHandler({ engine, hmacSecret: SECRET }));
expectType<(req: WebhookRequest) => Promise<WebhookResponse>>(createVapiHandlerSub({ engine, hmacSecret: SECRET }));
expectError(createVapiHandler({ engine })); // hmacSecret required
expectError(createVapiHandler({})); // engine + hmacSecret required

// --- createRetellWsHandler (main + ./retell subpath identical) --------------
const retell = createRetellWsHandler({ engine, hmacSecret: SECRET });
expectType<(req: RetellHandshakeRequest) => boolean>(retell.verifyHandshake);
expectType<AsyncGenerator<RetellOutboundChunk, void, unknown>>(retell.handleMessage({}));
const retellSub = createRetellWsHandlerSub({ engine, hmacSecret: SECRET });
expectType<(req: RetellHandshakeRequestSub) => boolean>(retellSub.verifyHandshake);
expectType<AsyncGenerator<RetellOutboundChunkSub, void, unknown>>(retellSub.handleMessage({}));
expectError(createRetellWsHandler({ engine })); // hmacSecret required

// --- HMAC primitives + constants --------------------------------------------
expectType<HmacVerifyResult>(verifyVapiHmac({ rawBody: 'b', signature: 'sha256=ab', timestamp: '1', secret: SECRET }));
expectType<HmacVerifyResult>(verifyRetellHmac({ rawBody: 'b', signature: 'ab', secret: SECRET }));
expectError(verifyVapiHmac({ rawBody: 'b', secret: SECRET })); // signature + timestamp keys required
expectError(verifyRetellHmac({ rawBody: 'b' })); // signature + secret keys required
expectType<32>(MIN_SECRET_LENGTH);
expectType<number>(DEFAULT_VAPI_REPLAY_WINDOW_MS); // `5 * 60 * 1000` widens to number

// --- exported type shapes ---------------------------------------------------
expectAssignable<HmacVerifyResult>({ valid: true });
expectAssignable<HmacVerifyResult>({ valid: false, reason: 'signature_mismatch' });
expectNotAssignable<HmacVerifyResult>({ valid: false }); // reason required on the invalid arm
expectNotAssignable<HmacVerifyResult>({ valid: false, reason: 'nope' }); // not an HmacFailureReason

expectAssignable<HmacFailureReason>('replay_window_exceeded');
expectAssignable<HmacFailureReason>('secret_too_short');
expectNotAssignable<HmacFailureReason>('whatever');

expectAssignable<VapiHmacOptions>({ rawBody: 'b', signature: undefined, timestamp: undefined, secret: 's' });
expectAssignable<RetellHmacOptions>({ rawBody: 'b', signature: 'x', secret: 's' });

expectAssignable<VoiceWebhookPhase>('vapi_tool_call');
expectAssignable<VoiceWebhookPhase>('retell_response_required');
expectNotAssignable<VoiceWebhookPhase>('twilio_call');

expectAssignable<VoiceWebhookBlockEvent>({ phase: 'vapi_transcript', reason: 'r' });
expectAssignable<VoiceWebhookHmacFailureEvent>({ vendor: 'vapi', reason: 'r' });
expectNotAssignable<VoiceWebhookHmacFailureEvent>({ vendor: 'twilio', reason: 'r' }); // vendor union

expectAssignable<VapiHandlerConfig>({ engine, hmacSecret: 's' });
expectAssignable<VapiHandlerConfig>({
  engine,
  hmacSecret: 's',
  replayWindowMs: 1000,
  onBlock: event => void event,
  onHmacFailure: event => void event,
  onError: err => void err,
  onAssistantRequest: async () => ({})
});
expectAssignable<RetellHandlerConfig>({ engine, hmacSecret: 's' });

expectAssignable<WebhookResponse>({ status: 200, body: { ok: true } });
expectNotAssignable<WebhookResponse>({ status: 201, body: {} }); // status is a fixed numeric union
expectAssignable<WebhookRequest>({ rawBody: 'b', headers: {} });

// --- subpath-exported types (RetellHandshakeRequest / RetellOutboundChunk) ---
expectAssignable<RetellHandshakeRequest>({ rawBody: 'b', signature: 'x' });
expectAssignable<RetellHandshakeRequest>({ rawBody: 'b', signature: undefined });
expectAssignable<RetellOutboundChunk>({ type: 'text', content: 'x' });
expectAssignable<RetellOutboundChunk>({ type: 'text', content: 'x', end: true });
expectAssignable<RetellOutboundChunk>({ type: 'block', reason: 'r' });
expectNotAssignable<RetellOutboundChunk>({ type: 'audio', content: 'x' });
