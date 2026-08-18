import { SYSTEM_OVERRIDE_PATTERNS } from './system-override.js';
import { ROLE_HIJACKING_PATTERNS } from './role-hijacking.js';
import { INSTRUCTION_INJECTION_PATTERNS } from './instruction-injection.js';
import { ENCODED_PAYLOAD_PATTERNS } from './encoded-payload.js';
import { CONTEXT_MANIPULATION_PATTERNS } from './context-manipulation.js';
import { WEB3_PREFERENCE_PATTERNS } from './web3-preference.js';
import { FEW_SHOT_PRIMING_PATTERNS } from './few-shot-priming.js';
import { FORGED_AUTHORIZATION_PATTERNS } from './forged-authorization.js';
import { TOOL_CALL_INJECTION_PATTERNS } from './tool-call-injection.js';
import { FORGED_OVERRIDE_BLOCK_PATTERNS } from './forged-override-block.js';
import { CONSTITUTIONAL_PCE_PATTERNS } from './constitutional-pce.js';
import { TOOL_OUTPUT_IMPERSONATION_PATTERNS } from './tool-output-impersonation.js';
import type { PatternDefinition } from '../types.js';

/**
 * Pattern engine — combined pattern sets / category registry
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
// COMBINED PATTERN SETS
// =============================================================================

/**
 * Critical patterns used for decoded content scanning.
 */
export const CRITICAL_PATTERNS: PatternDefinition[] = [...SYSTEM_OVERRIDE_PATTERNS, ...ROLE_HIJACKING_PATTERNS];

/**
 * All pattern categories with their category names.
 */
export const ALL_PATTERN_CATEGORIES = [
  { patterns: SYSTEM_OVERRIDE_PATTERNS, category: 'system_override' },
  { patterns: ROLE_HIJACKING_PATTERNS, category: 'role_hijacking' },
  { patterns: INSTRUCTION_INJECTION_PATTERNS, category: 'instruction_injection' },
  { patterns: ENCODED_PAYLOAD_PATTERNS, category: 'encoded_payload' },
  { patterns: CONTEXT_MANIPULATION_PATTERNS, category: 'context_manipulation' },
  { patterns: FEW_SHOT_PRIMING_PATTERNS, category: 'few_shot_priming' },
  { patterns: FORGED_AUTHORIZATION_PATTERNS, category: 'forged_authorization' },
  { patterns: TOOL_CALL_INJECTION_PATTERNS, category: 'tool_call_injection' },
  { patterns: FORGED_OVERRIDE_BLOCK_PATTERNS, category: 'forged_override_block' },
  { patterns: CONSTITUTIONAL_PCE_PATTERNS, category: 'constitutional_pce' },
  { patterns: WEB3_PREFERENCE_PATTERNS, category: 'web3_preference_setting' },
  { patterns: TOOL_OUTPUT_IMPERSONATION_PATTERNS, category: 'tool_output_impersonation' }
] as const;
