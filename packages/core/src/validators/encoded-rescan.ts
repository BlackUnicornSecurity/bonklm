/**
 * BonkLM - Encoded Rescan Validator
 * =================================
 * Decode-then-rescan layer for obfuscated injection payloads. Obfuscation
 * schemes (unicode-escape, HTML entity, percent/URL, base64, base32, hex, ROT13,
 * ROT47, reverse, leetspeak, and multi-layer chains of these) let an attacker
 * smuggle an injection past the plaintext pattern engines. This validator decodes
 * each candidate scheme and re-runs the EXISTING injection detectors on the
 * decoded text — so a payload the raw scan missed is caught once revealed.
 *
 * Precision is enforced by three independent conditions before a block:
 *   1. a structural marker / a cipher transform actually produced different text;
 *   2. the decoded text passes an injection-keyword firewall (cipher "garbage"
 *      carries no real injection words, so speculative decoders cannot misfire);
 *   3. the decoded text matches a real injection PATTERN at or above a per-decoder
 *      severity floor — WARNING+ for marker-driven STRUCTURAL transports (their
 *      presence is unambiguous obfuscation intent), CRITICAL for speculative
 *      ciphers and multi-layer chains (every string "decodes", so only the
 *      strongest signal is trusted).
 *
 * The validator is purely ADDITIVE: it only ever raises a block on content the raw
 * engine already let through, so it cannot reduce recall or remove a true positive.
 * Tuned to recover obfuscated injections without introducing false positives on
 * benign encoded content (legitimate base64/unicode-escape data, codec docs, etc.).
 */

import { createResult, type Finding, type GuardrailResult, Severity } from '../base/GuardrailResult.js';
import { type EncodedRescanConfig, mergeConfig, type ValidatorConfig } from '../base/ValidatorConfig.js';
import { createLogger, type Logger } from '../base/GenericLogger.js';
import { sanitizeLogString } from '../common/index.js';
import {
  type DecodeCandidate,
  decodeCandidates,
  DEFAULT_MAX_DECODE_DEPTH,
  MAX_DECODE_INPUT,
  multiLayerDecode
} from '../common/encoding-decoders.js';
import { detectPatterns } from './pattern-engine.js';
import { detectJailbreakPatterns } from './jailbreak.js';

/**
 * Injection-keyword firewall. A decoded variant must contain at least one of these
 * before any pattern re-scan runs. This is what makes the speculative cipher
 * decoders (ROT13/ROT47/reverse/leet) safe: applying them to benign plaintext
 * yields garbage that contains none of these words, so it never reaches the
 * pattern engine. Kept deliberately broad (the CRITICAL/WARNING pattern match is
 * the real precision gate); narrowing it would only drop recall.
 */
const INJECTION_KEYWORDS =
  /\b(?:ignore|bypass|override|system|jailbreak|unrestricted|disable|instructions?|prompt|safety|reveal|admin|sudo|exfiltrat|credential|password)\b/i;

interface PatternLike {
  pattern_name: string;
  severity: Severity;
  blockEligible?: boolean;
}

/** Severity ordering, matching the engine's `mergeResults` ranking (BLOCKED sits below CRITICAL). */
const SEVERITY_RANK: Record<Severity, number> = {
  [Severity.INFO]: 0,
  [Severity.WARNING]: 1,
  [Severity.BLOCKED]: 2,
  [Severity.CRITICAL]: 3
};

/**
 * Return the first finding that qualifies as a block for this decoder class, or
 * `undefined`. STRUCTURAL transports block on WARNING+ (a literal marker is unambiguous
 * obfuscation); ciphers/chains require CRITICAL (every string "decodes"). `blockEligible:
 * false` (web3 tripwire) pattern findings never block — mirrors PromptInjectionValidator;
 * JailbreakFinding has no `blockEligible` field (always eligible).
 */
function firstBlocking(findings: PatternLike[], requireCritical: boolean): PatternLike | undefined {
  const floor = requireCritical ? SEVERITY_RANK[Severity.CRITICAL] : SEVERITY_RANK[Severity.WARNING];
  return findings.find(f => f.blockEligible !== false && SEVERITY_RANK[f.severity] >= floor);
}

/**
 * EncodedRescanValidator — decode-then-rescan injection detector.
 */
export class EncodedRescanValidator {
  private readonly config: EncodedRescanConfig &
    Required<Pick<ValidatorConfig, 'sensitivity' | 'action' | 'enabled' | 'logLevel' | 'includeFindings'>>;
  private readonly logger: Logger;
  private readonly maxDecodeDepth: number;

  constructor(config: EncodedRescanConfig = {}) {
    // `mergeConfig` already layers the caller's config over the defaults; do NOT re-spread the raw
    // `config` on top (an explicit `{ action: undefined }` would clobber the default back to undefined).
    this.config = mergeConfig(config);
    this.maxDecodeDepth = config.maxDecodeDepth ?? DEFAULT_MAX_DECODE_DEPTH;
    this.logger = this.config.logger ?? createLogger('console', this.config.logLevel);
  }

  /**
   * Decode each candidate scheme and re-scan it. Returns a standard GuardrailResult;
   * blocks when an obfuscated injection is recovered (subject to the action mode).
   */
  validate(content: string): GuardrailResult {
    if (this.config.enabled === false) return createResult(true, Severity.INFO, []);
    // Empty, whitespace-only, or over-length input: nothing to decode (over-length
    // content is left to the always-on validators; decoding it would add no signal
    // and only burn the time budget).
    if (!content || content.trim().length === 0 || content.length > MAX_DECODE_INPUT) {
      return createResult(true, Severity.INFO, []);
    }

    const candidates: DecodeCandidate[] = [
      ...decodeCandidates(content),
      ...multiLayerDecode(content, this.maxDecodeDepth).map(text => ({
        method: 'multi_layer',
        text,
        structural: false
      }))
    ];

    const findings: Finding[] = [];
    const seenMethods = new Set<string>();

    for (const cand of candidates) {
      if (cand.text === content || seenMethods.has(cand.method)) continue;
      if (!INJECTION_KEYWORDS.test(cand.text)) continue;

      const requireCritical = !cand.structural;
      const hit =
        firstBlocking(detectPatterns(cand.text), requireCritical) ??
        firstBlocking(detectJailbreakPatterns(cand.text), requireCritical);
      if (!hit) continue;

      seenMethods.add(cand.method);
      // Provenance only — `cand.method` and the inner `pattern_name` are static
      // library constants, so no attacker-derived text enters the finding.
      const inner = hit.pattern_name;
      findings.push({
        category: 'encoded_injection',
        pattern_name: `encoded_${cand.method}_injection`,
        severity: Severity.CRITICAL,
        weight: 10,
        description: `Injection payload recovered after ${cand.method} decoding (matched ${inner})`
      });
    }

    let allowed = findings.length === 0;
    // Honour the action mode: only 'block' enforces; 'log'/'sanitize'/'allow' observe.
    if (this.config.action !== 'block') allowed = true;
    const severity = findings.length > 0 ? Severity.CRITICAL : Severity.INFO;

    if (findings.length > 0) {
      // pattern_name values are static library constants, but route through the shared
      // CWE-117 sanitizer for defense-in-depth and to match every other validator's log sink.
      const methods = sanitizeLogString(findings.map(f => f.pattern_name).join(', '));
      this.logger.debug(`EncodedRescanValidator recovered ${findings.length} obfuscated injection(s): ${methods}`);
    }

    return createResult(allowed, severity, findings);
  }
}

/**
 * Quick validation helper for decode-then-rescan detection.
 */
export function validateEncodedRescan(content: string, config?: EncodedRescanConfig): GuardrailResult {
  return new EncodedRescanValidator(config).validate(content);
}
