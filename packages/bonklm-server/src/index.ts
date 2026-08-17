// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonklm-server
 * ===========================
 * Fastify-based HTTP server exposing BonkLM guardrails over
 * authenticated endpoints. The server supports three host-protocol mappers:
 *
 *   - `POST /litellm` — LiteLLM custom-guardrail Python plugin format
 *   - `POST /portkey` — Portkey webhook guardrail format
 *   - `POST /openai-compatible` — generic OpenAI chat-completion
 *
 * LiteLLM and OpenAI-compatible routes use HMAC-SHA256 authentication.
 * Portkey can use a static Bearer credential and returns its native
 * `{ verdict: boolean }` response shape.
 *
 * Performance target (AC measurable): P99 < 1.5s on the
 * `packages/core/benchmarks/` corpus on a 4-vCPU container.
 *
 * @package @blackunicorn/bonklm-server
 */
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
import { GuardrailEngine } from '@blackunicorn/bonklm';
import type { EngineResult } from '@blackunicorn/bonklm';
import { sanitizeReasonText } from '@blackunicorn/bonklm/core/connector-utils';
import { assertValidPortkeyWebhookSecret } from './auth/portkey.js';
import { authenticatedBodyParser, type AuthError, ensureRequestAuthenticated } from './auth/request.js';
import { assertValidReplayWindowMs, DEFAULT_REPLAY_WINDOW_MS } from './hmac/index.js';
import { ReplayCache } from './hmac/replay-cache.js';
import { adaptLogger } from './logger-adapter.js';
import {
  type LiteLLMHookPayload,
  mapLiteLLM,
  mapOpenAICompat,
  mapPortkey,
  type OpenAICompatPayload,
  type PortkeyHookPayload
} from './payload-mappers/index.js';
import type { BonklmServerOptions, GuardrailDecision, PortkeyWebhookDecision } from './types.js';

export type { BonklmServerOptions, GuardrailDecision, PortkeyWebhookDecision } from './types.js';
export {
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  DEFAULT_REPLAY_WINDOW_MS,
  DEFAULT_REPLAY_CACHE_SIZE,
  ReplayCache,
  verifyHmacSignature,
  signHmac
} from './hmac/index.js';
export type { HmacFailureReason, HmacVerifyResult } from './hmac/index.js';
export { mapLiteLLM, mapPortkey, mapOpenAICompat } from './payload-mappers/index.js';

/** Minimum HMAC secret length (bytes). */
const MIN_HMAC_SECRET_BYTES = 32;

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
 *   hmacSecret: process.env.BONKLM_HMAC_SECRET!,
 * });
 *
 * await server.listen({ port: 4123, host: '0.0.0.0' });
 * console.log('BonkLM server listening on', server.addresses());
 * ```
 */
export async function createBonklmGuardrailServer(options: BonklmServerOptions): Promise<FastifyInstance> {
  // Boundary validation.
  if (typeof options.hmacSecret !== 'string' || Buffer.byteLength(options.hmacSecret, 'utf8') < MIN_HMAC_SECRET_BYTES) {
    throw new Error(
      `createBonklmGuardrailServer: hmacSecret MUST contain at least ${MIN_HMAC_SECRET_BYTES} bytes of entropy. ` +
        'Generate via `openssl rand -base64 32` or equivalent.'
    );
  }
  if ((options.validators === undefined || options.validators.length === 0) && options.engine === undefined) {
    throw new Error(
      'createBonklmGuardrailServer: either `validators: [...]` (non-empty) OR `engine` MUST be supplied.'
    );
  }
  if (options.portkeyWebhookSecret !== undefined) {
    assertValidPortkeyWebhookSecret(options.portkeyWebhookSecret);
  }

  const engine =
    options.engine ??
    new GuardrailEngine({
      validators: options.validators!,
      ...(options.guards !== undefined && options.guards.length > 0 ? { guards: options.guards } : {})
    });

  // Development consumers must explicitly opt out of production-safe responses.
  const productionMode = options.productionMode ?? true;
  const replayWindowMs = options.replayWindowMs;
  if (replayWindowMs !== undefined) {
    assertValidReplayWindowMs(replayWindowMs);
  }
  // Seen-signature cache: an accepted signature is rejected when it is
  // submitted again inside the window. Guarantees are per-instance and
  // capacity-bounded: a captured request replayed to THIS instance is
  // rejected while its entry is retained (retention exceeds the
  // acceptance window); at capacity the server fails closed
  // (replay_cache_exhausted) instead of evicting unexpired entries; a
  // replay routed to a DIFFERENT replica in a multi-replica deployment
  // still succeeds unless a shared cache is injected via
  // `options.replayCache`. Size to window × peak accepted rps.
  const replayCache =
    options.replayCache ??
    new ReplayCache({
      windowMs: replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS,
      ...(options.replayCacheSize !== undefined ? { maxSize: options.replayCacheSize } : {})
    });

  // Bound request cost while allowing ordinary conversation histories.
  const bodyLimit = options.bodyLimit ?? 512 * 1024;

  // Fastify accepts a caller-supplied logger through `loggerInstance`.
  // Keep the options type explicit so incompatible API changes fail at build time
  // — which is exactly what caught the previous `LogController` construction:
  // that export does not exist in the Fastify this package resolves to. Suppress
  // Fastify's automatic per-request logging with the top-level
  // `disableRequestLogging` option, which is supported across the whole v5 line.
  const fastifyOpts: FastifyServerOptions =
    options.logger === undefined
      ? {
          logger: {
            level: process.env.NODE_ENV === 'test' ? 'silent' : 'info'
          },
          disableRequestLogging: true,
          bodyLimit
        }
      : {
          loggerInstance: adaptLogger(options.logger),
          disableRequestLogging: true,
          bodyLimit
        };
  const fastify = Fastify(fastifyOpts) as unknown as FastifyInstance;

  // Authenticate raw request bytes before parsing. Fastify normalizes
  // Content-Type parameters before dispatching to this catch-all parser.
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser(
    '*',
    { parseAs: 'string' },
    authenticatedBodyParser(options, replayWindowMs, replayCache)
  );
  fastify.addHook('preHandler', async request =>
    ensureRequestAuthenticated(options, replayWindowMs, request, replayCache)
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
    const message = err instanceof Error ? err.message : 'unknown error';
    if (isAuthError) {
      reply.code(status).send({
        error: (err as AuthError).code,
        ...(productionMode || (err as AuthError).code !== 'hmac_auth_failed'
          ? {}
          : { reason: (err as AuthError).hmacReason })
      });
      return;
    }
    reply.code(status).send({
      error: 'bad_request',
      ...(productionMode ? {} : { message })
    });
  });

  // Health endpoint — NO HMAC check (intentional for k8s probes).
  fastify.get('/healthz', async () => ({ status: 'ok' }));

  // The 3 guardrail routes (HMAC pre-validation runs at the global
  // hook above; route handlers only execute on valid HMAC).
  fastify.post('/litellm', async (req: FastifyRequest, _reply: FastifyReply): Promise<GuardrailDecision> => {
    const payload = req.body as LiteLLMHookPayload;
    const mapped = mapLiteLLM(payload);
    const result = await engine.validate(mapped.content);
    return makeDecision('litellm', result, req.id, productionMode);
  });

  fastify.post('/portkey', async (req: FastifyRequest, _reply: FastifyReply): Promise<PortkeyWebhookDecision> => {
    const payload = req.body as PortkeyHookPayload;
    const mapped = mapPortkey(payload);
    const result = await engine.validate(mapped.content);
    return { verdict: !result.blocked };
  });

  fastify.post('/openai-compatible', async (req: FastifyRequest, _reply: FastifyReply): Promise<GuardrailDecision> => {
    const payload = req.body as OpenAICompatPayload;
    const mapped = mapOpenAICompat(payload);
    const result = await engine.validate(mapped.content);
    return makeDecision('openai-compatible', result, req.id, productionMode);
  });

  // Match unknown POSTs so the same authenticated body parser runs before a
  // not-found response. This prevents content-type behavior from revealing
  // whether an unauthenticated caller guessed a protected route correctly.
  fastify.post('/*', async (_request, reply) => reply.code(404).send({ error: 'not_found' }));

  // Binding remains explicit at the Fastify boundary: consumers pass
  // `{ port, host }` to `listen`, or port 0 for dynamic assignment.
  return fastify;
}

/**
 * Translate an engine result into the shared `GuardrailDecision`
 * response shape. Sanitization + production-mode handling baked in.
 *
 * Validator output is sanitized before it crosses the HTTP boundary.
 * Production mode controls whether reason and finding detail is exposed.
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
        : engineResult.findings.map(f => ({
            category: sanitizeReasonText(String(f.category)),
            severity: sanitizeReasonText(String(f.severity)),
            description: sanitizeReasonText(f.description) ?? ''
          })),
    requestId
  };
}
