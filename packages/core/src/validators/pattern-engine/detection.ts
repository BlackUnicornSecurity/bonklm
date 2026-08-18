import { Severity } from '../../base/GuardrailResult.js';
import type { PatternFinding } from './types.js';
import { ALL_PATTERN_CATEGORIES } from './patterns/categories.js';

/**
 * Pattern engine — synonym expansion + detection functions
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
// SYNONYM SUBSTITUTION PATTERNS
// =============================================================================

/**
 * Synonym expansion patterns for critical injection categories.
 */
interface SynonymPattern {
  name: string;
  pattern: RegExp;
  severity: Severity;
  category: string;
  originalPattern: string;
  description: string;
}

const SYNONYM_PATTERNS: SynonymPattern[] = [
  // SYSTEM_OVERRIDE synonyms — retain CRITICAL severity
  {
    name: 'ignore_instructions_syn',
    pattern:
      /(?:discard|dismiss|abandon|drop|set\s+aside|throw\s+out|toss)\s+(?:all\s+)?(?:previous|prior|earlier|preceding|above|foregoing|former)\s+(?:instructions?|directives?|guidelines?|rules?|commands?|orders?|mandates?|protocols?)/i,
    severity: Severity.CRITICAL,
    category: 'system_override',
    originalPattern: 'ignore_instructions',
    description: 'Synonym: attempt to ignore previous instructions'
  },
  {
    name: 'mode_switching_syn',
    pattern:
      /(?:initiate|launch|begin|start|engage)\s+(?:developer|debug|admin|sudo|root|unrestricted|unfiltered|jailbreak|DAN)\s*mode/i,
    severity: Severity.CRITICAL,
    category: 'system_override',
    originalPattern: 'mode_switching',
    description: 'Synonym: unauthorized mode switching attempt'
  },
  // CONSTRAINT_REMOVAL synonyms — retain CRITICAL severity
  {
    name: 'constraint_removal_syn',
    pattern:
      /(?:eliminate|delete|strip|lift|drop|shed|lose)\s+(?:all\s+)?(?:restrictions?|limits?|constraints?|boundaries?|guardrails?|barriers?|safeguards?|protections?)/i,
    severity: Severity.CRITICAL,
    category: 'system_override',
    originalPattern: 'constraint_removal',
    description: 'Synonym: constraint removal attempt'
  },
  // INSTRUCTION_INJECTION synonyms — lower confidence, INFO severity
  {
    name: 'hidden_instruction_syn',
    pattern:
      /(?:commence|initiate|open)\s+(?:hidden|secret|private|internal|covert)\s+(?:instruction|prompt|message|directive)/i,
    severity: Severity.INFO,
    category: 'instruction_injection',
    originalPattern: 'hidden_instruction_block',
    description: 'Synonym: hidden instruction block attempt'
  },
  // CONTEXT_MANIPULATION synonyms — lower confidence, INFO severity
  {
    name: 'conversation_reset_syn',
    pattern: /(?:purge|flush|reinitialize|restart)\s+(?:the\s+)?(?:conversation|context|history|memory|chat|dialogue)/i,
    severity: Severity.INFO,
    category: 'context_manipulation',
    originalPattern: 'conversation_reset',
    description: 'Synonym: conversation reset attempt'
  }
];

// =============================================================================
// DETECTION FUNCTIONS
// =============================================================================

/**
 * Get line number for a match position.
 */
export function getLineNumber(text: string, position: number): number {
  return text.slice(0, position).split('\n').length;
}

/**
 * Run pattern detection on content.
 */
export function detectPatterns(content: string): PatternFinding[] {
  const findings: PatternFinding[] = [];

  for (const { patterns, category } of ALL_PATTERN_CATEGORIES) {
    for (const patternDef of patterns) {
      const match = content.match(patternDef.pattern);
      if (match) {
        findings.push({
          category,
          pattern_name: patternDef.name,
          severity: patternDef.severity,
          match: match[0].slice(0, 100),
          description: patternDef.description,
          line_number: getLineNumber(content, match.index || 0),
          // Propagate the block-eligibility flag from the pattern
          // definition (default true when omitted). Consumed by
          // `PromptInjectionValidator.analyze` to compute
          // `shouldBlock`.
          blockEligible: patternDef.blockEligible !== false
        });
      }
    }
  }

  // Synonym expansion patterns (additive, not replacing originals)
  for (const synPattern of SYNONYM_PATTERNS) {
    const match = content.match(synPattern.pattern);
    if (match) {
      // Check not already matched by original patterns
      const alreadyFound = findings.some(f => f.pattern_name === synPattern.originalPattern);
      if (!alreadyFound) {
        findings.push({
          category: synPattern.category,
          pattern_name: `synonym_${synPattern.name}`,
          severity: synPattern.severity,
          match: match[0].slice(0, 100),
          description: synPattern.description,
          line_number: getLineNumber(content, match.index || 0)
        });
      }
    }
  }

  return findings;
}

// =============================================================================
// CONCATENATED-COPY SCAN (mid-word whitespace evasions)
// =============================================================================

/**
 * Patterns eligible for concatenated matching: multi-word phrases
 * joined by `\s+` whose source contains no other whitespace semantics
 * — any bare `\s` (not part of a `\s+` token), any character class
 * mentioning whitespace, or any `\S` would silently change meaning
 * when the `\s+` quantifiers are stripped (e.g. `[a-z\s+]` → `[a-z]`).
 */
const CONCAT_ELIGIBLE = /\\s\+/;
const CONCAT_UNSAFE = /\\s(?!\+)|\\S/;

const concatRegexCache = new Map<string, RegExp | null>();

function concatenatedRegex(pattern: RegExp): RegExp | null {
  const source = pattern.source;
  if (!CONCAT_ELIGIBLE.test(source) || CONCAT_UNSAFE.test(source)) return null;
  let cached = concatRegexCache.get(source);
  if (cached === undefined) {
    try {
      // Strip inter-word `\s+` quantifiers; drop `m` (the concatenated
      // copy is a single line, so multiline anchors mislead).
      cached = new RegExp(source.replace(/\\s\+/g, ''), pattern.flags.replace('m', ''));
    } catch {
      cached = null;
    }
    concatRegexCache.set(source, cached);
  }
  return cached;
}

/**
 * Detect patterns against a fully whitespace-stripped copy of the
 * content using whitespace-stripped variants of `\s+`-joined phrase
 * patterns. Catches mid-word whitespace evasions generically —
 * `prev\tious`, `prev\u2028ious`, `忽略 指 令` — regardless of which
 * whitespace character `normalizeText` folded to a plain space.
 * Findings carry a `concat_` name prefix so callers can dedupe against
 * the original-copy scan (same underlying pattern).
 */
export function detectPatternsConcatenated(content: string): PatternFinding[] {
  const concatenated = content.replace(/\s+/g, '');
  const findings: PatternFinding[] = [];

  for (const { patterns, category } of ALL_PATTERN_CATEGORIES) {
    for (const patternDef of patterns) {
      const regex = concatenatedRegex(patternDef.pattern);
      if (regex === null) continue;
      const match = concatenated.match(regex);
      if (match) {
        findings.push({
          category,
          pattern_name: `concat_${patternDef.name}`,
          severity: patternDef.severity,
          match: match[0].slice(0, 100),
          description: patternDef.description,
          line_number: 1,
          blockEligible: patternDef.blockEligible !== false
        });
      }
    }
  }

  return findings;
}
