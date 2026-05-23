/**
 * Story 3.4 — Voice-webhooks shared types
 * =========================================
 *
 * Both Vapi + Retell handlers consume a `GuardrailEngine` and produce
 * shared block/telemetry event shapes.
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';

export type VoiceWebhookPhase =
  | 'vapi_tool_call'
  | 'vapi_assistant_request'
  | 'vapi_transcript'
  | 'retell_update_only'
  | 'retell_response_required';

export interface VoiceWebhookBlockEvent {
  phase: VoiceWebhookPhase;
  reason: string;
  category?: string;
  severity?: string;
}

export interface VoiceWebhookHmacFailureEvent {
  vendor: 'vapi' | 'retell';
  reason: string;
}

export interface VapiHandlerConfig {
  engine: GuardrailEngine;
  /** Shared HMAC secret. Minimum 32 chars enforced. */
  hmacSecret: string;
  /** Default 5 minutes. */
  replayWindowMs?: number;
  /** Fire on validation BLOCK (before HTTP 403 response). */
  onBlock?: (event: VoiceWebhookBlockEvent) => void;
  /** Fire on HMAC verification failure (before HTTP 401 response). */
  onHmacFailure?: (event: VoiceWebhookHmacFailureEvent) => void;
  /** Error sink for handler exceptions. */
  onError?: (err: unknown) => void;
  /**
   * Sprint 19 Story 3.4 audit closure (architect C4): Vapi expects an
   * `assistant` config object in the `assistant-request` response body.
   * Caller supplies the assistant config via this hook. The connector
   * passes the result through (no validation — the assistant config is
   * operator-owned, not LLM-generated).
   *
   * If unset, the handler returns HTTP 400 to signal misconfiguration
   * rather than silently breaking Vapi's session with a `{ok:true}`
   * body Vapi cannot parse as an assistant spec.
   */
  onAssistantRequest?: (msg: unknown) => Promise<unknown> | unknown;
}

export interface RetellHandlerConfig {
  engine: GuardrailEngine;
  hmacSecret: string;
  onBlock?: (event: VoiceWebhookBlockEvent) => void;
  onHmacFailure?: (event: VoiceWebhookHmacFailureEvent) => void;
  onError?: (err: unknown) => void;
}

/**
 * Generic webhook handler signature. Returns a structured response
 * the connector author can adapt to their HTTP framework (Express,
 * Fastify, Next.js Route Handler, Hono, etc.).
 */
export interface WebhookResponse {
  status: 200 | 400 | 401 | 403 | 500;
  body: unknown;
  headers?: Record<string, string>;
}

export interface WebhookRequest {
  /** Raw body string — REQUIRED for HMAC verification. */
  rawBody: string;
  /** Normalised lowercase headers. */
  headers: Record<string, string | undefined>;
}
