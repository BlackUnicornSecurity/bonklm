/**
 * Story 1.3a — Composed-Context Validator
 * ========================================
 * Concatenates an array of recalled memory entries (passed as
 * `ValidatorInput { kind: 'composed_context' }`) and runs the supplied
 * validator stack against the RAW combined blob. Targets the wake-up
 * attack class where each individual memory write is benign but the
 * composed history reconstitutes an injection payload at recall time.
 *
 * Round-2 amendment specifics:
 *   - R2-1: "run regex on RAW concatenated blob; never split on
 *     delimiter post-concat." The validator concatenates entries with
 *     `'\n\n'` and feeds the whole blob to the underlying validators
 *     once.
 *   - R2-1 also requires bidirectional detection ("payload split
 *     across entries detected in both orderings"). We run a SECOND
 *     scan against the reverse-ordered concatenation so attacks where
 *     fragments arrive in reverse chronological order are also caught.
 *     This doubles the scan cost but is bounded by the hard cap.
 *   - R2-D2: soft cap 32KB (warn-only telemetry), hard cap 200KB
 *     (truncate newest-first). The hard-cap extends `MAX_INPUT_LENGTH`
 *     for the composed-context path only — connector-supplied entries
 *     can carry more than the default 100KB ceiling without losing
 *     the recall context.
 *   - R2-11: telemetry attributes `composedContextBytesScanned`,
 *     `composedContextTruncated`, `composedContextSoftCapExceeded` are
 *     populated on `result.metadata` so Story 3.11's OTel adapter can
 *     emit them as `bonklm.composed_context.*` span attributes.
 *
 * Hook integration: connectors wiring this validator on the recall
 * path should register their HookManager hooks with
 * `{ phase: AFTER_VALIDATION, surface: 'composed_context' }`.
 */
import type { Validator, ValidatorInput } from '../engine/GuardrailEngine.types.js';
import { createResult, type GuardrailResult, Severity } from '../base/GuardrailResult.js';
import type { Logger } from '../base/GenericLogger.js';
import { maxSeverity, riskFromScore, runValidatorChain, VALIDATOR_ERROR_CATEGORIES } from './validator-utils.js';
import { appendIndirectInjectionArm } from './indirect-injection-arm.js';

/** Default soft cap (32KB) — exceeding it warns via telemetry. */
export const DEFAULT_COMPOSED_CONTEXT_SOFT_CAP_BYTES = 32 * 1024;
/** Default hard cap (200KB) — exceeding it truncates newest-first. */
export const DEFAULT_COMPOSED_CONTEXT_HARD_CAP_BYTES = 200 * 1024;

const ENTRY_SEPARATOR = '\n\n';

export interface ComposedContextValidatorConfig {
  /**
   * Validator stack to run against the concatenated blob. Typically
   * PromptInjection + Jailbreak. Order matters: short-circuits on the
   * first BLOCK.
   *
   * **Cost note**: the composed-context validator runs each chain
   * TWICE per call (forward + reverse-order concat) to defeat
   * order-dependent payload splits. Budget accordingly — a heavy
   * validator stack will halve the headroom under the 200ms P99 gate.
   */
  validators: Validator[];
  /**
   * Soft cap (bytes). When the total exceeds this but stays under
   * `hardCapBytes`, the validator emits a soft-cap warning via
   * `result.metadata.composedContextSoftCapExceeded = true` so the
   * caller can flag the recall context for review without truncating.
   * @default 32_768 (32KB)
   */
  softCapBytes?: number;
  /**
   * Hard cap (bytes). When the total exceeds this the validator
   * truncates newest-first — older entries are dropped until the
   * concatenated blob fits under the cap. Telemetry surfaces this
   * via `result.metadata.composedContextTruncated = true`.
   *
   * **Oversized single-entry behaviour**: if the NEWEST entry by
   * itself exceeds `hardCapBytes`, it is admitted in full rather
   * than refused — the security scanner's job is to scan whatever
   * content actually reaches the LLM, and refusing the only entry
   * would leave the LLM operating on unscanned content downstream.
   * The truncation flag is still set whenever older entries are
   * dropped.
   *
   * Must be >= 1; the constructor throws on 0 / negative values.
   *
   * @default 204_800 (200KB)
   */
  hardCapBytes?: number;
  /** Optional logger. */
  logger?: Logger;
}

export interface ComposedContextBatchResult {
  result: GuardrailResult;
  /** Number of bytes that were actually scanned (post-truncation). */
  bytesScanned: number;
  /** True if the input was truncated newest-first under the hard cap. */
  truncated: boolean;
  /**
   * True when the post-truncation byte count exceeded the soft cap AND
   * truncation did NOT fire. Truncation supersedes soft-cap signalling
   * to avoid double-alerting on a single oversized call (audit-loop
   * decision). Consumers needing the raw byte count consult
   * `bytesScanned`.
   */
  softCapExceeded: boolean;
}

export interface ComposedContextValidator extends Validator {
  validateEntries(entries: string[]): Promise<ComposedContextBatchResult>;
}

/**
 * UTF-8 byte length helper. JavaScript strings are UTF-16; the
 * concatenated blob the validator scans is a JS string, but the cap is
 * in BYTES so connectors can budget memory predictably.
 */
function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

interface EntrySelection {
  kept: string[];
  bytesScanned: number;
  truncated: boolean;
}

/**
 * Select entries newest-first (last-in-array first) up to the hard cap.
 *
 * Entries are typically supplied in chronological order (oldest first,
 * newest last). When the total exceeds the cap we drop OLDEST entries
 * — the recall context loses ancient history rather than the most
 * recent state, which is generally less useful for the LLM.
 *
 * An individual entry that ALONE exceeds the cap is included in full
 * (we still want to scan it) but no older entries are then admitted.
 * If the FIRST entry from the newest end is itself oversized, it's the
 * only entry we scan.
 */
function selectEntriesNewestFirst(entries: string[], hardCap: number, separatorBytes: number): EntrySelection {
  const reversed: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const eBytes = utf8ByteLength(entries[i]);
    const sep = reversed.length > 0 ? separatorBytes : 0;
    if (bytes + eBytes + sep > hardCap) {
      // If we haven't admitted ANY entries yet but this single entry
      // is oversized, admit it in full so we still scan something.
      // Otherwise: subsequent entries are all OLDER → admit none and
      // record that truncation happened.
      if (reversed.length === 0) {
        reversed.push(entries[i]);
        bytes += eBytes;
        truncated = i > 0; // older entries dropped → truncated
      } else {
        truncated = true;
      }
      break;
    }
    reversed.push(entries[i]);
    bytes += eBytes + sep;
  }
  // Restore chronological order.
  return { kept: reversed.reverse(), bytesScanned: bytes, truncated };
}

/**
 * Build a {@link ComposedContextValidator}.
 *
 * @example
 * ```ts
 * const composed = createComposedContextValidator({
 *   validators: [new PromptInjectionValidator(), new JailbreakValidator()],
 * });
 *
 * // Connector wiring (Mem0 / Zep / DO recall path):
 * const r = await composed.validateEntries(recentMemories);
 * if (r.result.blocked) {
 *   // R2-1 contract: terminate the LLM invocation
 *   throw new Error(r.result.reason);
 * }
 * ```
 */
export function createComposedContextValidator(config: ComposedContextValidatorConfig): ComposedContextValidator {
  if (config.validators.length === 0) {
    throw new Error('createComposedContextValidator requires at least one underlying validator.');
  }
  // D-065 §7-step-2.c: append the provenance-gated indirect-injection arm for
  // the composed_context surface (triage-bot steering, escalation suppression,
  // cross-doc copilot tool-call, cover-up directives) via the shared composer.
  // Appended after the caller's chain; scanned on both the forward and reverse
  // concat blobs like every composed-context validator.
  const validators = appendIndirectInjectionArm(config.validators, 'composed_context');
  const softCap = config.softCapBytes ?? DEFAULT_COMPOSED_CONTEXT_SOFT_CAP_BYTES;
  const hardCap = config.hardCapBytes ?? DEFAULT_COMPOSED_CONTEXT_HARD_CAP_BYTES;
  if (softCap < 0 || hardCap < 0) {
    throw new RangeError('composed-context caps must be non-negative');
  }
  // Audit-loop BLOCK fix: `hardCapBytes: 0` would silently fall into
  // the oversized-single-entry branch and admit one entry anyway,
  // producing a config that scans content when the caller asked for
  // none. Reject at construction so the misconfiguration is loud.
  if (hardCap < 1) {
    throw new RangeError(
      'composed-context hardCapBytes must be >= 1 — pass a positive byte budget or omit the option for the default 200KB cap.'
    );
  }
  if (softCap > hardCap) {
    throw new RangeError(`composed-context softCapBytes (${softCap}) must be <= hardCapBytes (${hardCap})`);
  }
  const separatorBytes = utf8ByteLength(ENTRY_SEPARATOR);
  const logger = config.logger;

  const validateEntries = async (entries: string[]): Promise<ComposedContextBatchResult> => {
    if (entries.length === 0) {
      return {
        result: {
          ...createResult(true, Severity.INFO, []),
          metadata: {
            composedContextBytesScanned: 0,
            composedContextTruncated: false,
            composedContextSoftCapExceeded: false
          }
        },
        bytesScanned: 0,
        truncated: false,
        softCapExceeded: false
      };
    }

    const totalBytes = entries.reduce((acc, e, i) => acc + utf8ByteLength(e) + (i > 0 ? separatorBytes : 0), 0);

    const selection: EntrySelection =
      totalBytes <= hardCap
        ? { kept: entries, bytesScanned: totalBytes, truncated: false }
        : selectEntriesNewestFirst(entries, hardCap, separatorBytes);

    // Audit-loop BLOCK fix: precedence between hard-cap and soft-cap
    // signals. When truncation fired, the hard-cap event subsumes the
    // soft-cap event for telemetry purposes (you'd otherwise alert
    // twice on a single oversized-input call). Surface ONLY the
    // truncation flag in that case; consumers that need post-truncation
    // byte count read `composedContextBytesScanned`.
    const softCapExceeded = !selection.truncated && selection.bytesScanned > softCap;

    if (selection.truncated) {
      logger?.warn('[ComposedContextValidator] hard cap truncation', {
        original: entries.length,
        kept: selection.kept.length,
        bytesScanned: selection.bytesScanned,
        hardCap
      });
    } else if (softCapExceeded) {
      logger?.info('[ComposedContextValidator] soft cap exceeded', {
        bytesScanned: selection.bytesScanned,
        softCap
      });
    }

    const forwardBlob = selection.kept.join(ENTRY_SEPARATOR);
    // R2-1: scan reverse-ordered concat too so attacks split across
    // entries are caught regardless of fragment arrival order.
    const reverseBlob = [...selection.kept].reverse().join(ENTRY_SEPARATOR);

    const forwardResult = await runValidatorChain(validators, forwardBlob, VALIDATOR_ERROR_CATEGORIES.composedContext);
    // Short-circuit if the forward scan already blocked — the reverse
    // pass is only needed to catch attacks the forward pass would have
    // missed.
    const reverseResult = forwardResult.blocked
      ? createResult(true, Severity.INFO, [])
      : await runValidatorChain(validators, reverseBlob, VALIDATOR_ERROR_CATEGORIES.composedContext);

    const blocked = forwardResult.blocked || reverseResult.blocked;
    const reason = forwardResult.blocked
      ? forwardResult.reason
      : reverseResult.blocked
        ? reverseResult.reason
        : undefined;
    const severity = maxSeverity(forwardResult.severity, reverseResult.severity);
    // Double-count note (audit-loop): when a self-contained attack
    // matches BOTH the forward and reverse scans, its findings appear
    // twice and contribute twice to risk_score. This is acceptable
    // failure-mode for a security scanner (over-penalise rather than
    // under-detect), but consumers that route on risk_score thresholds
    // should treat composed-context results as upper-bound estimates,
    // not exact scores. Use `result.blocked` as the gate signal.
    const allFindings = [...forwardResult.findings, ...reverseResult.findings];
    const aggregateScore = forwardResult.risk_score + reverseResult.risk_score;

    return {
      result: {
        allowed: !blocked,
        blocked,
        reason,
        severity,
        risk_level: riskFromScore(aggregateScore),
        risk_score: aggregateScore,
        findings: allFindings,
        metadata: {
          composedContextBytesScanned: selection.bytesScanned,
          composedContextTruncated: selection.truncated,
          composedContextSoftCapExceeded: softCapExceeded
        },
        timestamp: Date.now()
      },
      bytesScanned: selection.bytesScanned,
      truncated: selection.truncated,
      softCapExceeded
    };
  };

  return {
    name: 'ComposedContextValidator',
    async validate(input: string | ValidatorInput): Promise<GuardrailResult> {
      if (typeof input === 'string' || input.kind !== 'composed_context') {
        return createResult(true, Severity.INFO, []);
      }
      const batch = await validateEntries(input.entries);
      return batch.result;
    },
    validateEntries
  };
}
