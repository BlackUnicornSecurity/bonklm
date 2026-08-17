/**
 * Shared helpers for composite validators
 * =======================================
 * Extracted in Story 1.3 (audit-loop BLOCK fix). Three composite
 * validators — `createToolCallArgsValidator`, `createRetrievedDocValidator`,
 * `createMemoryWriteValidator` — previously carried near-identical copies
 * of these primitives. A single bug fix (e.g. the
 * `f.match === replacement` sentinel skip) had to land in three places
 * or risk silent divergence. This module consolidates them.
 *
 * Public surface:
 *   - {@link RedactingValidator} — capability interface for validators
 *     that own a pattern dictionary and can redact in place
 *     (`SecretGuard.redactContent`, `PIIGuard.redactContent`).
 *   - {@link runValidatorChain} — sequential validator chain with
 *     short-circuit on the first BLOCK + parameterised error category.
 *   - {@link applyRedaction} — capability-driven first pass + Finding.match
 *     substring-replace fallback.
 *   - {@link maxSeverity}, {@link riskFromScore} — severity / risk-level
 *     helpers.
 */
import type { Validator } from '../engine/GuardrailEngine.types.js';
import { createResult, type Finding, type GuardrailResult, RiskLevel, Severity } from '../base/GuardrailResult.js';
import { sanitizeLogString } from '../common/index.js';

/**
 * Cumulative-audit export — the per-composite error-category strings
 * surfaced when an underlying validator throws inside
 * `runValidatorChain`. Previously inlined as literal strings at each
 * call site; exporting as constants lets OTel / SIEM rules key off
 * them stably.
 */
export const VALIDATOR_ERROR_CATEGORIES = {
  toolCallArgs: 'tool_call_args_validator_error',
  retrievedDoc: 'retrieved_doc_validator_error',
  memoryWrite: 'memory_write_validator_error',
  composedContext: 'composed_context_validator_error'
} as const;

export type ValidatorErrorCategory = (typeof VALIDATOR_ERROR_CATEGORIES)[keyof typeof VALIDATOR_ERROR_CATEGORIES];

/**
 * Capability interface for validators that own a pattern dictionary
 * and can apply substring-level redaction on the original content.
 * `SecretGuard` and `PIIGuard` implement this; PromptInjection-style
 * pattern validators that don't mask their `Finding.match` can rely on
 * the fallback substring-replace in {@link applyRedaction}.
 */
export interface RedactingValidator extends Validator {
  redactContent(content: string, replacement: string): string;
}

/** Type-guard for {@link RedactingValidator}. */
export function hasRedactContent(v: Validator): v is RedactingValidator {
  return typeof (v as RedactingValidator).redactContent === 'function';
}

/**
 * Return the higher of two severity values.
 */
export function maxSeverity(a: Severity, b: Severity): Severity {
  const order: Record<Severity, number> = {
    [Severity.INFO]: 0,
    [Severity.WARNING]: 1,
    [Severity.BLOCKED]: 2,
    [Severity.CRITICAL]: 3
  };
  return order[b] > order[a] ? b : a;
}

/**
 * Map cumulative `risk_score` to a `RiskLevel`.
 */
export function riskFromScore(score: number): RiskLevel {
  if (score >= 25) return RiskLevel.HIGH;
  if (score >= 10) return RiskLevel.MEDIUM;
  return RiskLevel.LOW;
}

/**
 * Run a sequential validator chain. Short-circuits on the first BLOCK
 * so downstream validators don't see content that an earlier validator
 * already refused. Caught throws surface as a CRITICAL finding with the
 * supplied `errorCategory` so the caller can correlate the chain error
 * back to the composite that ran it.
 */
export async function runValidatorChain(
  validators: Validator[],
  content: string,
  errorCategory: string
): Promise<GuardrailResult> {
  let merged: GuardrailResult = createResult(true, Severity.INFO, []);
  for (const v of validators) {
    let r: GuardrailResult;
    try {
      r = await v.validate(content);
    } catch (err) {
      r = createResult(false, Severity.CRITICAL, [
        {
          category: errorCategory,
          severity: Severity.CRITICAL,
          // CWE-117 (ADR-0001): a thrown error can carry attacker-influenced
          // bytes (validator-processed connector content); this synthetic finding
          // description flows into the returned result, so sanitize before embed.
          description: `Underlying validator threw: ${sanitizeLogString(String(err))}`,
          weight: 25
        }
      ]);
    }
    const nextScore = merged.risk_score + r.risk_score;
    merged = {
      ...merged,
      allowed: merged.allowed && r.allowed,
      blocked: merged.blocked || r.blocked,
      // Prefer the blocking validator's reason.
      reason: r.blocked ? r.reason : merged.reason,
      severity: maxSeverity(merged.severity, r.severity),
      findings: [...merged.findings, ...r.findings],
      risk_score: nextScore,
      risk_level: riskFromScore(nextScore)
    };
    if (r.blocked) break;
  }
  return merged;
}

/**
 * Apply redact-mode substitution to `content`.
 *
 * Two complementary mechanisms:
 *   1. Capability-driven: validators implementing
 *      {@link RedactingValidator} redact their own matched regions.
 *      This is the only correct path for validators that mask their
 *      `Finding.match` (SecretGuard, PIIGuard).
 *   2. Fallback substring-replace on each `Finding.match` for
 *      validators that don't opt into capability-based redaction.
 *      Skipped when the match is empty or equals the replacement
 *      (no-op).
 */
export function applyRedaction(
  content: string,
  findings: Finding[],
  validators: Validator[],
  replacement: string
): string {
  let redacted = content;

  for (const v of validators) {
    if (hasRedactContent(v)) {
      redacted = v.redactContent(redacted, replacement);
    }
  }

  for (const f of findings) {
    if (!f.match || f.match.length === 0) continue;
    if (f.match === replacement) continue;
    redacted = redacted.split(f.match).join(replacement);
  }
  return redacted;
}
