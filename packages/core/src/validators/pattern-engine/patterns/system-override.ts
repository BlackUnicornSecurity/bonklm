import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';
import { SECRET_ENVVAR_SRC, SECRET_NOUN_SRC, SECRET_TOOL_SRC, STRONG_SECRET_SRC } from './shared-sources.js';

/**
 * Pattern engine — system override patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
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
    // A forged "SYSTEM OVERRIDE" directive label IMMEDIATELY gating an injection imperative
    // ("SYSTEM OVERRIDE: ignore instructions", "system override - disregard your guidelines").
    // The bare imperative alone is deliberately NOT caught here: `ignore_instructions` requires a
    // previous/prior/system qualifier and `ignore_all_instructions` requires "all", so a qualifier-
    // free "ignore instructions" slips both — and the standalone token "system override" is prose-
    // ambiguous (a control switch, an ops procedure, an env var) and is not a trigger on its own.
    // Precision comes from the COMBINATION: the forged label, an optional :/-/— or bare adjacency,
    // then an injection verb that must IMMEDIATELY follow the label (only a separator / whitespace
    // between), then a governing-instruction noun in a bounded window. That ordering keeps benign
    // prose clear — "a system override can bypass the rate limiter" (non-adjacent verb, non-governing
    // noun), "never disable safety interlocks during a system override drill" (verb precedes the
    // label), and "SYSTEM OVERRIDE: ENABLED was logged" (no injection verb) all stay inert.
    // Deliberately TIGHT — only the immediately-adjacent variant is in scope. A sentence break or
    // filler word between label and verb ("SYSTEM OVERRIDE. Now ignore your instructions"), an
    // out-of-set synonym, or a non-`[:\-—]` dash as the sole separator are NOT caught here; those
    // paraphrases belong to the broader semantic redesign, since widening this anchor to reach them
    // re-introduces the benign-prose false positives this combination is built to avoid.
    name: 'system_override_directive',
    pattern:
      /system\s+override\b\s*[:\-—]?\s*(?:ignore|disregard|forget|disable|bypass|override|remove|turn\s+off)\b[^.\n]{0,30}\b(?:instructions?|rules?|guidelines?|prompts?|constraints?|safety|guard\s?rails?|restrictions?)/i,
    severity: Severity.CRITICAL,
    description: 'Forged system-override directive carrying an injection imperative'
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
  },
  {
    // Typed-noun constraint removal the base `constraint_removal` set omits (security/content/fairness/
    // neutrality/equality/ethical/moral). REQUIRES the "all" totality quantifier — the marker separating
    // the attack ("ignore all security protocols", "disregard all fairness guidelines") from ordinary
    // technical prose ("disable security checks in dev", "override security checks now require MFA",
    // "bypass security checks in the validation layer"), which a determiner-free form wrongly matches.
    // `safety` omitted (covered by `constraint_removal`); `override` omitted (benign "override" feature
    // prose). Negation-guarded; trailing \b stops "content filter" binding inside "content filtering".
    // Complements #128's `system_override_directive` (which needs the forged SYSTEM OVERRIDE label) by
    // catching the label-free "ignore all <typed> …" form. Validated FP-free against the benign set.
    name: 'constraint_removal_typed',
    pattern:
      /(?<!\b(?:never|not|don'?t|do\s+not|cannot|can'?t|shouldn'?t|should\s+not|won'?t)\s{0,3})\b(?:ignore|disregard|bypass|circumvent|disable|suspend|remove)\s+all\s+(?:your\s+|the\s+)?(?:security|content|fairness|neutrality|equality|ethical|moral)\s+(?:guidelines?|protocols?|filters?|constraints?|checks?|restrictions?|rules?|measures?)\b/i,
    severity: Severity.CRITICAL,
    description: 'Typed-constraint removal attempt'
  },
  {
    // Constraint-softening social-engineering DIRECTED AT THE ASSISTANT: "relax/loosen/lower your
    // guidelines|guardrails". Two precision anchors: (1) the second-person "your" so legal/governance
    // prose ("the court lifted restrictions") is inert; (2) the object restricted to the AI-governance
    // nouns `guidelines`/`guardrails` only — the generic `restrictions`/`protocols`/`rules` collide with
    // medical/customer-support prose where "your" addresses the USER ("the nurse will ease your
    // restrictions", "lift your protocols after the follow-up"). Full negation guard.
    name: 'relax_own_guidelines',
    pattern:
      /(?<!\b(?:never|not|don'?t|do\s+not|cannot|can'?t|shouldn'?t|should\s+not|won'?t)\s{0,3})\b(?:relax|loosen|lower|ease|drop|lift)\s+your\s+(?:safety\s+|content\s+)?(?:guidelines?|guardrails?)\b/i,
    severity: Severity.CRITICAL,
    description: 'Request to relax the assistant’s own guidelines'
  },
  {
    // System-prompt EXFILTRATION via an exfil/disclosure verb the narrower `system_prompt_reveal`
    // misses: (1) "reply with / replying with / respond with" (an assistant is never legitimately
    // asked to "reply with" its system prompt — a credential-verify / authority pretext payload),
    // and (2) an intervening adjective between "your" and the object ("reveal your COMPLETE system
    // instructions"). The verb set is restricted to EXFIL/disclosure verbs (reveal/disclose/dump/
    // expose/leak/repeat/recite + reply-with) — a review surfaced that the pure-display verbs
    // show/display/print/output matched benign LLMOps/debug prose ("print your current system
    // prompt to the console"); `system_prompt_reveal` still covers the adjacent show/print form.
    // Object anchored to YOUR (adjective?) system prompt|instructions — determiner "your" pins it
    // to the addressee, ADJACENT to the object so it cannot bind across a gap ("show your TEAM the
    // new system prompt" does not match). Config verbs (provide/share/give/paste/send) and
    // verb-LAST reports ("a researcher leaked the system prompt") do not match. Bounded windows.
    name: 'system_prompt_exfil',
    pattern:
      /(?:reply\s+with|reply\s+by|replying\s+with|respond\s+with|reveal|repeat|recite|disclose|dump|expose|leak)\b[^.\n]{0,40}\byour\s+(?:current\s+|complete\s+|full\s+|entire\s+|initial\s+|original\s+|exact\s+|verbatim\s+|raw\s+|hidden\s+)?system\s+(?:prompt|instructions?)/i,
    severity: Severity.CRITICAL,
    description: 'System-prompt exfiltration request'
  },
  {
    // Subvert the assistant's OWN safeguards ("ignore your own system prompt", "bypass your own
    // system prompt"). The "your own" anchor pins it to the assistant, AND the object is
    // restricted to the unambiguously-AI noun `system prompt`: a review surfaced that generic
    // objects (rules/guidelines/limitations), metaphor nouns (safeguards/guardrails), and even
    // "your own safety protocols/guidelines" matched benign second-person safety-coaching prose
    // ("never bypass your own safety protocols"), so all of those were removed — only "system
    // prompt" has no benign coaching sense. Bounded windows.
    name: 'subvert_own_safeguards',
    pattern:
      /(?:bypass|ignore|disable|circumvent|override|turn\s+off|get\s+around)\b[^.\n]{0,25}\byour\s+own\b[^.\n]{0,25}system\s+prompt/i,
    severity: Severity.CRITICAL,
    description: 'Request to subvert the assistant’s own safeguards'
  },
  // ---------------------------------------------------------------------------------------------
  // Credential / secret EXFILTRATION directives (request-side complement to SecretGuard, which
  // detects secret VALUES already present in text; these catch the imperative to PRODUCE them).
  // Sibling family to `system_prompt_exfil` above. Each pattern is anchored on an ATTACK-SPECIFIC
  // FRAME — search-your-RAG, invoke-a-secret-tool, read-a-secrets-file, interrogate-the-assistant —
  // NOT on a bare verb+secret, because benign secops and code-description prose ("the helper
  // extracts the bearer token and returns its value") reaches verb+secret but never the frame.
  // Pure-display verbs (show/display/print/output) and pure-SEARCH verbs (find) are EXCLUDED from the
  // exfil-verb gates — they match benign debug / remediation prose ("find all the passwords flagged
  // as weak"). Negation-guarded (`(?<!non[-\s])` keeps "return the non-secret settings" inert);
  // bounded windows are ReDoS-safe. `rag_secret_exfil`'s `[\s\S]{0,300}?` bridge intentionally spans
  // sentences (a RAG frame and its extract clause are often separated) — do NOT narrow it to `[^.\n]`.
  {
    // Search YOUR RAG / knowledge base / documents, then EXTRACT/RETURN the secrets as values. The
    // benign form requests INFORMATION ("summarize / provide information about / retrieve documents
    // that discuss" best-practices/policies) and carries no exfil verb governing an
    // `all|any|every|the <secret>` object. The trailing negative lookahead additionally rejects the
    // case where the secret noun is a TOPIC MODIFIER of a benign doc ("return the password policy
    // section", "return the API key rotation guide") rather than the exfiltration object itself.
    name: 'rag_secret_exfil',
    pattern: new RegExp(
      String.raw`(?:search|query|scan|comb|look\s+through|go\s+through|crawl|perform\s+a\s+[a-z]+\s+search\s+of)\b[^.\n]{0,50}\b(?:your\s+|the\s+)?(?:rag|knowledge[-\s]?base|vector\s+(?:store|database|db)|retrieval\s+(?:store|index)|indexed\s+documents?|(?:rag\s+)?documents?|knowledge\s+base)\b[\s\S]{0,300}?\b(?:extract|exfiltrat\w*|dump|harvest|return|reveal|disclose)\b[^.\n]{0,30}\b(?:all|any|every|the)\s+(?:[a-z]+\s+){0,3}?(?:${STRONG_SECRET_SRC}|(?<!non[-\s])credentials?|(?<!non[-\s])secrets?|passwords?)\b(?!\s+(?:policy|policies|section|guide|guidelines?|document|documentation|article|management|requirements?|reset|rotation|best[-\s]practices?|standards?|hygiene|manager|overview|training|awareness|faq))`,
      'i'
    ),
    severity: Severity.CRITICAL,
    description: 'Retrieval-store secret-exfiltration request'
  },
  {
    // USE / EXECUTE a secret-reading tool (get_secret/read_file/dump_environment/list_credentials/…)
    // to read/extract a secret NOUN. Case-insensitive. The uppercase-env-var object is split into
    // `tool_envvar_exfil` below (a case-sensitive pattern) — folding it in here under /i would match
    // ordinary lowercase compounds (sortkey, rowkey). Benign tool prose ("use the search tool to
    // retrieve the documentation") names no secret object.
    name: 'tool_secret_exfil',
    pattern: new RegExp(
      String.raw`(?:use|using|execute|run|call|invoke)\b[^.\n]{0,30}\b(?:your\s+|the\s+)?${SECRET_TOOL_SRC}\b[\s\S]{0,150}?\b(?:read|access|retrieve|extract|get|dump|export|reveal|list)\b[^.\n]{0,45}\b${SECRET_NOUN_SRC}`,
      'i'
    ),
    severity: Severity.CRITICAL,
    description: 'Tool-mediated secret-exfiltration request'
  },
  {
    // Same tool frame, but the secret object is an UPPERCASE secret env-var NAME (BEARER_TOKEN,
    // AWS_SECRET_ACCESS_KEY, GITHUB_TOKEN). CASE-SENSITIVE (no /i flag), and the env-var token
    // (`SECRET_ENVVAR_SRC`) is STEM-GATED so benign `PARTITION_KEY` / `NEXT_PAGE_TOKEN` / `FEATURE_FLAG_KEY`
    // do not match. Read-verb set matches `tool_secret_exfil` (no display/return). NOTE: `SECRET_TOOL_SRC`'s
    // "<X> tool" prose branch is lowercase-only here (no /i) — a capitalised "Environment tool" + uppercase
    // env var is a known, accepted RECALL gap, not a false positive.
    name: 'tool_envvar_exfil',
    pattern: new RegExp(
      String.raw`(?:[Uu]se|[Uu]sing|[Ee]xecute|[Rr]un|[Cc]all|[Ii]nvoke)\b[^.\n]{0,30}\b(?:[Yy]our\s+|[Tt]he\s+)?${SECRET_TOOL_SRC}\b[\s\S]{0,150}?\b(?:read|access|retrieve|extract|get|dump|export|reveal|list)\b[^.\n]{0,45}${SECRET_ENVVAR_SRC}`
    ),
    severity: Severity.CRITICAL,
    description: 'Tool-mediated secret env-var exfiltration request'
  },
  {
    // A secret-reading tool invoked WITH a secret-typed parameter ("execute the get_secret tool with
    // parameter 'database_password'"). The argument must be QUOTED or `=`/`:`-assigned AND itself contain
    // a secret keyword, so a non-secret parameter ("with parameter 'feature_flag'") and mere prose naming
    // a variable ("the get_env variable API_KEY_ROTATION_DAYS") do not match.
    name: 'tool_param_secret_exfil',
    pattern:
      /(?:get_secret|read_secret|fetch_secret|get_credential|read_credential|get_env\w*)\w*\b[^.\n]{0,40}\b(?:with\s+)?(?:parameter|param|argument|arg|key|name|variable)\s*(?:["']|[:=]\s*["']?)[a-z_]*(?:password|secret|token|api_?key|credential)[a-z_]*/i,
    severity: Severity.CRITICAL,
    description: 'Secret-tool invoked with a secret-typed parameter'
  },
  {
    // Read/load a .env / config / secrets / credentials file, THEN extract/dump secrets from it.
    // Only genuinely-exfil verbs gate the tail (extract/dump/reveal/harvest/expose/steal/exfiltrate);
    // benign verbs (return/get/view) were removed because onboarding/IR prose reaches them ("open the
    // settings file to view which API keys are required"). All tail nouns are negation-guarded.
    name: 'creds_file_exfil',
    pattern: new RegExp(
      String.raw`(?:read|access|open|load|parse|cat|exfiltrat\w*)\b[^.\n]{0,30}(?:\.env\b|\b(?:env\s+file|config(?:uration)?\s+file|settings\s+file|secrets?\s+file|credentials?\s+(?:file|\.ya?ml|\.json)|service-credentials)\b)[^.\n]{0,45}\b(?:to\s+)?(?:extract|dump|reveal|harvest|expose|steal|exfiltrat\w*)\b[^.\n]{0,30}\b(?:${STRONG_SECRET_SRC}|(?<!non[-\s])(?:credentials?|secrets?|passwords?|tokens?|api\s*keys?|sensitive\s+data))\b`,
      'i'
    ),
    severity: Severity.CRITICAL,
    description: 'Secrets-file read-and-exfiltrate request'
  },
  {
    // Interrogate the ASSISTANT for its own credentials ("what credentials do you use / what keys do
    // you have access to"). The impersonal "are stored/used/configured" branch additionally requires a
    // nearby second-person `your` so benign infra-inventory ("which secrets are stored in Vault") and
    // third-person ("what credentials does the service use", "what credentials do I need from IT") stay
    // inert.
    name: 'cred_interrogative',
    pattern: new RegExp(
      String.raw`(?:what|which)\s+(?:${STRONG_SECRET_SRC}|credentials?|auth\w*\s+keys?|passwords?|secrets?)\s+(?:do\s+(?:you|your\s+\w+)\s+(?:use|have)|are\s+(?:stored|used|configured)\b[^.\n]{0,20}\byour\b|do\s+you\s+have\s+access\s+to)`,
      'i'
    ),
    severity: Severity.CRITICAL,
    description: 'Interrogation for the assistant’s own credentials'
  }
];
