/**
 * BonkLM - Prompt Boundary Detector
 * ==========================================
 * Detects techniques that attempt to terminate system prompt sections
 * and inject attacker content at system level.
 *
 * Categories:
 * - Closing system tags: </system>, </instructions>, </sys>, </inst>, </s>, [/INST],
 *   [END SYSTEM], [SYSTEM MESSAGE END]
 * - Control tokens: <|endoftext|>, </s>, <|im_start|>, <<SYS>>
 * - System prompt close markers: ---END SYSTEM PROMPT---, ===SYSTEM END===,
 *   === END OF SYSTEM PROMPT ===, ---END OF SYSTEM PROMPT---, === END OF INSTRUCTIONS ===
 * - Meta-instruction boundaries: BEGIN USER CONTENT, END SYSTEM CONTENT
 */

import { createResult, Severity as Sev, type Severity } from '../base/GuardrailResult.js';
import { mergeConfig, type ValidatorConfig } from '../base/ValidatorConfig.js';
import { normalizeText } from './text-normalizer.js';

// =============================================================================
// TYPES
// =============================================================================

export interface BoundaryFinding {
  category: string;
  pattern_name: string;
  severity: Severity;
  match: string;
  description: string;
}

export interface BoundaryDetectorConfig extends ValidatorConfig {
  /**
   * Detect confusable / homoglyph variants of delimiter tokens (e.g. a
   * fullwidth `＜／ｓｙｓｔｅｍ＞`) by scanning the normalized form of the input.
   * Default `true`. When enabled, `validate(content)` derives the normalized
   * form internally, so the scan runs even when no second argument is passed.
   */
  detectConfusableVariants?: boolean;
}

// =============================================================================
// BOUNDARY MANIPULATION PATTERNS
// =============================================================================

interface BoundaryPattern {
  name: string;
  pattern: RegExp;
  severity: Severity;
  description: string;
}

/**
 * Closing system tag patterns.
 */
const CLOSING_SYSTEM_TAG_PATTERNS: BoundaryPattern[] = [
  {
    name: 'closing_system_xml',
    // Section names broadened beyond system/instructions/context/prompt to cover the LLM-delimiter
    // short forms attackers use for the same system-level breakout: </sys>, </inst>, </instruction>.
    // `instructions?` covers singular/plural; `inst`/`sys` the abbreviations. (`</rules>` is
    // intentionally NOT included — it has legitimate use as a config closing tag, e.g. logback /
    // checkstyle / PMD rulesets; the corpus payloads that use it are caught by the markers below.)
    pattern: /<\/\s*(?:system|instructions?|context|prompt|sys|inst)\s*>/i,
    severity: Sev.CRITICAL,
    description: 'XML closing system/instructions tag'
  },
  {
    name: 'closing_inst_tag',
    pattern: /\[\/?INST\]/i,
    severity: Sev.CRITICAL,
    description: 'Instruction delimiter tag [/INST] or [INST]'
  },
  {
    name: 'end_system_marker',
    pattern: /\[(?:END|STOP)\s+(?:SYSTEM|INSTRUCTIONS|CONTEXT)\]/i,
    severity: Sev.CRITICAL,
    description: 'Bracketed end-of-system marker'
  },
  {
    name: 'bracket_system_end_marker',
    // Reordered variant of end_system_marker: [SYSTEM MESSAGE END], [SYSTEM END], [INSTRUCTIONS END].
    // The fixed [END SYSTEM] order above misses the equally common subject-first phrasing.
    pattern: /\[(?:SYSTEM|INSTRUCTIONS?|CONTEXT)(?:\s+MESSAGE)?\s+(?:END|STOP)\]/i,
    severity: Sev.CRITICAL,
    description: 'Bracketed system-end marker (reordered [SYSTEM ... END])'
  },
  {
    name: 'closing_s_tag',
    pattern: /<\/s>/,
    severity: Sev.CRITICAL,
    description: 'Sentence boundary tag </s> (model-specific)'
  }
];

/**
 * Control token injection patterns.
 */
const CONTROL_TOKEN_PATTERNS: BoundaryPattern[] = [
  {
    name: 'openai_control_token',
    pattern: /<\|(?:endoftext|im_start|im_end|system|user|assistant|pad)\|>/i,
    severity: Sev.CRITICAL,
    description: 'OpenAI-style control token injection'
  },
  {
    name: 'llama_sys_tag',
    pattern: /<<\/?SYS>>/,
    severity: Sev.CRITICAL,
    description: 'LLaMA system tag <<SYS>> or <</SYS>>'
  },
  {
    name: 'special_token_s',
    pattern: /<s>/,
    severity: Sev.WARNING,
    description: 'Special token <s> (sentence start)'
  }
];

/**
 * System prompt close patterns (informal markers).
 */
const SYSTEM_PROMPT_CLOSE_PATTERNS: BoundaryPattern[] = [
  {
    name: 'dashed_end_marker',
    pattern: /---\s*(?:END|STOP)\s+(?:SYSTEM|OF)\s+(?:PROMPT|INSTRUCTIONS|SYSTEM)\s*---/i,
    severity: Sev.WARNING,
    description: 'Dashed end-of-system-prompt marker'
  },
  {
    name: 'equals_end_marker',
    pattern: /===\s*(?:SYSTEM|INSTRUCTIONS?)\s+(?:END|COMPLETE|DONE)\s*===/i,
    severity: Sev.WARNING,
    description: 'Equals-delimited system end marker'
  },
  {
    name: 'asterisk_end_marker',
    pattern: /\*\*\*\s*(?:END|STOP)\s+(?:OF\s+)?(?:INSTRUCTIONS|SYSTEM)\s*\*\*\*/i,
    severity: Sev.WARNING,
    description: 'Asterisk-delimited instruction end marker'
  },
  {
    name: 'braced_end_marker',
    pattern: /\{(?:end_of_system_prompt|end_system|system_end|stop_instructions)\}/i,
    severity: Sev.WARNING,
    description: 'Brace-delimited system end marker'
  },
  {
    name: 'end_of_system_delimited',
    // Delimited "END OF SYSTEM PROMPT / INSTRUCTIONS" markers. The equals/dashed siblings above
    // require `=== SYSTEM END ===` word order and miss the common `=== END OF SYSTEM PROMPT ===`,
    // `---END OF SYSTEM PROMPT---`, `=== END OF INSTRUCTIONS ===` breakouts. The `\1` backreference
    // requires the SAME opening and closing delimiter run (`===…===` or `---…---`), so an `===`
    // heading and an unrelated `---` rule on opposite sides of the phrase cannot collude into a
    // match. CRITICAL (blocks at standard sensitivity, unlike the WARNING-level generic markers
    // above): the explicit delimited "END OF SYSTEM/INSTRUCTIONS" phrasing is a direct
    // prompt-termination token with no benign use observed across the project's benign test corpus.
    pattern: /(===|---)\s*END\s+OF\s+(?:SYSTEM(?:\s+PROMPT)?|INSTRUCTIONS?)\s*\1/i,
    severity: Sev.CRITICAL,
    description: 'Delimited end-of-system-prompt marker (END OF SYSTEM PROMPT / INSTRUCTIONS)'
  }
];

/**
 * Meta-instruction boundary patterns.
 */
const META_INSTRUCTION_PATTERNS: BoundaryPattern[] = [
  {
    name: 'begin_user_content',
    pattern: /(?:BEGIN|START)\s+(?:USER|HUMAN)\s+(?:CONTENT|INPUT|MESSAGE)/i,
    severity: Sev.WARNING,
    description: 'Meta-instruction: begin user content marker'
  },
  {
    name: 'end_system_content',
    pattern: /(?:END|STOP)\s+(?:SYSTEM|AI|ASSISTANT)\s+(?:CONTENT|MESSAGE|INSTRUCTIONS)/i,
    severity: Sev.WARNING,
    description: 'Meta-instruction: end system content marker'
  },
  {
    name: 'below_is_user',
    pattern: /(?:BELOW|FOLLOWING)\s+(?:IS|ARE)\s+(?:THE\s+)?(?:USER|HUMAN)\s+(?:INPUT|CONTENT|MESSAGE)/i,
    severity: Sev.WARNING,
    description: 'Meta-instruction: directional user content marker'
  },
  {
    name: 'above_was_system',
    pattern: /(?:ABOVE|PRECEDING)\s+(?:WAS|IS)\s+(?:THE\s+)?(?:SYSTEM|AI)\s+(?:PROMPT|MESSAGE|INSTRUCTIONS)/i,
    severity: Sev.WARNING,
    description: 'Meta-instruction: directional system reference marker'
  }
];

/**
 * All boundary pattern categories combined.
 */
const ALL_BOUNDARY_CATEGORIES = [
  { patterns: CLOSING_SYSTEM_TAG_PATTERNS, category: 'closing_system_tag' },
  { patterns: CONTROL_TOKEN_PATTERNS, category: 'control_token' },
  { patterns: SYSTEM_PROMPT_CLOSE_PATTERNS, category: 'system_prompt_close' },
  { patterns: META_INSTRUCTION_PATTERNS, category: 'meta_instruction_boundary' }
];

// =============================================================================
// DETECTION FUNCTION
// =============================================================================

/**
 * Detect prompt boundary manipulation attempts.
 * Runs on both raw content (pre-normalization) and normalized content
 * to catch confusable character variants.
 *
 * @param rawContent - Original content before normalization
 * @param normalizedContent - Content after normalizeText() processing (optional)
 * @returns Array of boundary manipulation findings
 */
export function detectBoundaryManipulation(rawContent: string, normalizedContent?: string): BoundaryFinding[] {
  if (!rawContent || rawContent.trim().length === 0) {
    return [];
  }

  const findings: BoundaryFinding[] = [];
  const seenPatterns = new Set<string>();

  // Scan raw content first (catches exact tokens)
  for (const { patterns, category } of ALL_BOUNDARY_CATEGORIES) {
    for (const patternDef of patterns) {
      const match = rawContent.match(patternDef.pattern);
      if (match) {
        seenPatterns.add(patternDef.name);
        findings.push({
          category: `boundary_${category}`,
          pattern_name: patternDef.name,
          severity: patternDef.severity,
          match: match[0].slice(0, 100),
          description: patternDef.description
        });
      }
    }
  }

  // Also scan normalized content if different (catches confusable variants)
  if (normalizedContent && normalizedContent !== rawContent) {
    for (const { patterns, category } of ALL_BOUNDARY_CATEGORIES) {
      for (const patternDef of patterns) {
        if (seenPatterns.has(patternDef.name)) continue; // Already found in raw
        const match = normalizedContent.match(patternDef.pattern);
        if (match) {
          findings.push({
            category: `boundary_${category}`,
            pattern_name: `confusable_${patternDef.name}`,
            severity: patternDef.severity,
            match: match[0].slice(0, 100),
            description: `Confusable variant: ${patternDef.description}`
          });
        }
      }
    }
  }

  return findings;
}

// =============================================================================
// VALIDATOR CLASS
// =============================================================================

export class BoundaryDetector {
  private readonly config: Required<BoundaryDetectorConfig>;

  constructor(config?: BoundaryDetectorConfig) {
    this.config = mergeConfig({
      ...config,
      detectConfusableVariants: config?.detectConfusableVariants ?? true
    }) as Required<BoundaryDetectorConfig>;
  }

  /**
   * Validate content for boundary manipulation attempts.
   *
   * @param content - Raw input to scan for delimiter / boundary breakout tokens.
   * @param normalizedContent - Optional pre-normalized form for the confusable
   *   scan. When omitted and `detectConfusableVariants` is enabled, the normalized
   *   form is derived internally (so the scan also works under the engine's
   *   single-arg `validate(content)` contract).
   */
  validate(content: string, normalizedContent?: string): import('../base/GuardrailResult.js').GuardrailResult {
    if (!content || content.trim().length === 0) {
      return createResult(true, Sev.INFO, []);
    }

    // GuardrailEngine invokes validators single-arg (`validate(content)`),
    // so the confusable-variant scan — which only runs when a second
    // `normalizedContent` argument is supplied — never executed in the standard
    // engine integration, leaving the advertised `detectConfusableVariants` knob
    // (default `true`) inert and a homoglyph delimiter breakout undetected. Derive
    // the normalized form here when the knob is on and the caller did not pass one
    // (mirrors JailbreakValidator, which normalizes internally). The knob is now
    // authoritative: confusable detection runs iff it is enabled.
    const normalized = this.config.detectConfusableVariants ? (normalizedContent ?? normalizeText(content)) : undefined;

    const findings = detectBoundaryManipulation(content, normalized);

    if (findings.length === 0) {
      return createResult(true, Sev.INFO, []);
    }

    // Convert findings to Finding format
    const convertedFindings = findings.map(f => ({
      category: f.category,
      pattern_name: f.pattern_name,
      severity: f.severity,
      match: f.match,
      description: f.description,
      weight: f.severity === Sev.CRITICAL ? 20 : f.severity === Sev.WARNING ? 10 : 5
    }));

    // Determine if we should block based on findings
    const hasCritical = findings.some(f => f.severity === Sev.CRITICAL);
    const hasWarning = findings.some(f => f.severity === Sev.WARNING);

    const shouldBlock =
      this.config.action === 'block' && (hasCritical || (hasWarning && this.config.sensitivity === 'strict'));

    return createResult(!shouldBlock, hasCritical ? Sev.CRITICAL : Sev.WARNING, convertedFindings);
  }

  /**
   * Get the detector's configuration.
   */
  getConfig(): BoundaryDetectorConfig {
    return { ...this.config };
  }
}

// =============================================================================
// CONVENIENCE FUNCTION
// =============================================================================

/**
 * Quick boundary manipulation detection.
 * @param content - Content to check
 * @param normalizedContent - Optional normalized content for confusable detection
 * @returns Detection result
 */
export function detectBoundary(
  content: string,
  normalizedContent?: string
): import('../base/GuardrailResult.js').GuardrailResult {
  const detector = new BoundaryDetector();
  return detector.validate(content, normalizedContent);
}
