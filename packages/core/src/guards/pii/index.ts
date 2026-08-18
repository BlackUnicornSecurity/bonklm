/**
 * BonkLM - PII Guard
 * ============================
 * Detects and blocks Personally Identifiable Information (PII) in content.
 *
 * Features:
 * - US patterns: SSN, phone, driver's license, passport, Medicare, ITIN
 * - EU patterns: IBAN, NINO, NHS, tax IDs, national IDs (18 countries)
 * - Common patterns: Credit cards, email, IP, DOB, MAC address
 * - Algorithmic validators: Luhn, IBAN MOD-97, NHS MOD-11, etc.
 * - Context detection for reducing false positives
 * - Test file and fake data exclusion
 */

import { createResult, Severity as Sev } from '../../base/GuardrailResult.js';
import { mergeConfig, type ValidatorConfig } from '../../base/ValidatorConfig.js';
import { normalizeText } from '../../validators/text-normalizer.js';
import {
  ALL_PATTERNS,
  FAKE_DATA_INDICATORS,
  type PiiSeverity,
  SENSITIVE_CONTEXT_PATTERNS,
  TEST_FILE_INDICATORS
} from './patterns.js';
import { redactInSinglePass, redactPIIValue } from './validators.js';

// ============================================================================
// TYPES
// =============================================================================

export interface PIIGuardConfig extends ValidatorConfig {
  /**
   * File path to check (for test file detection)
   */
  filePath?: string;

  /**
   * Enable test file bypass
   */
  allowTestFiles?: boolean;

  /**
   * Minimum severity level to trigger blocking
   */
  minSeverity?: PiiSeverity;
}

export interface PiiDetection {
  patternName: string;
  match: string;
  line: string;
  lineNumber: number;
  severity: PiiSeverity;
}

// ============================================================================
// CONTEXT DETECTION
// ============================================================================

/**
 * Check if a file path indicates a test/mock data file.
 */
export function isTestFile(filePath: string | undefined): boolean {
  if (!filePath) return false;

  const pathLower = filePath.toLowerCase();
  return TEST_FILE_INDICATORS.some(indicator => pathLower.includes(indicator));
}

/**
 * Check if the content/line is in a sensitive context.
 *
 * @param patterns - Context patterns to scan for. Defaults to the broad
 *   {@link SENSITIVE_CONTEXT_PATTERNS}; a pattern can pass a narrower,
 *   domain-specific set (e.g. banking context for BIC_SWIFT) via
 *   {@link PiiPattern.contextPatterns}.
 */
export function isSensitiveContext(
  content: string,
  line: string,
  patterns: RegExp[] = SENSITIVE_CONTEXT_PATTERNS
): boolean {
  // Check the line itself
  for (const pattern of patterns) {
    if (pattern.test(line)) {
      return true;
    }
  }

  // Check surrounding context (5 lines before and after)
  const lines = content.split('\n');
  const lineIndex = lines.findIndex(l => l.includes(line.trim()));

  if (lineIndex !== -1) {
    const start = Math.max(0, lineIndex - 5);
    const end = Math.min(lines.length, lineIndex + 6);
    const context = lines.slice(start, end).join('\n');

    for (const pattern of patterns) {
      if (pattern.test(context)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if content around a match indicates fake/test data.
 */
export function isFakeData(content: string, line: string): boolean {
  // Check the line itself
  for (const pattern of FAKE_DATA_INDICATORS) {
    if (pattern.test(line)) {
      return true;
    }
  }

  // Check surrounding context (3 lines before and after)
  const lines = content.split('\n');
  const lineIndex = lines.findIndex(l => l.includes(line.trim()));

  if (lineIndex !== -1) {
    const start = Math.max(0, lineIndex - 3);
    const end = Math.min(lines.length, lineIndex + 4);
    const context = lines.slice(start, end).join('\n');

    for (const pattern of FAKE_DATA_INDICATORS) {
      if (pattern.test(context)) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// PII DETECTION
// ============================================================================

/**
 * Detect PII in content.
 *
 * Cumulative-audit fix (closes Story 1.2-class homoglyph bypass for PII):
 * normalises the input via `normalizeText` BEFORE pattern matching so
 * homoglyph-mangled SSN / email / etc. (e.g. Cyrillic confusables,
 * combining marks, fullwidth chars) get caught the same way the
 * normalised form does. Mirrors `SecretGuard.detect`'s normalisation
 * (see `guards/secret.ts:148`).
 */
export function detectPii(content: string): PiiDetection[] {
  const detections: PiiDetection[] = [];
  // Normalise before splitting so line indices map to the normalised form
  // (consistent with the matchText that detection reports).
  content = normalizeText(content);
  const lines = content.split('\n');

  for (const piiPattern of ALL_PATTERNS) {
    // Reset regex state
    piiPattern.regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = piiPattern.regex.exec(content)) !== null) {
      const matchText = match[0];

      // Find which line this match is on
      let charCount = 0;
      let lineNumber = 0;
      let matchLine = '';

      for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i].length + 1; // +1 for newline
        if (charCount + lineLength > match.index) {
          lineNumber = i + 1;
          matchLine = lines[i]!;
          break;
        }
        charCount += lineLength;
      }

      // Run validator if one exists
      if (piiPattern.validator) {
        if (!piiPattern.validator(matchText)) {
          continue; // Skip invalid matches
        }
      }

      // Check context requirement
      if (piiPattern.contextRequired) {
        if (!isSensitiveContext(content, matchLine, piiPattern.contextPatterns)) {
          continue; // Skip matches not in sensitive context
        }
      }

      // Check for fake/test data
      if (isFakeData(content, matchLine)) {
        continue; // Skip fake data
      }

      // Redact the match value for safer in-memory storage
      const redactedMatch = piiPattern.redactionMask || redactPIIValue(matchText, piiPattern.name);

      detections.push({
        patternName: piiPattern.name,
        match: redactedMatch.slice(0, 20) + (redactedMatch.length > 20 ? '...' : ''),
        line: matchLine.trim().slice(0, 80),
        lineNumber,
        severity: piiPattern.severity
      });
    }
  }

  return detections;
}

// ============================================================================
// GUARD CLASS
// ============================================================================

export class PIIGuard {
  private readonly config: Required<Omit<PIIGuardConfig, 'filePath'>> & { filePath?: string };

  constructor(config?: PIIGuardConfig) {
    this.config = {
      ...mergeConfig(config),
      filePath: config?.filePath,
      allowTestFiles: config?.allowTestFiles ?? true,
      minSeverity: config?.minSeverity ?? 'warning'
    } as Required<Omit<PIIGuardConfig, 'filePath'>> & { filePath?: string };
  }

  /**
   * Validate content for PII
   */
  validate(content: string, filePath?: string): import('../../base/GuardrailResult.js').GuardrailResult {
    if (!content || content.trim().length === 0) {
      return createResult(true, Sev.INFO, []);
    }

    const effectiveFilePath = filePath ?? this.config.filePath;

    // Check if this is a test file
    if (this.config.allowTestFiles && isTestFile(effectiveFilePath)) {
      return createResult(true, Sev.INFO, [
        {
          category: 'pii_guard',
          description: 'Test/mock data file bypassed',
          severity: Sev.INFO,
          weight: 0
        }
      ]);
    }

    // Detect PII
    const detections = detectPii(content);

    if (detections.length === 0) {
      return createResult(true, Sev.INFO, []);
    }

    // Separate by severity
    const criticalPii = detections.filter(d => d.severity === 'critical');
    const warningPii = detections.filter(d => d.severity === 'warning');
    const infoPii = detections.filter(d => d.severity === 'info');

    // If only info-level PII, allow with log
    if (criticalPii.length === 0 && warningPii.length === 0) {
      return createResult(true, Sev.INFO, [
        {
          category: 'pii_guard',
          description: `Only info-level PII detected: ${infoPii.length} finding(s)`,
          severity: Sev.INFO,
          weight: 1
        }
      ]);
    }

    // Build findings
    const severityOrder: Record<PiiSeverity, number> = { critical: 3, warning: 2, info: 1 };
    const minSeverityOrder = severityOrder[this.config.minSeverity] ?? 2;

    const findings = detections
      .filter(d => severityOrder[d.severity] >= minSeverityOrder)
      .slice(0, 10)
      .map(d => ({
        category: 'pii_detected',
        pattern_name: d.patternName,
        severity: d.severity === 'critical' ? Sev.CRITICAL : d.severity === 'warning' ? Sev.WARNING : Sev.INFO,
        match: d.match,
        description: `${d.patternName} at line ${d.lineNumber}: "${d.match}"`,
        line_number: d.lineNumber,
        weight: d.severity === 'critical' ? 20 : d.severity === 'warning' ? 10 : 1
      }));

    const hasCritical = criticalPii.length > 0;
    const shouldBlock = this.config.action === 'block' && findings.length > 0;

    return createResult(!shouldBlock, hasCritical ? Sev.CRITICAL : Sev.WARNING, findings);
  }

  /**
   * Get detected PII in content
   */
  detect(content: string): PiiDetection[] {
    return detectPii(content);
  }

  /**
   * redact PII in place.
   *
   * `Finding.match` carries a *pre-redacted* form (e.g. `***-**-****`
   * for SSN, `j****@example.com` for email) so PII findings don't
   * carry the raw value through telemetry. That makes the standard
   * "substring-replace Finding.match" path in
   * `createRetrievedDocValidator` / `createMemoryWriteValidator`
   * INCAPABLE of redacting PII from the original content — the doc
   * contains the raw value, not the mask.
   *
   * `redactContent` re-runs the same pattern set against the input and
   * replaces each match with `replacement`, in a single cascade-proof pass
   * (see {@link redactInSinglePass}): text inserted by one pattern is never
   * re-scanned by a later one, so the literal `REDACTED` inside a `[REDACTED]`
   * token can no longer be re-matched by the loose BIC/SWIFT shape into
   * `[[REDACTED]]`. `replacement` is applied as a literal string, so
   * caller-supplied `$1` / `$&` / `$<name>` are never interpolated as regex
   * backreferences.
   *
   * Patterns marked `contextRequired: true` (US_Phone, IBAN-like, etc.)
   * are STILL applied here — we cannot afford to leave PII unredacted
   * inside a `redact`-mode flow even if `detect()` wouldn't surface it
   * outside a sensitive context. For the same fail-safe reason, per-pattern
   * `validator`s (Luhn, BIC country-code, etc.) are intentionally NOT run here:
   * redaction is deliberately over-inclusive, so a token `detect()` would
   * reject (e.g. an uppercase word matching the loose BIC shape) is still masked
   * rather than risk leaving real PII in the content.
   *
   * **Normalisation parity** (cumulative-audit BLOCK fix): `detect()`
   * applies `normalizeText` so homoglyph-mangled PII is caught. This
   * method MUST apply the same normalisation OR the homoglyph-mangled
   * PII would pass detect (which routed into redact mode) but slip
   * through this raw-string scan — same bug class as the Story 1.2
   * SecretGuard fix. Returning the normalised + redacted form is the
   * correct behaviour for RAG content reaching an LLM (the LLM sees
   * the same normalised characters anyway).
   *
   * @param content     - Original content to redact.
   * @param replacement - Substitution string. @default '[REDACTED]'
   * @returns The content with each PII match replaced (and the text
   *   normalised — see note above).
   */
  redactContent(content: string, replacement: string = '[REDACTED]'): string {
    if (!content) return content;
    const normalized = normalizeText(content);
    return redactInSinglePass(normalized, ALL_PATTERNS, () => replacement);
  }

  /**
   * Get the guard's configuration
   */
  getConfig(): PIIGuardConfig {
    return { ...this.config };
  }
}

// =============================================================================
// CONVENIENCE FUNCTION
// =============================================================================

/**
 * Quick PII check.
 * @param content - Content to check
 * @param filePath - Optional file path for test file detection
 * @returns Validation result
 */
export function checkPII(content: string, filePath?: string): import('../../base/GuardrailResult.js').GuardrailResult {
  const guard = new PIIGuard();
  return guard.validate(content, filePath);
}

// Re-export for external use
export * from './validators.js';
export * from './patterns.js';
