/**
 * tsd type-surface suite — @blackunicorn/bonklm-server (ST-04-250).
 *
 * Imports by package name so it resolves the package `types` entry
 * exactly as a consumer would, and proves every signature rejects
 * misuse. Covers:
 *   - `createBonklmGuardrailServer` (the sole factory — returns a
 *     `Promise<FastifyInstance>`; `hmacSecret` is the one required
 *     option in the bag),
 *   - the HMAC primitives (`verifyHmacSignature` / `signHmac`) + the
 *     two header-name literals + the widened `DEFAULT_REPLAY_WINDOW_MS`,
 *   - the `HmacVerifyResult` discriminated union (locked on `valid`) +
 *     the 6-member `HmacFailureReason` union + the `HmacVerifyOptions`
 *     bag (nameable ONLY via the `./hmac` subpath),
 *   - the three payload mappers — their input payload types are NOT
 *     re-exported (no `./payload-mappers` subpath), so they are
 *     exercised via object literals and the shared `MappedGuardInput`
 *     return shape is locked structurally,
 *   - the `BonklmServerOptions` bag + the `GuardrailDecision` response
 *     shape.
 *
 * Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { FastifyInstance } from 'fastify';
import type { GuardrailEngine, Logger, Validator } from '@blackunicorn/bonklm';
import {
  createBonklmGuardrailServer,
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  DEFAULT_REPLAY_WINDOW_MS,
  verifyHmacSignature,
  signHmac,
  mapLiteLLM,
  mapPortkey,
  mapOpenAICompat,
  type BonklmServerOptions,
  type GuardrailDecision,
  type HmacFailureReason,
  type HmacVerifyResult
} from '@blackunicorn/bonklm-server';
import type { HmacVerifyOptions } from '@blackunicorn/bonklm-server/hmac';

declare const engine: GuardrailEngine;
declare const logger: Logger;
declare const validator: Validator;

// --- createBonklmGuardrailServer (hmacSecret required) ----------------------
expectType<Promise<FastifyInstance>>(createBonklmGuardrailServer({ hmacSecret: 's' }));
expectType<Promise<FastifyInstance>>(
  createBonklmGuardrailServer({
    validators: [validator],
    engine,
    port: 0,
    host: '0.0.0.0',
    hmacSecret: 's',
    replayWindowMs: 300000,
    productionMode: true,
    bodyLimit: 524288,
    logger
  })
);
expectError(createBonklmGuardrailServer({})); // hmacSecret required
expectError(createBonklmGuardrailServer()); // options required

// --- BonklmServerOptions bag ------------------------------------------------
expectAssignable<BonklmServerOptions>({ hmacSecret: 's' });
expectAssignable<BonklmServerOptions>({ hmacSecret: 's', validators: [validator] });
expectAssignable<BonklmServerOptions>({ hmacSecret: 's', engine });
expectNotAssignable<BonklmServerOptions>({}); // hmacSecret required
expectNotAssignable<BonklmServerOptions>({ hmacSecret: 123 }); // hmacSecret is string
expectNotAssignable<BonklmServerOptions>({ hmacSecret: 's', productionMode: 'yes' }); // boolean field
expectNotAssignable<BonklmServerOptions>({ hmacSecret: 's', port: '0' }); // number field

// --- HMAC verify + sign -----------------------------------------------------
expectType<HmacVerifyResult>(verifyHmacSignature({ rawBody: 'b', signature: 's', timestamp: 't', secret: 'k' }));
expectType<HmacVerifyResult>(
  verifyHmacSignature({
    rawBody: 'b',
    signature: undefined,
    timestamp: undefined,
    secret: 'k',
    replayWindowMs: 1000,
    nowMs: () => 0
  })
);
expectError(verifyHmacSignature({ rawBody: 'b', secret: 'k' })); // signature + timestamp keys required
expectError(verifyHmacSignature()); // options required

expectType<string>(signHmac('b', 't', 'k'));
expectType<string>(signHmac('b', 123, 'k')); // timestamp accepts number
expectError(signHmac('b', 't')); // secret required
expectError(signHmac('b', true, 'k')); // timestamp not boolean

// --- HmacVerifyOptions bag (subpath-only) -----------------------------------
expectAssignable<HmacVerifyOptions>({ rawBody: 'b', signature: 's', timestamp: 't', secret: 'k' });
expectAssignable<HmacVerifyOptions>({
  rawBody: 'b',
  signature: undefined,
  timestamp: undefined,
  secret: 'k',
  replayWindowMs: 1,
  nowMs: () => 0
});
expectNotAssignable<HmacVerifyOptions>({ rawBody: 'b', secret: 'k' }); // signature + timestamp keys required
expectNotAssignable<HmacVerifyOptions>({ signature: 's', timestamp: 't', secret: 'k' }); // rawBody required

// --- HmacVerifyResult union + HmacFailureReason -----------------------------
expectAssignable<HmacVerifyResult>({ valid: true });
expectAssignable<HmacVerifyResult>({ valid: false, reason: 'signature_mismatch' });
expectNotAssignable<HmacVerifyResult>({ valid: false }); // reason required when invalid
expectNotAssignable<HmacVerifyResult>({ valid: 'maybe' }); // valid is a boolean literal

expectAssignable<HmacFailureReason>('missing_signature');
expectAssignable<HmacFailureReason>('missing_timestamp');
expectAssignable<HmacFailureReason>('malformed_timestamp');
expectAssignable<HmacFailureReason>('malformed_signature');
expectAssignable<HmacFailureReason>('replay_window_exceeded');
expectAssignable<HmacFailureReason>('signature_mismatch');
expectNotAssignable<HmacFailureReason>('expired'); // not a member
expectNotAssignable<HmacFailureReason>('missing_secret'); // not a member

// --- constants: header-name literals vs widened replay window ---------------
expectType<'x-bonklm-signature'>(HMAC_SIGNATURE_HEADER);
expectType<'x-bonklm-timestamp'>(HMAC_TIMESTAMP_HEADER);
expectType<number>(DEFAULT_REPLAY_WINDOW_MS);

// --- payload mappers + shared MappedGuardInput return shape -----------------
// Payload input types + MappedGuardInput are NOT re-exported (no
// `./payload-mappers` subpath) — exercise via object literals and lock
// the return shape structurally.
type ExpectedMappedGuardInput = {
  content: string;
  metadata: {
    source: 'litellm' | 'portkey' | 'openai-compatible';
    model?: string;
    messageCount: number;
  };
};

expectType<ExpectedMappedGuardInput>(mapLiteLLM({}));
expectType<ExpectedMappedGuardInput>(
  mapLiteLLM({ data: { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4' }, call_type: 'completion' })
);
expectType<ExpectedMappedGuardInput>(mapLiteLLM({ request_data: { messages: [{ content: 'x' }] } }));
expectError(mapLiteLLM()); // payload required
expectError(mapLiteLLM({ call_type: 123 })); // call_type is string
expectError(mapLiteLLM({ data: { model: 5 } })); // model is string

expectType<ExpectedMappedGuardInput>(mapPortkey({}));
expectType<ExpectedMappedGuardInput>(
  mapPortkey({ request: { json: { messages: [{ content: 'x' }], model: 'm', prompt: 'p' }, text: 't' } })
);
expectType<ExpectedMappedGuardInput>(mapPortkey({ messages: [{ content: 'x' }], model: 'm' }));
expectError(mapPortkey()); // payload required
expectError(mapPortkey({ model: 9 })); // model is string

expectType<ExpectedMappedGuardInput>(mapOpenAICompat({}));
expectType<ExpectedMappedGuardInput>(mapOpenAICompat({ messages: [{ role: 'system', content: 'x' }], model: 'm' }));
expectType<ExpectedMappedGuardInput>(mapOpenAICompat({ prompt: 'legacy completion' }));
expectError(mapOpenAICompat()); // payload required
expectError(mapOpenAICompat({ prompt: 42 })); // prompt is string

// --- GuardrailDecision response shape ---------------------------------------
expectAssignable<GuardrailDecision>({ allowed: true, blocked: false, surface: 'litellm', requestId: 'r' });
expectAssignable<GuardrailDecision>({
  allowed: false,
  blocked: true,
  surface: 'portkey',
  requestId: 'r',
  reason: 'blocked',
  findings: [{ category: 'c', severity: 'BLOCKED', description: 'd' }, {}]
});
expectNotAssignable<GuardrailDecision>({ allowed: true, blocked: false, surface: 'x' }); // requestId required
expectNotAssignable<GuardrailDecision>({ allowed: true, blocked: false, requestId: 'r' }); // surface required
expectNotAssignable<GuardrailDecision>({ blocked: false, surface: 'x', requestId: 'r' }); // allowed required
