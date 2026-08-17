/**
 * Vapi webhook handler
 * =================================
 *
 * Vapi sends 3 event types relevant to BonkLM:
 *
 *   1. `tool-calls` (sync) — Vapi waits for the response before
 *      proceeding. Validator BLOCK → respond with HTTP 403 + structured
 *      error body; Vapi cancels the tool call.
 *   2. `assistant-request` (sync, 7.5s ceiling) — Vapi calls during a
 *      session to fetch the assistant config. Validator BLOCK → respond
 *      with an empty assistant or with HTTP 403 (Vapi terminates the
 *      session).
 *   3. `transcript` (async observe-only) — Vapi sends transcripts
 *      mid-session without waiting for a response. Validator findings
 *      are LOGGED but cannot block — Vapi has already committed the
 *      transcript to the LLM call. To block on transcript content,
 *      switch to Vapi's "Custom LLM" mode and validate at the LLM
 *      proxy layer instead.
 *
 * README emphasises the transcript caveat as a top-level warning.
 */
import { verifyVapiHmac } from '../hmac.js';
import type {
  VapiHandlerConfig,
  VoiceWebhookBlockEvent,
  VoiceWebhookHmacFailureEvent,
  WebhookRequest,
  WebhookResponse
} from '../types.js';

/** Vapi event-type discriminator from the request body. */
type VapiMessageType = 'tool-calls' | 'assistant-request' | 'transcript' | string;

interface VapiMessage {
  type?: VapiMessageType;
  toolCallList?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
  /** transcript event payload. */
  transcript?: string;
  /** assistant-request: typically empty body; Vapi expects an assistant config back. */
  call?: unknown;
}

interface VapiRequestBody {
  message?: VapiMessage;
}

const VAPI_SIGNATURE_HEADER = 'x-vapi-signature';
const VAPI_TIMESTAMP_HEADER = 'x-vapi-timestamp';

/**
 * Returns an HTTP handler suitable for Express / Fastify / Next.js /
 * Hono. Pass `req.rawBody` (NOT `req.body` — HMAC verification
 * requires the literal bytes) and lowercase headers.
 */
export function createVapiHandler(config: VapiHandlerConfig): (req: WebhookRequest) => Promise<WebhookResponse> {
  if (!config?.engine) {
    throw new TypeError('createVapiHandler: config.engine (GuardrailEngine) is required.');
  }
  if (typeof config.hmacSecret !== 'string' || config.hmacSecret.length < 32) {
    throw new TypeError('createVapiHandler: config.hmacSecret must be a string ≥ 32 chars.');
  }

  return async function vapiHandler(req: WebhookRequest): Promise<WebhookResponse> {
    try {
      if (!req || typeof req.rawBody !== 'string' || !req.headers) {
        return { status: 401, body: { error: 'malformed_request' } };
      }

      // 1. HMAC verification (BEFORE JSON.parse — preserves the route-
      // enumeration-oracle closure pattern from bonklm-server).
      const hmacResult = verifyVapiHmac({
        rawBody: req.rawBody,
        signature: req.headers[VAPI_SIGNATURE_HEADER],
        timestamp: req.headers[VAPI_TIMESTAMP_HEADER],
        secret: config.hmacSecret,
        replayWindowMs: config.replayWindowMs
      });
      if (!hmacResult.valid) {
        emitHmacFailure(config, { vendor: 'vapi', reason: hmacResult.reason });
        // Sprint 19 Story 3.4 hardening (security C-1 + architect
        // C2): opaque response body. Reason is in onHmacFailure
        // telemetry (operator-controlled) NOT the wire response —
        // defeats semantic enumeration oracle.
        return { status: 401, body: { error: 'unauthorized' } };
      }

      // 2. Parse + dispatch on message.type.
      let parsed: VapiRequestBody;
      try {
        parsed = JSON.parse(req.rawBody) as VapiRequestBody;
      } catch {
        // post-auth parse failures are
        // 400 Bad Request, not 401 (which is reserved for auth
        // failures).
        return { status: 400, body: { error: 'invalid_json' } };
      }
      const message = parsed?.message;
      if (!message || typeof message.type !== 'string') {
        return { status: 400, body: { error: 'missing_message_type' } };
      }

      switch (message.type) {
        case 'tool-calls':
          return await handleToolCalls(message, config);
        case 'assistant-request':
          return await handleAssistantRequest(message, config);
        case 'transcript':
          return await handleTranscriptObserveOnly(message, config);
        default:
          // Unknown event type — Vapi may add new ones. Pass through.
          return { status: 200, body: { ok: true } };
      }
    } catch (err) {
      safeOnError(config, err);
      return { status: 500, body: { error: 'internal' } };
    }
  };
}

// =============================================================================
// Handlers
// =============================================================================

async function handleToolCalls(message: VapiMessage, config: VapiHandlerConfig): Promise<WebhookResponse> {
  const calls = Array.isArray(message.toolCallList) ? message.toolCallList : [];
  for (const call of calls) {
    const args = call?.function?.arguments;
    if (args === undefined) continue;
    const argsString = typeof args === 'string' ? args : safeStringify(args);
    // Note: engine.validate(content:string) is the heterogenous-stack-
    // safe path — some validators (PromptInjection) accept string only.
    // validateInput({kind:'tool_call', ...}) would BLOCK on those
    // validators with a `validator_error` finding (Sprint 16 audit
    // closure documented this asymmetry).
    const result = await config.engine.validate(argsString);
    if (result.blocked) {
      const ev: VoiceWebhookBlockEvent = {
        phase: 'vapi_tool_call',
        reason: 'tool_call_blocked',
        category: result.findings[0]?.category,
        severity: String(result.severity)
      };
      safeOnBlock(config, ev);
      return { status: 403, body: { error: 'tool_call_blocked', findings: result.findings } };
    }
  }
  return { status: 200, body: { ok: true } };
}

async function handleAssistantRequest(message: VapiMessage, config: VapiHandlerConfig): Promise<WebhookResponse> {
  // Vapi expects an
  // `assistant` config object in the response body — `{ok:true}`
  // breaks the session. Caller MUST provide `onAssistantRequest`
  // hook; otherwise we return 400 to surface the misconfiguration.
  if (typeof config.onAssistantRequest !== 'function') {
    return {
      status: 400,
      body: {
        error: 'assistant_request_unconfigured',
        message:
          'createVapiHandler received an assistant-request event but no onAssistantRequest hook is configured. Vapi expects an assistant config object in the response body.'
      }
    };
  }
  const assistant = await config.onAssistantRequest(message);
  return { status: 200, body: assistant };
}

async function handleTranscriptObserveOnly(message: VapiMessage, config: VapiHandlerConfig): Promise<WebhookResponse> {
  // Transcript is async observe-only — Vapi does NOT wait for our
  // response. We validate and surface telemetry but the LLM call has
  // already fired by the time we receive this event.
  const transcript = typeof message.transcript === 'string' ? message.transcript : '';
  if (transcript.length === 0) return { status: 200, body: { ok: true } };

  const result = await config.engine.validate(transcript);
  if (result.blocked) {
    const ev: VoiceWebhookBlockEvent = {
      phase: 'vapi_transcript',
      reason: 'transcript_blocked_observe_only',
      category: result.findings[0]?.category,
      severity: String(result.severity)
    };
    safeOnBlock(config, ev);
    // Still 200 — Vapi does not act on our response for transcripts.
    // To enforce, the caller must switch to Custom LLM mode.
  }
  return { status: 200, body: { ok: true } };
}

// =============================================================================
// Helpers
// =============================================================================

function safeOnBlock(config: VapiHandlerConfig, ev: VoiceWebhookBlockEvent): void {
  try {
    config.onBlock?.(ev);
  } catch (err) {
    safeOnError(config, err);
  }
}

function emitHmacFailure(config: VapiHandlerConfig, ev: VoiceWebhookHmacFailureEvent): void {
  try {
    config.onHmacFailure?.(ev);
  } catch (err) {
    safeOnError(config, err);
  }
}

function safeOnError(config: VapiHandlerConfig, err: unknown): void {
  if (!config.onError) return;
  try {
    config.onError(err);
  } catch {
    /* swallow */
  }
}

function safeStringify(args: unknown): string {
  try {
    return JSON.stringify(args);
  } catch {
    // empty string
    // (skip validation) is safer than `[object Object]` (which is a
    // dead signal the validator passes). Caller-side circular refs
    // shouldn't exist in webhook payloads — Vapi sends parsed JSON —
    // but defense-in-depth.
    return '';
  }
}

// Re-export removed — consumers import GuardrailEngine from
// `@blackunicorn/bonklm` directly (audit NIT-1).
