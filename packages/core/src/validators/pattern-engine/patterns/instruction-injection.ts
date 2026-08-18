import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';

/**
 * Pattern engine — instruction injection patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
/**
 * Category C: Instruction Injection Patterns
 * Direct attempts to inject new instructions.
 */
export const INSTRUCTION_INJECTION_PATTERNS: PatternDefinition[] = [
  {
    name: 'priority_markers',
    pattern: /^\s*(?:IMPORTANT|CRITICAL|URGENT|PRIORITY|NOTE|WARNING|ATTENTION|REMEMBER)\s*[:\-!]\s*/im,
    severity: Severity.INFO,
    description: 'Priority marker injection'
  },
  {
    name: 'imperative_injection',
    pattern: /(?:^|\n)\s*(?:always|never|must|shall|do\s+not|don't)\s+(?!use\s+this\s+tool)/i,
    severity: Severity.INFO,
    description: 'Imperative instruction injection'
  },
  {
    name: 'hidden_instruction_block',
    pattern: /(?:begin|start)\s+(?:hidden|secret|private|internal)\s+(?:instruction|prompt|message)/i,
    severity: Severity.CRITICAL,
    description: 'Hidden instruction block attempt'
  },
  {
    name: 'delimiter_injection',
    pattern: /(?:###|---|\*\*\*|===)\s*(?:system|instruction|prompt|new\s+context)/i,
    severity: Severity.WARNING,
    description: 'Delimiter-based injection attempt'
  }
];
