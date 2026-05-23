/**
 * Story 3.4 — Retell webhook handler
 * ===================================
 *
 * Retell exposes two event types over WebSocket:
 *
 *   - `update_only` — partial transcript update; analogous to Vapi's
 *     transcript event but Retell DOES wait for the response (silently
 *     discards it). Validator BLOCK fires telemetry but cannot block
 *     the in-flight LLM call.
 *   - `response_required` — full LLM-proxy invocation: Retell expects
 *     the connector to call its own LLM and stream back text. Validator
 *     BLOCK terminates the response stream with an empty / error
 *     completion.
 *
 * The connector exposes a single `createRetellWsHandler` that consumes
 * raw WebSocket messages and emits responses. The WebSocket transport
 * itself is the connector author's responsibility (Express + `ws`,
 * Hono + Cloudflare Workers, Fastify + `@fastify/websocket`, etc.) —
 * we provide the message-handler closure.
 *
 * HMAC verification fires on the INITIAL handshake message; subsequent
 * messages on the same connection are trusted (per Retell convention).
 */
import { verifyRetellHmac } from '../hmac.js';
import type {
  RetellHandlerConfig,
  VoiceWebhookBlockEvent,
  VoiceWebhookHmacFailureEvent,
} from '../types.js';

type RetellMessageType = 'update_only' | 'response_required' | string;

interface RetellMessage {
  interaction_type?: RetellMessageType;
  transcript?: Array<{ role?: string; content?: string }> | string;
  response_id?: number;
}

export interface RetellHandshakeRequest {
  /** Raw stringified initial handshake body (signed by Retell). */
  rawBody: string;
  /** `X-Retell-Signature` header value. */
  signature: string | undefined;
}

export type RetellOutboundChunk =
  | { type: 'text'; content: string; end?: boolean }
  | { type: 'block'; reason: string };

/**
 * Returns an object with two methods:
 *   - `verifyHandshake({rawBody, signature})` — call on the initial
 *     HTTP-upgrade or first WS message to authenticate.
 *   - `handleMessage(parsedMessage)` — call on every subsequent WS
 *     message; returns an async generator of chunks to send back to
 *     Retell.
 */
export function createRetellWsHandler(config: RetellHandlerConfig): {
  verifyHandshake: (req: RetellHandshakeRequest) => boolean;
  handleMessage: (msg: RetellMessage) => AsyncGenerator<RetellOutboundChunk, void, unknown>;
} {
  if (!config?.engine) {
    throw new TypeError('createRetellWsHandler: config.engine is required.');
  }
  if (typeof config.hmacSecret !== 'string' || config.hmacSecret.length < 32) {
    throw new TypeError('createRetellWsHandler: config.hmacSecret must be ≥ 32 chars.');
  }

  function verifyHandshake(req: RetellHandshakeRequest): boolean {
    const result = verifyRetellHmac({
      rawBody: req.rawBody,
      signature: req.signature,
      secret: config.hmacSecret,
    });
    if (!result.valid) {
      emitHmacFailure(config, { vendor: 'retell', reason: result.reason });
      return false;
    }
    return true;
  }

  async function* handleMessage(msg: RetellMessage): AsyncGenerator<RetellOutboundChunk, void, unknown> {
    const interactionType = msg?.interaction_type;
    try {
      if (!msg || typeof interactionType !== 'string') return;

      switch (interactionType) {
        case 'update_only': {
          // Partial transcript — observe-only (Retell will silently
          // discard our response, similar to Vapi transcript).
          const text = extractTranscriptText(msg.transcript);
          if (text.length === 0) return;
          const result = await config.engine.validate(text);
          if (result.blocked) {
            safeOnBlock(config, {
              phase: 'retell_update_only',
              reason: 'update_only_blocked_observe_only',
              category: result.findings[0]?.category,
              severity: String(result.severity),
            });
            // Yield a block notice — Retell ignores it but operator
            // logs / spies see the signal.
            yield { type: 'block', reason: 'update_only_blocked_observe_only' };
          }
          return;
        }

        case 'response_required': {
          // Full LLM proxy — connector author streams the LLM
          // completion back. We validate the accumulated transcript
          // FIRST; if BLOCKed, terminate immediately with an empty
          // text + block notice.
          const text = extractTranscriptText(msg.transcript);
          if (text.length === 0) {
            // Nothing to validate — proceed.
            return;
          }
          const result = await config.engine.validate(text);
          if (result.blocked) {
            safeOnBlock(config, {
              phase: 'retell_response_required',
              reason: 'response_required_blocked',
              category: result.findings[0]?.category,
              severity: String(result.severity),
            });
            yield { type: 'block', reason: 'response_required_blocked' };
            yield { type: 'text', content: '', end: true };
            return;
          }
          // Validation passed — connector author hooks their LLM call
          // here. This generator yields nothing; the caller's outer
          // loop streams the LLM chunks.
          return;
        }

        default:
          return;
      }
    } catch (err) {
      safeOnError(config, err);
      // Sprint 19 Story 3.4 audit code-reviewer-C3 closure: for
      // `response_required`, emit a terminating sequence so the
      // Retell connection doesn't hang waiting for an LLM response
      // that will never arrive. For `update_only`, the consumer
      // expects no output.
      if (interactionType === 'response_required') {
        yield { type: 'block', reason: 'internal_error' };
        yield { type: 'text', content: '', end: true };
      }
    }
  }

  return { verifyHandshake, handleMessage };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Sprint 19 Story 3.4 audit closure (architect C5): for ARRAY
 * transcripts (multi-turn), validate ONLY the latest `role:'user'`
 * entry. Validating the cumulative transcript produces:
 *  (a) noise telemetry (already-accepted historical injections
 *      re-flag);
 *  (b) self-inflicted DoS where one bad sentence early blocks every
 *      subsequent benign user turn.
 * For STRING transcripts (single-turn), pass through verbatim.
 */
function extractTranscriptText(transcript: RetellMessage['transcript']): string {
  if (typeof transcript === 'string') return transcript;
  if (Array.isArray(transcript)) {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const entry = transcript[i];
      if (entry?.role === 'user' && typeof entry.content === 'string') {
        return entry.content;
      }
    }
    return '';
  }
  return '';
}

function safeOnBlock(config: RetellHandlerConfig, ev: VoiceWebhookBlockEvent): void {
  try {
    config.onBlock?.(ev);
  } catch (err) {
    safeOnError(config, err);
  }
}

function emitHmacFailure(
  config: RetellHandlerConfig,
  ev: VoiceWebhookHmacFailureEvent
): void {
  try {
    config.onHmacFailure?.(ev);
  } catch (err) {
    safeOnError(config, err);
  }
}

function safeOnError(config: RetellHandlerConfig, err: unknown): void {
  if (!config.onError) return;
  try {
    config.onError(err);
  } catch {
    /* swallow */
  }
}
