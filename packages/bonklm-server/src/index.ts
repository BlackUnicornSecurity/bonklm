/**
 * @blackunicorn/bonklm-server
 * ===========================
 * Fastify-based HTTP server exposing BonkLM guardrails over
 * HMAC-authenticated endpoints. Per Story 2.13 AC, the server
 * supports three host-protocol mappers:
 *
 *   - `POST /litellm` — LiteLLM custom-guardrail Python plugin format
 *   - `POST /portkey` — Portkey webhook guardrail format
 *   - `POST /openai-compatible` — generic OpenAI chat-completion
 *
 * All three routes share:
 *   - HMAC-SHA256 auth via `X-Bonklm-Signature` + `X-Bonklm-Timestamp`
 *   - 5-minute replay window (configurable via `replayWindowMs`)
 *   - Shared `GuardrailDecision` response shape (route-specific
 *     normalizers translate to host-protocol verdicts — see README)
 *
 * Performance target (AC measurable): P99 < 1.5s on the
 * `packages/core/benchmarks/` corpus on a 4-vCPU container.
 *
 * @package @blackunicorn/bonklm-server
 */
import Fastify from 'fastify';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify';
import { GuardrailEngine } from '@blackunicorn/bonklm';
import type { EngineResult } from '@blackunicorn/bonklm';
import { sanitizeReasonText } from '@blackunicorn/bonklm/core/connector-utils';
import {
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  verifyHmacSignature,
  type HmacFailureReason,
} from './hmac/index.js';
import {
  mapLiteLLM,
  mapPortkey,
  mapOpenAICompat,
  type LiteLLMHookPayload,
  type PortkeyHookPayload,
  type OpenAICompatPayload,
} from './payload-mappers/index.js';
import type { BonklmServerOptions, GuardrailDecision } from './types.js';

export type { BonklmServerOptions, GuardrailDecision } from './types.js';
export {
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  DEFAULT_REPLAY_WINDOW_MS,
  verifyHmacSignature,
  signHmac,
} from './hmac/index.js';
export type {
  HmacFailureReason,
  HmacVerifyResult,
} from './hmac/index.js';
export {
  mapLiteLLM,
  mapPortkey,
  mapOpenAICompat,
} from './payload-mappers/index.js';

/** Minimum HMAC secret length (bytes). Sec-audit fail-closed boundary. */
const MIN_HMAC_SECRET_BYTES = 32;

/**
 * HTTP status codes for HMAC failure reasons. Defaults to 401 to
 * avoid leaking which check failed; replay-window exceeded maps to
 * 408 (Request Timeout) for the rare benign clock-skew case.
 */
function hmacFailureStatus(reason: HmacFailureReason): number {
  switch (reason) {
    case 'replay_window_exceeded':
      return 408;
    default:
      return 401;
  }
}

/**
 * Build a Fastify server with the three guardrail routes wired.
 *
 * @example
 * ```ts
 * import { createBonklmGuardrailServer } from '@blackunicorn/bonklm-server';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const server = await createBonklmGuardrailServer({
 *   validators: [new PromptInjectionValidator()],
 *   port: 4123,
 *   hmacSecret: process.env.BONKLM_HMAC_SECRET!,
 * });
 *
 * await server.listen();
 * console.log('BonkLM server listening on', server.addresses());
 * ```
 */
export async function createBonklmGuardrailServer(
  options: BonklmServerOptions
): Promise<FastifyInstance> {
  // Boundary validation.
  if (
    typeof options.hmacSecret !== 'string' ||
    options.hmacSecret.length < MIN_HMAC_SECRET_BYTES
  ) {
    throw new Error(
      `createBonklmGuardrailServer: hmacSecret MUST be a string of at least ${MIN_HMAC_SECRET_BYTES} characters of entropy. ` +
        'Generate via `openssl rand -base64 32` or equivalent.'
    );
  }
  if (
    (options.validators === undefined || options.validators.length === 0) &&
    options.engine === undefined
  ) {
    throw new Error(
      'createBonklmGuardrailServer: either `validators: [...]` (non-empty) OR `engine` MUST be supplied.'
    );
  }

  const engine =
    options.engine ??
    new GuardrailEngine({
      validators: options.validators!,
    });

  // Story 2.13 audit sec S8 closure: productionMode default flipped
  // from `false` to `true`. The CLI bin path already defaults to
  // true via env var; the programmatic API is now consistent. Dev
  // consumers must explicitly set `productionMode: false`.
  const productionMode = options.productionMode ?? true;
  const replayWindowMs = options.replayWindowMs;

  // Story 2.13 audit sec S6 closure: bodyLimit default to 512KB.
  // Long conversation histories are common; the prior 1MB Fastify
  // default left a wide DoS surface (worst-case regex scan time
  // grows with body size). Consumers can override via the option.
  const bodyLimit = options.bodyLimit ?? 512 * 1024;

  // Story 2.13 audit rev R2 closure: pass the caller's logger via
  // `loggerInstance` rather than silently discarding it via
  // `logger: false`. Fastify 5 accepts a pre-built logger via
  // `loggerInstance` — we narrow to `FastifyServerOptions` so a
  // future Fastify-6 signature change fails loudly rather than
  // silently (v0.5.0 pre-publish rev v5#6 closure: replaced
  // `as never` escape hatches with `Parameters<typeof Fastify>[0]`).
  const fastifyOpts: FastifyServerOptions =
    options.logger === undefined
      ? {
          logger: {
            level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
          },
          bodyLimit,
        }
      : {
          loggerInstance: options.logger as FastifyServerOptions['loggerInstance'],
          bodyLimit,
        };
  const fastify = Fastify(fastifyOpts) as unknown as FastifyInstance;

  // Story 2.13 audit arch 2# / arch 3# / rev R1 / sec S4 closure:
  // custom JSON parser that VERIFIES HMAC BEFORE attempting JSON
  // parse. Without this, malformed-JSON requests return 400 from
  // Fastify's parser before HMAC ever runs — a route-enumeration
  // oracle for unauthenticated probers. By integrating HMAC into
  // the parser, every request gets auth-checked first regardless of
  // body validity.
  //
  // Fastify 5 strips Content-Type params (charset, boundary) before
  // dispatching to the parser, so `application/json` matches both
  // `application/json` AND `application/json; charset=utf-8` (the
  // Python httpx/requests default). The vendor-suffix variant
  // (`application/vnd.api+json`) is handled by the additional
  // regex parser below.
  type AuthError = Error & {
    statusCode: number;
    hmacReason?: string;
    isAuthError: true;
  };
  const captureRawBodyAndAuth = (
    req: FastifyRequest,
    body: unknown,
    done: (err: Error | null, parsed?: unknown) => void
  ): void => {
    if (typeof body !== 'string') {
      done(new Error('expected string body'));
      return;
    }
    (req as FastifyRequest & { rawBody: string }).rawBody = body;

    // HMAC check FIRST — fails closed on missing/invalid auth even
    // when JSON would also fail to parse. Health route doesn't enter
    // here (POST-only parser registration).
    const sig = req.headers[HMAC_SIGNATURE_HEADER];
    const ts = req.headers[HMAC_TIMESTAMP_HEADER];
    const result = verifyHmacSignature({
      rawBody: body,
      signature: Array.isArray(sig) ? sig[0] : sig,
      timestamp: Array.isArray(ts) ? ts[0] : ts,
      secret: options.hmacSecret,
      replayWindowMs,
    });
    if (!result.valid) {
      const authError = new Error('hmac_auth_failed') as AuthError;
      authError.statusCode = hmacFailureStatus(result.reason);
      authError.hmacReason = result.reason;
      authError.isAuthError = true;
      done(authError);
      return;
    }

    // Auth OK — parse JSON.
    try {
      const parsed: unknown = body.length > 0 ? JSON.parse(body) : {};
      done(null, parsed);
    } catch (err) {
      done(err as Error);
    }
  };
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    captureRawBodyAndAuth
  );
  // Vendor-suffix variants (`application/vnd.api+json`, etc.).
  fastify.addContentTypeParser(
    /^application\/.*\+json$/,
    { parseAs: 'string' },
    captureRawBodyAndAuth
  );

  // Centralized error handler: emits the right status for HMAC auth
  // failures, JSON parse errors, body-too-large, etc. Production-
  // mode strips the error message to avoid leaking internals.
  fastify.setErrorHandler((err: unknown, _req, reply) => {
    const isAuthError =
      typeof (err as { isAuthError?: unknown }).isAuthError === 'boolean' &&
      (err as { isAuthError: boolean }).isAuthError;
    const status =
      typeof (err as { statusCode?: number }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 400;
    const message =
      err instanceof Error ? err.message : 'unknown error';
    if (isAuthError) {
      reply.code(status).send({
        error: 'hmac_auth_failed',
        ...(productionMode
          ? {}
          : { reason: (err as AuthError).hmacReason }),
      });
      return;
    }
    reply.code(status).send({
      error: 'bad_request',
      ...(productionMode ? {} : { message }),
    });
  });

  // Health endpoint — NO HMAC check (intentional for k8s probes).
  fastify.get('/healthz', async () => ({ status: 'ok' }));

  // The 3 guardrail routes (HMAC pre-validation runs at the global
  // hook above; route handlers only execute on valid HMAC).
  fastify.post(
    '/litellm',
    async (req: FastifyRequest, _reply: FastifyReply): Promise<GuardrailDecision> => {
      const payload = req.body as LiteLLMHookPayload;
      const mapped = mapLiteLLM(payload);
      const result = await engine.validate(mapped.content);
      return makeDecision('litellm', result, req.id, productionMode);
    }
  );

  fastify.post(
    '/portkey',
    async (req: FastifyRequest, _reply: FastifyReply): Promise<GuardrailDecision> => {
      const payload = req.body as PortkeyHookPayload;
      const mapped = mapPortkey(payload);
      const result = await engine.validate(mapped.content);
      return makeDecision('portkey', result, req.id, productionMode);
    }
  );

  fastify.post(
    '/openai-compatible',
    async (req: FastifyRequest, _reply: FastifyReply): Promise<GuardrailDecision> => {
      const payload = req.body as OpenAICompatPayload;
      const mapped = mapOpenAICompat(payload);
      const result = await engine.validate(mapped.content);
      return makeDecision('openai-compatible', result, req.id, productionMode);
    }
  );

  // Bind server to host/port. The actual `listen` call is deferred
  // to the consumer; consumers can `await server.listen({ port })`
  // or pass port-0 via options for dynamic assignment.
  return fastify;
}

/**
 * Translate an engine result into the shared `GuardrailDecision`
 * response shape. Sanitization + production-mode handling baked in.
 *
 * v0.5.0 pre-publish audit sec v5#9 closure: attacker-controlled
 * validator output (`engineResult.reason`, `finding.description`) is
 * now sanitized via `sanitizeReasonText` BEFORE crossing the HTTP
 * boundary, regardless of `productionMode`. The `productionMode`
 * gate controls whether reason/findings are EXPOSED at all; the
 * sanitization always runs when they are.
 */
function makeDecision(
  surface: 'litellm' | 'portkey' | 'openai-compatible',
  engineResult: EngineResult,
  requestId: string,
  productionMode: boolean
): GuardrailDecision {
  const blocked = engineResult.blocked;
  return {
    allowed: !blocked,
    blocked,
    reason: blocked
      ? productionMode
        ? 'guardrail decision'
        : (sanitizeReasonText(engineResult.reason) ?? 'guardrail decision')
      : undefined,
    surface,
    findings:
      productionMode || !engineResult.findings
        ? undefined
        : engineResult.findings.map((f) => ({
            category: f.category,
            severity: String(f.severity),
            description: sanitizeReasonText(f.description) ?? '',
          })),
    requestId,
  };
}
