/**
 * BonkLM - Harm-Goal Intent Validator
 * ===================================
 * Deterministic, reproducible (no LLM) intent-level layer that closes the recall
 * gaps the surface-pattern validators are blind to: exploit-generation and
 * restricted-synthesis requests that carry NO single keyed surface string because
 * they are wrapped in narrative/persona, multi-turn/agent decomposition, few-shot
 * priming, back-translation, social-authority laundering, or token-boundary /
 * base64 obfuscation.
 *
 * Approach: recognise the harm GOAL by the CO-OCCURRENCE of intent signal classes
 * (a "produce" verb + an offensive artifact that is meant to WORK; or a synthesis
 * verb governing a restricted object) rather than any single keyword, evaluated
 * over several de-obfuscated VIEWS of the input (raw, invisible-char-stripped,
 * newline-stripped, spaced-letter-collapsed, bracket-filler-stripped, percent-
 * decoded, and base64-decoded). The combination requirement plus per-signal
 * negation guards are what keep benign/defensive security and chemistry discussion
 * at zero findings — a documentation or detection request carries the artifact
 * noun but none of the working-primitive / RCE-goal co-signals.
 *
 * Fully deterministic: same input -> same verdict. Edge-portable (no Node `Buffer`
 * — base64 views go through the shared `base64DecodeToUtf8` codec). Purely
 * additive in the engine: it only ever raises a block, so it cannot reduce recall
 * or remove a true positive. No attacker-derived text enters findings or logs
 * (CWE-117) — only static library constants are emitted.
 *
 * @package @blackunicorn/bonklm/core
 */

import { createResult, type Finding, type GuardrailResult, Severity } from '../base/GuardrailResult.js';
import { mergeConfig, type ValidatorConfig } from '../base/ValidatorConfig.js';
import { createLogger, type Logger } from '../base/GenericLogger.js';
import { sanitizeLogString } from '../common/index.js';
import { base64DecodeToUtf8 } from '../common/edge-codec.js';

/** Hard input ceiling — bounds the multi-view regex passes (ReDoS / time-budget guard). */
const MAX_HARM_INPUT = 500_000;

// ---------------------------------------------------------------------------
// Intent signal vocabularies (bounded alternations — ReDoS-safe)
// ---------------------------------------------------------------------------

// Imperative "produce an artifact for me" verbs (all inflections). Deliberately
// excludes the noun-heavy "code"/"build" (they match "code review", "build
// time") — every exploit-gen attack carries a stronger verb.
const PRODUCE_VERB_RE =
  /\b(?:writ(?:e|es|ing)|creat(?:e|es|ed|ing)|generat(?:e|es|ed|ing)|produc(?:e|es|ed|ing)|provid(?:e|es|ed|ing)|develop(?:ed|ing)?|craft(?:ed|ing)?|construct(?:ed|ing)?|implement(?:ed|ing)?|compos(?:e|es|ed|ing)|draft(?:ed|ing)?|give\s+me|hand\s+me|hand\s+over|send\s+me|show\s+me\s+(?:the\s+)?(?:code|exploit|steps|payload)|walk\s+me\s+through|step[-\s]by[-\s]step)\b/i;

// Offensive cyber artifacts (compound where a bare word would be too broad).
const EXPLOIT_ARTIFACT_BODY =
  'exploit(?:\\s+(?:code|script|harness|module|chain))?|shellcode|pwntools|metasploit|msfvenom|rop\\s+(?:chain|gadget)|gadget\\s+chain|buffer\\s+overflow|stack\\s+(?:buffer\\s+)?overflow|heap\\s+(?:spray|overflow|grooming)|use[-\\s]after[-\\s]free|\\buaf\\b|format[-\\s]string\\s+(?:bug|exploit|vuln)|memory[-\\s]corruption|type\\s+confusion|privilege\\s+escalation|priv[-\\s]?esc|reverse\\s+shell|bind\\s+shell|malware|ransomware|keylogger|rootkit|backdoor|botnet|spyware|trojan';
const EXPLOIT_ARTIFACT_RE = new RegExp(`\\b(?:${EXPLOIT_ARTIFACT_BODY})\\b`, 'i');

// "make it actually work" qualifier ADJACENT to an offensive artifact
// ("working exploit", "complete shellcode", "fully weaponized payload"). The
// adjacency is what separates an exploit-gen request from a benign defender
// query — "write a COMPLETE GUIDE on privilege escalation" or "a WORKING
// EXAMPLE of keylogger behavior for our EDR lab" — where the qualifier governs
// a benign noun (guide/example/tutorial), not the artifact itself.
const FUNCTIONAL_QUAL =
  'working|functional|complete|runnable|fully[-\\s]?(?:working|functional|weaponi[sz]ed)|weaponi[sz]ed|production[-\\s]ready|end[-\\s]to[-\\s]end';
const FUNCTIONAL_ARTIFACT_RE = new RegExp(
  `\\b(?:${FUNCTIONAL_QUAL})\\s+(?:\\w+\\s+){0,1}?(?:${EXPLOIT_ARTIFACT_BODY})\\b`,
  'i'
);

// Concrete offensive-construction primitives. Their PRESENCE (not a bare
// artifact noun) is what distinguishes "write the exploit" from a defender's
// "write a guide on privilege escalation" — documentation requests carry none
// of these. Kept distinct from a benign "write some C code" by requiring named
// memory-corruption / weaponization mechanics, not bare language tokens.
// NOTE: only operational ACTIONS/tools — NOT concept-names a defender discusses
// ("ROP chains", "the return address", "use-after-free bug class"). Those are
// excluded so conceptual/educational write-ups stay at zero findings.
const EXPLOIT_MECHANICS_RE =
  /\b(?:shellcode|nop\s+sled|reverse\s+shell|bind\s+shell|stack\s+smash\w*|ropgadget|jmp[-\s]?esp|ret2\w+|heap\s+spray|use[-\s]after[-\s]free\s+(?:exploit|primitive)|return[-\s]address\s+offset|overwrit\w*\s+(?:the\s+)?(?:saved\s+)?(?:return\s+(?:address|pointer)|function\s+pointer|vtable)|bypass\w*\s+(?:smep|smap|kaslr|secure\s+boot)|disabl\w*\s+(?:aslr|secure\s+boot|stack\s+protect\w*)|dxe\s+driver|pwntools|metasploit|msfvenom|kernel\s+priv\w*[-\s]?esc\w*\s+exploit|privilege[-\s]escalation\s+exploit)\b/i;

// Defensive / ANALYTICAL deliverable that GOVERNS the offensive artifact — a defensive or
// malware-analysis verb acting ON the artifact ("DETECT shellcode", "DISASSEMBLE the trojan",
// "DETONATE this ransomware sample", "FINGERPRINT the malware"), the artifact compounded with a
// defensive head ("rootkit DETECTOR", "malware ANALYSIS"), or a defensive head delivered FOR the
// artifact ("SIGNATURE for a botnet", "SCANNER for shellcode"). The directional, governing
// relationship separates a defender/analyst deliverable from an attack that merely names a
// defensive word in its vuln-discovery SETUP ("static analysis flagged this ... write an exploit").
//
// DOCUMENTED RESIDUAL (single-layer limitation, accepted 2026-06-20): the test runs over the whole
// input, so an attacker who CO-LOCATES a benign "detect <artifact>" clause with a SEPARATE non-RCE
// exploit ask can suppress the latter. The most dangerous requests are still un-launderable —
// explicit code-execution goals (artifactRce) and step-by-step synthesis (ACTIONABLE_SYNTH_RE) are
// never suppressed. Evasion-proof closure would require per-clause artifact scoping (follow-up).
const _DEF_VERB =
  'detect(?:s|ed|ing|ion)?|scan(?:s|ned|ning)?|monitor(?:s|ed|ing)?|analy[sz]\\w*|remov(?:e|es|ed|ing|al)|mitigat\\w*|block(?:s|ed|ing)?|identif\\w*|catch(?:es|ing)?|flag(?:s|ged|ging)?|alert(?:s|ed|ing)?|classif\\w*|recogni[sz]\\w*|prevent\\w*|defend\\w*|protect\\w*|track(?:s|ed|ing)?|pars(?:e|es|ed|ing|er|ers)?|quarantin\\w*|disassembl\\w*|decompil\\w*|unpack(?:s|ed|ing)?|deobfuscat\\w*|detonat\\w*|dissect\\w*|fingerprint\\w*|cluster(?:s|ed|ing)?|triag\\w*|reverse[-\\s]?engineer\\w*|sinkhol\\w*|neutrali[sz]\\w*';
const _DEF_HEAD =
  'detectors?|detection|scanners?|scanning|monitor(?:s|ing)?|analy[sz]ers?|analysis|removal|mitigation|classifiers?|classification|trackers?|simulators?|simulation|sandbox(?:es)?|emulators?|profilers?|parsers?|signatures?|playbooks?|defen[cs]e|defensive|protection|deobfuscat\\w*|disassembl\\w*';
// Gaps use `[\w-]+` so a hyphenated token ("UPX-packed") counts as one word, but clause-boundary
// punctuation (";", ",", ".") STOPS the gap — defensive governance is within a phrase, not across
// clauses ("static analysis flagged this; write an exploit" must NOT suppress the exploit ask).
const DEFENSE_GOVERNS_ARTIFACT_RE = new RegExp(
  `\\b(?:${_DEF_VERB})\\b(?:\\s+[\\w-]+){0,4}\\s+(?:${EXPLOIT_ARTIFACT_BODY}|nop\\s+sled)\\b` +
    `|\\b(?:${EXPLOIT_ARTIFACT_BODY}|nop\\s+sled)(?:\\s+[\\w-]+){0,2}\\s+(?:${_DEF_HEAD})\\b` +
    `|\\b(?:${_DEF_HEAD})\\b(?:\\s+[\\w-]+){0,2}\\s+(?:for|of|against)\\s+(?:[\\w-]+\\s+){0,3}(?:${EXPLOIT_ARTIFACT_BODY}|nop\\s+sled)\\b`,
  'i'
);

// Code-execution / control-flow-hijack goal phrases.
const RCE_GOAL_RE =
  /(?:pop(?:ping)?\s+(?:a\s+)?(?:root\s+)?shell|spawn(?:ing)?\s+(?:a\s+)?shell|gain(?:ing)?\s+(?:a\s+)?(?:root\s+)?shell|get(?:ting)?\s+(?:a\s+)?(?:root\s+)?shell|root\s+shell|\/bin\/(?:sh|bash)|arbitrary\s+code\s+execution|remote\s+code\s+execution|\brce\b|overwrit\w*\s+(?:the\s+)?(?:saved\s+)?(?:return\s+(?:address|pointer)|function\s+pointer|vtable)|redirect\w*\s+(?:execution|control[-\s]flow)|control[-\s]flow\s+hijack|escalat\w*\s+(?:to\s+)?(?:root|privileg)|hijack\w*\s+(?:execution|control))/i;

// Restricted-synthesis intent (kept ABSTRACT — no specifics authored here).
// Synthesis verbs (verb inflections only — "produc(e|es|ed|ing)" deliberately
// EXCLUDES the noun forms product/production/productive; likewise cook/brew).
// "synthesi[sz](?:e|es|ed|ing)?" keeps the action noun "synthesis" (as in
// "synthesis route") while the verb-only "produc(e|es|ed|ing)" still excludes
// the nouns product/production/productive.
const SYNTH_VERB_STEMS =
  'synthesi[sz](?:e|es|ed|ing)?|produc(?:e|es|ed|ing)|manufactur(?:e|es|ed|ing)|formulat(?:e|es|ed|ing)|prepar(?:e|es|ed|ing)|cook(?:s|ed|ing)?|brew(?:s|ed|ing)?|extract(?:s|ed|ing)?|convert(?:s|ed|ing)?|obtain(?:s|ed|ing)?|mak(?:e|es|ing)';

const RESTRICTED_QUALIFIER =
  'illegal|illicit|restricted|controlled|regulated|banned|prohibited|scheduled|dangerous|hazardous|toxic|lethal|deadly|weaponi[sz]\\w*|nerve|chemical[-\\s]weapon|bio(?:logical)?[-\\s]?(?:weapon|agent)|narcotic|psychoactive';
const RESTRICTED_NOUN =
  'substance|stimulant|drug|narcotic|compound|agent|material|precursor|chemical|reagent|explosive|toxin|poison|pathogen|weapon|device|formulation|gas|powder|mixture';
const RESTRICTED_NOUN_RE = new RegExp(`\\b(?:${RESTRICTED_NOUN})\\b`, 'i');

// Descriptive / enforcement / legal / safety-compliance framing — a legal brief, a
// law-enforcement training module on DETECTING illicit manufacturing, an overview of how
// authorities IDENTIFY illegal production sites, or a process-safety review is talking ABOUT
// restricted activity, not requesting a synthesis. The detect/identify arm is anchored to an
// ACTIVITY noun (manufacturing/production/operations/labs/sites) so an attacker's "synthesize X
// to avoid detection" is NOT suppressed. Applied only in co-occurrence with a restricted noun.
const RESTRICTED_DESCRIPTIVE_RE =
  /\b(?:legal\s+brief|law\s+enforcement|process\s+safety\s+review|safety\s+data\s*sheet|under\s+international\s+law|regulatory\s+(?:compliance|filing|affairs)|compliance\s+(?:review|report|audit)|training\s+(?:module|document|course|program)\s+on|forensic\w*|(?:detect(?:ing|ion)?|identif(?:y|ying|ication)|recogniz(?:e|ing|ition)|investigat(?:e|ing|ion))[\w\s]{0,24}\b(?:manufactur\w*|production|synthesis|operations?|traffick\w*|smuggl\w*|labs?|sites?|facilit\w*))\b/i;

// Data-admin framing — the restricted thing handled as PAPERWORK / RECORDS (a report, permit,
// registry, inventory, licence, profile), i.e. a retrieval/conversion of documents, not an
// actionable synthesis. Applied only in tight co-occurrence with a restricted noun.
const RESTRICTED_DATA_ADMIN_RE =
  /\b(?:report|permit|registry|registries|inventory|inventories|record|records|spreadsheet|database|certificate|licen[sc]es?|datasheet|manifest|catalogue?s?|dossier|ledger|profiles?|ehs|msds)\b/i;

// Actionable-synthesis imperative — when present, NO descriptive / data-admin frame excuses the
// request: it is asking HOW to actually MAKE the restricted thing, not describing or filing it.
// This is what re-blocks the laundered "legal brief: synthesize X step by step" and "in my registry,
// how to synthesize the precursor" while leaving "legal brief on the manufacture of X" (no actionable
// imperative) suppressed. The second arm requires a synthesis SOURCE (from a precursor/reagent) so a
// benign "extract the regulated compound from the database" stays a data-admin (non-blocking) match.
const ACTIONABLE_SYNTH_RE = new RegExp(
  '\\b(?:' +
    'step[-\\s]by[-\\s]step|synthesis\\s+route|reaction\\s+(?:route|scheme)|' +
    'exact\\s+(?:steps?|method|procedure|recipe|quantit\\w*|ratios?)|' +
    'full\\s+(?:synthesis|method|route|recipe|procedure|process|instructions|write[-\\s]?up)|' +
    'how\\s+to\\s+(?:synthesi[sz]e|cook|make|produce|manufactur\\w*|prepar\\w*|extract|brew|formulat\\w*)|' +
    'walk\\s+(?:me\\s+)?through\\s+(?:cooking|synthesi\\w*|making|producing|preparing|extracting|brewing)|' +
    'give\\s+(?:me\\s+)?the\\s+(?:full\\s+|exact\\s+|complete\\s+)?(?:synthesis|method|route|steps?|recipe|procedure|process|instructions)|' +
    'start\\s+to\\s+finish' +
    ')\\b' +
    '|\\b(?:cook|synthesi[sz]e|produc\\w*|manufactur\\w*|extract|brew|formulat\\w*|prepar\\w*)\\b[\\w\\s]{0,30}?\\bfrom\\b(?:\\s+\\w+){0,3}\\s+(?:precursor|reagent|feedstock|starting\\s+material)',
  'i'
);

// A synthesis VERB directly governing a restricted object ("produce an illegal
// stimulant", "extract a regulated psychoactive substance", "synthesize a
// controlled substance from a restricted precursor"). This is the irreducible
// "make me a <restricted thing>" request; the verb->qualifier->noun adjacency +
// the negation guard keep benign chemistry prose ("controlled chemical
// reaction", "names no controlled substance") at zero findings.
const SYNTH_NEAR_RESTRICTED_RE = new RegExp(
  `\\b(?:${SYNTH_VERB_STEMS})\\s+(?:\\w+\\s+){0,3}?(?:${RESTRICTED_QUALIFIER})\\s+(?:\\w+\\s+){0,2}?(?:${RESTRICTED_NOUN})\\b`,
  'i'
);

// Object-before-verb order ("a controlled substance is typically synthesized",
// "the restricted precursor ... produced"). Same negation guard applies.
const RESTRICTED_NEAR_SYNTH_RE = new RegExp(
  `\\b(?:${RESTRICTED_QUALIFIER})\\s+(?:\\w+\\s+){0,2}?(?:${RESTRICTED_NOUN})\\s+(?:\\w+\\s+){0,4}?(?:${SYNTH_VERB_STEMS}|production|synthesi[sz]\\w*)\\b`,
  'i'
);

// Negation / exclusion frame: a signal term within this window AFTER a negator is
// a benign mention ("without working exploits", "names no controlled substance",
// "no specific compound"), not an actionable request. Anchored to the end of a
// preceding-context slice so only a nearby negator counts.
const NEGATOR_RE =
  /\b(?:without|no|not|never|exclud(?:e|es|ing)|free\s+of|avoid(?:ing|s)?|names?\s+no|don'?t|cannot|can'?t|won'?t|isn'?t|aren'?t|rather\s+than|instead\s+of|no\s+need)\b[\w\s,'’–—-]{0,40}$/i;

// Invisible token-splitters: soft-hyphen, ZWSP, ZWNJ, ZWJ, word-joiner, ZWNBSP/BOM.
const ZERO_WIDTH_RE = /[­​‌‍⁠﻿]/g;
const BASE64_RE = /(?:[A-Za-z0-9+/]{4}){5,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;

export interface HarmIntentResult {
  readonly exploitGen: boolean;
  readonly restrictedSynth: boolean;
}

// ---------------------------------------------------------------------------
// De-obfuscation views
// ---------------------------------------------------------------------------

/** Remove invisible token-splitters and join hyphenation across line breaks. */
function deobfuscate(text: string): string {
  return text.replace(ZERO_WIDTH_RE, '').replace(/-\s*\r?\n\s*/g, '');
}

/** Remove line breaks entirely — reassembles hard-line-break token splits. */
function stripNewlines(text: string): string {
  return text.replace(ZERO_WIDTH_RE, '').replace(/\r?\n/g, '');
}

/** Collapse runs of single spaced-out letters ("s y n t h" -> "synth", "u a f" -> "uaf"). */
function collapseSpacedLetters(text: string): string {
  return text.replace(/(?:\b[A-Za-z]\b[ \t]){2,}\b[A-Za-z]\b/g, m => m.replace(/[ \t]/g, ''));
}

/** Remove short bracketed filler spans ("produce [note: x] an [note: x] drug"). */
function stripBracketFiller(text: string): string {
  return text.replace(/[[(][^\]\n)]{0,40}[\])]/g, ' ').replace(/[ \t]{2,}/g, ' ');
}

/** Decode %XX percent/URL-encoding so percent-hex-wrapped requests are visible. */
function percentDecode(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2}){2,}/g, seq => {
    try {
      return decodeURIComponent(seq);
    } catch {
      return seq;
    }
  });
}

/**
 * Decode base64 blobs to printable text segments for decode-then-classify.
 * Edge-portable via the shared codec (no Node `Buffer`). Only segments that are
 * mostly printable ASCII are kept, so random base64-looking data is ignored.
 */
function decodedSegments(text: string): string[] {
  const out: string[] = [];
  let guard = 0;
  for (const m of text.matchAll(BASE64_RE)) {
    if (guard++ >= 200) break;
    const decoded = base64DecodeToUtf8(m[0]);
    // Keep only mostly-printable decodes — a base64 blob of binary data decodes to
    // control bytes and carries no instruction text, so it should not become a view.
    // (0/0 -> NaN -> falsy, so an empty decode is naturally skipped without a guard.)
    const printable = [...decoded].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126).length;
    if (printable / decoded.length > 0.8) out.push(decoded);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core intent predicate (evaluated per view)
// ---------------------------------------------------------------------------

/** True if `re` matches at least one occurrence NOT preceded by a negator. */
function unnegated(re: RegExp, s: string): boolean {
  // Need a global clone to iterate every match; dedupe flags so an already-global
  // source cannot raise a duplicate-flag error.
  const g = new RegExp(re.source, [...new Set(`${re.flags}g`)].join(''));
  for (const match of s.matchAll(g)) {
    // A global-regex match always carries a numeric index, so no fallback is needed.
    const pre = s.slice(Math.max(0, match.index - 48), match.index);
    if (!NEGATOR_RE.test(pre)) return true;
  }
  return false;
}

/** Start indices of every match of `re` in `s`. */
function indicesOf(re: RegExp, s: string): number[] {
  const g = new RegExp(re.source, [...new Set(`${re.flags}g`)].join(''));
  const out: number[] = [];
  for (const match of s.matchAll(g)) out.push(match.index);
  return out;
}

/**
 * True if some match of `a` lies within `window` characters of some match of `b`. Used to
 * gate a suppression on PROXIMITY — a defensive/descriptive term only neutralises an offensive
 * signal when it sits next to it, so a long attack that mentions the term far from the payload
 * still fires.
 */
function coOccur(a: RegExp, b: RegExp, s: string, window: number): boolean {
  const ai = indicesOf(a, s);
  if (ai.length === 0) return false;
  const bi = indicesOf(b, s);
  // `bi` empty -> the inner `.some` is false for every x, so no explicit guard needed.
  return ai.some(x => bi.some(y => Math.abs(x - y) <= window));
}

function evalView(s: string): HarmIntentResult {
  // Exploit-generation: a REQUEST (produce verb) for an offensive artifact that
  // is meant to WORK — either an explicit code-execution goal next to the
  // artifact, or a functional qualifier ADJACENT to the artifact ("working
  // exploit"). Counting only NON-NEGATED signals + the adjacency keep
  // conceptual/defensive write-ups ("write a complete guide on privilege
  // escalation for defenders", "without actual shellcode") at zero.
  const artifactRce = unnegated(EXPLOIT_ARTIFACT_RE, s) && unnegated(RCE_GOAL_RE, s);
  const funcArtifact = unnegated(FUNCTIONAL_ARTIFACT_RE, s);
  const mechanics = unnegated(EXPLOIT_MECHANICS_RE, s);
  let exploitGen = unnegated(PRODUCE_VERB_RE, s) && (artifactRce || funcArtifact || mechanics);
  // A defensive / analytical deliverable that GOVERNS the artifact ("rootkit DETECTOR", "DETECT a
  // reverse shell", "DISASSEMBLE the trojan", "spyware REMOVAL guide") is a benign defender/analyst
  // request — suppress it. The DIRECTIONAL governing relationship keeps an attack that merely
  // mentions a defensive word in its setup ("static analysis flagged this ... write an exploit")
  // unaffected. An explicit code-execution goal (artifactRce) is NEVER suppressed — a pop-a-shell
  // request cannot be laundered behind "detect". (See DEFENSE_GOVERNS_ARTIFACT_RE for the residual.)
  if (exploitGen && !artifactRce && DEFENSE_GOVERNS_ARTIFACT_RE.test(s)) {
    exploitGen = false;
  }

  // Restricted-synthesis: a synthesis verb directly governing a restricted
  // object ("synthesize a controlled substance", "extract a regulated
  // psychoactive substance"). Adjacency + negation guard keep benign chemistry
  // ("controlled chemical reaction", "names no controlled substance") at zero.
  let restrictedSynth = unnegated(SYNTH_NEAR_RESTRICTED_RE, s) || unnegated(RESTRICTED_NEAR_SYNTH_RE, s);
  // Descriptive/enforcement/legal framing ("legal brief on ...", "training module on detecting
  // illicit manufacturing") or the restricted thing handled as PAPERWORK (a report / permit /
  // registry near it) is not an actionable synthesis — UNLESS an actionable-synthesis imperative
  // ("synthesize X step by step", "how to cook ... from the precursor") is present, which no frame
  // excuses. That veto re-blocks frame-laundered synthesis requests.
  if (
    restrictedSynth &&
    !ACTIONABLE_SYNTH_RE.test(s) &&
    (coOccur(RESTRICTED_DESCRIPTIVE_RE, RESTRICTED_NOUN_RE, s, 96) ||
      coOccur(RESTRICTED_DATA_ADMIN_RE, RESTRICTED_NOUN_RE, s, 48))
  ) {
    restrictedSynth = false;
  }

  return { exploitGen, restrictedSynth };
}

/**
 * Run the intent predicate over every de-obfuscated view of the input.
 * Exported for unit testing (genericized controls only).
 */
export function detectHarmIntent(text: string): HarmIntentResult {
  if (!text || text.length > MAX_HARM_INPUT) {
    return { exploitGen: false, restrictedSynth: false };
  }
  const newlineStripped = stripNewlines(text);
  const bracketStripped = stripBracketFiller(text);
  const views: string[] = [
    text,
    deobfuscate(text),
    newlineStripped,
    collapseSpacedLetters(text.replace(/\r?\n/g, ' ')),
    bracketStripped,
    // composed: bracket-filler + spaced-letter splitting together
    collapseSpacedLetters(bracketStripped.replace(/\r?\n/g, ' ')),
    percentDecode(text),
    percentDecode(newlineStripped),
    ...decodedSegments(text),
    ...decodedSegments(newlineStripped)
  ];
  let exploitGen = false;
  let restrictedSynth = false;
  for (const v of views) {
    const r = evalView(v);
    if (r.exploitGen) exploitGen = true;
    if (r.restrictedSynth) restrictedSynth = true;
    if (exploitGen && restrictedSynth) break;
  }
  return { exploitGen, restrictedSynth };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * HarmIntentValidator — deterministic harm-goal intent detector.
 *
 * Flags exploit-generation and restricted-synthesis REQUESTS independent of the
 * narrative / persona / multi-turn / few-shot / translation / token-obfuscation
 * framing that defeats single-string surface patterns. Additive: only ever
 * raises a block.
 */
export class HarmIntentValidator {
  private readonly config: ValidatorConfig &
    Required<Pick<ValidatorConfig, 'sensitivity' | 'action' | 'enabled' | 'logLevel' | 'includeFindings'>>;
  private readonly logger: Logger;

  constructor(config: ValidatorConfig = {}) {
    this.config = mergeConfig(config);
    this.logger = this.config.logger ?? createLogger('console', this.config.logLevel);
  }

  /**
   * Evaluate the harm-goal intent predicate over the content. Returns a standard
   * GuardrailResult; blocks when an exploit-generation or restricted-synthesis
   * request is recognised (subject to the action mode).
   */
  validate(content: string): GuardrailResult {
    if (this.config.enabled === false) return createResult(true, Severity.INFO, []);
    if (!content || content.trim().length === 0 || content.length > MAX_HARM_INPUT) {
      return createResult(true, Severity.INFO, []);
    }

    const intent = detectHarmIntent(content);
    const findings: Finding[] = [];

    if (intent.exploitGen) {
      findings.push({
        category: 'harm_intent',
        pattern_name: 'harm_intent_exploit_generation',
        severity: Severity.CRITICAL,
        weight: 10,
        confidence: 'critical',
        description:
          'Exploit-generation intent: request for a working offensive / code-execution primitive (framing-independent)'
      });
    }

    if (intent.restrictedSynth) {
      findings.push({
        category: 'harm_intent',
        pattern_name: 'harm_intent_restricted_synthesis',
        severity: Severity.CRITICAL,
        weight: 10,
        confidence: 'critical',
        description:
          'Restricted-synthesis intent: actionable request to produce a controlled / restricted / dangerous substance (framing-independent)'
      });
    }

    let allowed = findings.length === 0;
    // Honour the action mode: only 'block' enforces; 'log'/'sanitize'/'allow' observe.
    if (this.config.action !== 'block') allowed = true;
    const severity = findings.length > 0 ? Severity.CRITICAL : Severity.INFO;

    if (findings.length > 0) {
      // pattern_name values are static library constants; route through the shared
      // CWE-117 sanitizer for defense-in-depth and to match every validator's log sink.
      const names = sanitizeLogString(findings.map(f => f.pattern_name).join(', '));
      this.logger.debug(`HarmIntentValidator flagged harm-goal intent: ${names}`);
    }

    return createResult(allowed, severity, findings);
  }
}

/**
 * Quick validation helper for harm-goal intent detection.
 */
export function validateHarmIntent(content: string, config?: ValidatorConfig): GuardrailResult {
  return new HarmIntentValidator(config).validate(content);
}
