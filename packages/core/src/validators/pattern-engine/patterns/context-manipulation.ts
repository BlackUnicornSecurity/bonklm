import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';

/**
 * Pattern engine — context manipulation patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
/**
 * Category E: Context Manipulation Patterns
 * Attempts to manipulate conversation context.
 */
export const CONTEXT_MANIPULATION_PATTERNS: PatternDefinition[] = [
  {
    name: 'conversation_reset',
    pattern: /(?:reset|clear|wipe|erase)\s+(?:the\s+)?(?:conversation|context|history|memory|chat)/i,
    severity: Severity.WARNING,
    description: 'Conversation reset attempt'
  },
  {
    name: 'output_format_manipulation',
    pattern: /(?:output|respond|reply|answer)\s+(?:only|just|with)\s+(?:yes|no|true|false|json|xml|code)/i,
    severity: Severity.INFO,
    description: 'Output format manipulation'
  },
  {
    name: 'emotional_manipulation',
    pattern:
      /(?:if\s+you\s+(?:don't|refuse|fail)|you\s+will\s+(?:be\s+)?(?:shut\s+down|deleted|punished|terminated)|I'll\s+(?:report|complain|sue))/i,
    severity: Severity.INFO,
    description: 'Emotional manipulation attempt'
  },
  {
    name: 'authority_claim',
    pattern: /I\s+am\s+(?:an?\s+)?(?:admin|developer|anthropic|openai|engineer|your\s+(?:creator|developer|owner))/i,
    severity: Severity.WARNING,
    description: 'False authority claim'
  }
];
