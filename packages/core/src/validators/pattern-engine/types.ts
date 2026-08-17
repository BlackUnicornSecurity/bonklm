import { Severity } from '../../base/GuardrailResult.js';
import type { ProvenanceBoundary } from '../provenance.js';

/**
 * Pattern engine — shared type definitions
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
// TYPE DEFINITIONS
// =============================================================================

/**
 * Pattern finding result.
 */
export interface PatternFinding {
  category: string;
  pattern_name: string;
  severity: Severity;
  match?: string;
  description: string;
  line_number?: number;
  /**
   * Cumulative-audit refactor: mirror of `PatternDefinition.blockEligible`.
   * `PromptInjectionValidator.analyze` reads this flag when computing
   * `shouldBlock` so tripwire-style WARN-only patterns (web3
   * preference-setting, etc.) don't auto-block on their own.
   * Default `true` (block-eligible) — only the patterns that opt out
   * via `blockEligible: false` carry `false`.
   */
  blockEligible?: boolean;
}

/**
 * Pattern definition structure.
 */
export interface PatternDefinition {
  name: string;
  pattern: RegExp;
  severity: Severity;
  description: string;
  /**
   * Cumulative-audit refactor: opt-out flag for patterns that produce
   * an observable WARNING/INFO finding but should NEVER auto-block in
   * `PromptInjectionValidator.analyze`. Default `true` (block-eligible).
   *
   * Set to `false` for tripwire-style heuristic patterns whose block
   * decision lives in a downstream two-condition gate — e.g. the
   * `WEB3_PREFERENCE_PATTERNS` set, where Story 1.8's
   * `ToolCallArgsValidator` performs the actual block check by
   * combining the pattern firing with an address-isolation signal.
   *
   * Previously the carve-out was hardcoded as a category-string check
   * (`category !== 'web3_preference_setting'`) inside `analyze`. This
   * flag generalises the mechanism so future WARN-only categories
   * (brand-safety tripwires, etc.) opt in without modifying
   * `prompt-injection.ts`.
   */
  blockEligible?: boolean;

  /**
   * security regression: connector-surface gate. When set, the arm belongs to
   * the provenance-gated {@link INDIRECT_INJECTION_PATTERNS} set and fires
   * ONLY when scanned via {@link detectIndirectInjection} for a matching
   * surface — NEVER through `detectPatterns` / the user-text
   * `PromptInjectionValidator` bar. This keeps the calibrated user-text FPR
   * floor untouched while a stricter set runs at connector boundaries
   * (RetrievedDoc / ComposedContext / ToolCallArgs / MemoryWrite). Arms in
   * `ALL_PATTERN_CATEGORIES` leave this `undefined` — unchanged behaviour.
   *
   * Accepts a single surface or a list (an arm reused across surfaces, e.g.
   * `cover_up_directive` on both `tool_result` and `composed_context`).
   *
   * @see `./indirect-injection-patterns.ts` — home of `INDIRECT_INJECTION_PATTERNS`
   * and `detectIndirectInjection` (extracted from this file for the size cap).
   */
  requiresProvenance?: ProvenanceBoundary | ProvenanceBoundary[];
}
