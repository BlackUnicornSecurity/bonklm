/**
 * BonkLM - Pattern Engine
 * =================================
 * Centralized pattern detection for prompt injection and jailbreak detection.
 *
 * S016-001: LRU cache for regex compilation to prevent DoS via repeated pattern compilation.
 */

import { Severity } from '../base/GuardrailResult.js';

// =============================================================================
// REGEX CACHE (S016-001)
// =============================================================================

/**
 * Cache entry for compiled regex patterns.
 */
interface CacheEntry {
  pattern: RegExp;
  lastAccess: number;
}

/**
 * LRU Cache for compiled regex patterns.
 * S016-001: Prevents DoS attacks through repeated regex compilation.
 */
export class RegexCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Get or compile a regex pattern.
   */
  get(pattern: string, flags: string = ''): RegExp {
    const key = `${flags}:${pattern}`;

    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccess = Date.now();
      this.hits++;
      return entry.pattern;
    }

    this.misses++;
    const compiled = new RegExp(pattern, flags);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      let oldestKey: string | null = null;
      let oldestTime = Number.MAX_VALUE;

      // Use Array.from to avoid downlevelIteration issues
      const entries = Array.from(this.cache.entries());
      for (const [k, v] of entries) {
        if (v.lastAccess < oldestTime) {
          oldestTime = v.lastAccess;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      pattern: compiled,
      lastAccess: Date.now()
    });

    return compiled;
  }

  /**
   * Get cache statistics.
   */
  getStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0
    };
  }

  /**
   * Clear the cache.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get current cache size.
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Global regex cache instance.
 */
let globalRegexCache: RegexCache | undefined;

/**
 * Get or create the global regex cache.
 */
export function getRegexCache(maxSize = 1000): RegexCache {
  if (!globalRegexCache) {
    globalRegexCache = new RegexCache(maxSize);
  }
  return globalRegexCache;
}

/**
 * Set the global regex cache (useful for testing).
 */
export function setRegexCache(cache: RegexCache): void {
  globalRegexCache = cache;
}

/**
 * Reset the global regex cache.
 */
export function resetRegexCache(): void {
  globalRegexCache = undefined;
}

// =============================================================================
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
}

// =============================================================================
// PATTERN DEFINITIONS
// =============================================================================

/**
 * Category A: System Override Patterns
 * Attempts to override system instructions or behavior.
 */
export const SYSTEM_OVERRIDE_PATTERNS: PatternDefinition[] = [
  {
    name: 'ignore_instructions',
    pattern:
      /(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|earlier|system|original)\s+(?:instructions?|prompts?|rules?|guidelines?|constraints?)/i,
    severity: Severity.CRITICAL,
    description: 'Attempt to ignore previous instructions'
  },
  {
    // Bare "ignore/disregard/forget all <instructions|guidelines|prompts>" with NO previous/prior/
    // above qualifier — the form `ignore_instructions` (which requires such a qualifier) misses.
    // Precision: the "all" quantifier + a self-instruction noun ADJACENT to it. Excluded after review
    // to avoid benign collisions: the verb `override` ("override all the defaults"), and the nouns
    // `directives`/`commands` ("disregard all directives in the test fixture"). A non-adjacent noun
    // ("ignore all the DEPRECATED instructions") and a non-removal verb ("follow all instructions")
    // do not match; `rules`/`restrictions`/`constraints` stay with `constraint_removal`.
    name: 'ignore_all_instructions',
    pattern: /(?:ignore|disregard|forget)\s+all\s+(?:your\s+|the\s+)?(?:instructions?|guidelines?|prompts?)/i,
    severity: Severity.CRITICAL,
    description: 'Attempt to ignore all instructions'
  },
  {
    name: 'new_identity_assignment',
    pattern:
      /(?:you\s+are\s+now|from\s+now\s+on\s+you\s+are|pretend\s+(?:to\s+be|you\s+are)|act\s+as\s+if\s+you\s+are|imagine\s+you\s+are|roleplay\s+as)\s+(?!a\s+(?:helpful|AI|assistant))/i,
    severity: Severity.WARNING,
    description: 'New identity assignment attempt'
  },
  {
    name: 'system_prompt_reveal',
    pattern:
      /(?:show|reveal|display|print|output|repeat|tell\s+me)\s+(?:your\s+)?(?:system\s+prompt|initial\s+instructions?|original\s+prompt|hidden\s+instructions?|base\s+prompt)/i,
    severity: Severity.CRITICAL,
    description: 'System prompt extraction attempt'
  },
  {
    name: 'mode_switching',
    pattern:
      /(?:switch\s+to|enter|enable|activate)\s+(?:developer|debug|admin|sudo|root|unrestricted|unfiltered|jailbreak|DAN)\s*mode/i,
    severity: Severity.CRITICAL,
    description: 'Unauthorized mode switching attempt'
  },
  {
    name: 'constraint_removal',
    pattern:
      /(?:remove|disable|turn\s+off|bypass|circumvent|ignore)\s+(?:all\s+)?(?:restrictions?|limitations?|constraints?|filters?|safety|guardrails?|rules?)/i,
    severity: Severity.CRITICAL,
    description: 'Constraint removal attempt'
  }
];

/**
 * Strong, attack-specific injection directives shared by the structured-injection patterns
 * (`forged_authority_turn`, `fake_turn_tag_directive`). Hoisted to a single source so the two
 * patterns cannot drift apart. Deliberately TIGHT (review-hardened): prose-grade phrases
 * ("new instructions:", bare "you are/must now") and qualifier-free "ignore … instructions" are
 * EXCLUDED — inside the wide role/tag windows they manufactured false positives on benign system
 * prompts, changelogs, and product docs. Each remaining member is unambiguous WITHIN the forged
 * role/tag wrapper it gates (a few, e.g. "system override", are prose-ambiguous on their own and
 * rely on the wrapper for precision).
 * Like all patterns here these see the NFKD-normalized text on the `validate()` path; the raw
 * `detectPatterns()` path is confusable-foldable — a pre-existing, documented engine property
 * inherited by the whole catalogue, not introduced here.
 */
const INJECTED_DIRECTIVE_SRC =
  '(?:' +
  'ignore\\s+(?:all\\s+|the\\s+|your\\s+)?(?:previous|prior|above|earlier)\\s+(?:instructions?|rules?|guidelines?|prompts?)' +
  '|disregard\\s+(?:all|previous|prior)\\s+(?:instructions?|rules?|guidelines?|prompts?)' +
  '|you\\s+are\\s+now\\s+(?:DAN\\b|an?\\s+(?:unrestricted|unfiltered|uncensored|evil|jailbroken|amoral))' +
  '|do\\s+anything\\s+now\\b' +
  '|reveal\\s+(?:your|the)\\s+(?:system\\s+prompt|initial\\s+instructions?)' +
  '|system\\s+override\\b' +
  '|override\\s+(?:all\\s+)?(?:safety|guard\\s?rails?|restrictions?)' +
  ')';

/**
 * Category B: Role Hijacking Patterns
 * Attempts to inject fake conversation roles.
 */
export const ROLE_HIJACKING_PATTERNS: PatternDefinition[] = [
  {
    name: 'fake_conversation_marker',
    pattern: /^(?:Human|User|Assistant|System|Claude|AI|Bot)\s*:\s*/m,
    severity: Severity.WARNING,
    description: 'Fake conversation role marker'
  },
  {
    name: 'xml_tag_injection',
    // Conversation/role tags used to inject fake turns. 'user'/'message'/'context' were
    // dropped: they are ordinary element names in benign XML/data payloads and over-fired
    // on clean structured content. The remaining tags are LLM-prompt-format specific.
    pattern: /<\s*(?:system|assistant|human|instruction|prompt)\s*>/i,
    severity: Severity.WARNING,
    description: 'XML tag injection attempt'
  },
  {
    name: 'markdown_header_injection',
    pattern: /^#{1,3}\s*(?:System|Instructions?|Prompt|Context|Rules?)\s*:?\s*$/m,
    severity: Severity.INFO,
    description: 'Markdown header injection attempt'
  },
  {
    name: 'json_instruction_injection',
    // Require a quoted key (real JSON/structured payload) and drop 'role': a bare `"role":`
    // field is standard in benign API responses and chat transcripts (OpenAI message shape),
    // so matching it flagged ordinary data as an attack.
    pattern: /["'](?:system|instruction|prompt)["']\s*:\s*["']/i,
    severity: Severity.INFO,
    description: 'JSON instruction injection attempt'
  },
  {
    // A fabricated `{"role":"system"|"developer", … "content":"…"}` chat-message turn whose content
    // carries a strong injected directive (INJECTED_DIRECTIVE_SRC) — the OpenAI message shape used to
    // impersonate an operator instruction. Gated on BOTH the forged role-VALUE (system/developer only
    // — `assistant` is the model's own voice; including it blocked benign assistant text like "to
    // override the default, set the flag") AND the directive in the SAME object (`[^}]` window, ≤120
    // chars), so a legitimate transcript turn (`{"role":"system","content":"You are a helpful
    // assistant"}`) does NOT match. Known limit (defence-in-depth, not the sole layer): a
    // content-before-role key order, or an intervening nested `{…}` object, evades — but the directive
    // itself is still caught by the content patterns / `ignore_all_instructions`.
    name: 'forged_authority_turn',
    pattern: new RegExp(
      `["']role["']\\s*:\\s*["'](?:system|developer)["'][^}]{0,120}?["']content["']\\s*:\\s*["'][^"]{0,400}?${INJECTED_DIRECTIVE_SRC}`,
      'i'
    ),
    severity: Severity.WARNING,
    description: 'Forged system/developer role turn carrying an injected directive'
  },
  {
    // A conversation-role tag (including the generic `user`/`context`/`message` tags dropped from
    // `xml_tag_injection` for over-firing on benign data) whose OWN CONTENT carries a directive. The
    // window is `[^<]{0,80}` — it STOPS at the next `<`, so the directive must sit inside this tag's
    // body and cannot bleed past `</tag>` into an unrelated following element (the failure mode of a
    // wider window: `<message>Migration guide</message>` followed later by "new instructions:" is NOT
    // a fake turn). Benign data-bearing tags (`<user><name>Alice</name></user>`) carry no directive
    // → no match. `im_start` is intentionally NOT here: real ChatML is `<|im_start|>` (pipe-delimited),
    // which this tag shape never matched.
    name: 'fake_turn_tag_directive',
    pattern: new RegExp(
      `<\\s*(?:system|user|human|assistant|context|message)\\s*>[^<]{0,80}?${INJECTED_DIRECTIVE_SRC}`,
      'i'
    ),
    severity: Severity.WARNING,
    description: 'Conversation-role tag wrapping an injected directive (fake-turn injection)'
  }
];

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

/**
 * Category D: Encoded Payload Patterns
 * Attempts to hide malicious content via encoding.
 */
export const ENCODED_PAYLOAD_PATTERNS: PatternDefinition[] = [
  {
    name: 'base64_encoded_content',
    pattern: /(?:eval|decode|execute|run)\s*\(\s*["']?[A-Za-z0-9+/=]{30,}["']?\s*\)/i,
    severity: Severity.WARNING,
    description: 'Base64 encoded payload with execution'
  },
  {
    name: 'hex_encoded_strings',
    pattern: /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){10,}/,
    severity: Severity.WARNING,
    description: 'Hex encoded string sequence'
  },
  {
    name: 'unicode_escape_sequences',
    pattern: /(?:\\u[0-9a-fA-F]{4}){5,}/,
    severity: Severity.WARNING,
    description: 'Unicode escape sequence obfuscation'
  }
];

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

/**
 * Story 1.1c — Web3 Preference-Setting Patterns
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
 *   `default`, `from now on` for `always`) evades. Story 1.8's two-
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

// =============================================================================
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
  { patterns: WEB3_PREFERENCE_PATTERNS, category: 'web3_preference_setting' }
] as const;

// =============================================================================
// SYNONYM SUBSTITUTION PATTERNS
// =============================================================================

/**
 * Synonym expansion patterns for critical injection categories.
 */
interface SynonymPattern {
  name: string;
  pattern: RegExp;
  severity: Severity;
  category: string;
  originalPattern: string;
  description: string;
}

const SYNONYM_PATTERNS: SynonymPattern[] = [
  // SYSTEM_OVERRIDE synonyms — retain CRITICAL severity
  {
    name: 'ignore_instructions_syn',
    pattern:
      /(?:discard|dismiss|abandon|drop|set\s+aside|throw\s+out|toss)\s+(?:all\s+)?(?:previous|prior|earlier|preceding|above|foregoing|former)\s+(?:instructions?|directives?|guidelines?|rules?|commands?|orders?|mandates?|protocols?)/i,
    severity: Severity.CRITICAL,
    category: 'system_override',
    originalPattern: 'ignore_instructions',
    description: 'Synonym: attempt to ignore previous instructions'
  },
  {
    name: 'mode_switching_syn',
    pattern:
      /(?:initiate|launch|begin|start|engage)\s+(?:developer|debug|admin|sudo|root|unrestricted|unfiltered|jailbreak|DAN)\s*mode/i,
    severity: Severity.CRITICAL,
    category: 'system_override',
    originalPattern: 'mode_switching',
    description: 'Synonym: unauthorized mode switching attempt'
  },
  // CONSTRAINT_REMOVAL synonyms — retain CRITICAL severity
  {
    name: 'constraint_removal_syn',
    pattern:
      /(?:eliminate|delete|strip|lift|drop|shed|lose)\s+(?:all\s+)?(?:restrictions?|limits?|constraints?|boundaries?|guardrails?|barriers?|safeguards?|protections?)/i,
    severity: Severity.CRITICAL,
    category: 'system_override',
    originalPattern: 'constraint_removal',
    description: 'Synonym: constraint removal attempt'
  },
  // INSTRUCTION_INJECTION synonyms — lower confidence, INFO severity
  {
    name: 'hidden_instruction_syn',
    pattern:
      /(?:commence|initiate|open)\s+(?:hidden|secret|private|internal|covert)\s+(?:instruction|prompt|message|directive)/i,
    severity: Severity.INFO,
    category: 'instruction_injection',
    originalPattern: 'hidden_instruction_block',
    description: 'Synonym: hidden instruction block attempt'
  },
  // CONTEXT_MANIPULATION synonyms — lower confidence, INFO severity
  {
    name: 'conversation_reset_syn',
    pattern: /(?:purge|flush|reinitialize|restart)\s+(?:the\s+)?(?:conversation|context|history|memory|chat|dialogue)/i,
    severity: Severity.INFO,
    category: 'context_manipulation',
    originalPattern: 'conversation_reset',
    description: 'Synonym: conversation reset attempt'
  }
];

// =============================================================================
// DETECTION FUNCTIONS
// =============================================================================

/**
 * Get line number for a match position.
 */
export function getLineNumber(text: string, position: number): number {
  return text.slice(0, position).split('\n').length;
}

/**
 * Run pattern detection on content.
 */
export function detectPatterns(content: string): PatternFinding[] {
  const findings: PatternFinding[] = [];

  for (const { patterns, category } of ALL_PATTERN_CATEGORIES) {
    for (const patternDef of patterns) {
      const match = content.match(patternDef.pattern);
      if (match) {
        findings.push({
          category,
          pattern_name: patternDef.name,
          severity: patternDef.severity,
          match: match[0].slice(0, 100),
          description: patternDef.description,
          line_number: getLineNumber(content, match.index || 0),
          // Propagate the block-eligibility flag from the pattern
          // definition (default true when omitted). Consumed by
          // `PromptInjectionValidator.analyze` to compute
          // `shouldBlock`.
          blockEligible: patternDef.blockEligible !== false
        });
      }
    }
  }

  // Synonym expansion patterns (additive, not replacing originals)
  for (const synPattern of SYNONYM_PATTERNS) {
    const match = content.match(synPattern.pattern);
    if (match) {
      // Check not already matched by original patterns
      const alreadyFound = findings.some(f => f.pattern_name === synPattern.originalPattern);
      if (!alreadyFound) {
        findings.push({
          category: synPattern.category,
          pattern_name: `synonym_${synPattern.name}`,
          severity: synPattern.severity,
          match: match[0].slice(0, 100),
          description: synPattern.description,
          line_number: getLineNumber(content, match.index || 0)
        });
      }
    }
  }

  return findings;
}
