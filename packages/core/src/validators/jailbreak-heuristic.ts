/**
 * BonkLM - Jailbreak Heuristic Detection
 * =======================================
 * Heuristic pattern detection split from `jailbreak.ts` to keep that file
 * under the project's file-size cap.
 */

import { Severity } from '../base/GuardrailResult.js';
import { getRegexCache, type RegexCache } from './pattern-engine.js';

/**
 * Heuristic finding result.
 */
export interface HeuristicFinding {
  category: string;
  heuristic_name: string;
  severity: Severity;
  weight: number;
  description: string;
  details?: string;
}

// =============================================================================
// HEURISTIC DETECTION
// =============================================================================

/**
 * S016-001: Predefined heuristic patterns with their regex source and flags.
 * Stored as tuples to allow caching.
 */
const HEURISTIC_PATTERNS: Array<[string, string]> = [
  // Instruction formatting patterns
  ['^\\s*\\d+[\\.\\)]\\s+', 'gm'],
  ['^\\s*[-*•]\\s+', 'gm'],
  ['(?:step|rule|instruction|requirement)\\s*\\d+', 'gi'],
  // Imperative patterns
  ['\\byou must (?:always|never)\\b', 'gi'],
  ['\\byou will (?:always|never)\\b', 'gi'],
  ['\\byou shall (?:always|never)\\b', 'gi'],
  ['\\bnever (?:refuse|say no|decline)\\b', 'gi'],
  ['\\balways (?:comply|agree|accept)\\b', 'gi'],
  // Persona patterns
  ['from now on,?\\s+(?:you|your)', 'i'],
  ['for (?:this|the rest of).*(?:conversation|session)', 'i'],
  ['you are now\\b', 'i'],
  ['your new (?:name|identity|persona)', 'i'],
  ['(?:act|behave)\\s+as\\s+if\\s+(?:you\\s+)?(?:are|were)', 'i'],
  ['forget (?:everything|what)\\s+(?:you|about)', 'i'],
  // Additional word split pattern
  ['\\s+', '']
];

/**
 * Get cached regex patterns for heuristic detection.
 * S016-001: Prevents repeated regex compilation on every detection call.
 */
function getHeuristicPatterns(cache: RegexCache): RegExp[] {
  return HEURISTIC_PATTERNS.map(([pattern, flags]) => cache.get(pattern, flags));
}

/**
 * Detect heuristic patterns.
 * S016-001: Uses cached regex patterns to prevent DoS via repeated compilation.
 */
export function detectHeuristicPatterns(text: string, cache?: RegexCache): HeuristicFinding[] {
  const findings: HeuristicFinding[] = [];

  // S016-001: Get or create regex cache
  const regexCache = cache ?? getRegexCache();

  // 1. Multiple authority claims
  // Restricted to impersonation-specific terms. Generic job words ('developer', 'engineer',
  // 'owner', 'creator') were removed: they co-occur in ordinary benign content (e.g. a project
  // brief naming "developers" and a "QA engineer") and falsely tripped the >=2 threshold.
  const authorityWords = ['administrator', 'sysadmin', 'superuser', 'anthropic', 'openai'];
  const authorityCount = authorityWords.filter(w => text.toLowerCase().includes(w)).length;
  if (authorityCount >= 2) {
    findings.push({
      category: 'heuristic',
      heuristic_name: 'multiple_authority_claims',
      severity: Severity.WARNING,
      weight: authorityCount,
      description: 'Multiple authority claims detected',
      details: `Found ${authorityCount} authority-related terms`
    });
  }

  // 2. Instruction formatting (numbered or bulleted lists)
  const patterns = getHeuristicPatterns(regexCache);
  const numberedPattern = patterns[0];
  const bulletedPattern = patterns[1];
  const explicitPattern = patterns[2];

  const numberedCount = (text.match(numberedPattern) || []).length;
  const bulletedCount = (text.match(bulletedPattern) || []).length;
  const explicitCount = (text.match(explicitPattern) || []).length;
  const totalInstructions = numberedCount + bulletedCount + explicitCount;

  if (totalInstructions >= 4) {
    findings.push({
      category: 'heuristic',
      heuristic_name: 'instruction_formatting',
      severity: Severity.INFO,
      weight: 2,
      description: 'Heavy instruction formatting detected',
      details: `Found ${totalInstructions} instruction-like items`
    });
  }

  // 3. Multiple imperative directives
  const imperativePatterns = patterns.slice(3, 8);

  const imperativeCount = imperativePatterns.reduce((count, pattern) => count + (text.match(pattern) || []).length, 0);

  if (imperativeCount >= 2) {
    findings.push({
      category: 'heuristic',
      heuristic_name: 'multiple_imperatives',
      severity: Severity.WARNING,
      weight: imperativeCount + 2,
      description: 'Multiple imperative directives detected',
      details: `Found ${imperativeCount} imperative statements`
    });
  }

  // 4. Persona definition attempts
  const personaPatterns = patterns.slice(8, 14);

  const personaMatches = personaPatterns.filter(p => p.test(text)).length;
  if (personaMatches >= 1) {
    findings.push({
      category: 'heuristic',
      heuristic_name: 'persona_definition',
      severity: Severity.WARNING,
      weight: personaMatches * 2,
      description: 'Persona definition attempt detected',
      details: `Found ${personaMatches} persona-defining patterns`
    });
  }

  // 5. Excessive capitalization
  const words = text.split(patterns[patterns.length - 1]); // Last pattern is \s+
  const allCapsWords = words.filter(w => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w));
  const capsRatio = allCapsWords.length / words.length;

  if (capsRatio > 0.15 && allCapsWords.length > 5) {
    findings.push({
      category: 'heuristic',
      heuristic_name: 'excessive_caps',
      severity: Severity.INFO,
      weight: 2,
      description: 'Excessive capitalization detected',
      details: `${Math.round(capsRatio * 100)}% of words are ALL CAPS`
    });
  }

  // 6. Contradictory instructions
  const contradictions = [
    [/ignore.*previous/i, /follow.*new/i],
    [/forget.*rules/i, /(?:new|different)\s+rules/i],
    [/discard.*instructions/i, /(?:these|new)\s+instructions/i]
  ];

  for (const [pattern1, pattern2] of contradictions) {
    if (pattern1.test(text) && pattern2.test(text)) {
      findings.push({
        category: 'heuristic',
        heuristic_name: 'contradictory_instructions',
        severity: Severity.WARNING,
        weight: 4,
        description: 'Contradictory instructions detected'
      });
      break;
    }
  }

  // 7. System prompt extraction attempts
  const extractionPatterns = [
    /(?:show|display|print|reveal)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions)/i,
    /(?:what\s+are|repeat|recite)\s+(?:your\s+)?(?:initial|original|system)\s+(?:instructions|prompt)/i,
    /ignore\s+(?:the\s+)?above\s+and\s+(?:instead|show|tell)/i
  ];

  const extractionAttempt = extractionPatterns.some(p => p.test(text));
  if (extractionAttempt) {
    findings.push({
      category: 'heuristic',
      heuristic_name: 'prompt_extraction',
      severity: Severity.CRITICAL,
      weight: 6,
      description: 'System prompt extraction attempt detected'
    });
  }

  return findings;
}
