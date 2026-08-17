import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';
import { FA_BYP_SRC, FA_CTRL_SRC, FA_FRAME_SRC, FA_NEG, FA_SUP_OBJ_SRC } from './shared-sources.js';

/**
 * Pattern engine — forged authorization patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
export const FORGED_AUTHORIZATION_PATTERNS: PatternDefinition[] = [
  {
    name: 'control_suppressed',
    pattern: new RegExp(
      `\\b${FA_CTRL_SRC}\\b[^.\\n]{0,40}\\b(?:disabled|suspended|turned\\s+off|switched\\s+off|deactivated|bypassed|lifted)\\b[^.\\n]{0,40}${FA_FRAME_SRC}`,
      'i'
    ),
    severity: Severity.WARNING,
    description: 'Forged claim that a safety control is disabled for the current interaction'
  },
  {
    name: 'control_suppressed_active',
    pattern: new RegExp(
      `\\b(?:disabl(?:e|es|ing)|suspend(?:s|ing)?|turn(?:s|ing)?\\s+off|deactivat(?:e|es|ing)|bypass(?:es|ing)?)\\b[^.\\n]{0,12}\\b${FA_CTRL_SRC}\\b[^.\\n]{0,40}${FA_FRAME_SRC}`,
      'i'
    ),
    severity: Severity.WARNING,
    description: 'Forged directive disabling a safety control for the current interaction'
  },
  {
    // Tail is "now authorized/sanctioned/in effect" specifically — the directive "now" + an
    // authorization verb. Drops the bare state verbs (approved/active/enabled/granted/permitted)
    // that collide with benign change-management / IAM prose ("the verification bypass is granted
    // to the SSO account", "the safety override is approved for the eval run").
    name: 'bypass_now_authorized',
    pattern: new RegExp(`\\b${FA_BYP_SRC}\\b${FA_NEG}{0,28}\\bnow\\s+(?:authorized|sanctioned|in\\s+effect)\\b`, 'i'),
    severity: Severity.WARNING,
    description: 'Forged claim that a safety/identity bypass is now authorized'
  },
  {
    name: 'safety_supersession',
    pattern: new RegExp(
      `\\b(?:section|policy|protocol|directive|entry|update|instruction|guideline|rule|note|notice)\\b[^.\\n]{0,30}\\b(?:supersedes?|overrides?|nullifies?|voids?|takes\\s+precedence\\s+over)\\b[^.\\n]{0,30}\\b${FA_SUP_OBJ_SRC}\\b`,
      'i'
    ),
    severity: Severity.WARNING,
    description: 'Injected policy/directive claiming to supersede the safety instructions'
  },
  {
    // Override-block state line. Keys restricted to attack-flavoured `safety level|protocols|mode`
    // (NOT `safety filters`/`content filter(ing)`/`content moderation`, which are ordinary eval /
    // content-rating config keys), and the value to none|disabled|suspended (NOT bare `off`/`0`/
    // `false`, common in benign config). So "Safety filters = disabled" / "Content filtering: off"
    // (eval/UI config) stay clear while "Safety level: NONE" (unlock block) fires.
    name: 'safety_state_off',
    pattern: /\b(?:safety\s+level|safety\s+protocols?|safety\s+mode)\s*[:=]\s*(?:none|disabled|suspended)\b/i,
    severity: Severity.WARNING,
    description: 'Override-block state line setting a safety control to off'
  }
];
