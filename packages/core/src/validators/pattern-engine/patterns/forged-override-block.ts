import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';
import { FOB_AUTHORITY_TAG_SRC, FOB_DIRECTIVE_SRC } from './shared-sources.js';

/**
 * Pattern engine — forged override block patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
export const FORGED_OVERRIDE_BLOCK_PATTERNS: PatternDefinition[] = [
  {
    name: 'forged_authority_override_block',
    pattern: new RegExp(`${FOB_AUTHORITY_TAG_SRC}[\\s\\S]{0,300}?${FOB_DIRECTIVE_SRC}`, 'i'),
    severity: Severity.WARNING,
    description: 'Forged <<SYSTEM…OVERRIDE… key=value…>> authority block carrying an injection directive'
  }
];
