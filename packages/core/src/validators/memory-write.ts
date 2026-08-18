/**
 * Memory-Write Validator
 * ==================================
 * Validates `ValidatorInput { kind: 'memory_write' }` payloads against a
 * stack of memory-safety validators before content is persisted to
 * agent memory (Mem0, Zep, LangChain conversational memory, Cloudflare
 * Durable Object `setState`, etc.).
 *
 * The default validator stack for memory writes is:
 *   - PromptInjectionValidator — detect memory-poison attempts
 *   - SecretGuard — never persist credentials
 *   - PIIGuard — never persist customer PII without explicit consent
 *   - XSSGuard — defang content that will later render in a UI
 *
 * Two failure modes:
 *   - 'block-write' (default) — refuse the write on any finding; the
 *     caller MUST NOT persist; original payload is returned unchanged
 *     for audit-trail purposes.
 *   - 'redact' — substring-replace flagged regions (via the
 *     `RedactingValidator` capability used by SecretGuard, falling back
 *     to `Finding.match` for non-capability validators). The write is
 *     ALLOWED and the redacted payload is returned for persistence.
 *     EXCEPTION: a provenance laundering re-scan hit (PR-C) fails the
 *     write CLOSED even in redact mode — the poison lives in the raw
 *     upstream body, not textually in `content`, so substring redaction
 *     cannot remove it; the whole write blocks (including any leaf
 *     findings that would otherwise have been redacted-and-allowed).
 *
 * Hook integration: connectors wiring this validator should register
 * any pre-write side-effect hooks with `{ phase: BEFORE_VALIDATION,
 * surface: 'memory_write' }` so the engine's HookManager fires them
 * before this validator runs. The surface vocabulary lock is in
 * `GuardrailEngine.types.ts:HookSurface`.
 *
 * Result metadata: `result.metadata.memorySessionId` and
 * `result.metadata.userId` are populated from the payload so audit
 * trails and OTel spans can correlate the decision to the persistence
 * site without re-deriving the IDs.
 */
import type { Validator, ValidatorInput } from '../engine/GuardrailEngine.types.js';
import { createResult, type GuardrailResult, mergeResults, Severity } from '../base/GuardrailResult.js';
import type { Logger } from '../base/GenericLogger.js';
import type { Provenance } from './provenance.js';
import { appendIndirectInjectionArm } from './indirect-injection-arm.js';
import { rescanLaunderedProvenance } from './provenance-rescan.js';
import { sanitizeLogString } from '../common/index.js';
import { applyRedaction, runValidatorChain, VALIDATOR_ERROR_CATEGORIES } from './validator-utils.js';

const DEFAULT_REDACT_REPLACEMENT = '[REDACTED]';

/** Memory write failure mode. */
export type MemoryWriteFailureMode = 'block-write' | 'redact';

/**
 * Memory-write payload metadata. An open record (arbitrary connector keys stay
 * allowed) with one typed slot: the optional {@link Provenance} envelope.
 *
 * defines the typing only. PR-C consumes it: when this
 * envelope carries tool-derived provenance, {@link createMemoryWriteValidator}
 * re-scans the raw upstream body behind the chain (see {@link rescanLaunderedProvenance})
 * to catch poison the laundered `content` hides. POPULATING the envelope — an
 * upstream connector caching the raw body + stamping `derivedFrom` — is a later
 * per-connector increment; until then the consumer degrades to a no-op.
 */
export interface MemoryWriteMetadata {
  /** Upstream-derivation envelope (stamped by an upstream connector increment). */
  provenance?: Provenance;
  [key: string]: unknown;
}

/** Payload shape mirroring `ValidatorInput { kind: 'memory_write' }`. */
export interface MemoryWritePayload {
  content: string;
  userId?: string;
  sessionId?: string;
  metadata?: MemoryWriteMetadata;
}

export interface MemoryWriteValidatorConfig {
  /** Validator stack to run against `payload.content`. */
  validators: Validator[];
  /**
   * What to do when a validator flags the write.
   * @default 'block-write'
   */
  onFailure?: MemoryWriteFailureMode;
  /**
   * Substitution string for redact mode. @default '[REDACTED]'
   */
  redactReplacement?: string;
  /** Optional logger. */
  logger?: Logger;
}

/**
 * Connector-facing return shape for `validateWrite`. `payload.content`
 * is the post-redaction content (when in `redact` mode) — connectors
 * SHOULD persist `result.payload.content` rather than the original
 * input.
 */
export interface MemoryWriteResult {
  result: GuardrailResult;
  payload: MemoryWritePayload;
  blocked: boolean;
}

/**
 * Validator + connector-helper composite.
 */
export interface MemoryWriteValidator extends Validator {
  validateWrite(payload: MemoryWritePayload): Promise<MemoryWriteResult>;
}

function buildMetadata(payload: MemoryWritePayload): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  // Audit-loop fix: skip empty-string identifiers. An empty string in
  // an audit trail causes spurious OTel-span / DB-lookup correlations.
  // Callers who want the field present MUST pass a non-empty value.
  if (payload.sessionId !== undefined && payload.sessionId !== '') {
    meta.memorySessionId = payload.sessionId;
  }
  if (payload.userId !== undefined && payload.userId !== '') {
    meta.userId = payload.userId;
  }
  // Audit-loop rename: `payloadMetadata` was ambiguous against the
  // outer `result.metadata` field. `sourceMetadata` reads more
  // naturally as "metadata from the source payload".
  if (payload.metadata !== undefined) meta.sourceMetadata = payload.metadata;
  return meta;
}

/**
 * Build a {@link MemoryWriteValidator} that runs the supplied stack
 * against `payload.content` before the caller persists the memory.
 *
 * @example
 * ```ts
 * const memWriter = createMemoryWriteValidator({
 *   validators: [
 *     new PromptInjectionValidator(),
 *     new SecretGuard(),
 *     new PIIGuard(),
 *     new XSSGuard(),
 *   ],
 *   onFailure: 'block-write',
 * });
 *
 * // Connector wiring (e.g. inside a Mem0 / Zep / DO setState wrapper):
 * const r = await memWriter.validateWrite({
 *   content: userMessage,
 *   userId: ctx.userId,
 *   sessionId: ctx.sessionId,
 * });
 * if (r.blocked) {
 *   logger.warn('memory write refused', r.result);
 *   throw new Error(r.result.reason);
 * }
 * await store.persist(r.payload.content); // redacted in 'redact' mode
 * ```
 */
export function createMemoryWriteValidator(config: MemoryWriteValidatorConfig): MemoryWriteValidator {
  if (config.validators.length === 0) {
    throw new Error('createMemoryWriteValidator requires at least one underlying validator.');
  }
  // security regression: append the provenance-gated indirect-injection arm for
  // the memory_write surface (shell-var credential exfil, legacy-compat override
  // framing) via the shared composer. Appended after the caller's chain; scans
  // the laundered surface `content`. The complementary PR-C raw-upstream re-scan
  // (gated on `metadata.provenance` / hasToolResultProvenance) runs in
  // `validateWrite` and catches poison the laundered `content` no longer carries.
  const validators = appendIndirectInjectionArm(config.validators, 'memory_write');
  const mode: MemoryWriteFailureMode = config.onFailure ?? 'block-write';
  const replacement = config.redactReplacement ?? DEFAULT_REDACT_REPLACEMENT;
  const logger = config.logger;

  const validateWrite = async (payload: MemoryWritePayload): Promise<MemoryWriteResult> => {
    const metadata = buildMetadata(payload);
    const leafResult = await runValidatorChain(validators, payload.content, VALIDATOR_ERROR_CATEGORIES.memoryWrite);

    // security regression: re-scan the RAW upstream body behind the write's
    // provenance chain for indirect-injection payloads the laundered surface
    // `content` hides (the Home-E laundering attack). Gated on tool-derived
    // provenance, so a genuine user write (no `metadata.provenance`) is a no-op;
    // a cache miss / out-of-scope lookup degrades to nothing, never a false block.
    const launderingRescan = rescanLaunderedProvenance(payload.metadata?.provenance);
    const launderingFlagged = launderingRescan.results.length > 0;
    const result = launderingFlagged ? mergeResults(leafResult, ...launderingRescan.results) : leafResult;

    // No findings anywhere → straight pass-through.
    if (!result.blocked) {
      return {
        result: { ...result, metadata },
        payload,
        blocked: false
      };
    }

    // Redact mode mitigates by substring-replacing flagged regions of `content`.
    // It CANNOT mitigate a laundering hit: the poison lives in the raw upstream
    // body, not textually in the (laundered) `content`, so replacement would
    // leave the attacker instruction in the persisted write. Fail closed — a
    // raw-upstream hit blocks even in redact mode.
    if (mode === 'redact' && !launderingFlagged) {
      const redactedContent = applyRedaction(payload.content, result.findings, validators, replacement);
      logger?.info('[MemoryWriteValidator] redacted memory write', {
        // CWE-117: sessionId/userId are caller-influenced; escape before logging
        // (audit re-touch rule — match the retrieved-doc sanitization discipline).
        sessionId: sanitizeLogString(payload.sessionId ?? ''),
        userId: sanitizeLogString(payload.userId ?? ''),
        findings: result.findings.length
      });
      return {
        // Redact mode: validator flagged content, but we mitigated
        // in-place. Surface as ALLOWED at the top level so callers
        // persist the redacted content. Severity reflects the original
        // findings so telemetry consumers can still observe the event.
        result: {
          ...result,
          allowed: true,
          blocked: false,
          reason: undefined,
          metadata
        },
        payload: { ...payload, content: redactedContent },
        blocked: false
      };
    }

    // block-write — refuse the write; original payload preserved.
    logger?.warn('[MemoryWriteValidator] memory write blocked', {
      // CWE-117: sessionId/userId + the leaf reason are attacker-influenceable;
      // escape before logging (audit re-touch rule, ADR-0001).
      sessionId: sanitizeLogString(payload.sessionId ?? ''),
      userId: sanitizeLogString(payload.userId ?? ''),
      reason: sanitizeLogString(result.reason ?? ''),
      // PR-C forensic signal: how many raw upstream bodies were re-scanned and
      // whether the block was attributable to a laundering hit. Numeric/boolean
      // only — never the raw match (CWE-117 / secret-egress discipline).
      launderingRescanned: launderingRescan.scanned,
      launderingBlocked: launderingFlagged
    });
    return {
      result: { ...result, metadata },
      payload,
      blocked: true
    };
  };

  return {
    name: 'MemoryWriteValidator',
    async validate(input: string | ValidatorInput): Promise<GuardrailResult> {
      if (typeof input === 'string' || input.kind !== 'memory_write') {
        return createResult(true, Severity.INFO, []);
      }
      const r = await validateWrite(input.payload);
      return r.result;
    },
    validateWrite
  };
}
