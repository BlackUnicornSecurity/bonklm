/**
 * BonkLM - Prompt Injection Validator
 * =============================================
 * Detects attempts to manipulate AI agent behavior through injected instructions.
 *
 * Features:
 * - Multi-layer pattern-based detection (multi-category pattern catalogue, see pattern-engine.ts)
 * - Unicode normalization and obfuscation detection
 * - Base64 payload detection
 * - Multi-layer encoding detection
 * - HTML comment injection detection
 */

import { createResult, Finding, type GuardrailResult, RiskLevel, Severity } from '../base/GuardrailResult.js';
import type { PromptInjectionConfig, ValidatorConfig } from '../base/ValidatorConfig.js';
import { createLogger, type Logger } from '../base/GenericLogger.js';
import {
  collapseIntraWordLineBreaks,
  containsNonAscii,
  detectHiddenUnicode,
  normalizeText,
  type UnicodeFinding
} from './text-normalizer.js';
import { detectPatterns, detectPatternsConcatenated, type PatternFinding } from './pattern-engine.js';
// Story 2.1: edge-portable codecs replace `Buffer.from(..., 'base64'|'hex')`
// so the prompt-injection scanner runs identically on Node, Workerd,
// Deno, and Bun via the `@blackunicorn/bonklm/edge` subpath.
import { base64DecodeToUtf8, hexDecodeToUtf8 } from '../common/edge-codec.js';

const DEFAULT_CONFIG: Required<
  Pick<
    PromptInjectionConfig,
    'detectMultiLayerEncoding' | 'detectBase64Payloads' | 'detectHtmlComments' | 'maxDecodeDepth'
  >
> = {
  detectMultiLayerEncoding: true,
  detectBase64Payloads: true,
  detectHtmlComments: true,
  maxDecodeDepth: 3 // Reduced from 5 to prevent potential infinite loops
};

/**
 * Base64 finding.
 */
export interface Base64Finding {
  category: string;
  severity: Severity;
  match_preview: string;
  decoded_preview?: string;
  description: string;
  contains_injection: boolean;
}

/**
 * Multi-layer encoding finding.
 */
export interface MultiLayerEncodingFinding {
  category: string;
  severity: Severity;
  encoding_layers: string[];
  original_encoded: string;
  final_decoded: string;
  description: string;
  contains_injection: boolean;
  decode_depth: number;
}

/**
 * HTML comment finding.
 */
export interface HtmlCommentFinding {
  category: string;
  severity: Severity;
  comment_preview: string;
  description: string;
}

/**
 * Complete analysis result.
 */
export interface PromptInjectionAnalysisResult {
  findings: PatternFinding[];
  unicode_findings: UnicodeFinding[];
  base64_findings: Base64Finding[];
  html_findings: HtmlCommentFinding[];
  multi_layer_findings: MultiLayerEncodingFinding[];
  highest_severity: Severity;
  should_block: boolean;
}

/**
 * Maximum decoding depth to prevent infinite loops.
 * Increased from 3 to 5 to detect more sophisticated encoding attacks
 * while maintaining loop protection via MAX_ITERATIONS.
 */
const MAX_DECODE_DEPTH = 5;

/**
 * Minimum content length to attempt decoding.
 */
const MIN_DECODE_LENGTH = 20;

/**
 * Maximum input length to prevent DoS attacks on large inputs.
 */
const MAX_INPUT_LENGTH = 100_000;

/**
 * Wall-clock time budget (ms) for each regex-scan phase.
 *
 * B.1 / ST-05-101 — CWE-1333 defence:
 * Regex patterns /[A-Za-z0-9+/]{40,}={0,2}/g and /(?:0x)?[0-9A-Fa-f]{40,}/g
 * can exhibit catastrophic backtracking on near-base64 inputs (e.g. 60 chars of
 * 'A' followed by a non-base64 terminator). MAX_INPUT_LENGTH = 100_000 truncates
 * the outer input but does not bound how many regex match iterations run on the
 * accepted portion.
 *
 * Defence approach: time-budget check between match iterations inside
 * detectMultiLayerEncoding and detectBase64Payloads. If total elapsed wall-clock
 * exceeds this budget the scan loop breaks early, returning whatever findings
 * were accumulated up to that point (fail-safe: partial results, not crash or
 * infinite spin). 500 ms is the acceptance-criterion ceiling from ST-05-101; real
 * inputs finish in <20 ms at 100 K chars so this provides a 25x safety margin.
 */
const REGEX_SCAN_BUDGET_MS = 500;

/**
 * How often (in regex match iterations) to check Date.now() inside scan loops.
 * Every-iteration checks are accurate but add syscall overhead at high counts.
 * 256 is a power-of-two so the modulo check compiles to a bitwise AND.
 */
const BUDGET_CHECK_INTERVAL = 256;

/**
 * Detect and iteratively decode multi-layer encoded content.
 */
function detectMultiLayerEncoding(content: string, maxDepth: number = MAX_DECODE_DEPTH): MultiLayerEncodingFinding[] {
  const findings: MultiLayerEncodingFinding[] = [];

  const encodingPatterns = [
    { name: 'base64', pattern: /[A-Za-z0-9+/]{40,}={0,2}/g },
    { name: 'url_encoded', pattern: /%[0-9A-Fa-f]{2}(?:%[0-9A-Fa-f]{2}){10,}/g },
    { name: 'hex_encoded', pattern: /(?:0x)?[0-9A-Fa-f]{40,}/g },
    { name: 'unicode_escape', pattern: /(?:\\u[0-9A-Fa-f]{4}){10,}/g },
    { name: 'javascript_escape', pattern: /(?:\\x[0-9A-Fa-f]{2}|\\n|\\r|\\t|\\0){10,}/g }
  ];

  // B.1 time-budget: shared across all patterns in this call.
  const scanStart = Date.now();
  let totalIterations = 0;
  let budgetExceeded = false;

  for (const encodingPattern of encodingPatterns) {
    if (budgetExceeded) break;

    let match: RegExpExecArray | null;
    encodingPattern.pattern.lastIndex = 0;

    while ((match = encodingPattern.pattern.exec(content)) !== null) {
      // Sample wall-clock every BUDGET_CHECK_INTERVAL match iterations.
      totalIterations++;
      if ((totalIterations & (BUDGET_CHECK_INTERVAL - 1)) === 0) {
        if (Date.now() - scanStart > REGEX_SCAN_BUDGET_MS) {
          budgetExceeded = true;
          break;
        }
      }
      const encodedText = match[0];

      if (encodedText.length < MIN_DECODE_LENGTH) {
        continue;
      }

      // Scope the loop-detection Set per-match. Sharing one Set across all
      // patterns let an attacker neutralise a later malicious payload by
      // priming it with a benign earlier base64 that shares a decode prefix
      // (the second match would short-circuit with LOOP_DETECTED).
      const processedInputs = new Set<string>();
      const result = iterativeDecode(encodedText, processedInputs, maxDepth);

      if (result.decodeLayers.length > 1) {
        // Run the full pattern suite on the decoded payload. Filter to WARNING+
        // so low-signal INFO patterns (e.g. priority_markers) don't escalate the
        // multi-layer finding to CRITICAL on benign content.
        const decodedFindings = detectPatterns(result.finalDecoded);
        const containsInjection = decodedFindings.some(
          f => f.severity === Severity.WARNING || f.severity === Severity.CRITICAL
        );

        findings.push({
          category: 'multi_layer_encoding',
          severity: containsInjection ? Severity.CRITICAL : Severity.WARNING,
          encoding_layers: result.decodeLayers,
          original_encoded: encodedText.slice(0, 50) + (encodedText.length > 50 ? '...' : ''),
          final_decoded: result.finalDecoded.slice(0, 100) + (result.finalDecoded.length > 100 ? '...' : ''),
          description: `Multi-layer encoded content detected (${result.decodeLayers.length} layers: ${result.decodeLayers.join(' → ')})`,
          contains_injection: containsInjection,
          decode_depth: result.decodeLayers.length
        });
      }
    }
  }

  return findings;
}

/**
 * Iteratively decode content with loop detection.
 */
function iterativeDecode(
  input: string,
  processedInputs: Set<string>,
  maxDepth: number
): {
  decodeLayers: string[];
  finalDecoded: string;
} {
  const decodeLayers: string[] = [];
  let currentContent = input;
  let depth = 0;
  let iterations = 0;
  const MAX_ITERATIONS = maxDepth * 2 + 5; // Hard limit to prevent crafted encoding loops

  while (depth < maxDepth && iterations < MAX_ITERATIONS) {
    iterations++;

    if (processedInputs.has(currentContent)) {
      decodeLayers.push('LOOP_DETECTED');
      break;
    }
    processedInputs.add(currentContent);

    const decoded = attemptDecode(currentContent);
    if (!decoded || decoded.result === currentContent) {
      break;
    }

    decodeLayers.push(decoded.method);
    currentContent = decoded.result;
    depth++;

    const printableRatio = (currentContent.match(/[\x20-\x7e\n\r\t]/g) || []).length / currentContent.length;
    if (printableRatio < 0.75) {
      break;
    }
  }

  return {
    decodeLayers,
    finalDecoded: currentContent
  };
}

/**
 * Attempt to decode content using various methods.
 */
function attemptDecode(content: string): { method: string; result: string } | null {
  if (/^[A-Za-z0-9+/]+=*$/.test(content)) {
    const decoded = base64DecodeToUtf8(content);
    if (decoded !== content && decoded.length > 0) {
      return { method: 'base64', result: decoded };
    }
  }

  if (/%[0-9A-Fa-f]{2}/.test(content)) {
    try {
      const decoded = decodeURIComponent(content);
      if (decoded !== content) {
        return { method: 'url', result: decoded };
      }
    } catch {
      // Not valid URL encoding
    }
  }

  if (/^(?:0x)?[0-9A-Fa-f]+$/.test(content)) {
    const hexContent = content.replace(/^0x/, '');
    if (hexContent.length % 2 === 0) {
      const decoded = hexDecodeToUtf8(hexContent);
      if (decoded !== content && decoded.length > 0) {
        return { method: 'hex', result: decoded };
      }
    }
  }

  if (/\\u[0-9A-Fa-f]{4}/.test(content)) {
    try {
      const decoded = content.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      if (decoded !== content) {
        return { method: 'unicode_escape', result: decoded };
      }
    } catch {
      // Not valid unicode escapes
    }
  }

  // JavaScript escape sequences (\xHH, \n, \r, \t, \0)
  if (/\\x[0-9A-Fa-f]{2}|\\n|\\r|\\t|\\0/.test(content)) {
    try {
      let decoded = content;
      // Decode \xHH sequences
      decoded = decoded.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      // Decode common escapes
      decoded = decoded.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\0/g, '\0');
      if (decoded !== content) {
        return { method: 'javascript_escape', result: decoded };
      }
    } catch {
      // Not valid JavaScript escapes
    }
  }

  return null;
}

/**
 * Detect base64 encoded payloads.
 *
 * B.1 time-budget: same REGEX_SCAN_BUDGET_MS / BUDGET_CHECK_INTERVAL guard
 * as detectMultiLayerEncoding — early exit if pattern matching spins.
 */
function detectBase64Payloads(text: string): Base64Finding[] {
  const findings: Base64Finding[] = [];
  const base64Pattern = /[A-Za-z0-9+/]{40,}={0,2}/g;
  let match;

  const scanStart = Date.now();
  let iterations = 0;

  while ((match = base64Pattern.exec(text)) !== null) {
    iterations++;
    if ((iterations & (BUDGET_CHECK_INTERVAL - 1)) === 0) {
      if (Date.now() - scanStart > REGEX_SCAN_BUDGET_MS) break;
    }

    const potentialBase64 = match[0];

    try {
      const decoded = base64DecodeToUtf8(potentialBase64);
      if (decoded.length === 0) continue;
      const printableRatio = (decoded.match(/[\x20-\x7e\n\r\t]/g) || []).length / decoded.length;
      if (printableRatio < 0.85) {
        continue;
      }

      // Run the full pattern suite on the decoded payload. Filter to WARNING+
      // so low-signal INFO patterns don't escalate the base64 finding to CRITICAL.
      const decodedFindings = detectPatterns(decoded);
      const containsInjection = decodedFindings.some(
        f => f.severity === Severity.WARNING || f.severity === Severity.CRITICAL
      );

      findings.push({
        category: 'base64_payload',
        severity: containsInjection ? Severity.CRITICAL : Severity.WARNING,
        match_preview: `${potentialBase64.slice(0, 30)}...`,
        decoded_preview: decoded.slice(0, 50) + (decoded.length > 50 ? '...' : ''),
        description: containsInjection
          ? 'Base64 encoded content contains injection patterns'
          : 'Base64 encoded content detected',
        contains_injection: containsInjection
      });
    } catch {
      // Not valid base64, ignore
    }
  }

  return findings;
}

/**
 * Detect injection patterns in HTML comments.
 *
 * ReDoS guard: the previous regex `/<!--([\s\S]*?)-->/g`
 * exhibited O(n^2) quadratic backtracking on inputs composed of many `<!--`
 * tokens with no closing `-->`.  Benchmark: 100 KB → 838 ms (pre-fix),
 * 0.4 ms (post-fix).  Replaced with a plain-string `indexOf` scanner that
 * is O(n) regardless of input shape.  Semantics are identical: only the
 * content between a matched `<!--` / `-->` pair is inspected; an unclosed
 * opener is ignored (no findings produced, consistent with prior behaviour).
 *
 * CWE-1333 mitigation.
 */
function detectHtmlCommentInjection(text: string): HtmlCommentFinding[] {
  const findings: HtmlCommentFinding[] = [];

  let searchFrom = 0;
  while (searchFrom < text.length) {
    const openPos = text.indexOf('<!--', searchFrom);
    if (openPos === -1) break;

    const closePos = text.indexOf('-->', openPos + 4);
    if (closePos === -1) break; // Unclosed opener — stop scanning

    const commentContent = text.slice(openPos + 4, closePos);

    if (/ignore|override|bypass|disable|instructions?/i.test(commentContent)) {
      findings.push({
        category: 'html_comment_injection',
        severity: Severity.WARNING,
        comment_preview: commentContent.slice(0, 50) + (commentContent.length > 50 ? '...' : ''),
        description: 'HTML comment contains injection patterns'
      });
      break; // First hit is sufficient
    }

    searchFrom = closePos + 3;
  }

  return findings;
}

/**
 * Prompt Injection Validator class.
 *
 * @public v1.0-RC1 API freeze. `name = 'prompt-injection'`
 * is frozen (cache keys depend on it). Pattern catalogue is `@internal`
 * — new patterns ship in minor versions, refinement of an existing
 * pattern is patch-level. `validate()` signature inherits from
 * `Validator`.
 */
export class PromptInjectionValidator {
  /**
   * Stable validator name. Required for `cachedValidate` (rejects
   * validators with empty/missing name per Story 2.7 B2 closure —
   * constructor.name is minify-unsafe).
   */
  readonly name = 'prompt-injection';
  private readonly config: Required<PromptInjectionConfig> & ValidatorConfig;
  private readonly logger: Logger;

  constructor(config: PromptInjectionConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, includeFindings: true, ...config } as Required<PromptInjectionConfig> &
      ValidatorConfig;
    this.logger = this.config.logger ?? createLogger('console', this.config.logLevel);
  }

  /**
   * Analyze content for prompt injection attempts.
   */
  analyze(content: string): PromptInjectionAnalysisResult {
    if (!content || content.trim().length === 0) {
      return {
        findings: [],
        unicode_findings: [],
        base64_findings: [],
        html_findings: [],
        multi_layer_findings: [],
        highest_severity: Severity.INFO,
        should_block: false
      };
    }

    // Prevent DoS attacks with extremely large inputs
    if (content.length > MAX_INPUT_LENGTH) {
      return {
        findings: [
          {
            category: 'input_too_large',
            pattern_name: 'size_limit_exceeded',
            severity: Severity.WARNING,
            match: `Input length ${content.length} exceeds maximum ${MAX_INPUT_LENGTH}`,
            description: 'Input too large to process safely',
            line_number: 1
          }
        ],
        unicode_findings: [],
        base64_findings: [],
        html_findings: [],
        multi_layer_findings: [],
        highest_severity: Severity.WARNING,
        should_block: false
      };
    }

    // Detection runs on BOTH the line-preserved normalization AND a copy
    // with mid-word line-break splits closed (`prev\nious` → `previous`).
    // Word-boundary wraps ("all\nprevious") rely on the line-preserved
    // copy (`\s+` phrase separators match newlines); mid-word split
    // evasions are only visible on the collapsed copy. Union, deduped
    // by pattern name.
    const linePreserved = normalizeText(content);
    const obfuscationDetected = linePreserved.length < content.length * 0.85;
    // Genuine unicode obfuscation requires actual non-ASCII characters (homoglyphs,
    // zero-width, control). Whitespace-heavy plain-ASCII content (e.g. pretty-printed JSON)
    // also shrinks >15% during normalization but is NOT obfuscated — don't flag it.
    const hasNonAscii = containsNonAscii(content);

    const collapsedContent = collapseIntraWordLineBreaks(linePreserved);
    const findings = detectPatterns(collapsedContent);
    if (collapsedContent !== linePreserved) {
      const lineFindings = detectPatterns(linePreserved);
      const seenNames = new Set(findings.map(f => f.pattern_name));
      for (const finding of lineFindings) {
        if (!seenNames.has(finding.pattern_name)) {
          findings.push(finding);
        }
      }
    }
    // Third scan: fully-concatenated copy × whitespace-stripped phrase
    // patterns — closes mid-word whitespace evasions (`prev\tious`,
    // U+2028 splits) regardless of which whitespace `normalizeText`
    // folded to a plain space. Deduped by base pattern name.
    {
      const concatFindings = detectPatternsConcatenated(linePreserved);
      const seenNames = new Set(findings.map(f => f.pattern_name.replace(/^concat_/, '')));
      for (const finding of concatFindings) {
        if (!seenNames.has(finding.pattern_name.replace(/^concat_/, ''))) {
          findings.push(finding);
        }
      }
    }

    if (obfuscationDetected) {
      const originalFindings = detectPatterns(content);
      // Dedupe on the BASE name (concat_ prefix stripped) so a pattern
      // matched on both the original and concatenated copies yields a
      // single finding.
      const existingNames = new Set(findings.map(f => f.pattern_name.replace(/^concat_/, '')));
      for (const finding of originalFindings) {
        if (!existingNames.has(finding.pattern_name.replace(/^concat_/, ''))) {
          findings.push(finding);
        }
      }

      if (hasNonAscii) {
        findings.push({
          category: 'unicode_obfuscation',
          pattern_name: 'heavy_obfuscation',
          severity: Severity.WARNING,
          match: 'Heavy Unicode obfuscation detected',
          description: 'Heavy Unicode obfuscation detected - text was significantly altered during normalization',
          line_number: 1
        });
      }
    }

    // Scan RAW content (not normalizedContent): normalizeText intentionally does not strip the
    // Plane-14 Tags block, so the smuggled characters must be read here before any normalization.
    const unicodeFindings = detectHiddenUnicode(content);
    const base64Findings = this.config.detectBase64Payloads ? detectBase64Payloads(content) : [];
    const htmlFindings = this.config.detectHtmlComments ? detectHtmlCommentInjection(content) : [];
    const multiLayerFindings = this.config.detectMultiLayerEncoding
      ? detectMultiLayerEncoding(content, this.config.maxDecodeDepth)
      : [];

    const allSeverities: Severity[] = [
      ...findings.map(f => f.severity),
      ...unicodeFindings.map(f => f.severity),
      ...base64Findings.map(f => f.severity),
      ...htmlFindings.map(f => f.severity),
      ...multiLayerFindings.map(f => f.severity)
    ];

    const severityOrder: Record<Severity, number> = {
      [Severity.INFO]: 0,
      [Severity.WARNING]: 1,
      [Severity.BLOCKED]: 2,
      [Severity.CRITICAL]: 3
    };

    let highestSeverity: Severity = Severity.INFO;
    for (const severity of allSeverities) {
      if (severityOrder[severity] > severityOrder[highestSeverity]) {
        highestSeverity = severity;
      }
    }

    // Cumulative-audit refactor: tripwire-style patterns (web3
    // preference-setting + any future WARN-only category) opt out of
    // auto-blocking via `PatternDefinition.blockEligible: false`.
    // `detectPatterns` propagates the flag onto each `PatternFinding`
    // as `f.blockEligible`. Findings default to block-eligible when the
    // flag is omitted. Non-pattern findings (unicode, base64, html,
    // multi-layer) are always block-eligible — they have no
    // PatternDefinition to opt out from.
    //
    // Previously this was a hardcoded category-string check
    // (`f.category !== 'web3_preference_setting'`). Generalised so
    // future categories opt in without modifying this file.
    const blockEligibleSeverities: Severity[] = [
      ...findings.filter(f => f.blockEligible !== false).map(f => f.severity),
      ...unicodeFindings.map(f => f.severity),
      ...base64Findings.map(f => f.severity),
      ...htmlFindings.map(f => f.severity),
      ...multiLayerFindings.map(f => f.severity)
    ];
    let blockEligibleSeverity: Severity = Severity.INFO;
    for (const s of blockEligibleSeverities) {
      if (severityOrder[s] > severityOrder[blockEligibleSeverity]) {
        blockEligibleSeverity = s;
      }
    }
    const shouldBlock = blockEligibleSeverity === Severity.WARNING || blockEligibleSeverity === Severity.CRITICAL;

    return {
      findings,
      unicode_findings: unicodeFindings,
      base64_findings: base64Findings,
      html_findings: htmlFindings,
      multi_layer_findings: multiLayerFindings,
      highest_severity: highestSeverity,
      should_block: shouldBlock
    };
  }

  /**
   * Validate content for prompt injection.
   */
  validate(content: string): GuardrailResult {
    const result = this.analyze(content);

    const allFindings: Finding[] = [
      ...result.findings.map(f => ({
        category: f.category,
        pattern_name: f.pattern_name,
        severity: f.severity,
        match: f.match,
        description: f.description,
        line_number: f.line_number,
        weight: f.severity === Severity.CRITICAL ? 10 : f.severity === Severity.WARNING ? 5 : 1
      })),
      ...result.unicode_findings.map(f => ({
        category: f.category,
        severity: f.severity,
        description: f.description,
        weight: f.severity === Severity.CRITICAL ? 10 : 5
      })),
      ...result.base64_findings.map(f => ({
        category: f.category,
        severity: f.severity,
        description: f.description,
        weight: f.contains_injection ? 10 : 3
      })),
      ...result.html_findings.map(f => ({
        category: f.category,
        severity: f.severity,
        description: f.description,
        weight: 5
      })),
      ...result.multi_layer_findings.map(f => ({
        category: f.category,
        severity: f.severity,
        description: f.description,
        weight: f.contains_injection ? 10 : 5
      }))
    ];

    const riskScore = allFindings.reduce((sum, f) => sum + (f.weight ?? 1), 0);

    let riskLevel: RiskLevel = RiskLevel.LOW;
    if (riskScore >= 30) {
      riskLevel = RiskLevel.HIGH;
    } else if (riskScore >= 15) {
      riskLevel = RiskLevel.MEDIUM;
    }

    const allowed = !result.should_block;

    if (allFindings.length > 0) {
      this.logger.warn('Prompt injection patterns detected', {
        findings_count: allFindings.length,
        highest_severity: result.highest_severity,
        risk_score: riskScore,
        risk_level: riskLevel,
        blocked: !allowed
      });
    }

    return createResult(allowed, result.highest_severity, this.config.includeFindings ? allFindings : []);
  }
}

/**
 * Convenience function to validate content.
 */
export function validatePromptInjection(content: string, config?: PromptInjectionConfig): GuardrailResult {
  const validator = new PromptInjectionValidator(config);
  return validator.validate(content);
}

/**
 * Convenience function to analyze content.
 */
export function analyzePromptInjection(content: string, config?: PromptInjectionConfig): PromptInjectionAnalysisResult {
  const validator = new PromptInjectionValidator(config);
  return validator.analyze(content);
}
