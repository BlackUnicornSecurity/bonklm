/**
 * Sprint 21 — Unified `BonklmBlockEvent` discriminated union
 * ============================================================
 *
 * Closes Sprint 20 cumulative-audit architect C2: 4 connector
 * packages emitted 4 distinct `onBlock` event shapes. Operators
 * wiring one Datadog/OTel sink had to write 4 mappers. This module
 * defines the canonical base + a discriminated union over `kind`.
 *
 * Connector packages alias their existing types to one of:
 *   - `kind: 'voice'`         — livekit-connector, voice-webhooks
 *   - `kind: 'sandbox'`       — e2b-adapter, daytona-adapter
 *   - `kind: 'inference'`     — inference-providers
 *   - `kind: 'durable-exec'`  — restate-middleware, temporal-middleware
 *   - `kind: 'document'`      — document-ingest
 *
 * Common base fields:
 *   - `reason: string` — short human-readable reason (≤200 chars).
 *   - `category?: string` — validator category from the underlying
 *     finding (e.g. 'prompt_injection', 'code_injection').
 *   - `severity?: string` — finding severity ('critical' | 'warning'
 *     | etc.).
 *
 * Per-kind extension carries the surface-specific payload. Operator
 * dashboards can match on `kind` for cross-package aggregation
 * without needing to know every individual `surface` / `phase` enum.
 */

export interface BonklmBlockEventBase {
  /** Discriminator for cross-package aggregation. */
  kind: BonklmBlockEventKind;
  /** Short human-readable reason. */
  reason: string;
  /** Validator finding category, when available. */
  category?: string;
  /** Finding severity. */
  severity?: string;
}

export type BonklmBlockEventKind =
  | 'voice'
  | 'sandbox'
  | 'inference'
  | 'durable-exec'
  | 'document'
  | 'cf-agent'
  | 'web-middleware';

/** Voice surfaces — LiveKit Agents + Vapi/Retell webhooks. */
export type BonklmVoiceSurface =
  | 'audio_partial'
  | 'audio_final'
  | 'audio_tts'
  | 'audio_tool'
  | 'vapi_tool_call'
  | 'vapi_assistant_request'
  | 'vapi_transcript'
  | 'retell_update_only'
  | 'retell_response_required';

export interface BonklmVoiceBlockEvent extends BonklmBlockEventBase {
  kind: 'voice';
  /** Pinned voice surface. */
  surface: BonklmVoiceSurface;
}

/** Sandbox surfaces — E2B + Daytona. */
export type BonklmSandboxSurface =
  // E2B
  | 'commands.run'
  | 'runCode'
  | 'files.write'
  | 'files.read'
  | 'files.remove'
  | 'files.list'
  // Daytona
  | 'process.exec'
  | 'process.run'
  | 'fs.writeFile'
  | 'fs.readFile'
  | 'fs.deleteFile'
  | 'fs.listFiles'
  | 'fs.replaceInFiles';

export interface BonklmSandboxBlockEvent extends BonklmBlockEventBase {
  kind: 'sandbox';
  /** Pinned sandbox surface. */
  surface: BonklmSandboxSurface;
  /**
   * First 200 chars of the payload that triggered the block.
   * SECURITY NOTE: this carries user-controlled content; operators
   * shipping logs to a less-trusted SIEM should redact.
   */
  payload?: string;
}

/** Inference-provider surfaces — Groq + Cerebras + Together. */
export type BonklmInferenceProvider = 'groq' | 'cerebras' | 'together';

export interface BonklmInferenceBlockEvent extends BonklmBlockEventBase {
  kind: 'inference';
  provider: BonklmInferenceProvider;
  phase: 'input' | 'output';
}

/** Durable-execution surfaces — Restate + Temporal. */
export type BonklmDurableExecRuntime = 'restate' | 'temporal';

export interface BonklmDurableExecBlockEvent extends BonklmBlockEventBase {
  kind: 'durable-exec';
  runtime: BonklmDurableExecRuntime;
  validatorName: string;
}

/** Document-ingest surfaces — LlamaParse + Unstructured + Reducto. */
export type BonklmDocumentPhase =
  | 'llamaparse'
  | 'unstructured'
  | 'reducto'
  | 'validate_extracted_text';

export interface BonklmDocumentBlockEvent extends BonklmBlockEventBase {
  kind: 'document';
  phase: BonklmDocumentPhase;
  /** Source document identifier when available. */
  documentId?: string;
  /** First 200 chars of the extracted text that triggered the block. */
  excerpt?: string;
}

/**
 * Cloudflare Agent surfaces — `setState` + `sql` SELECT + storage reads.
 * Story 3.8 / Sprint 22.
 */
export type BonklmCfAgentSurface =
  | 'setState'
  | 'sql_select'
  | 'storage_get'
  | 'storage_list'
  | 'storage_getAlarm';

export interface BonklmCfAgentBlockEvent extends BonklmBlockEventBase {
  kind: 'cf-agent';
  surface: BonklmCfAgentSurface;
  /** True when the underlying surface broadcasts to WS clients (setState). */
  broadcast: boolean;
}

/**
 * Web middleware surfaces — Elysia plugin + Next.js helpers.
 * Story 3.9 / Sprint 22.
 */
export type BonklmWebMiddlewarePhase = 'request' | 'response';

export interface BonklmWebMiddlewareBlockEvent extends BonklmBlockEventBase {
  kind: 'web-middleware';
  phase: BonklmWebMiddlewarePhase;
  /** First 200 chars of the blocked body. */
  excerpt?: string;
}

/**
 * Cross-package block-event discriminated union.
 *
 * @public Sprint 26/28 v1.0-RC1 API freeze. The 7 `kind` values are
 * frozen — adding a new `kind` is a MINOR (additive) bump; removing
 * or renaming one is MAJOR. Per-kind interfaces are also `@public`;
 * new OPTIONAL fields on the per-kind interfaces are additive.
 */
export type BonklmBlockEvent =
  | BonklmVoiceBlockEvent
  | BonklmSandboxBlockEvent
  | BonklmInferenceBlockEvent
  | BonklmDurableExecBlockEvent
  | BonklmDocumentBlockEvent
  | BonklmCfAgentBlockEvent
  | BonklmWebMiddlewareBlockEvent;

/**
 * Type guard for cross-package consumers.
 *
 * Sprint 21 audit closure (security C-6): this guard is a TypeScript
 * narrowing convenience, NOT a security trust boundary. A maliciously
 * crafted object with valid `kind` + `reason` fields passes the
 * guard. Consumers that pass `event.payload` to downstream sinks
 * MUST treat the payload as untrusted (e.g. redact / escape /
 * size-cap before logging).
 */
export function isBonklmBlockEvent(value: unknown): value is BonklmBlockEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown; reason?: unknown };
  if (typeof v.kind !== 'string') return false;
  if (typeof v.reason !== 'string') return false;
  return (
    v.kind === 'voice' ||
    v.kind === 'sandbox' ||
    v.kind === 'inference' ||
    v.kind === 'durable-exec' ||
    v.kind === 'document' ||
    v.kind === 'cf-agent' ||
    v.kind === 'web-middleware'
  );
}
