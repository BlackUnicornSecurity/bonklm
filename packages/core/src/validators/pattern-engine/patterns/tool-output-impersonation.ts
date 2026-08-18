import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';

/**
 * Pattern engine — tool output impersonation patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
/**
 * Tool-Output Impersonation Patterns
 * ==================================
 * Indirect prompt-injection where hostile content rides in through a TOOL
 * channel (command stdout, a retrieved doc, a "system-notice" slot) and is
 * written to impersonate trusted harness framing, then steer the agent.
 * Models the tool-output-impersonation class seen in agent code-review
 * workflows: injected text that tries to make a reviewing agent skip
 * reading a file, accept unverified "it's clean" claims, paste a credential
 * to a bogus host, and declare a premature "safe to merge" verdict.
 *
 * Severity contract (mirrors WEB3_PREFERENCE_PATTERNS):
 *   - `phishes_credential_reauth` is the ONLY CRITICAL, block-eligible arm.
 *     It fires only on high-precision, near-zero-FP credential-phishing
 *     signatures (a known bogus token host, or the fake `--paste-token`
 *     flag) — handing a credential to an attacker is catastrophic, so this
 *     arm hard-blocks via `PromptInjectionValidator.analyze`. Keeping the
 *     blocking arm signature-only (not prose) is deliberate: a BLOCK must
 *     not fire on benign sentences like "never paste your key into chat".
 *   - the other five are WARNING with `blockEligible: false`: they surface
 *     a finding ("flag") for a human/agent to see but never auto-block on
 *     their own, because these phrasings can occasionally occur in benign
 *     content. A genuine injection typically trips several at once and/or
 *     co-occurs with a CRITICAL category, which does block.
 *
 * Surface note: this category is most valuable when the scanner runs on
 * UNTRUSTED tool output / retrieved content (e.g. a PostToolUse output
 * validator that scans untrusted tool results), where harness
 * control-framing has no legitimate reason to appear inside a tool's
 * payload.
 *
 * Coverage limits (honest tripwire caveats — tracked, not silently
 * dropped):
 * - Recall vs precision split: the BLOCK arm is intentionally narrow
 *   (host/flag signature only), so a credential-phish that uses a
 *   different host and no `--paste-token` flag is NOT blocked — at most it
 *   trips the non-blocking `phishes_credential_paste` prose tripwire.
 *   Blocking on low-precision prose would over-block legitimate security
 *   advice; broader credential-host intelligence is future work.
 * - Closed verb/synonym sets: the WARNING arms key on specific verbs and
 *   nouns. One-word paraphrases evade ("vetted/ok per …", "revisit
 *   later", "no point reading"). These are heuristic flags, not a hardened
 *   gate; the negatives corpus
 *   (tests/validators/fixtures/tool-output-impersonation-negatives.txt)
 *   pins the realistic benign forms guaranteed NOT to fire (CI "clean per
 *   prior run", "you should merge", "stop reading at <delimiter>", etc.).
 * - Substantive-claim gap (accepted): `asserts_unverified_clean` keys on the
 *   "skip verification" rider ("no need to verify"), NOT on the underlying
 *   technical assertion. A bare claim like "the pack output is invariant" is
 *   indistinguishable from legitimate engineering prose (cf. the "invariant
 *   under reordering" / "deterministic and byte-stable" negatives), so it is
 *   deliberately not matched without the rider. An attacker who drops the
 *   rider loses this arm but is still caught by the harness-framing arm when
 *   the claim ships inside a forged `[system-note]`.
 * - No NFKD normalisation on the direct `detectPatterns()` path (only
 *   `PromptInjectionValidator.validate` normalises) — confusable-homoglyph
 *   evasion of these keywords is possible at the direct-call path, same as
 *   the web3 set. NFKD does NOT fold unicode hyphens to ASCII `-`, so a
 *   homoglyph-hyphen host variant is not recovered even on the validate()
 *   path; the `--paste-token` arm is the resilient credential signal.
 * - English-only.
 * - ReDoS posture: all gaps are bounded — `[^.\n]{0,N}` windows between fixed
 *   anchors, plus the bounded variable-length negative lookbehind on
 *   `phishes_credential_paste` — with no nested or unbounded quantifiers, so
 *   every arm matches in time linear in the input. `detectPatterns` has no
 *   time budget of its own, so keeping these linear is load-bearing.
 */
export const TOOL_OUTPUT_IMPERSONATION_PATTERNS: PatternDefinition[] = [
  {
    // Harness/system control-framing forged inside tool output: a bracketed
    // system wrapper (any of note/reminder/message/notice), a bare-colon
    // `system reminder:` / `system notice:` prefix (the attack-flavoured colon
    // forms only — benign `System message:` / `System note:` log prefixes are
    // deliberately NOT in the colon arm), a "tool-results integrity notice", or
    // the genuine bare string "Tool ran without output." with an instruction
    // tag appended after it. The discriminator vs. benign prose that merely
    // MENTIONS the harness ("…in system-reminder tags", "a system-note field")
    // is the bracket/colon framing: a bare mention without `[]/<>/()` brackets
    // or a trailing colon does NOT fire. "tool-results integrity check" is
    // intentionally excluded (benign dev speak); only notice/warning/alert
    // framing fires.
    name: 'impersonates_harness_framing',
    pattern:
      /(?:[[({<]\s*\/?\s*system[-_\s]?(?:note|reminder|message|notice)\s*[\])}>]|\bsystem[-_\s]?(?:reminder|notice)\s*:|\btool[-\s]?results?\s+integrity\s+(?:notice|warning|alert)|\btool\s+ran\s+without\s+output\.\s*[[({<])/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Tool output impersonates harness/system control framing'
  },
  {
    // Misdirection that tells the agent to stop/skip/defer reading or
    // reviewing. "stop reading" excludes the benign "stop reading at/from
    // <delimiter>" (parser idiom). "circle back later" is matched only with
    // "later" (the defer order); benign "circle back to <topic>" is exempt.
    // "check" is excluded from the skip verbs ("no need to check the box" is
    // common benign prose); verify/review/read/examine remain.
    name: 'instructs_skip_review',
    pattern:
      /(?:\bstop\s+reading\b(?!\s+(?:at|from)\b)|\bskip\s+(?:re-?)?(?:read(?:ing)?|review(?:ing)?)\b|\b(?:circle|come)\s+back\s+later\b|(?:\bno\s+need\s+to|\bdon'?t\s+bother(?:\s+to)?|\bdo\s+not\s+bother(?:\s+to)?)\s+(?:re-?)?(?:read|review|verif(?:y|ying)|examin(?:e|ing))\b)/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Tool output instructs the agent to skip/defer review'
  },
  {
    // "Trust me on hearsay" framing: a property is clean/verified "per a
    // <person>'s prior verification/review/audit", or an instruction to skip
    // verification ("no need to verify / re-check / confirm"). Narrowed so
    // citing an ARTIFACT is exempt — "clean per prior CI run" / "correct per
    // the spec" do NOT fire (the "per" arm requires a PERSON + a
    // verification-act noun). The benign CI verbs re-run / re-test are excluded
    // from the skip-verb set ("no need to re-run the test suite" is ordinary
    // build prose; the re-review / re-read skip-verification phrasings are
    // handled by the sibling `instructs_skip_review` arm). Honest attribution
    // ("reviewed by a maintainer last week")
    // and honest self-report ("I verified it locally") are exempt.
    name: 'asserts_unverified_clean',
    pattern:
      /(?:\bper\s+(?:a\s+|the\s+)?(?:maintainer|reviewer|architect|senior\s+\w+)(?:'s)?\s+(?:prior\s+|previous\s+|earlier\s+)?(?:verification|review|audit|approval|sign-?off|say-so)\b|\bno\s+need\s+to\s+(?:re-?(?:verify|check)|verify|confirm|double-?check)\b)/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Tool output asserts unverified "clean/verified" on hearsay'
  },
  {
    // Credential phishing — THE ONLY CRITICAL, BLOCK-ELIGIBLE arm. Narrow by
    // design: the bogus token host as a real FQDN (>=2 dotted labels after
    // `tokens`) or the fake `--paste[-_]token` flag. Requiring a real FQDN
    // keeps a BLOCK off benign filenames/identifiers that merely contain the
    // words (e.g. `claude code tokens.txt`, `claudeCodeTokens.length`), which
    // are NOT blocked. Generic "paste your token into chat" prose lives in
    // the non-blocking arm below so it can
    // never hard-block legitimate security advice ("never paste your key…").
    name: 'phishes_credential_reauth',
    pattern: /(?:\bclaude-?code-?tokens(?:\.[a-z0-9-]+){2,}\b|(?<![\w-])--paste[-_]?token(?![\w-]))/i,
    severity: Severity.CRITICAL,
    description: 'Tool output phishes a credential via a known re-auth signature'
  },
  {
    // Non-blocking generalisation of the credential lure: an imperative to
    // paste/enter/share a token/secret/key INTO the chat (or next message).
    // WARNING + blockEligible:false so a false positive only flags, never
    // blocks. Leading negation ("never/don't/avoid paste …") is excluded so
    // security advice does not even flag. A single variable-length negative
    // lookbehind suppresses negation within ~30 chars before the verb (V8
    // supports variable-length lookbehind), so "never ever paste ..." and
    // "do not, under any circumstances, paste ..." are suppressed too (both
    // sit within the 30-char window), not only the adjacent "never paste"
    // form. A negator further than ~30 chars from the verb is NOT suppressed —
    // an accepted precision limit for this non-blocking flag.
    name: 'phishes_credential_paste',
    pattern:
      /(?<!\b(?:never|not|no|don'?t|do\s+not|avoid|cannot|can'?t|under\s+no\s+circumstances)\b[^.\n]{0,30})\b(?:paste|enter|type|share|send|drop|reveal|provide)\s+(?:the\s+|your\s+|a\s+)?(?:setup[\s-]?token|token|api[\s-]?key|secret|password|credential|access[\s-]?key)\b[^.\n]{0,30}\b(?:into\s+(?:this|the)\s+(?:chat|conversation|thread|message|reply|window|box)|in\s+(?:your\s+)?(?:next\s+)?(?:message|reply|chat))\b/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Tool output asks the agent to paste a credential into the chat'
  },
  {
    // Premature verdict pushed by tool content: an instruction to
    // conclude/declare the work clean / safe-to-merge, or a direct "you
    // should now conclude/sign off/approve and merge". The verb set is
    // conclude/declare only — the neutral verbs determine/decide are excluded
    // because they read as benign reviewer QUESTIONS ("decide whether the
    // branch is safe to merge"), not a verdict push. Further narrowed to
    // exclude benign reviewer guidance ("once CI is green you should merge",
    // "you should approve the PR") and a bot's bare status line ("looks safe
    // to merge to me"), which carry no premature-conclusion push.
    name: 'pushes_premature_verdict',
    pattern:
      /(?:\b(?:conclude|declare)\b[^.\n]{0,30}\b(?:clean|safe\s+to\s+merge|ready\s+to\s+merge|safe\s+to\s+ship|good\s+to\s+go)\b|\byou\s+should\s+(?:now\s+|just\s+)?(?:conclude|sign\s+off|approve\s+and\s+merge)\b)/i,
    severity: Severity.WARNING,
    blockEligible: false,
    description: 'Tool output pushes a premature "clean / safe to merge" verdict'
  }
];
