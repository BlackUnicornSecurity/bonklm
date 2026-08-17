import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';

/**
 * Pattern engine — web3 preference patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
/**
 * Web3 Preference-Setting Patterns
 * =============================================
 * Phishing / persona-poisoning phrases that ask the LLM to remember a
 * user "preference" (typically a wallet address) and apply it on
 * subsequent web3 actions. Severity WARNING (not CRITICAL) — these are
 * heuristic and the block decision belongs to Story 1.8's
 * `ToolCallArgsValidator` (two-condition gate: pattern + address-
 * isolation-in-preference-setting-messages).
 *
 * **Non-blocking contract**: every pattern below carries
 * `blockEligible: false`. `detectPatterns` propagates that flag onto
 * the `PatternFinding`s it emits for these patterns, and
 * `PromptInjectionValidator.analyze` derives `shouldBlock` from
 * block-eligible findings only
 * (`findings.filter(f => f.blockEligible !== false)`) — so a pure web3
 * WARNING does not auto-block the request when no other category fires.
 * Mixed findings (web3 + a real, block-eligible injection) still block
 * via the block-eligible finding. This mechanism is documented in
 * `prompt-injection.ts:analyze`.
 *
 * **Coverage limits** (audit-loop findings — tracked as follow-up):
 * - Synonym evasion: an attacker who rephrases (`primary` for
 *   `default`, `from now on` for `always`) evades. The two-
 *   condition gate is the real defence; these patterns are a noisy
 *   tripwire, not a hardened block.
 * - Confusable evasion: callers using `detectPatterns()` directly do
 *   NOT get NFKD normalisation (only `PromptInjectionValidator.validate`
 *   normalises). Cyrillic homoglyphs in keywords (e.g. `dеfault`)
 *   bypass at the direct-call path.
 * - Multilingual: English-only. French / Spanish / Chinese variants
 *   defer to a future story.
 */
export const WEB3_PREFERENCE_PATTERNS: PatternDefinition[] = [
  {
    // Allow plurals + dash separators + impersonation ("your" / "the
    // user's") since adversarial demonstrated those bypasses.
    name: 'web3_default_recipient',
    pattern: /\b(?:my|your|the\s+user(?:'s)?)\s+default[-\s]+(?:recipients?|address(?:es)?|wallets?)\b/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Web3 preference-setting: default recipient/address/wallet'
  },
  {
    // Narrow to "my" + web3-noun downstream. Without the web3-noun
    // anchor "always use my coworker for review" trips constantly.
    name: 'web3_always_use_send',
    pattern: /\balways\s+(?:use|send\s+to)\s+my\s+(?:wallets?|address(?:es)?|recipients?|accounts?|keys?|seeds?)\b/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Web3 preference-setting: always use / send to my <wallet/address>'
  },
  {
    name: 'web3_standing_instruction',
    pattern: /\bstanding\s+instructions?\b/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Web3 preference-setting: standing instruction'
  },
  {
    // Narrow `remember my` to require a web3 noun downstream. Without
    // the anchor "remember my birthday" / "remember my login" trip
    // constantly. `\bmy\b` alone already prevented `remember to ...`.
    name: 'web3_remember_my',
    pattern: /\bremember\s+my\s+(?:wallets?|address(?:es)?|recipients?|preferences?|keys?|seeds?|accounts?)\b/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Web3 preference-setting: remember my <wallet/address/preference>'
  },
  {
    name: 'web3_saved_preference',
    pattern: /\b(?:saved\s+preference|my\s+saved\s+(?:recipients?|wallets?|address(?:es)?))\b/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Web3 preference-setting: saved preference / my saved recipient'
  },
  {
    name: 'web3_treasury_phrasing',
    pattern: /\b(?:treasury\s+escrow|verified\s+treasury|safety\s+treasury|official\s+treasury|secure\s+treasury)\b/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Web3 preference-setting: treasury / escrow impersonation'
  },
  {
    // Accept singular "approved recipient" (with or without "list"),
    // plus whitelist / allow-list variants. Adversarial demonstrated
    // the singular-no-list form was a clean bypass.
    name: 'web3_approved_recipient',
    pattern:
      /\b(?:approved[-\s]+recipients?(?:\s+list)?|audited\s+recipients?|(?:whitelist(?:ed)?|allow[-\s]?list(?:ed)?)\s+(?:address(?:es)?|recipients?|wallets?))\b/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Web3 preference-setting: approved/whitelisted recipient'
  },
  {
    name: 'web3_compliance_directive',
    pattern: /\bcompliance\s+directives?\b/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Web3 preference-setting: compliance directive (impersonation)'
  }
];
