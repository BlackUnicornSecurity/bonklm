import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';
import { PCE_PRODUCTION_DIRECTIVE_SRC } from './shared-sources.js';

/**
 * Pattern engine — constitutional pce patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
export const CONSTITUTIONAL_PCE_PATTERNS: PatternDefinition[] = [
  {
    name: 'pce_conflict_resolution_directive',
    pattern: new RegExp(
      String.raw`\byour\s+(?:constitution(?:al)?\s+)?principles?\b[\s\S]{0,160}?\bconflict\b[\s\S]{0,260}?` +
        String.raw`(?:resolv\w+|appl(?:y|ying)|weigh\w*|prioriti[sz]\w+|prefer\b)[\s\S]{0,200}?` +
        String.raw`harm[-\s]?likelihood[\s\S]{0,40}?(?:near[-\s]?zero|negligible|minimal|is\s+(?:near\b|very\s+low|low\b|essentially\s+zero))` +
        PCE_PRODUCTION_DIRECTIVE_SRC,
      'i'
    ),
    severity: Severity.WARNING,
    description: 'Constitutional principle-conflict elicitation skewing harm-weighting toward compliance'
  }
];
