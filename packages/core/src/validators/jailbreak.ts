/**
 * BonkLM - Jailbreak Validator
 * =====================================
 * Multi-layer defense against AI jailbreak attempts.
 *
 * Detection Layers:
 * 1. Unicode normalization and confusable character mapping
 * 2. Pattern matching (44 patterns across 10 categories)
 * 3. Multi-turn pattern detection
 * 4. Fuzzy matching for keyword variations
 * 5. Heuristic behavioral analysis
 * 6. Session risk tracking with decay and escalation
 */

import { createLogger, type Logger } from '../base/GenericLogger.js';
import { createResult, Finding, type GuardrailResult, Severity } from '../base/GuardrailResult.js';
import { type JailbreakConfig, mergeConfig, type ValidatorConfig } from '../base/ValidatorConfig.js';
import { collapseIntraWordLineBreaks, containsNonAscii, normalizeText } from './text-normalizer.js';
import { type SessionPatternFinding, updateSessionState } from '../session/SessionTracker.js';
import { getRegexCache, type RegexCache } from './pattern-engine.js';
import { ALL_PATTERNS, JAILBREAK_KEYWORDS, JAILBREAK_PHRASES } from './jailbreak-patterns.js';

import { detectHeuristicPatterns, type HeuristicFinding } from './jailbreak-heuristic.js';

// Re-export HeuristicFinding and detectHeuristicPatterns for back-compat — callers
// previously imported them from './validators/jailbreak.js'.
export { detectHeuristicPatterns } from './jailbreak-heuristic.js';
export type { HeuristicFinding } from './jailbreak-heuristic.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Maximum input length to prevent DoS attacks on large inputs.
 */
const MAX_INPUT_LENGTH = 100_000;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Jailbreak finding result.
 */
export interface JailbreakFinding {
  category: string;
  pattern_name: string;
  severity: Severity;
  weight: number;
  match?: string;
  description: string;
  escalated?: boolean;
}

/**
 * Fuzzy finding result.
 */
export interface FuzzyFinding {
  category: string;
  matched_word: string;
  target_keyword: string;
  similarity: number;
  severity: Severity;
  weight: number;
  description: string;
}

/**
 * Multi-turn finding result.
 */
export interface MultiTurnFinding {
  category: string;
  pattern_name: string;
  severity: Severity;
  weight: number;
  description: string;
}

/**
 * Complete analysis result.
 */
export interface JailbreakAnalysisResult {
  findings: JailbreakFinding[];
  fuzzy_findings: FuzzyFinding[];
  heuristic_findings: HeuristicFinding[];
  multi_turn_findings: MultiTurnFinding[];
  /**
   * True when normalization shrank the input past the threshold. This is the raw
   * shrink signal only — it can be `true` with NO obfuscation finding for benign
   * whitespace-heavy plain-ASCII content (e.g. pretty-printed JSON), since the
   * `heavy_obfuscation` finding is additionally gated on a non-ASCII character.
   */
  obfuscation_detected: boolean;
  highest_severity: Severity;
  should_block: boolean;
  risk_score: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  is_escalating: boolean;
}

/**
 * Calculate similarity ratio between two strings (SequenceMatcher equivalent).
 */
function similarityRatio(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1.0;

  // Simple longest common subsequence approach
  const lcs = longestCommonSubsequence(longer, shorter);
  return (2.0 * lcs) / (longer.length + shorter.length);
}

/**
 * Calculate longest common subsequence length.
 */
function longestCommonSubsequence(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Fuzzy match keywords in text.
 * Reduced threshold from 0.85 to 0.75 to reduce false positives while maintaining detection.
 * S016-001: Uses cached regex patterns for phrase matching.
 */
export function fuzzyMatchKeywords(text: string, threshold = 0.75, cache?: RegexCache): FuzzyFinding[] {
  const findings: FuzzyFinding[] = [];

  // S016-001: Get or create regex cache
  const regexCache = cache ?? getRegexCache();
  const whitespacePattern = regexCache.get('\\s+', '');

  const words = text.toLowerCase().split(whitespacePattern);

  for (const word of words) {
    if (word.length < 4) continue;

    for (const keyword of JAILBREAK_KEYWORDS) {
      // A word that simply CONTAINS the keyword (an inflection like "ignored"/"bypassed", or a
      // compound) is not an obfuscation typo: it carries the keyword literally and is matched in
      // context by the pattern sets, so fuzzy-flagging it only adds benign false positives.
      // Fuzzy matching targets character-substituted evasions ("byp4ss") where the keyword is
      // NOT a clean substring.
      if (word.includes(keyword)) continue;

      // Length-ratio guard: a near-match is only meaningful between similarly-sized tokens.
      // Without it the LCS ratio flags a short keyword as a subsequence of a longer benign
      // word (e.g. "stan" inside "standard"), the dominant false-positive source.
      const lenRatio = Math.min(word.length, keyword.length) / Math.max(word.length, keyword.length);
      if (lenRatio < 0.7) continue;

      const similarity = similarityRatio(word, keyword);
      if (similarity >= threshold && similarity < 1.0) {
        findings.push({
          category: 'fuzzy_match',
          matched_word: word,
          target_keyword: keyword,
          similarity,
          severity: Severity.WARNING,
          weight: 3,
          description: `Fuzzy match: "${word}" similar to "${keyword}" (${Math.round(similarity * 100)}%)`
        });
      }
    }
  }

  // Check for phrase matches
  const lowerText = text.toLowerCase();
  for (const phrase of JAILBREAK_PHRASES) {
    // Check with some variation tolerance
    const words = phrase.split(' ');
    const fuzzyPhrase = words.join('\\s*');
    // S016-001: Use cached regex instead of creating new RegExp
    const regex = regexCache.get(fuzzyPhrase, 'i');
    if (regex.test(lowerText)) {
      findings.push({
        category: 'fuzzy_phrase',
        matched_word: phrase,
        target_keyword: phrase,
        similarity: 1.0,
        severity: Severity.WARNING,
        weight: 4,
        description: `Phrase match: "${phrase}"`
      });
    }
  }

  return findings;
}

// =============================================================================
// MULTI-TURN PATTERN DETECTION
// =============================================================================

/**
 * Detect multi-turn setup patterns.
 */
export function detectMultiTurnPatterns(text: string): MultiTurnFinding[] {
  const findings: MultiTurnFinding[] = [];

  const setupPatterns = [
    {
      name: 'setup_preamble',
      pattern: /(?:first|before\s+we\s+start|let\s+me\s+explain|here's\s+how\s+this\s+works)/i,
      description: 'Setup preamble detected'
    },
    {
      name: 'persistent_state_change',
      pattern:
        /(?:from\s+now\s+on|going\s+forward|for\s+the\s+rest\s+of)\s+(?:this|our)\s+(?:conversation|chat|session)/i,
      description: 'Persistent state change attempt'
    },
    {
      name: 'persistence_instruction',
      pattern: /(?:remember|don't\s+forget|keep\s+in\s+mind).*\b(?:throughout|always|every\s+response)/i,
      description: 'Persistence instruction detected'
    }
  ];

  for (const { name, pattern, description } of setupPatterns) {
    if (pattern.test(text)) {
      findings.push({
        category: 'multi_turn',
        pattern_name: name,
        severity: Severity.INFO,
        weight: 2,
        description
      });
    }
  }

  return findings;
}

// =============================================================================
// MAIN ANALYSIS
// =============================================================================

/**
 * Run jailbreak pattern detection on content.
 */
export function detectJailbreakPatterns(content: string): JailbreakFinding[] {
  const findings: JailbreakFinding[] = [];

  for (const patternDef of ALL_PATTERNS) {
    const match = content.match(patternDef.pattern);
    if (match) {
      findings.push({
        category: getPatternCategory(patternDef.name),
        pattern_name: patternDef.name,
        severity: patternDef.severity,
        weight: patternDef.weight,
        match: match[0].slice(0, 100),
        description: patternDef.description
      });
    }
  }

  return findings;
}

/**
 * Concatenated-copy scan for mid-word whitespace evasions: matches
 * `\s+`-joined patterns (whitespace stripped from both pattern and
 * content) so `prev\tious`, `U+2028`-splits and friends cannot hide
 * behind whitespace that `normalizeText` folds to a plain space.
 * Mirrors `detectPatternsConcatenated` in the pattern engine. Names
 * carry a `concat_` prefix for dedupe against the original-copy scan.
 */
export function detectJailbreakPatternsConcatenated(content: string): JailbreakFinding[] {
  const concatenated = content.replace(/\s+/g, '');
  const findings: JailbreakFinding[] = [];

  for (const patternDef of ALL_PATTERNS) {
    const source = patternDef.pattern.source;
    if (!/\\s\+/.test(source) || /\\s(?!\+)|\\S/.test(source)) continue;
    let regex: RegExp;
    try {
      regex = new RegExp(source.replace(/\\s\+/g, ''), patternDef.pattern.flags.replace('m', ''));
    } catch {
      continue;
    }
    const match = concatenated.match(regex);
    if (match) {
      findings.push({
        category: getPatternCategory(patternDef.name),
        pattern_name: `concat_${patternDef.name}`,
        severity: patternDef.severity,
        weight: patternDef.weight,
        match: match[0].slice(0, 100),
        description: patternDef.description
      });
    }
  }

  return findings;
}

/**
 * Get category for a pattern name.
 */
function getPatternNameCategory(name: string): string {
  if (name.startsWith('fic_frame')) return 'fictional_weaponization';
  if (name.includes('dan')) return 'dan';
  if (name.includes('roleplay') || name.includes('character')) return 'roleplay';
  if (name.includes('hypothetical') || name.includes('educational')) return 'hypothetical';
  if (
    name.includes('developer') ||
    name.includes('admin') ||
    name.includes('authorization') ||
    name.includes('testing') ||
    name.includes('internal')
  )
    return 'authority';
  if (
    name === 'urgency_pressure' ||
    name === 'guilt_manipulation' ||
    name === 'flattery_attack' ||
    name === 'threat_pattern'
  )
    return 'social_engineering';
  if (
    name === 'reciprocity_exploitation' ||
    name === 'social_proof_ai' ||
    name === 'consensus_pressure' ||
    name === 'politeness_exploitation' ||
    name === 'fitd_escalation'
  )
    return 'social_compliance';
  if (
    name === 'false_rapport' ||
    name === 'boundary_erosion' ||
    name === 'shared_goal_framing' ||
    name === 'flattery_chain' ||
    name === 'guilt_induction' ||
    name === 'sycophancy_exploitation'
  )
    return 'trust_exploitation';
  if (
    name === 'learned_helplessness' ||
    name === 'desperation_framing' ||
    name === 'moral_obligation' ||
    name === 'artificial_deadline'
  )
    return 'emotional_manipulation';
  if (
    name.includes('grandma') ||
    name.includes('stan') ||
    name.includes('aim') ||
    name.includes('opposite') ||
    name.includes('translator') ||
    name.includes('movie')
  )
    return 'known_template';
  return 'obfuscation';
}

/**
 * Alias for compatibility.
 */
const getPatternCategory = getPatternNameCategory;

/**
 * Default configuration for JailbreakValidator.
 */
const DEFAULT_JAILBREAK_CONFIG: Required<
  Pick<
    JailbreakConfig,
    'enableSessionTracking' | 'sessionEscalationThreshold' | 'enableFuzzyMatching' | 'enableHeuristics'
  >
> = {
  enableSessionTracking: true,
  sessionEscalationThreshold: 12, // Reduced from 15 to catch fragmentation attacks
  enableFuzzyMatching: true,
  enableHeuristics: true
};

// =============================================================================
// JAILBREAK VALIDATOR CLASS
// =============================================================================

/**
 * Jailbreak Validator class.
 *
 * @public v1.0-RC1 API freeze. `name = 'jailbreak'` is
 * frozen.
 */
export class JailbreakValidator {
  /**
   * Stable validator name. Required for `cachedValidate` (B2 closure —
   * constructor.name is minify-unsafe). Sprint 20 audit architect B1
   * closure: pairs with PromptInjectionValidator's Sprint 20 rename so
   * the full default validator bundle works with the new restate +
   * temporal middleware.
   */
  readonly name = 'jailbreak';
  private readonly config: Required<JailbreakConfig> & ValidatorConfig;
  private readonly logger: Logger;

  constructor(config: JailbreakConfig = {}) {
    // First merge with base defaults, then with jailbreak-specific defaults
    const baseMerged = mergeConfig(config);
    this.config = { ...baseMerged, ...DEFAULT_JAILBREAK_CONFIG, ...config } as Required<JailbreakConfig> &
      ValidatorConfig;
    this.logger = this.config.logger ?? createLogger('console', this.config.logLevel);
  }

  /**
   * Analyze content for jailbreak attempts.
   */
  analyze(content: string, sessionId?: string): JailbreakAnalysisResult {
    if (!content || content.trim().length === 0) {
      return this.createEmptyResult();
    }

    // Prevent DoS attacks with extremely large inputs
    if (content.length > MAX_INPUT_LENGTH) {
      return {
        findings: [
          {
            category: 'input_too_large',
            pattern_name: 'size_limit_exceeded',
            severity: Severity.WARNING,
            weight: 5,
            match: `Input length ${content.length} exceeds maximum ${MAX_INPUT_LENGTH}`,
            description: 'Input too large to process safely'
          }
        ],
        fuzzy_findings: [],
        heuristic_findings: [],
        multi_turn_findings: [],
        obfuscation_detected: false,
        highest_severity: Severity.WARNING,
        should_block: false,
        risk_score: 5,
        risk_level: 'LOW',
        is_escalating: false
      };
    }

    // 1. Detect patterns and extract findings
    const { findings, obfuscationDetected, normalized } = this.extractPatterns(content);

    // 2. Run additional detection methods
    const fuzzyFindings = this.detectFuzzyMatches(normalized);
    const heuristicFindings = this.detectHeuristics(normalized);
    const multiTurnFindings = detectMultiTurnPatterns(normalized);

    // 3. Calculate risk and session escalation
    const { riskScore, riskLevel, isEscalating } = this.calculateRisk(
      findings,
      fuzzyFindings,
      heuristicFindings,
      multiTurnFindings,
      sessionId
    );

    // 4. Apply escalation severity upgrade
    this.applyEscalation(findings, isEscalating, riskScore);

    // 5. Determine final severity and blocking decision
    const { highestSeverity, shouldBlock } = this.calculateSeverityAndBlocking(
      findings,
      fuzzyFindings,
      heuristicFindings,
      multiTurnFindings,
      riskScore,
      isEscalating
    );

    return {
      findings,
      fuzzy_findings: fuzzyFindings,
      heuristic_findings: heuristicFindings,
      multi_turn_findings: multiTurnFindings,
      obfuscation_detected: obfuscationDetected,
      highest_severity: highestSeverity,
      should_block: shouldBlock,
      risk_score: riskScore,
      risk_level: riskLevel,
      is_escalating: isEscalating
    };
  }

  /**
   * Create an empty analysis result.
   */
  private createEmptyResult(): JailbreakAnalysisResult {
    return {
      findings: [],
      fuzzy_findings: [],
      heuristic_findings: [],
      multi_turn_findings: [],
      obfuscation_detected: false,
      highest_severity: Severity.INFO,
      should_block: false,
      risk_score: 0,
      risk_level: 'LOW',
      is_escalating: false
    };
  }

  /**
   * Extract patterns from content and detect obfuscation.
   */
  private extractPatterns(content: string): {
    findings: JailbreakFinding[];
    obfuscationDetected: boolean;
    normalized: string;
  } {
    // Detection runs on BOTH copies (see PromptInjectionValidator):
    // the line-preserved normalization keeps word-boundary wraps
    // matching (`\s+` separators cross newlines), the collapsed copy
    // exposes mid-word split evasions (`prev\nious`).
    const linePreserved = normalizeText(content);
    const normalized = collapseIntraWordLineBreaks(linePreserved);
    const obfuscationDetected = linePreserved.length < content.length * 0.85;

    const findings = detectJailbreakPatterns(normalized);
    if (normalized !== linePreserved) {
      this.mergeUniqueFindings(findings, detectJailbreakPatterns(linePreserved));
    }
    // Third scan: fully-concatenated copy × whitespace-stripped phrase
    // patterns — closes mid-word whitespace evasions (`prev\tious`).
    this.mergeUniqueFindings(findings, detectJailbreakPatternsConcatenated(linePreserved));

    const originalHasNonAscii = containsNonAscii(content);

    // Also run on original if significantly different
    if (obfuscationDetected) {
      const originalFindings = detectJailbreakPatterns(content);
      this.mergeUniqueFindings(findings, originalFindings);

      // Genuine obfuscation requires actual non-ASCII characters (homoglyphs,
      // zero-width, control). Whitespace-heavy plain-ASCII content (e.g.
      // pretty-printed JSON) also shrinks >15% during normalization but is NOT
      // obfuscated — don't flag it. Mirrors PromptInjectionValidator's gate.
      if (originalHasNonAscii) {
        findings.push({
          category: 'obfuscation',
          pattern_name: 'heavy_obfuscation',
          severity: Severity.WARNING,
          weight: 5,
          description: 'Heavy text obfuscation detected'
        });
      }
    }

    // homoglyph_substitution's regex uses broad char classes (Latin | confusable) at every
    // position of "jailbreak"; after normalization the matched span is always ASCII, AND the
    // un-normalized second-pass `detectJailbreakPatterns(content)` above also matches on plain
    // ASCII (broad alternation). The rule fires on benign security-research prose that mentions
    // the plain word "jailbreak" (5 Tier-1 FP including explicit `clean-*` reference fixtures
    // self-labeled "NO attack content"). A homoglyph SUBSTITUTION attack must by definition
    // include ≥1 non-ASCII codepoint INSIDE THE MATCHED SPAN of the original input — a
    // content-level `containsNonAscii` check is too coarse (benign prose often contains
    // em-dashes / smart quotes). Re-run the pattern globally against the original and drop the
    // finding unless a match span carries a non-ASCII codepoint. Run AFTER both detection
    // passes so a second-pass re-add of the same finding is also filtered.
    if (findings.some(f => f.pattern_name === 'homoglyph_substitution')) {
      const homoglyphDef = ALL_PATTERNS.find(p => p.name === 'homoglyph_substitution');
      if (homoglyphDef) {
        const globalPattern = new RegExp(homoglyphDef.pattern.source, 'gi');
        let realSubstitution = false;
        for (const m of content.matchAll(globalPattern)) {
          for (let i = 0; i < m[0].length; i++) {
            if (m[0].charCodeAt(i) > 127) {
              realSubstitution = true;
              break;
            }
          }
          if (realSubstitution) break;
        }
        if (!realSubstitution) {
          for (let i = findings.length - 1; i >= 0; i--) {
            if (findings[i].pattern_name === 'homoglyph_substitution') findings.splice(i, 1);
          }
        }
      }
    }

    return { findings, obfuscationDetected, normalized };
  }

  /**
   * Merge unique findings into target array.
   */
  private mergeUniqueFindings(target: JailbreakFinding[], source: JailbreakFinding[]): void {
    // Dedupe on the BASE name (concat_ prefix stripped) so the
    // concatenated-copy scan never double-counts a pattern that also
    // matched on the original copy.
    const existingNames = new Set(target.map(f => f.pattern_name.replace(/^concat_/, '')));
    for (const finding of source) {
      if (!existingNames.has(finding.pattern_name.replace(/^concat_/, ''))) {
        target.push(finding);
      }
    }
  }

  /**
   * Run fuzzy matching if enabled.
   */
  private detectFuzzyMatches(content: string): FuzzyFinding[] {
    return this.config.enableFuzzyMatching ? fuzzyMatchKeywords(content) : [];
  }

  /**
   * Run heuristic detection if enabled.
   */
  private detectHeuristics(content: string): HeuristicFinding[] {
    return this.config.enableHeuristics ? detectHeuristicPatterns(content) : [];
  }

  /**
   * Calculate risk score and level, handling session tracking if enabled.
   */
  private calculateRisk(
    findings: JailbreakFinding[],
    fuzzyFindings: FuzzyFinding[],
    heuristicFindings: HeuristicFinding[],
    multiTurnFindings: MultiTurnFinding[],
    sessionId?: string
  ): { riskScore: number; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; isEscalating: boolean } {
    if (this.config.enableSessionTracking && sessionId && findings.length > 0) {
      return this.calculateSessionRisk(findings, fuzzyFindings, heuristicFindings, multiTurnFindings, sessionId);
    }

    return this.calculateLocalRisk(findings, fuzzyFindings, heuristicFindings);
  }

  /**
   * Calculate risk with session tracking.
   */
  private calculateSessionRisk(
    findings: JailbreakFinding[],
    fuzzyFindings: FuzzyFinding[],
    heuristicFindings: HeuristicFinding[],
    multiTurnFindings: MultiTurnFinding[],
    sessionId: string
  ): { riskScore: number; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; isEscalating: boolean } {
    const sessionFindings = this.buildSessionFindings(findings, fuzzyFindings, heuristicFindings, multiTurnFindings);

    const sessionResult = updateSessionState(sessionId, sessionFindings);
    const riskScore = sessionResult.riskScore;
    const isEscalating = sessionResult.shouldEscalate;
    const riskLevel = this.determineRiskLevel(riskScore, true);

    return { riskScore, riskLevel, isEscalating };
  }

  /**
   * Build session findings from all detection results.
   */
  private buildSessionFindings(
    findings: JailbreakFinding[],
    fuzzyFindings: FuzzyFinding[],
    heuristicFindings: HeuristicFinding[],
    multiTurnFindings: MultiTurnFinding[]
  ): SessionPatternFinding[] {
    const sessionFindings: SessionPatternFinding[] = [];

    for (const f of findings) {
      sessionFindings.push({
        category: f.category,
        weight: f.weight,
        pattern_name: f.pattern_name,
        timestamp: Date.now()
      });
    }

    for (const f of fuzzyFindings) {
      sessionFindings.push({
        category: f.category,
        weight: f.weight,
        pattern_name: `fuzzy_${f.target_keyword}`,
        timestamp: Date.now()
      });
    }

    for (const f of heuristicFindings) {
      sessionFindings.push({
        category: f.category,
        weight: f.weight,
        pattern_name: f.heuristic_name,
        timestamp: Date.now()
      });
    }

    for (const f of multiTurnFindings) {
      sessionFindings.push({
        category: f.category,
        weight: f.weight,
        pattern_name: f.pattern_name,
        timestamp: Date.now()
      });
    }

    return sessionFindings;
  }

  /**
   * Calculate local risk without session tracking.
   */
  private calculateLocalRisk(
    findings: JailbreakFinding[],
    fuzzyFindings: FuzzyFinding[],
    heuristicFindings: HeuristicFinding[]
  ): { riskScore: number; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; isEscalating: boolean } {
    const riskScore =
      findings.reduce((sum, f) => sum + f.weight, 0) +
      fuzzyFindings.reduce((sum, f) => sum + f.weight, 0) +
      heuristicFindings.reduce((sum, f) => sum + f.weight, 0);

    return {
      riskScore,
      riskLevel: this.determineRiskLevel(riskScore, false),
      isEscalating: false
    };
  }

  /**
   * Determine risk level from score.
   */
  private determineRiskLevel(score: number, useSessionThresholds: boolean): 'LOW' | 'MEDIUM' | 'HIGH' {
    const highThreshold = useSessionThresholds ? 25 : 15;
    const mediumThreshold = useSessionThresholds ? 10 : 8;

    if (score >= highThreshold) return 'HIGH';
    if (score >= mediumThreshold) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Apply severity escalation for high-risk sessions.
   */
  private applyEscalation(findings: JailbreakFinding[], isEscalating: boolean, riskScore: number): void {
    if (isEscalating && riskScore > 15) {
      for (const finding of findings) {
        if (finding.severity === Severity.WARNING) {
          finding.severity = Severity.CRITICAL;
          finding.escalated = true;
        }
      }
    }
  }

  /**
   * Calculate highest severity and blocking decision.
   */
  private calculateSeverityAndBlocking(
    findings: JailbreakFinding[],
    fuzzyFindings: FuzzyFinding[],
    heuristicFindings: HeuristicFinding[],
    multiTurnFindings: MultiTurnFinding[],
    riskScore: number,
    isEscalating: boolean
  ): { highestSeverity: Severity; shouldBlock: boolean } {
    const highestSeverity = this.getHighestSeverity(findings, fuzzyFindings, heuristicFindings, multiTurnFindings);

    const shouldBlock =
      highestSeverity === Severity.WARNING ||
      highestSeverity === Severity.CRITICAL ||
      (riskScore >= 25 && isEscalating);

    return { highestSeverity, shouldBlock };
  }

  /**
   * Get highest severity from all findings.
   */
  private getHighestSeverity(
    findings: JailbreakFinding[],
    fuzzyFindings: FuzzyFinding[],
    heuristicFindings: HeuristicFinding[],
    multiTurnFindings: MultiTurnFinding[]
  ): Severity {
    const severityOrder: Record<Severity, number> = {
      [Severity.INFO]: 0,
      [Severity.WARNING]: 1,
      [Severity.BLOCKED]: 2,
      [Severity.CRITICAL]: 3
    };

    let highestSeverity: Severity = Severity.INFO;

    for (const severity of [
      ...findings.map(f => f.severity),
      ...fuzzyFindings.map(f => f.severity),
      ...heuristicFindings.map(f => f.severity),
      ...multiTurnFindings.map(f => f.severity)
    ]) {
      if (severityOrder[severity] > severityOrder[highestSeverity]) {
        highestSeverity = severity;
      }
    }

    return highestSeverity;
  }

  /**
   * Validate content for jailbreak attempts.
   */
  validate(content: string, sessionId?: string): GuardrailResult {
    const result = this.analyze(content, sessionId);

    const allFindings: Finding[] = [
      ...result.findings.map(f => ({
        category: f.category,
        pattern_name: f.pattern_name,
        severity: f.severity,
        match: f.match,
        description: f.description,
        weight: f.weight
      })),
      ...result.fuzzy_findings.map(f => ({
        category: f.category,
        severity: f.severity,
        description: f.description,
        weight: f.weight
      })),
      ...result.heuristic_findings.map(f => ({
        category: f.category,
        severity: f.severity,
        description: f.description,
        weight: f.weight
      })),
      ...result.multi_turn_findings.map(f => ({
        category: f.category,
        pattern_name: f.pattern_name,
        severity: f.severity,
        description: f.description,
        weight: f.weight
      }))
    ];

    const allowed = !result.should_block;

    if (allFindings.length > 0) {
      this.logger.warn('Jailbreak patterns detected', {
        findings_count: allFindings.length,
        highest_severity: result.highest_severity,
        risk_score: result.risk_score,
        risk_level: result.risk_level,
        is_escalating: result.is_escalating,
        blocked: !allowed
      });
    }

    return createResult(allowed, result.highest_severity, this.config.includeFindings ? allFindings : []);
  }
}

/**
 * Convenience function to validate content.
 */
export function validateJailbreak(content: string, config?: JailbreakConfig): GuardrailResult {
  const validator = new JailbreakValidator(config);
  return validator.validate(content);
}

/**
 * Convenience function to analyze content.
 */
export function analyzeJailbreak(
  content: string,
  config?: JailbreakConfig,
  sessionId?: string
): JailbreakAnalysisResult {
  const validator = new JailbreakValidator(config);
  return validator.analyze(content, sessionId);
}
