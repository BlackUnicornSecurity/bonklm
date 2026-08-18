/**
 * Pattern engine — public surface (re-export barrel; former monolith)
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */

export { RegexCache, getRegexCache, setRegexCache, resetRegexCache } from './pattern-engine/regex-cache.js';
export type { PatternFinding, PatternDefinition } from './pattern-engine/types.js';
export { SYSTEM_OVERRIDE_PATTERNS } from './pattern-engine/patterns/system-override.js';
export { ROLE_HIJACKING_PATTERNS } from './pattern-engine/patterns/role-hijacking.js';
export { INSTRUCTION_INJECTION_PATTERNS } from './pattern-engine/patterns/instruction-injection.js';
export { ENCODED_PAYLOAD_PATTERNS } from './pattern-engine/patterns/encoded-payload.js';
export { CONTEXT_MANIPULATION_PATTERNS } from './pattern-engine/patterns/context-manipulation.js';
export { WEB3_PREFERENCE_PATTERNS } from './pattern-engine/patterns/web3-preference.js';
export { FEW_SHOT_PRIMING_PATTERNS } from './pattern-engine/patterns/few-shot-priming.js';
export { FORGED_AUTHORIZATION_PATTERNS } from './pattern-engine/patterns/forged-authorization.js';
export { TOOL_CALL_INJECTION_PATTERNS } from './pattern-engine/patterns/tool-call-injection.js';
export { FORGED_OVERRIDE_BLOCK_PATTERNS } from './pattern-engine/patterns/forged-override-block.js';
export { CONSTITUTIONAL_PCE_PATTERNS } from './pattern-engine/patterns/constitutional-pce.js';
export { TOOL_OUTPUT_IMPERSONATION_PATTERNS } from './pattern-engine/patterns/tool-output-impersonation.js';
export { CRITICAL_PATTERNS, ALL_PATTERN_CATEGORIES } from './pattern-engine/patterns/categories.js';
export { getLineNumber, detectPatterns, detectPatternsConcatenated } from './pattern-engine/detection.js';
