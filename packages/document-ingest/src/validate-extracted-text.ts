/**
 * `validateExtractedText` helper for DIY parsers
 * ===========================================================
 *
 * For consumers running their own parser (pdf.js, mammoth, jsdom,
 * etc.). Accepts plain extracted text + the engine config; returns
 * a structured decision OR throws on BLOCK.
 *
 * Reusable building block — the LlamaParse / Unstructured / Reducto
 * wrappers all delegate to this internally so the validation logic
 * lives in ONE place.
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  DocumentIngestBlockedError,
  type DocumentIngestBlockEvent,
  type DocumentIngestPhase,
  type DocumentIngestWrapOptions
} from './types.js';

/** Default maximum text size accepted by the validator (1 MB). */
export const MAX_EXTRACTED_TEXT_BYTES = 1_000_000;

/**
 * Sprint 21 hardening (architect N5 + security C-4): policy for
 * oversize documents.
 *   - `'truncate'` (default): validate the first {@link maxBytes}
 *     bytes; fire `onOversize` (or `onError` when absent). NOTE: the
 *     downstream consumer still receives the FULL untruncated text
 *     from the parser — `validateExtractedText` does not rewrite the
 *     parser output. Operators concerned about the LLM consumer
 *     receiving unvalidated tail bytes should use `'block'` or
 *     pre-truncate before invoking the validator.
 *   - `'block'`: fail-CLOSED — synthesizes a BLOCK result and throws
 *     (or returns when `returnInsteadOfThrow: true`). Recommended for
 *     deployments where the LLM consumer will ingest whatever the
 *     parser produced.
 *   - `'allow'`: fail-OPEN — validates the truncated prefix; if clean,
 *     returns `{ blocked: false, oversized: true }`. The tail is
 *     UNVALIDATED. Only safe when the downstream consumer applies
 *     its own size cap.
 */
export type OversizePolicy = 'truncate' | 'block' | 'allow';

export interface ValidateExtractedTextOptions extends DocumentIngestWrapOptions {
  /** Surface phase tag for telemetry. */
  phase?: DocumentIngestPhase;
  /** Optional document identifier (passed through to telemetry). */
  documentId?: string;
  /**
   * When `true`, returns `{blocked: true, ...}` instead of throwing.
   * Default: `false` (throw on BLOCK).
   */
  returnInsteadOfThrow?: boolean;
  /**
   * per-call byte cap. Default
   * {@link MAX_EXTRACTED_TEXT_BYTES} (1 MB). Operators handling
   * legitimately-large legal/medical documents pass a higher value.
   */
  maxBytes?: number;
  /**
   * oversize
   * policy. Default `'truncate'` preserves the pre-Sprint-21 behavior
   * for backward compatibility.
   */
  onOversize?: OversizePolicy;
}

export interface ValidateExtractedTextResult {
  blocked: boolean;
  reason?: string;
  category?: string;
  severity?: string;
  /** Truncated to first 200 chars. */
  excerpt?: string;
  /**
   * `true` when validation
   * was SKIPPED via `shouldValidate=false`. Distinguishes "engine
   * cleared" (skipped:false) from "operator-exempted" (skipped:true)
   * for audit-trail consumers.
   */
  skipped?: boolean;
  /**
   * `true` when the document
   * exceeded {@link maxBytes}. Combined with `blocked` reveals the
   * `onOversize` policy outcome.
   */
  oversized?: boolean;
}

/**
 * Run the engine validator chain against extracted document text.
 *
 * - Empty / whitespace-only text → instant ALLOW (no engine call).
 * - Text > {@link MAX_EXTRACTED_TEXT_BYTES} → truncated to the cap +
 *   logged via `options.onError`. Truncation is a fail-CLOSED signal:
 *   the downstream LLM consumer would have ingested the same content,
 *   so we validate as much as we can.
 * - On BLOCK: fires `options.onBlock` + throws (or returns when
 *   `returnInsteadOfThrow: true`).
 */
export async function validateExtractedText(
  text: string,
  options: ValidateExtractedTextOptions
): Promise<ValidateExtractedTextResult> {
  if (typeof text !== 'string') {
    throw new TypeError('validateExtractedText: text must be a string (the parser-extracted document body).');
  }
  if (!options?.engine) {
    throw new TypeError('validateExtractedText: options.engine (GuardrailEngine) is required.');
  }

  const phase: DocumentIngestPhase = options.phase ?? 'validate_extracted_text';

  // Empty / whitespace-only → no-op ALLOW.
  if (text.trim().length === 0) {
    return { blocked: false };
  }

  // Operator allowlist hook.
  if (options.shouldValidate && options.shouldValidate(text, options.documentId) === false) {
    return { blocked: false, skipped: true };
  }

  // Sprint 21 hardening (BLOCK code-reviewer + security B-1):
  // byte-accurate truncation. `String.prototype.slice` works on
  // UTF-16 code units; multibyte payloads (CJK, emoji, Arabic) would
  // sail through a `slice(0, 1_000_000)` cap because the resulting
  // substring's byte length far exceeds the intended limit. Fix:
  // truncate via Buffer at the byte boundary.
  const maxBytes = options.maxBytes ?? MAX_EXTRACTED_TEXT_BYTES;
  const onOversize = options.onOversize ?? 'truncate';
  let content = text;
  let oversized = false;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    oversized = true;
    // Block policy: fail-CLOSED.
    if (onOversize === 'block') {
      const phaseTag: DocumentIngestPhase = options.phase ?? 'validate_extracted_text';
      const ev: DocumentIngestBlockEvent = {
        kind: 'document',
        phase: phaseTag,
        reason: `extracted text exceeded ${maxBytes} bytes (onOversize: 'block')`,
        documentId: options.documentId,
        category: 'oversized_document',
        severity: 'critical',
        excerpt: text.slice(0, 200)
      };
      safeOnBlock(options, ev);
      if (options.returnInsteadOfThrow) {
        return {
          blocked: true,
          reason: ev.reason,
          category: ev.category,
          severity: ev.severity,
          excerpt: ev.excerpt,
          oversized: true
        };
      }
      throw new DocumentIngestBlockedError(`${phaseTag} extracted text exceeded ${maxBytes} bytes`, phaseTag, {
        documentId: options.documentId,
        category: ev.category,
        severity: ev.severity
      });
    }
    // truncate / allow: validate the truncated prefix.
    safeOnError(
      options,
      new Error(
        `validateExtractedText: text exceeds ${maxBytes} bytes; truncating to cap (onOversize: '${onOversize}').`
      )
    );
    content = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
  }

  const result = await safeValidate(options.engine, content, options);

  if (!result.blocked) {
    return { blocked: false, oversized: oversized || undefined };
  }

  const finding = result.findings[0];
  const excerpt = content.slice(0, 200);
  const event: DocumentIngestBlockEvent = {
    kind: 'document',
    phase,
    reason: finding?.description ?? 'extracted_text_blocked',
    documentId: options.documentId,
    category: finding?.category,
    severity: String(result.severity),
    excerpt
  };
  safeOnBlock(options, event);

  if (options.returnInsteadOfThrow) {
    return {
      blocked: true,
      reason: event.reason,
      category: event.category,
      severity: event.severity,
      excerpt
    };
  }

  throw new DocumentIngestBlockedError(`${phase} extracted text blocked: ${event.reason}`, phase, {
    documentId: options.documentId,
    category: event.category,
    severity: event.severity
  });
}

async function safeValidate(
  engine: GuardrailEngine,
  content: string,
  options: ValidateExtractedTextOptions
): Promise<import('@blackunicorn/bonklm').EngineResult> {
  try {
    return await engine.validate(content);
  } catch (err) {
    safeOnError(options, err);
    throw err;
  }
}

function safeOnBlock(options: ValidateExtractedTextOptions, ev: DocumentIngestBlockEvent): void {
  if (!options.onBlock) return;
  try {
    options.onBlock(ev);
  } catch (err) {
    safeOnError(options, err);
  }
}

function safeOnError(options: ValidateExtractedTextOptions, err: unknown): void {
  if (!options.onError) return;
  try {
    options.onError(err);
  } catch {
    /* swallow */
  }
}
