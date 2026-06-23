/**
 * Story 1.3 — Memory-Write Validator
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
import { createResult, type GuardrailResult, Severity } from '../base/GuardrailResult.js';
import type { Logger } from '../base/GenericLogger.js';
import type { Provenance } from './provenance.js';
import { IndirectInjectionValidator } from './indirect-injection.js';
import { sanitizeLogString } from '../common/index.js';
import { applyRedaction, runValidatorChain, VALIDATOR_ERROR_CATEGORIES } from './validator-utils.js';

const DEFAULT_REDACT_REPLACEMENT = '[REDACTED]';

/** Memory write failure mode. */
export type MemoryWriteFailureMode = 'block-write' | 'redact';

/**
 * Memory-write payload metadata. An open record (arbitrary connector keys stay
 * allowed) with one typed slot: the optional {@link Provenance} envelope.
 *
 * D-065 §7-step-2.b PR-A defines the typing only; PR-C (`memory-utils`) is what
 * actually populates `metadata.provenance` from the upstream tool-result chain.
 * Once populated, a connector composing an `IndirectInjectionValidator({ surface:
 * 'memory_write' })` can gate the stricter arms on whether the write derives from
 * an attacker-influenceable tool result (`hasToolResultProvenance`).
 */
export interface MemoryWriteMetadata {
  /** Upstream-derivation envelope (PR-C threads it through here). */
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
  // D-065 §7-step-2.b: append the provenance-gated indirect-injection arms for
  // the memory_write surface (shell-var credential exfil, legacy-compat
  // override framing). Appended after the caller's chain. PR-C refines this to
  // gate on `metadata.provenance` (hasToolResultProvenance); PR-A gates on the
  // memory_write surface alone.
  const validators = [...config.validators, new IndirectInjectionValidator({ surface: 'memory_write' })];
  const mode: MemoryWriteFailureMode = config.onFailure ?? 'block-write';
  const replacement = config.redactReplacement ?? DEFAULT_REDACT_REPLACEMENT;
  const logger = config.logger;

  const validateWrite = async (payload: MemoryWritePayload): Promise<MemoryWriteResult> => {
    const metadata = buildMetadata(payload);
    const leafResult = await runValidatorChain(validators, payload.content, VALIDATOR_ERROR_CATEGORIES.memoryWrite);

    // No findings → straight pass-through.
    if (!leafResult.blocked) {
      return {
        result: { ...leafResult, metadata },
        payload,
        blocked: false
      };
    }

    if (mode === 'redact') {
      const redactedContent = applyRedaction(payload.content, leafResult.findings, validators, replacement);
      logger?.info('[MemoryWriteValidator] redacted memory write', {
        // CWE-117: sessionId/userId are caller-influenced; escape before logging
        // (audit re-touch rule — match the retrieved-doc sanitization discipline).
        sessionId: sanitizeLogString(payload.sessionId ?? ''),
        userId: sanitizeLogString(payload.userId ?? ''),
        findings: leafResult.findings.length
      });
      return {
        // Redact mode: validator flagged content, but we mitigated
        // in-place. Surface as ALLOWED at the top level so callers
        // persist the redacted content. Severity reflects the original
        // findings so telemetry consumers can still observe the event.
        result: {
          ...leafResult,
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
      reason: sanitizeLogString(leafResult.reason ?? '')
    });
    return {
      result: { ...leafResult, metadata },
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
