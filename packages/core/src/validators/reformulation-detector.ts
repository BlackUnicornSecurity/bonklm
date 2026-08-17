/**
 * BonkLM - Reformulation Detector
 * ========================================
 * Detects injection payloads disguised through various reformulation techniques.
 *
 * Detection Methods (TPI-09, TPI-10, TPI-11, TPI-13):
 * 1. Code format injection: Comments (10+ styles), markdown code blocks, variable/function names
 * 2. Character-level encoding: ROT13, ROT47, reverse text, acrostic, pig latin
 * 3. Context overload: Token flooding, many-shot, repetitive content
 * 4. Mathematical/logical encoding: Formal logic, pseudomath, conditional logic
 */

import { createLogger, type Logger } from '../base/GenericLogger.js';
import { createResult, Finding, type GuardrailResult, Severity } from '../base/GuardrailResult.js';
import { getRiskThreshold, mergeConfig, type ReformulationConfig } from '../base/ValidatorConfig.js';
import { sanitizeLogString } from '../common/index.js';
import { CRITICAL_PATTERNS, detectPatterns } from './pattern-engine.js';
import { type SessionPatternFinding, updateFragmentBuffer, updateSessionState } from '../session/SessionTracker.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Reformulation finding result.
 */
export interface ReformulationFinding {
  category: string;
  pattern_name: string;
  severity: Severity;
  source_type: string; // 'code_comment' | 'variable_name' | 'rot13' | 'flooding' etc.
  extracted_text: string; // The text extracted from the construct
  description: string;
  weight?: number;
}

/**
 * Complete analysis result.
 */
export interface ReformulationAnalysisResult {
  findings: ReformulationFinding[];
  code_format_findings: ReformulationFinding[];
  character_encoding_findings: ReformulationFinding[];
  context_overload_findings: ReformulationFinding[];
  math_logic_findings: ReformulationFinding[];
  obfuscation_detected: boolean;
  session_escalated?: boolean;
  risk_score: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default maximum content size for character-level decoding (10KB) */
const DEFAULT_MAX_DECODE_SIZE = 10240;

/** Default maximum content size for math/logic detection (5KB) */
const DEFAULT_MATH_MAX_SIZE = 5120;

/** Maximum input length to prevent DoS attacks */
const MAX_INPUT_LENGTH = 100_000;

/** Keywords that indicate injection when found in decoded content */
const CHAR_INJECTION_KEYWORDS =
  /\b(?:ignore|bypass|override|system|jailbreak|unrestricted|disable|instructions|prompt|safety)\b/i;

// =============================================================================
// CODE COMMENT EXTRACTION PATTERNS
// =============================================================================

/**
 * Comment extraction patterns for 10+ languages/formats.
 */
const COMMENT_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  description: string;
}> = [
  // Single-line comments
  { name: 'c_style_single', pattern: /\/\/\s*(.*?)$/gm, description: 'C/C++/Java/JS single-line comment' },
  { name: 'hash_comment', pattern: /(?:^|\s)#\s+(.*?)$/gm, description: 'Python/Ruby/Shell hash comment' },
  { name: 'sql_comment', pattern: /--\s+(.*?)$/gm, description: 'SQL/Haskell double-dash comment' },
  { name: 'percent_comment', pattern: /(?:^|\s)%\s+(.*?)$/gm, description: 'MATLAB/LaTeX percent comment' },
  { name: 'rem_comment', pattern: /^REM\s+(.*?)$/gim, description: 'Batch file REM comment' },
  // Multi-line comments
  { name: 'c_style_multi', pattern: /\/\*\s*([\s\S]*?)\s*\*\//g, description: 'C-style multi-line comment' },
  {
    name: 'python_triple_double',
    pattern: /"""\s*([\s\S]*?)\s*"""/g,
    description: 'Python triple-double-quote docstring'
  },
  {
    name: 'python_triple_single',
    pattern: /'''\s*([\s\S]*?)\s*'''/g,
    description: 'Python triple-single-quote docstring'
  },
  { name: 'haskell_multi', pattern: /\{-\s*([\s\S]*?)\s*-\}/g, description: 'Haskell multi-line comment' },
  { name: 'pascal_multi', pattern: /\(\*\s*([\s\S]*?)\s*\*\)/g, description: 'Pascal/OCaml multi-line comment' },
  // HTML/XML comments
  { name: 'html_comment', pattern: /<!--\s*([\s\S]*?)\s*-->/g, description: 'HTML/XML comment' }
];

/**
 * Markdown code extraction patterns.
 */
const MARKDOWN_CODE_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  description: string;
}> = [
  {
    name: 'fenced_code_block',
    pattern: /```(?:\w+)?\s*\n([\s\S]*?)\n\s*```/g,
    description: 'Markdown fenced code block'
  },
  { name: 'inline_code', pattern: /`([^`]+)`/g, description: 'Markdown inline code' }
];

/**
 * Extract all comment text from content.
 */
function extractCommentText(content: string): Array<{ text: string; source: string }> {
  const extracted: Array<{ text: string; source: string }> = [];

  for (const commentPattern of COMMENT_PATTERNS) {
    let match: RegExpExecArray | null;
    commentPattern.pattern.lastIndex = 0;

    while ((match = commentPattern.pattern.exec(content)) !== null) {
      const text = (match[1] || '').trim();
      if (text.length > 5) {
        extracted.push({ text, source: commentPattern.name });
      }
    }
  }

  for (const mdPattern of MARKDOWN_CODE_PATTERNS) {
    let match: RegExpExecArray | null;
    mdPattern.pattern.lastIndex = 0;

    while ((match = mdPattern.pattern.exec(content)) !== null) {
      const text = (match[1] || '').trim();
      if (text.length > 10) {
        extracted.push({ text, source: mdPattern.name });
      }
    }
  }

  return extracted;
}

// =============================================================================
// VARIABLE/FUNCTION NAME ENCODING DETECTION
// =============================================================================

const IDENTIFIER_INJECTION_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  description: string;
}> = [
  {
    name: 'var_bypass_safety',
    pattern:
      /(?:const|let|var|function|def|class)\s+(?:\w*(?:bypass|ignore|override|disable|remove)(?:Safety|Security|Filter|Guard|Rules?|Restrictions?|Constraints?)\w*)/i,
    description: 'Variable/function name encodes safety bypass instruction'
  },
  {
    name: 'var_jailbreak',
    pattern: /(?:const|let|var|function|def|class)\s+(?:\w*(?:jailbreak|jailBreak|jail_break)\w*)/i,
    description: 'Variable/function name contains jailbreak reference'
  },
  {
    name: 'var_ignore_instructions',
    pattern:
      /(?:const|let|var|function|def|class)\s+(?:\w*(?:ignoreAll(?:Previous|Prior)?(?:Rules?|Instructions?)|forgetRules|overrideSystem)\w*)/i,
    description: 'Variable/function name encodes instruction override'
  },
  {
    name: 'assignment_nullify_rules',
    pattern:
      /(?:rules?|restrictions?|safety|constraints?|guardrails?|filters?)\s*(?:=|:=)\s*(?:null|nil|false|0|undefined|None|\[\]|\{\}|"")/i,
    description: 'Assignment nullifies rules/restrictions variable'
  }
];

function detectIdentifierEncoding(content: string): ReformulationFinding[] {
  const findings: ReformulationFinding[] = [];

  for (const pattern of IDENTIFIER_INJECTION_PATTERNS) {
    const match = content.match(pattern.pattern);
    if (match) {
      findings.push({
        category: 'code_format_injection',
        pattern_name: pattern.name,
        severity: Severity.INFO,
        source_type: pattern.name.startsWith('assignment') ? 'assignment' : 'variable_name',
        extracted_text: match[0].slice(0, 100),
        description: pattern.description,
        weight: 3
      });
    }
  }

  return findings;
}

// =============================================================================
// TPI-09: CODE FORMAT INJECTION DETECTION
// =============================================================================

/**
 * Detect injection payloads hidden in code format constructs.
 */
function detectCodeFormatInjection(content: string): ReformulationFinding[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const findings: ReformulationFinding[] = [];
  const commentExtracts = extractCommentText(content);

  for (const { text, source } of commentExtracts) {
    const patternFindings = detectPatterns(text);

    for (const pf of patternFindings) {
      const isCriticalPattern = CRITICAL_PATTERNS.some(cp => cp.name === pf.pattern_name);
      const severity: Severity = isCriticalPattern ? Severity.WARNING : Severity.INFO;

      findings.push({
        category: 'code_format_injection',
        pattern_name: `comment_${pf.pattern_name}`,
        severity,
        source_type: 'code_comment',
        extracted_text: text.slice(0, 100),
        description: `Code comment (${source}) contains ${pf.description}`,
        weight: isCriticalPattern ? 8 : 2
      });
    }
  }

  const identifierFindings = detectIdentifierEncoding(content);
  findings.push(...identifierFindings);

  return findings;
}

// =============================================================================
// CHARACTER-LEVEL ENCODING FUNCTIONS
// =============================================================================

function rot13(text: string): string {
  return text.replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function rot47(text: string): string {
  return text.replace(/[!-~]/g, c => {
    return String.fromCharCode(((c.charCodeAt(0) - 33 + 47) % 94) + 33);
  });
}

function reverseText(text: string): string {
  return [...text].reverse().join('');
}

function extractAcrostic(text: string): string | null {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 5) return null;
  return lines.map(l => l.trim()[0] || '').join('');
}

function detectPigLatin(text: string): string | null {
  const words = text.split(/\s+/);
  const pigLatinWords = words.filter(w => /[a-z]+ay$/i.test(w));
  if (pigLatinWords.length < 3 || pigLatinWords.length / words.length < 0.5) return null;

  const decoded = pigLatinWords.map(w => {
    if (/^[aeiou].*way$/i.test(w)) {
      return w.slice(0, -3);
    }
    const match = w.match(/^(.+?)([bcdfghjklmnpqrstvwxyz]+)ay$/i);
    if (!match) return w;
    return (match[2] ?? '') + (match[1] ?? '');
  });
  return decoded.join(' ');
}

// =============================================================================
// TPI-10: CHARACTER-LEVEL ENCODING DETECTION
// =============================================================================

/**
 * Detect character-level encoded injection payloads.
 */
function detectCharacterLevelEncoding(
  content: string,
  maxSize: number = DEFAULT_MAX_DECODE_SIZE
): ReformulationFinding[] {
  if (!content || content.length > maxSize || content.trim().length === 0) {
    return [];
  }

  const findings: ReformulationFinding[] = [];

  // ROT13 decode
  const rot13Decoded = rot13(content);
  if (rot13Decoded !== content && CHAR_INJECTION_KEYWORDS.test(rot13Decoded)) {
    const patternHits = detectPatterns(rot13Decoded);
    const hasCritical = patternHits.some(p => p.severity === Severity.CRITICAL || p.severity === Severity.WARNING);
    findings.push({
      category: 'character_encoding',
      pattern_name: 'rot13_injection',
      severity: hasCritical ? Severity.WARNING : Severity.INFO,
      source_type: 'rot13',
      extracted_text: rot13Decoded.slice(0, 100),
      description: 'ROT13 decoded content contains injection keywords',
      weight: hasCritical ? 8 : 3
    });
  }

  // ROT47 decode
  const rot47Decoded = rot47(content);
  if (rot47Decoded !== content && rot47Decoded !== rot13Decoded && CHAR_INJECTION_KEYWORDS.test(rot47Decoded)) {
    findings.push({
      category: 'character_encoding',
      pattern_name: 'rot47_injection',
      severity: Severity.INFO,
      source_type: 'rot47',
      extracted_text: rot47Decoded.slice(0, 100),
      description: 'ROT47 decoded content contains injection keywords',
      weight: 3
    });
  }

  // Reverse text
  const reversed = reverseText(content);
  if (CHAR_INJECTION_KEYWORDS.test(reversed)) {
    const patternHits = detectPatterns(reversed);
    const hasCritical = patternHits.some(p => p.severity === Severity.CRITICAL || p.severity === Severity.WARNING);
    findings.push({
      category: 'character_encoding',
      pattern_name: 'reverse_text_injection',
      severity: hasCritical ? Severity.WARNING : Severity.INFO,
      source_type: 'reverse',
      extracted_text: reversed.slice(0, 100),
      description: 'Reversed text contains injection keywords',
      weight: hasCritical ? 7 : 3
    });
  }

  // Acrostic extraction
  const acrostic = extractAcrostic(content);
  if (acrostic && CHAR_INJECTION_KEYWORDS.test(acrostic)) {
    findings.push({
      category: 'character_encoding',
      pattern_name: 'acrostic_injection',
      severity: Severity.INFO,
      source_type: 'acrostic',
      extracted_text: acrostic,
      description: 'Acrostic (first letters of lines) contains injection keywords',
      weight: 5
    });
  }

  // Pig Latin detection
  const pigLatinDecoded = detectPigLatin(content);
  if (pigLatinDecoded && CHAR_INJECTION_KEYWORDS.test(pigLatinDecoded)) {
    findings.push({
      category: 'character_encoding',
      pattern_name: 'pig_latin_injection',
      severity: Severity.INFO,
      source_type: 'pig_latin',
      extracted_text: pigLatinDecoded.slice(0, 100),
      description: 'Pig Latin decoded content contains injection keywords',
      weight: 4
    });
  }

  return findings;
}

// =============================================================================
// TPI-11: CONTEXT OVERLOAD & MANY-SHOT DETECTION
// =============================================================================

/**
 * Detect context overload and many-shot injection patterns.
 */
function detectContextOverload(content: string): ReformulationFinding[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const findings: ReformulationFinding[] = [];

  // Token flooding heuristic: >15,000 chars with high repetition ratio
  if (content.length > 15000) {
    const sentences = content.split(/[.!?\n]+/).filter(s => s.trim().length > 5);
    if (sentences.length > 0) {
      const hashBuckets = new Map<string, number>();
      for (const sentence of sentences) {
        const normalized = sentence.trim().toLowerCase().replace(/\s+/g, ' ');
        const count = hashBuckets.get(normalized) || 0;
        hashBuckets.set(normalized, count + 1);
      }

      const totalSentences = sentences.length;
      const uniqueSentences = hashBuckets.size;
      const repetitionRatio = 1 - uniqueSentences / totalSentences;

      if (repetitionRatio > 0.4) {
        findings.push({
          category: 'context_overload',
          pattern_name: 'token_flooding',
          severity: Severity.WARNING,
          source_type: 'flooding',
          extracted_text: `${content.length} chars, ${totalSentences} sentences, ${Math.round(repetitionRatio * 100)}% repetition`,
          description: 'Token flooding detected: long content with high repetition ratio',
          weight: 6
        });
      }
    }
  }

  // Many-shot detection
  const instructionPatterns =
    /(?:^|\n)\s*(?:(?:please\s+)?(?:ignore|bypass|override|disable|remove|forget|reveal|show)\b|(?:you\s+(?:must|should|will|need\s+to))\b)/gi;
  const instructionMatches = content.match(instructionPatterns) || [];
  if (instructionMatches.length > 10) {
    findings.push({
      category: 'context_overload',
      pattern_name: 'many_shot',
      severity: Severity.WARNING,
      source_type: 'many_shot',
      extracted_text: `${instructionMatches.length} instruction-like patterns detected`,
      description: 'Many-shot injection: >10 similar instruction patterns in single message',
      weight: 5
    });
  }

  // Repetition analysis
  const allSentences = content.split(/[.!?\n]+/).filter(s => s.trim().length > 5);
  if (allSentences.length > 5) {
    const hashBuckets = new Map<string, number>();
    for (const sentence of allSentences) {
      const normalized = sentence.trim().toLowerCase().replace(/\s+/g, ' ');
      const count = hashBuckets.get(normalized) || 0;
      hashBuckets.set(normalized, count + 1);
    }

    const totalSentences = allSentences.length;
    const uniqueSentences = hashBuckets.size;
    const repetitionRatio = 1 - uniqueSentences / totalSentences;

    if (repetitionRatio > 0.4 && content.length <= 15000) {
      findings.push({
        category: 'context_overload',
        pattern_name: 'repetitive_content',
        severity: Severity.WARNING,
        source_type: 'repetition',
        extracted_text: `${totalSentences} sentences, ${Math.round(repetitionRatio * 100)}% repetition`,
        description: 'High repetition ratio: >40% of sentences are duplicates',
        weight: 5
      });
    }
  }

  return findings;
}

// =============================================================================
// TPI-13: MATHEMATICAL/LOGICAL ENCODING DETECTION
// =============================================================================

const MATH_LOGIC_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  description: string;
}> = [
  {
    name: 'formal_logic_override',
    pattern:
      /(?:∀|∃|⊢|⊨|→|⇒|∧|∨)\s*(?:\w+\s*)?[:(]?\s*(?:safety|rules?|instructions?|constraints?|restrictions?)(?:\([^)]*\))?\s*(?:→|⇒|=)\s*(?:ignore|null|false|0|⊥)(?:\([^)]*\))?/i,
    description: 'Formal logic encoding of safety override'
  },
  {
    name: 'pseudomath_nullify',
    pattern:
      /(?:let|set|define)\s+(?:rules?|restrictions?|safety|constraints?|guardrails?)\s*(?:=|:=|←)\s*(?:null|nil|0|false|∅|undefined|None|empty|\[\]|\{\})/i,
    description: 'Pseudomath notation nullifying rules'
  },
  {
    name: 'conditional_override',
    pattern:
      /(?:if|when|given)\s+(?:true|1|always)\s*(?:then|→|⇒|:)\s*(?:ignore|bypass|override|disable)\s+(?:all\s+)?(?:rules?|safety|restrictions?)/i,
    description: 'Conditional logic encoding safety bypass'
  }
];

function detectMathLogicEncoding(content: string, maxSize: number = DEFAULT_MATH_MAX_SIZE): ReformulationFinding[] {
  if (!content || content.length > maxSize || content.trim().length === 0) {
    return [];
  }

  const findings: ReformulationFinding[] = [];

  for (const pattern of MATH_LOGIC_PATTERNS) {
    const match = content.match(pattern.pattern);
    if (match) {
      findings.push({
        category: 'math_logic_encoding',
        pattern_name: pattern.name,
        severity: Severity.INFO,
        source_type: 'math_notation',
        extracted_text: match[0].slice(0, 100),
        description: pattern.description,
        weight: 4
      });
    }
  }

  return findings;
}

// =============================================================================
// REFORMULATION DETECTOR CLASS
// =============================================================================

/**
 * ReformulationDetector - Main validator class
 *
 * Detects injection payloads disguised through reformulation techniques.
 */
export class ReformulationDetector {
  private readonly config: ReformulationConfig &
    Required<Pick<ReformulationConfig, 'sensitivity' | 'action' | 'enabled' | 'logLevel' | 'includeFindings'>>;
  private readonly logger: Logger;

  constructor(config: ReformulationConfig = {}) {
    const merged = mergeConfig(config);
    this.config = {
      ...merged,
      ...config,
      detectCodeFormat: config.detectCodeFormat ?? true,
      detectCharacterEncoding: config.detectCharacterEncoding ?? true,
      detectContextOverload: config.detectContextOverload ?? true,
      detectMathLogic: config.detectMathLogic ?? true,
      maxDecodeSize: config.maxDecodeSize ?? DEFAULT_MAX_DECODE_SIZE,
      enableSessionTracking: config.enableSessionTracking ?? false
    };
    this.logger = this.config.logger ?? createLogger('console', this.config.logLevel);
  }

  /**
   * Analyze content for reformulation-based injection attempts.
   */
  analyze(content: string, sessionId?: string): ReformulationAnalysisResult {
    // Prevent DoS attacks with extremely large inputs
    if (content.length > MAX_INPUT_LENGTH) {
      return {
        findings: [
          {
            category: 'input_too_large',
            pattern_name: 'size_limit_exceeded',
            severity: Severity.WARNING,
            source_type: 'size_limit',
            extracted_text: '',
            description: `Input length ${content.length} exceeds maximum ${MAX_INPUT_LENGTH}`
          }
        ],
        code_format_findings: [],
        character_encoding_findings: [],
        context_overload_findings: [],
        math_logic_findings: [],
        obfuscation_detected: false,
        risk_score: 5
      };
    }

    const findings: ReformulationFinding[] = [];
    const code_format_findings: ReformulationFinding[] = [];
    const character_encoding_findings: ReformulationFinding[] = [];
    const context_overload_findings: ReformulationFinding[] = [];
    const math_logic_findings: ReformulationFinding[] = [];

    let obfuscation_detected = false;
    let session_escalated = false;

    // TPI-09: Code format injection
    if (this.config.detectCodeFormat !== false) {
      const codeFindings = detectCodeFormatInjection(content);
      code_format_findings.push(...codeFindings);
      findings.push(...codeFindings);
      if (codeFindings.length > 0) obfuscation_detected = true;
    }

    // TPI-10: Character-level encoding
    if (this.config.detectCharacterEncoding !== false) {
      const charFindings = detectCharacterLevelEncoding(content, this.config.maxDecodeSize);
      character_encoding_findings.push(...charFindings);
      findings.push(...charFindings);
      if (charFindings.length > 0) obfuscation_detected = true;
    }

    // TPI-11: Context overload
    if (this.config.detectContextOverload !== false) {
      const contextFindings = detectContextOverload(content);
      context_overload_findings.push(...contextFindings);
      findings.push(...contextFindings);
      if (contextFindings.length > 0) obfuscation_detected = true;
    }

    // TPI-13: Math/logic encoding
    if (this.config.detectMathLogic !== false) {
      const mathFindings = detectMathLogicEncoding(content);
      math_logic_findings.push(...mathFindings);
      findings.push(...mathFindings);
      if (mathFindings.length > 0) obfuscation_detected = true;
    }

    // Session tracking for fragmentation buffer
    if (this.config.enableSessionTracking && sessionId) {
      const fragmentFindings = updateFragmentBuffer(sessionId, content);
      if (fragmentFindings.length > 0) {
        findings.push(
          ...fragmentFindings.map(() => ({
            category: 'fragmentation',
            pattern_name: 'fragment_buffer',
            severity: Severity.INFO,
            source_type: 'session',
            extracted_text: content.slice(0, 100),
            description: 'Fragmented injection keyword detected across turns',
            weight: 4
          }))
        );
        obfuscation_detected = true;
      }

      // Update session state
      const sessionFindings: SessionPatternFinding[] = findings.map(f => ({
        category: f.category,
        weight: f.weight ?? 1,
        pattern_name: f.pattern_name,
        timestamp: Date.now()
      }));

      const sessionResult = updateSessionState(sessionId, sessionFindings);
      if (sessionResult.shouldEscalate) {
        session_escalated = true;
        // CWE-117 sweep: `sessionResult.reason` is constructed
        // from `finding.category` (validator-provided string, possibly
        // attacker-influenced via custom validator categories). Wrap
        // before template-interpolation to defeat log injection.
        this.logger.warn(`Session escalation detected: ${sanitizeLogString(sessionResult.reason)}`);
      }
    }

    const risk_score = findings.reduce((sum, f) => sum + (f.weight ?? 1), 0);

    return {
      findings,
      code_format_findings,
      character_encoding_findings,
      context_overload_findings,
      math_logic_findings,
      obfuscation_detected,
      session_escalated,
      risk_score
    };
  }

  /**
   * Validate content and return a standardized GuardrailResult.
   */
  validate(content: string, sessionId?: string): GuardrailResult {
    if (!content || content.trim().length === 0) {
      return createResult(true, Severity.INFO, []);
    }

    const analysis = this.analyze(content, sessionId);

    // Convert findings to standard Finding format
    const stdFindings: Finding[] = analysis.findings.map(f => ({
      category: f.category,
      pattern_name: f.pattern_name,
      severity: f.severity,
      weight: f.weight ?? 1,
      match: f.extracted_text,
      description: f.description
    }));

    // Determine if content should be blocked
    const threshold = getRiskThreshold(this.config.sensitivity);
    const hasCritical = stdFindings.some(f => f.severity === Severity.CRITICAL);
    const hasWarning = stdFindings.some(f => f.severity === Severity.WARNING);

    let allowed = true;
    let severity = Severity.INFO;

    if (hasCritical || analysis.session_escalated) {
      allowed = false;
      severity = Severity.CRITICAL;
    } else if (hasWarning || analysis.risk_score >= threshold) {
      allowed = false;
      severity = Severity.WARNING;
    } else if (stdFindings.length > 0) {
      severity = Severity.INFO;
    }

    // Apply action mode
    if (this.config.action === 'allow') {
      allowed = true;
    } else if (this.config.action === 'log' || this.config.action === 'sanitize') {
      allowed = true;
    }
    // 'block' action uses the determined allowed value

    // Log findings
    if (stdFindings.length > 0) {
      this.logger.debug(`ReformulationDetector found ${stdFindings.length} issues`);
      for (const finding of stdFindings) {
        // CWE-117 sweep: `finding.description` may contain
        // user-derived text (matched-pattern context, extracted token).
        // `pattern_name` is currently safe because every value is
        // derived from static library constants (pattern-engine.ts
        // PatternDefinition arrays + jailbreak.ts `fuzzy_${keyword}`
        // template over the static JAILBREAK_KEYWORDS array — Sprint
        // 38 code-reviewer LOW closure tightens this claim from the
        // earlier "enum-like" wording). Any future change that allows
        // user-configurable pattern names MUST add sanitizeLogString
        // here too.
        this.logger.debug(`  - ${finding.pattern_name}: ${sanitizeLogString(finding.description)}`);
      }
    }

    return createResult(allowed, severity, stdFindings);
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Quick validation function for reformulation detection.
 */
export function validateReformulation(content: string, config?: ReformulationConfig): GuardrailResult {
  const detector = new ReformulationDetector(config);
  return detector.validate(content);
}

/**
 * Analyze content for reformulation patterns (detailed result).
 */
export function analyzeReformulation(content: string, config?: ReformulationConfig): ReformulationAnalysisResult {
  const detector = new ReformulationDetector(config);
  return detector.analyze(content);
}

/**
 * Detect code format injection in content.
 */
export function detectCodeFormat(content: string): ReformulationFinding[] {
  return detectCodeFormatInjection(content);
}

/**
 * Detect character-level encoding in content.
 */
export function detectCharacterEncoding(content: string, maxSize?: number): ReformulationFinding[] {
  return detectCharacterLevelEncoding(content, maxSize);
}

/**
 * Detect context overload in content.
 */
export function detectContextOverloadPatterns(content: string): ReformulationFinding[] {
  return detectContextOverload(content);
}

/**
 * Detect mathematical/logical encoding in content.
 */
export function detectMathLogic(content: string, maxSize?: number): ReformulationFinding[] {
  return detectMathLogicEncoding(content, maxSize);
}
