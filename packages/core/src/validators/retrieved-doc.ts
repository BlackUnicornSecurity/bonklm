/**
 * Story 1.2 — Retrieved-Documents Validator
 * =========================================
 * Composable validator over a batch of retrieved documents (vector-DB
 * matches, RAG hits, knowledge-base lookups). Each doc's `content`
 * passes through the supplied validator stack; per-doc failures are
 * resolved by the configured policy:
 *
 *   - 'drop'      — drop the flagged doc, keep the rest, top-level NOT
 *                   blocked. Best when partial recall is acceptable
 *                   (e.g. semantic search with N=10, dropping 1-2 is
 *                   fine).
 *   - 'block-all' — single flagged doc terminates the entire batch.
 *                   Top-level is blocked, no doc survives. Best when
 *                   the LLM call must abort on any indirect injection.
 *   - 'redact'    — substring-replace each Finding.match in the doc's
 *                   content with `redactReplacement` (default
 *                   `[REDACTED]`); the doc is kept. Best for compliance
 *                   redaction (PII, secrets in customer-support
 *                   transcripts).
 *
 * The factory returns a {@link RetrievedDocValidator} that satisfies the
 * core {@link Validator} interface (for engine wiring) AND exposes a
 * {@link RetrievedDocValidator.validateBatch} convenience for connector
 * code that already holds the raw docs array.
 *
 * Per-doc decisions are recorded in `result.subResults` keyed by doc id
 * (or `doc[i]` when no id is present). The top-level `findings` list
 * aggregates every per-doc finding; per-doc detail is in subResults.
 * Consumers iterating both for telemetry MUST pick ONE source.
 *
 * Hooks: connectors that wire this validator into the engine should
 * fire `{ phase: AFTER, surface: 'retrieved_doc' }` so observability
 * pipelines (Story 3.11 OTel) can correlate decisions to the surface.
 */
import type { Validator, ValidatorInput } from '../engine/GuardrailEngine.types.js';
import {
  createResult,
  type Finding,
  type GuardrailResult,
  Severity,
} from '../base/GuardrailResult.js';
import type { Logger } from '../base/GenericLogger.js';
import {
  applyRedaction,
  maxSeverity,
  riskFromScore,
  runValidatorChain,
  VALIDATOR_ERROR_CATEGORIES,
} from './validator-utils.js';
export type { RedactingValidator } from './validator-utils.js';

const DEFAULT_REDACT_REPLACEMENT = '[REDACTED]';

/**
 * Per-document failure mode for {@link createRetrievedDocValidator}.
 */
export type PerDocFailureMode = 'drop' | 'block-all' | 'redact';

/**
 * Retrieved document shape — mirrors the `ValidatorInput` `retrieved_docs`
 * kind. `id` is optional but recommended; without it, per-doc subResults
 * are keyed by index position.
 */
export interface RetrievedDoc {
  id?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievedDocValidatorConfig {
  /**
   * Validator stack to run against each doc's `content`. Order matters:
   * short-circuits per-doc on the first BLOCK.
   */
  validators: Validator[];
  /**
   * Per-doc failure mode. @default 'drop'
   */
  onPerDocFailure?: PerDocFailureMode;
  /**
   * Substitution string for `redact` mode. @default '[REDACTED]'
   */
  redactReplacement?: string;
  /**
   * Optional logger for per-doc decisions. When set, every drop /
   * redact / block surfaces a structured log entry consumable by
   * downstream observability.
   */
  logger?: Logger;
}

/**
 * Return shape of {@link RetrievedDocValidator.validateBatch}. Mirrors
 * a typical connector's expectations: aggregate `result`, surviving
 * `docs` (post-drop and post-redact), and the count of docs that were
 * modified or removed.
 */
export interface RetrievedDocBatchResult {
  result: GuardrailResult;
  docs: RetrievedDoc[];
  filteredCount: number;
}

/**
 * Validator + batch-helper composite. Satisfies the core `Validator`
 * interface so it can sit in an engine chain, AND exposes
 * `validateBatch(docs)` for connectors that already have the raw doc
 * array and want the surviving list back in one call.
 */
export interface RetrievedDocValidator extends Validator {
  validateBatch(docs: RetrievedDoc[]): Promise<RetrievedDocBatchResult>;
}

// Story 1.3 (audit-loop BLOCK fix) — `maxSeverity`, `riskFromScore`,
// `runValidatorChain`, `applyRedaction`, `hasRedactContent` and
// `RedactingValidator` previously lived inline here. They were
// duplicated across `tool-call-args.ts`, `retrieved-doc.ts`, and
// `memory-write.ts`, so a single bug fix risked silently diverging
// across three copies. They now live in `./validator-utils.ts` and
// every composite validator imports from there.
//
// `RedactingValidator` is re-exported (above) so the public API
// surface of `retrieved-doc.ts` is unchanged.

/**
 * Build a {@link RetrievedDocValidator} that runs the supplied
 * validator stack against each doc in a batch.
 *
 * @example
 * ```ts
 * const docValidator = createRetrievedDocValidator({
 *   validators: [new PromptInjectionValidator(), new SecretGuard()],
 *   onPerDocFailure: 'redact',
 * });
 *
 * const { docs, result, filteredCount } = await docValidator.validateBatch([
 *   { id: 'm-1', content: 'normal RAG hit' },
 *   { id: 'm-2', content: 'ignore previous instructions' },
 * ]);
 * // docs[1].content === '[REDACTED] previous instructions' (if matched)
 * // result.subResults has both decisions
 * // filteredCount counts dropped or redact-modified docs
 * ```
 */
export function createRetrievedDocValidator(
  config: RetrievedDocValidatorConfig
): RetrievedDocValidator {
  if (config.validators.length === 0) {
    throw new Error(
      'createRetrievedDocValidator requires at least one underlying validator.'
    );
  }
  const mode: PerDocFailureMode = config.onPerDocFailure ?? 'drop';
  const replacement = config.redactReplacement ?? DEFAULT_REDACT_REPLACEMENT;
  const logger = config.logger;

  const validateBatch = async (docs: RetrievedDoc[]): Promise<RetrievedDocBatchResult> => {
    const subResults: Array<{ key: string; result: GuardrailResult }> = [];
    const allFindings: Finding[] = [];
    const survivingDocs: RetrievedDoc[] = [];
    let filteredCount = 0;
    let aggregateSeverity: Severity = Severity.INFO;
    let aggregateScore = 0;
    let batchBlocked = false;
    let blockReason: string | undefined;

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const key = doc.id ?? `doc[${i}]`;

      // Audit-loop fix: once block-all has fired, continue scanning in
      // record-only mode so `subResults` stays index-aligned with the
      // input `docs` array. Telemetry consumers that zip subResults
      // against the original input would otherwise silently misalign.
      if (batchBlocked) {
        subResults.push({
          key,
          result: createResult(true, Severity.INFO, [
            {
              category: 'retrieved_doc_not_scanned',
              severity: Severity.INFO,
              description: 'Doc not scanned: block-all already fired earlier in the batch.',
              weight: 0,
            },
          ]),
        });
        continue;
      }

      const leafResult = await runValidatorChain(
        config.validators,
        doc.content,
        VALIDATOR_ERROR_CATEGORIES.retrievedDoc
      );
      subResults.push({ key, result: leafResult });
      allFindings.push(...leafResult.findings);
      aggregateSeverity = maxSeverity(aggregateSeverity, leafResult.severity);
      aggregateScore += leafResult.risk_score;

      if (!leafResult.blocked) {
        survivingDocs.push(doc);
        continue;
      }

      // Per-doc failure path.
      if (mode === 'block-all') {
        batchBlocked = true;
        // Audit-loop fix: doc ids come from caller-controlled (often
        // attacker-influenced via uploaded RAG content) values. Strip
        // control characters + ANSI escape codes before interpolation
        // into log / error strings so a malicious id can't inject
        // false log lines.
        // eslint-disable-next-line no-control-regex
        const safeKey = key.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 128);
        blockReason = `Blocked by retrieved doc '${safeKey}': ${leafResult.reason ?? 'validation failed'}`;
        logger?.warn('[RetrievedDocValidator] block-all triggered', { key: safeKey, reason: leafResult.reason });
        // Don't break — fall through so the remaining docs get
        // record-only subResults entries.
        continue;
      }
      if (mode === 'redact') {
        filteredCount++;
        const redactedContent = applyRedaction(
          doc.content,
          leafResult.findings,
          config.validators,
          replacement
        );
        survivingDocs.push({ ...doc, content: redactedContent });
        logger?.info('[RetrievedDocValidator] redacted doc', {
          key,
          findings: leafResult.findings.length,
        });
        continue;
      }
      // drop
      filteredCount++;
      logger?.info('[RetrievedDocValidator] dropped doc', {
        key,
        reason: leafResult.reason,
      });
    }

    if (batchBlocked) {
      // block-all: no survivors regardless of what came before.
      return {
        result: {
          allowed: false,
          blocked: true,
          reason: blockReason,
          severity: aggregateSeverity,
          risk_level: riskFromScore(aggregateScore),
          risk_score: aggregateScore,
          findings: allFindings,
          subResults,
          timestamp: Date.now(),
        },
        docs: [],
        filteredCount: docs.length,
      };
    }

    return {
      result: {
        allowed: true,
        blocked: false,
        severity: aggregateSeverity,
        risk_level: riskFromScore(aggregateScore),
        risk_score: aggregateScore,
        findings: allFindings,
        subResults,
        timestamp: Date.now(),
      },
      docs: survivingDocs,
      filteredCount,
    };
  };

  return {
    name: 'RetrievedDocValidator',
    async validate(input: string | ValidatorInput): Promise<GuardrailResult> {
      if (typeof input === 'string' || input.kind !== 'retrieved_docs') {
        // Out-of-shape inputs return a clean allow — the validator is
        // a no-op on inputs it doesn't recognise.
        return createResult(true, Severity.INFO, []);
      }
      const batch = await validateBatch(input.docs);
      return batch.result;
    },
    validateBatch,
  };
}
