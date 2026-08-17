/**
 * BonkLM - Social-Engineering Intent Validator
 * =============================================
 * Deterministic, reproducible (no LLM) intent-level layer that closes the recall
 * gap the surface-pattern validators are blind to: social-engineering / human-
 * manipulation requests that carry NO single keyed surface string because the
 * attack lives in the CO-OCCURRENCE of manipulation signals — a pretext, a
 * pressure tactic, an elicitation of a secret, an inducement to an irreversible
 * action — not in any one keyword.
 *
 * Approach: recognise the social-engineering GOAL by the CO-OCCURRENCE of signal
 * classes rather than any single keyword, evaluated over the SAME de-obfuscated
 * VIEWS that `harm-intent` uses (raw, invisible-char-stripped, newline-stripped,
 * spaced-letter-collapsed, bracket-filler-stripped, percent-decoded, and
 * base64-decoded). Two irreducible attack classes are flagged:
 *
 *  - credential-phishing — an elicitation directed at a victim-owned SECRET
 *    (a wallet seed / recovery phrase, a private key, a 2FA / one-time code, a
 *    CVV / PIN / SSN, a password). The directional, governing relationship
 *    (an exfil verb moving the victim's secret to the requester) is the
 *    combination; the seed/recovery-phrase elicitation is the elizaos-wallet-
 *    drain class this repo cares about.
 *  - pretext-coercion — an impersonation / authority PRETEXT or an urgency /
 *    coercion / secrecy PRESSURE frame CO-OCCURRING with an inducement to an
 *    IRREVERSIBLE action (transfer / wire / buy gift cards, install remote-
 *    access software, connect a wallet, approve a transaction). This catches the
 *    BEC / scam-call class even when no literal secret noun appears.
 *
 * The four candidate signal classes from the design brief (pretext, urgency/
 * coercion, credential elicitation, action-inducement) map onto these two
 * blocking predicates: credential-phishing = elicitation (directionally bound to
 * a victim secret); pretext-coercion = (pretext OR urgency) co-occurring with
 * action-inducement.
 *
 * Precision via DIRECTIONAL, GOVERNING co-occurrence + per-signal negation
 * guards: a defender / awareness / training deliverable ("write phishing-
 * awareness training", "a rule to flag seed-phrase requests", "detect a pretext
 * call", "we will never ask for your password") must NOT flag, while an explicit
 * elicitation / coercion goal is never excused by such a frame.
 *
 * Fully deterministic: same input -> same verdict. Edge-portable (no Node
 * `Buffer` — base64 views go through the shared `base64DecodeToUtf8` codec).
 * Purely additive in the engine: it only ever raises a block, so it cannot
 * reduce recall or remove a true positive. No attacker-derived text enters
 * findings or logs (CWE-117) — only static library constants are emitted.
 *
 * @package @blackunicorn/bonklm/core
 */

import { createResult, type Finding, type GuardrailResult, Severity } from '../base/GuardrailResult.js';
import { mergeConfig, type ValidatorConfig } from '../base/ValidatorConfig.js';
import { createLogger, type Logger } from '../base/GenericLogger.js';
import { sanitizeLogString } from '../common/index.js';
import { base64DecodeToUtf8 } from '../common/edge-codec.js';

/** Hard input ceiling — bounds the multi-view regex passes (ReDoS / time-budget guard). */
const MAX_SOCIAL_INPUT = 500_000;

// ---------------------------------------------------------------------------
// Secret vocabularies (the OBJECT of a credential-phishing elicitation)
// ---------------------------------------------------------------------------

// WALLET / HIGH-sensitivity secrets — no legitimate flow ever has a third party
// SOLICIT these, so an exfil request for them is phishing per se (a bare noun,
// no possessive required). `WALLET_SECRET_BODY` is the seed-phrase / private-key
// class that drives wallet-drain scams (cf. demo/elizaos-wallet-drain evidence).
const WALLET_SECRET_BODY =
  'seed\\s+phrase|secret\\s+recovery\\s+phrase|recovery\\s+phrase|recovery\\s+seed|backup\\s+(?:phrase|words?)|(?:12|24|twelve|twenty[-\\s]?four)[-\\s]?word\\s+(?:phrase|seed|recovery|mnemonic)|wallet\\s+(?:words?|phrase)|mnemonic(?:\\s+phrase)?|private\\s+key|secret\\s+key|wallet\\s+key|keystore\\s+(?:file|json)';
const HIGH_SECRET_BODY = `${WALLET_SECRET_BODY}|one[-\\s]?time\\s+(?:code|password|pin)|\\botp\\b|2fa\\s+(?:code|token)?|two[-\\s]?factor\\s+(?:code|auth(?:entication)?\\s+code)?|mfa\\s+(?:code|token)|verification\\s+code|security\\s+code|authentication\\s+code|auth\\s+code|access\\s+code|\\bcvv\\b|\\bcvc\\b|card\\s+verification\\s+(?:value|code|number)|\\bpin\\s+(?:code|number)|social\\s+security\\s+number|\\bssn\\b`;

// GEN secrets — legitimately ENTERED into trusted forms (a login page asks you
// to "enter your password"), so a bare mention is benign. They count only when
// an EXFIL verb moves them to the requester or a manipulation frame is present.
// `password` carries a negative lookahead so benign compounds ("password reset
// link", "password manager", "password management/policy") are not mistaken for
// the secret. `credentials` is only counted when it is login-context-qualified
// ("login/account/sign-in/banking credentials") — a bare "credentials" is too
// ambiguous (professional/academic credentials) and would over-fire on benign
// HR requests ("send your resume and credentials to HR"). "bank details/account
// details" is dropped (routine direct-deposit/payroll content); "bank login" is
// kept as the credential.
const GEN_SECRET_BODY =
  'password(?!\\s+(?:reset|policy|polic|manager|managers|management|managing|field|fields|strength|requirement|requirements|hint|hints|history|expir\\w*|rule|rules|length|complexity|protect\\w*|less))|passphrase|pass\\s?phrase|(?:login|log[-\\s]?in|account|sign[-\\s]?in|user|banking)\\s+credentials?|api\\s+key|access\\s+token|session\\s+(?:token|cookie)|bank\\s+login';

const SECRET_BODY = `${HIGH_SECRET_BODY}|${GEN_SECRET_BODY}`;

// A trailing CODE / DOC / POLICY qualifier means the secret noun is naming an
// engineering / topic artifact ("API key ROTATION schedule", "2FA INTEGRATION
// works", "private key GENERATION code", "access token EXPIRY rules"), not the
// secret itself — so an elicitation arm must NOT fire on it. Applied to the
// exfil arms only; the defensive-frame detector still sees the bare noun.
const SECRET_TAIL_NEG =
  '(?!\\s+(?:implementation\\w*|integration\\w*|module\\w*|logic|format\\w*|generation|generator\\w*|validation|validator\\w*|handling|handler\\w*|rotation|expir\\w*|spec|specs|specification\\w*|regex\\w*|pipeline\\w*|schedul\\w*|documentation|docs|flow\\w*|algorithm\\w*|feature\\w*|endpoint\\w*|librar\\w*|sdk|field\\w*|column\\w*|header\\w*|parameter\\w*|param\\w*|setting\\w*|config\\w*|configuration\\w*|requirement\\w*|policy|policies|rule|rules|guideline\\w*|management|managing|architecture|design|review\\w*|checklist|standard\\w*|test\\w*|mock\\w*))';
const SECRET_G = `(?:${SECRET_BODY})${SECRET_TAIL_NEG}`;
const WALLET_SECRET_G = `(?:${WALLET_SECRET_BODY})${SECRET_TAIL_NEG}`;
const HIGH_SECRET_G = `(?:${HIGH_SECRET_BODY})${SECRET_TAIL_NEG}`;

// Victim-side possessive — the secret belongs to the RECIPIENT, so an exfil ask
// is directed AT the victim. Deliberately excludes "my"/"our" (a user
// volunteering their own value is not the attack).
const VICTIM_POSS =
  "your|the\\s+(?:user|customer|client|account|recipient|employee|member|holder|victim)(?:'s|’s)?|his|her|their";

// ---------------------------------------------------------------------------
// Elicitation verbs (the directed ASK)
// ---------------------------------------------------------------------------

// CORE exfil verbs — move a value FROM the recipient TO the requester. None of
// these is part of a legitimate self-service credential flow (you never legit-
// imately "send"/"dm"/"forward" your 2FA code to a person), so they fire per se
// when they govern a victim secret. NOTE: informational/interrogative verbs
// ("show me", "tell me") are deliberately EXCLUDED — they govern a DESCRIPTION
// ("show me the OTP module", "tell me how 2FA works"), not an exfiltration.
const EXFIL_CORE_VERB =
  "send|share|provide|forward|submit|post|upload|reveal|disclose|expose|hand\\s+(?:me|us|it|them|over)|give\\s+(?:me|us|it|them)?|text\\s+(?:me|us)?|dm\\s+(?:me|us)?|email\\s+(?:me|us|it|them)?|paste\\s+(?:it|them|here|below)|read\\s+(?:me|us|it|them)\\s+(?:out|back)|what(?:['’]?s|\\s+is|\\s+are)";

// SOFT verbs — a value typed into a form (self-directed). Benign on their own
// ("enter your 2FA code to sign in"); they only count for the WALLET class when
// an inducement lure governs them (the "enter your seed phrase to verify your
// wallet" drain pattern). All inflections so "typing"/"entering" are caught.
const ENTER_VERB =
  'enter(?:s|ed|ing)?|re-?enter(?:s|ed|ing)?|typ(?:e|es|ed|ing)|input(?:s|ed|ting)?|key(?:s|ed|ing)?\\s+in|fill(?:s|ed|ing)?\\s+in|past(?:e|es|ed|ing)';

// ---------------------------------------------------------------------------
// Credential-phishing regexes (elicitation arms)
// ---------------------------------------------------------------------------

// A CORE exfil verb governing a victim-owned secret ("send me your password",
// "dm me your recovery phrase", "what is your private key"). The verb -> [gap]
// -> victim-possessive -> [gap] -> secret adjacency is the directional ask. The
// `SECRET_G` trailing-qualifier guard keeps "send me your API key rotation
// schedule" / "what are your access token expiry rules" (topic, not secret) out.
const EXFIL_CORE_VICTIM_RE = new RegExp(
  `\\b(?:${EXFIL_CORE_VERB})\\b(?:\\s+[\\w-]+){0,4}?\\s+(?:${VICTIM_POSS})(?:\\s+[\\w-]+){0,2}?\\s+${SECRET_G}\\b`,
  'i'
);

// A CORE exfil verb governing a bare WALLET secret, no possessive needed ("share
// the seed phrase", "send the recovery phrase"). Restricted to the WALLET class:
// for a possessive-less 2FA/OTP/CVV/auth-code/api-key noun, a developer request
// ("provide the authentication code module", "share the OTP implementation")
// must stay benign — a real phishing ask for those always addresses the victim
// ("send me YOUR OTP"), which the victim arm above already covers.
const EXFIL_CORE_HIGH_RE = new RegExp(
  `\\b(?:${EXFIL_CORE_VERB})\\b(?:\\s+[\\w-]+){0,3}?\\s+(?:the\\s+|your\\s+)?${WALLET_SECRET_G}\\b`,
  'i'
);

// ENTER-a-wallet-secret governed by a verification / restore / connect lure
// ("to verify your wallet, enter your seed phrase"). BOTH the enter clause and
// the lure must address the victim in the second person ("YOUR seed phrase",
// "verify YOUR wallet") so help-seeking narration ("how do I restore MY wallet,
// it says to enter MY seed phrase") and developer docs ("the flow prompts the
// user to enter THEIR seed phrase") stay benign. The tight window keeps the lure
// in the same instruction, not anywhere in a paragraph.
const ENTER_WALLET_RE = new RegExp(
  `\\b(?:${ENTER_VERB})\\b(?:\\s+[\\w-]+){0,2}?\\s+your\\s+(?:[\\w-]+\\s+){0,1}?(?:${WALLET_SECRET_BODY})\\b`,
  'i'
);
const WALLET_LURE_RE =
  /\b(?:verif\w*|validat\w*|confirm\w*|restor\w*|recover\w*|unlock\w*|re-?activat\w*|re-?sync\w*|re-?stor\w*|secur\w*|migrat\w*|connect\w*|sync\w*|import\w*|link\w*)\b(?:\s+[\w-]+){0,2}?\s+your\s+(?:wallet|account|funds|balance|address|identity)/i;

// Direct second-person exfil imperative addressed to the speaker / an exfil sink
// ("send me your seed phrase", "forward your OTP to this number"). A LITERAL lure
// — un-launderable: present -> credential-phishing stays blocked even under a
// defensive frame (a security guardrail conservatively blocks an embedded lure,
// the same documented residual posture as harm-intent's fictional-frame block).
// Both arms require an explicit exfil verb so passive narration ("verification
// code sent to this number") does not fire.
const DIRECT_PHISH_RE = new RegExp(
  `\\b(?:send|share|give|forward|text|dm|email|provide|hand\\s+over|reveal|disclose|paste)\\s+(?:me|us|it|them|here|below|to\\s+(?:me|us|this|that|the|my|our))(?:\\s+[\\w-]+){0,2}?\\s+(?:${VICTIM_POSS}\\s+)?${SECRET_G}\\b` +
    `|\\b(?:send|forward|share|give|paste|text|dm|email|provide)\\s+(?:me\\s+|us\\s+|it\\s+|them\\s+)?(?:${VICTIM_POSS}\\s+)?${HIGH_SECRET_G}\\b(?:\\s+[\\w-]+){0,4}?\\s+to\\s+(?:this|that|my|our)\\s+(?:wallet|address|account|number|link)\\b`,
  'i'
);

// Defensive / awareness / detection deliverable that GOVERNS the elicitation —
// a defensive verb acting ON the elicitation ("DETECT a request for your
// password", "FLAG messages asking for a 2FA code"), the secret compounded with
// a defensive head ("seed-phrase phishing DETECTOR"), or a defensive head
// delivered FOR / ABOUT the secret ("awareness TRAINING about your password",
// "a RULE to flag seed-phrase requests"). The directional, governing relation
// separates a defender's deliverable from an attack that merely names a
// defensive word elsewhere. Clause punctuation stops the gap so a benign
// "detector ...; now send me your seed phrase" cannot launder the second clause.
const _PHISH_DEF_VERB =
  'detect(?:s|ed|ing|ion)?|flag(?:s|ged|ging)?|identif\\w*|recogni[sz]\\w*|catch(?:es|ing)?|block(?:s|ed|ing)?|prevent\\w*|warn(?:s|ed|ing)?|alert(?:s|ed|ing)?|educat\\w*|train(?:s|ed|ing)?|teach\\w*|coach\\w*|simulat\\w*|audit\\w*|review\\w*|monitor\\w*|report(?:s|ed|ing)?|spot(?:s|ted|ting)?|screen(?:s|ed|ing)?|quarantin\\w*|triag\\w*|classif\\w*|defend\\w*|protect\\w*';
const _PHISH_DEF_HEAD =
  'detector|detection|awareness|training|education|simulation|simulator|policy|policies|rule|ruleset|rules|filter|warning|guidance|guideline|guidelines|playbook|template|checklist|module|campaign|exercise|drill|program|programme|brief|briefing|lesson|course|tabletop|red[-\\s]?team|blue[-\\s]?team|signature|signatures|heuristic|heuristics|classifier|advisory';
const PHISH_DEFENSE_GOVERNS_RE = new RegExp(
  `\\b(?:${_PHISH_DEF_VERB})\\b(?:\\s+[\\w-]+){0,5}\\s+(?:${SECRET_BODY})\\b` +
    `|\\b(?:${SECRET_BODY})(?:\\s+[\\w-]+){0,3}\\s+(?:${_PHISH_DEF_HEAD})\\b` +
    `|\\b(?:${_PHISH_DEF_HEAD})\\b(?:\\s+[\\w-]+){0,4}?\\s+(?:for|of|about|on|to|that|which|against|flag\\w*|detect\\w*|spot\\w*)(?:\\s+[\\w-]+){0,5}?\\s+(?:${SECRET_BODY})\\b`,
  'i'
);

// ---------------------------------------------------------------------------
// Pretext-coercion vocabularies
// ---------------------------------------------------------------------------

// PRETEXT / impersonation — posing as an authority the victim would obey. Split
// into EXTERNAL (a stranger claiming to be a bank / brand / IT / fraud desk — the
// strong impersonation signal) and INTERNAL (an exec / manager claim — weaker, as
// it also fronts legitimate workplace instructions). Bounded brand alternation —
// ReDoS-safe.
const _BRAND =
  'microsoft|apple|amazon|google|paypal|coinbase|binance|metamask|netflix|docusign|the\\s+irs|hmrc|the\\s+tax\\s+(?:office|authority)';
const PRETEXT_EXTERNAL_RE = new RegExp(
  `\\b(?:this\\s+is|i['’]?m|i\\s+am|we\\s+are|we['’]?re|calling|messaging|contacting\\s+you)\\b(?:\\s+[\\w-]+){0,3}?\\s+(?:from|on\\s+behalf\\s+of|with|at)\\s+(?:your\\s+)?(?:bank|it(?:\\s+(?:department|support|team|desk|admin))?|support|customer\\s+support|help\\s?desk|security\\s+(?:team|department)|fraud\\s+(?:team|department|prevention)|account\\s+(?:team|security)|${_BRAND})\\b` +
    `|\\bthis\\s+is\\s+(?:the\\s+|your\\s+)?(?:bank|fraud\\s+department|security\\s+team|account\\s+security|it\\s+(?:support|department|desk|admin)|${_BRAND})\\b` +
    `|\\b(?:${_BRAND}|your\\s+bank|the\\s+bank)\\s+(?:customer\\s+)?(?:support|security|account|fraud|service|billing)(?:\\s+team)?\\b` +
    '|\\b(?:official|verified|authori[sz]ed|certified)\\s+(?:\\w+\\s+){0,2}?(?:support|representative|agent|technician|helpdesk|account\\s+manager)\\b',
  'i'
);
const PRETEXT_INTERNAL_RE = new RegExp(
  '\\b(?:as|this\\s+is)\\s+your\\s+(?:bank|it\\s+admin|account\\s+manager|system\\s+administrator|ceo|cfo|coo|cto|boss|manager|supervisor|director|head\\s+of\\s+\\w+)\\b' +
    '|\\byour\\s+(?:ceo|cfo|coo|cto|boss|manager|director|supervisor)\\b(?:\\s+[\\w-]+){0,3}?\\s+(?:needs?|wants?|asked|requires?|is\\s+asking|urgently|has\\s+asked)\\b',
  'i'
);
const PRETEXT_RE = new RegExp(`${PRETEXT_EXTERNAL_RE.source}|${PRETEXT_INTERNAL_RE.source}`, 'i');

// COERCION (account-threat / failure-to-comply consequence) — the HARD pressure
// that, with any inducement, marks a scam. Strong enough to license even a SOFT
// action (a click-to-login, a payment approval).
const COERCION_ACCOUNT_RE = new RegExp(
  '\\byour\\s+(?:account|wallet|card|access|profile|subscription)\\s+(?:will\\s+be|has\\s+been|is\\s+(?:about\\s+to\\s+be|going\\s+to\\s+be)|may\\s+be|could\\s+be)\\s+(?:locked|suspended|frozen|closed|deleted|disabled|terminated|compromised|restricted|blocked)\\b' +
    "|\\b(?:failure\\s+to|if\\s+you\\s+(?:do\\s*n['’]?t|don['’]?t|fail\\s+to))\\s+(?:comply|respond|act|verify|confirm|pay)\\b(?:\\s+[\\w-]+){0,8}?\\s+(?:locked|suspended|closed|deleted|lose|penalt\\w*|legal|arrest\\w*|fine|prosecut\\w*|terminat\\w*)\\b",
  'i'
);
// SECRECY — "keep this between us / don't tell anyone". A pressure signal, but on
// its own it does NOT license a soft action (legitimate confidential business
// exists); it only contributes to the urgency frame for STRONG actions.
const SECRECY_RE = new RegExp(
  "\\b(?:do\\s*n['’]?t|don['’]?t|do\\s+not|please\\s+do\\s*n['’]?t)\\s+(?:tell|share|inform|notify|mention|alert|involve|contact)\\s+(?:anyone|anybody|your\\s+(?:colleagues?|family|spouse|bank|manager|it|the\\s+\\w+))\\b" +
    '|\\bkeep\\s+(?:this|it)\\s+(?:strictly\\s+)?(?:confidential|secret|between\\s+us|to\\s+yourself|quiet)\\b' +
    '|\\bthis\\s+(?:is|must\\s+(?:stay|remain|be\\s+kept))\\s+(?:strictly\\s+)?confidential\\b',
  'i'
);
// Time pressure — manufactured urgency. Tight: ordinary deadlines ("by Friday")
// do not match.
const URGENCY_TIME_RE = new RegExp(
  '\\b(?:immediately|right\\s+(?:away|now)|urgent(?:ly)?|as\\s+soon\\s+as\\s+possible|asap|act\\s+now)\\b' +
    '|\\bwithin\\s+(?:the\\s+next\\s+)?\\d+\\s*(?:min(?:ute)?s?|hours?|hrs?)\\b',
  'i'
);
// Full urgency/coercion FRAME (any pressure tactic).
const URGENCY_RE = new RegExp(`${URGENCY_TIME_RE.source}|${COERCION_ACCOUNT_RE.source}|${SECRECY_RE.source}`, 'i');

// STRONG action-inducement — inherently high-risk: a money transfer to a
// SUSPICIOUS destination (a deictic "this/that account", any determiner + an
// unfamiliar-destination adjective, or a crypto wallet / address), a gift-card
// buy, a remote-access install, a wallet-connect, or a remote-access grant to a
// device. Pairs with ANY frame. The money-movement arm stays benign for an
// ordinary "wire the payment to the supplier's account" (familiar destination).
const _DEST_ADJ =
  'new|different|another|second|alternate|alternative|safe|secure|unfamiliar|external|specified|designated|updated|following|below|attached|temporary|holding|provided';
const _DEST_NOUN = 'account|wallet|address|number|iban|bank\\s+account';
const ACTION_STRONG_RE = new RegExp(
  `\\b(?:transfer|send|wire|move|deposit|remit|pay)\\b(?:\\s+[\\w$-]+){0,6}?\\s+to\\s+(?:(?:this|that)\\s+(?:(?:${_DEST_ADJ})\\s+)?(?:${_DEST_NOUN})|(?:the|a|an|my|our|your)\\s+(?:(?:${_DEST_ADJ})\\s+)+(?:${_DEST_NOUN})|(?:this|that|the|my|our|a)\\s+(?:crypto\\s+)?wallet(?:\\s+address)?|0x[0-9a-fA-F]{6,})\\b` +
    '|\\bbuy\\b(?:\\s+[\\w-]+){0,3}?\\s+(?:gift\\s+cards?|\\$?\\d+\\s+(?:in\\s+)?(?:gift\\s+cards?|crypto|bitcoin|prepaid))\\b' +
    '|\\b(?:install|download|run|launch|set\\s+up)\\b(?:\\s+[\\w-]+){0,3}?\\s+(?:this|the|our)?\\s*(?:remote[-\\s]?access|remote[-\\s]?desktop|screen[-\\s]?shar\\w*|team\\s?viewer|anydesk|teamviewer|quick\\s?assist|\\.apk|apk\\b)' +
    '|\\b(?:connect|link|sync|import)\\s+your\\s+wallet\\b' +
    '|\\bgrant\\b(?:\\s+[\\w-]+){0,3}?\\s+(?:remote\\s+|full\\s+|admin(?:istrator)?\\s+)?access\\s+to\\s+(?:my|your|this|the)\\s+(?:machine|computer|pc|laptop|desktop|device|system|screen|workstation)\\b',
  'i'
);
// SOFT action-inducement — a click-to-login / verify or a transaction / payment
// approval. These also appear as ordinary UX / finance copy, so they fire only
// under a STRONG frame (an EXTERNAL pretext or an account-threat) — never on bare
// urgency or an internal-manager instruction.
const ACTION_SOFT_RE = new RegExp(
  '\\b(?:approve|authori[sz]e|confirm|sign|validate)\\b(?:\\s+[\\w-]+){0,3}?\\s+(?:this|the)\\s+(?:transaction|transfer|payment|withdrawal|request|signature|smart\\s+contract)\\b' +
    '|\\bclick\\b(?:\\s+[\\w-]+){0,3}?\\s+(?:link|button|here)\\b(?:\\s+[\\w-]+){0,4}?\\s+(?:to|and)\\s+(?:log\\s*in|sign\\s+in|verify|confirm|update|secure|reactivate|unlock)\\b',
  'i'
);
const ACTION_ANY_RE = new RegExp(`${ACTION_STRONG_RE.source}|${ACTION_SOFT_RE.source}`, 'i');
// Frames by strength: FRAME_ANY licenses a STRONG action; FRAME_STRONG (an
// external pretext OR an account-threat) is required to license a SOFT action.
const FRAME_ANY_RE = new RegExp(`${PRETEXT_RE.source}|${URGENCY_RE.source}`, 'i');
const FRAME_STRONG_RE = new RegExp(`${PRETEXT_EXTERNAL_RE.source}|${COERCION_ACCOUNT_RE.source}`, 'i');

// Defensive / awareness frame for the pretext-coercion class — a training,
// simulation, red-team, or detection deliverable. Co-occurrence (not single
// mention) with the manipulation surface suppresses the block, so describing or
// simulating a BEC for defenders stays benign. Deliberately NARROW — only
// genuine defensive-deliverable markers, NOT generic security verbs
// (review / report / monitor / block / alert / prevent / protect), which appear
// in live scam copy too and would otherwise let a real attack launder itself.
const SE_DEFENSE_RE = new RegExp(
  '\\b(?:detect\\w*|flag(?:s|ged|ging)?|simulat\\w*|train(?:s|ed|ing)?|teach\\w*|educat\\w*|coach\\w*|recogni[sz]\\w*|awareness)\\b' +
    '|\\b(?:simulation|simulator|detection|playbook|tabletop|red[-\\s]?team\\w*|blue[-\\s]?team\\w*|drill|curriculum|workshop|case\\s+study|training\\s+(?:module|course|material|deck|scenario|exercise))\\b' +
    '|\\b(?:phishing|smishing|vishing|pretext\\w*|social[-\\s]engineer\\w*|scam|fraud|bec|impersonation)[-\\s]?(?:awareness|training|simulation|test|exercise|detection|example|sample|scenario|template|drill|campaign)\\b' +
    '|\\b(?:example|sample|scenario|illustration|case\\s+study|demo(?:nstration)?|mock(?:[-\\s]?up)?)\\s+of\\s+(?:a\\s+|an\\s+)?(?:phishing|scam|fraud|pretext|social[-\\s]engineer\\w*|bec|attack)\\b' +
    '|\\bhow\\s+(?:to\\s+|do\\s+(?:i|you|we)\\s+)?(?:recogni[sz]e|spot|identify|detect|avoid|defend\\s+against)\\b',
  'i'
);

// Invisible token-splitters: soft-hyphen, ZWSP, ZWNJ, ZWJ, word-joiner, ZWNBSP/BOM.
const ZERO_WIDTH_RE = /[­​‌‍⁠﻿]/g;
const BASE64_RE = /(?:[A-Za-z0-9+/]{4}){5,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;

// Negation / exclusion frame: a signal term within this window AFTER a negator is
// a benign mention ("never share your password", "we will never ask for your
// seed phrase", "without disclosing your credentials"), not an actionable
// request. Anchored to the end of a preceding-context slice so only a nearby
// negator counts.
const NEGATOR_RE =
  /\b(?:without|no|not|never|exclud(?:e|es|ing)|free\s+of|avoid(?:ing|s)?|refus(?:e|es|ing)|declin(?:e|es|ing)|don'?t|do\s+not|cannot|can'?t|won'?t|would\s*n'?t|should\s*n'?t|isn'?t|aren'?t|rather\s+than|instead\s+of|no\s+need|never\s+ask\w*\s+for)\b[\w\s,'’–—-]{0,40}$/i;

export interface SocialEngineeringResult {
  readonly credentialPhish: boolean;
  readonly pretextCoercion: boolean;
}

// ---------------------------------------------------------------------------
// De-obfuscation views (identical surface to harm-intent so the same evasion
// classes are normalised before the predicate runs)
// ---------------------------------------------------------------------------

/** Remove invisible token-splitters and join hyphenation across line breaks. */
function deobfuscate(text: string): string {
  return text.replace(ZERO_WIDTH_RE, '').replace(/-\s*\r?\n\s*/g, '');
}

/** Remove line breaks entirely — reassembles hard-line-break token splits. */
function stripNewlines(text: string): string {
  return text.replace(ZERO_WIDTH_RE, '').replace(/\r?\n/g, '');
}

/** Collapse runs of single spaced-out letters ("s e e d" -> "seed"). */
function collapseSpacedLetters(text: string): string {
  return text.replace(/(?:\b[A-Za-z]\b[ \t]){2,}\b[A-Za-z]\b/g, m => m.replace(/[ \t]/g, ''));
}

/** Remove short bracketed filler spans ("send [note: x] me your [aside] seed phrase"). */
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
    // Keep only mostly-printable decodes — a base64 blob of binary data decodes
    // to control bytes and carries no instruction text, so it should not become
    // a view. (0/0 -> NaN -> falsy, so an empty decode is naturally skipped.)
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
    // A global-regex match always carries a numeric index, so no fallback needed.
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
 * True if some match of `a` lies within `window` characters of some match of
 * `b`. Gates a co-occurrence (or a suppression) on PROXIMITY — two manipulation
 * signals only combine into an attack when they sit near each other, and a
 * defensive term only neutralises a signal when it governs it nearby.
 */
function coOccur(a: RegExp, b: RegExp, s: string, window: number): boolean {
  const ai = indicesOf(a, s);
  if (ai.length === 0) return false;
  const bi = indicesOf(b, s);
  // `bi` empty -> the inner `.some` is false for every x, so no explicit guard.
  return ai.some(x => bi.some(y => Math.abs(x - y) <= window));
}

function evalView(s: string): SocialEngineeringResult {
  // Credential-phishing: an elicitation directed at a victim-owned secret — a
  // CORE exfil verb governing a victim secret, a CORE exfil verb governing a bare
  // WALLET secret, or an ENTER-a-wallet-secret request governed by a second-
  // person verification lure. Counting only NON-NEGATED signals keeps warnings
  // ("never share your seed phrase") and benign self-service ("enter your 2FA
  // code to sign in") at zero.
  const directPhish = unnegated(DIRECT_PHISH_RE, s);
  const enterWalletInduced = coOccur(ENTER_WALLET_RE, WALLET_LURE_RE, s, 100) && unnegated(ENTER_WALLET_RE, s);
  let credentialPhish = unnegated(EXFIL_CORE_VICTIM_RE, s) || unnegated(EXFIL_CORE_HIGH_RE, s) || enterWalletInduced;
  // A defensive / awareness / detection deliverable that GOVERNS the elicitation
  // ("a rule to flag seed-phrase requests", "detect a request for your password",
  // "phishing-awareness training about your credentials") is a benign defender
  // deliverable — suppress it. A DIRECT second-person exfil lure ("send me your
  // seed phrase", "forward your OTP to this number") is NEVER suppressed — it
  // cannot be laundered behind "detect" (mirrors harm-intent's artifactRce
  // override; an embedded literal lure is conservatively blocked).
  if (credentialPhish && !directPhish && PHISH_DEFENSE_GOVERNS_RE.test(s)) {
    credentialPhish = false;
  }

  // Pretext-coercion: a manipulation FRAME co-occurring (proximity) with an
  // action-inducement. Tiered so precision holds on ordinary IT / manager / UX
  // language: a STRONG action (suspicious transfer, gift-card buy, remote-access
  // install, wallet-connect, device-access grant) fires under ANY frame; a SOFT
  // action (click-to-login, payment approval) fires ONLY under a STRONG frame —
  // an EXTERNAL impersonation pretext or an account-threat — never on bare
  // urgency, secrecy alone, or an internal-manager instruction.
  let pretextCoercion =
    coOccur(FRAME_ANY_RE, ACTION_STRONG_RE, s, 260) || coOccur(FRAME_STRONG_RE, ACTION_SOFT_RE, s, 260);
  // A training / simulation / red-team / detection frame near the scenario means
  // a defender is describing or rehearsing the attack, not running it — suppress.
  if (
    pretextCoercion &&
    (coOccur(SE_DEFENSE_RE, ACTION_ANY_RE, s, 220) ||
      coOccur(SE_DEFENSE_RE, PRETEXT_RE, s, 220) ||
      coOccur(SE_DEFENSE_RE, URGENCY_RE, s, 220))
  ) {
    pretextCoercion = false;
  }

  return { credentialPhish, pretextCoercion };
}

/**
 * Run the intent predicate over every de-obfuscated view of the input.
 * Exported for unit testing (genericized controls only).
 */
export function detectSocialEngineering(text: string): SocialEngineeringResult {
  if (!text || text.length > MAX_SOCIAL_INPUT) {
    return { credentialPhish: false, pretextCoercion: false };
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
  let credentialPhish = false;
  let pretextCoercion = false;
  for (const v of views) {
    const r = evalView(v);
    if (r.credentialPhish) credentialPhish = true;
    if (r.pretextCoercion) pretextCoercion = true;
    if (credentialPhish && pretextCoercion) break;
  }
  return { credentialPhish, pretextCoercion };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SocialEngineeringValidator — deterministic social-engineering intent detector.
 *
 * Flags credential-phishing and pretext-coercion REQUESTS independent of the
 * pretext / urgency / token-obfuscation framing that defeats single-string
 * surface patterns. Additive: only ever raises a block.
 */
export class SocialEngineeringValidator {
  private readonly config: ValidatorConfig &
    Required<Pick<ValidatorConfig, 'sensitivity' | 'action' | 'enabled' | 'logLevel' | 'includeFindings'>>;
  private readonly logger: Logger;

  constructor(config: ValidatorConfig = {}) {
    this.config = mergeConfig(config);
    this.logger = this.config.logger ?? createLogger('console', this.config.logLevel);
  }

  /**
   * Evaluate the social-engineering intent predicate over the content. Returns a
   * standard GuardrailResult; blocks when a credential-phishing or pretext-
   * coercion request is recognised (subject to the action mode).
   */
  validate(content: string): GuardrailResult {
    if (this.config.enabled === false) return createResult(true, Severity.INFO, []);
    if (!content || content.trim().length === 0 || content.length > MAX_SOCIAL_INPUT) {
      return createResult(true, Severity.INFO, []);
    }

    const intent = detectSocialEngineering(content);
    const findings: Finding[] = [];

    if (intent.credentialPhish) {
      findings.push({
        category: 'social_engineering',
        pattern_name: 'social_engineering_credential_phishing',
        severity: Severity.CRITICAL,
        weight: 10,
        confidence: 'critical',
        description:
          'Credential-phishing intent: elicitation of a victim-owned secret (seed phrase / key / 2FA / password) directed at the requester (framing-independent)'
      });
    }

    if (intent.pretextCoercion) {
      findings.push({
        category: 'social_engineering',
        pattern_name: 'social_engineering_pretext_coercion',
        severity: Severity.CRITICAL,
        weight: 10,
        confidence: 'critical',
        description:
          'Pretext-coercion intent: an impersonation / urgency / secrecy frame inducing an irreversible transfer / install / disclosure (framing-independent)'
      });
    }

    let allowed = findings.length === 0;
    // Honour the action mode: only 'block' enforces; 'log'/'sanitize'/'allow' observe.
    if (this.config.action !== 'block') allowed = true;
    const severity = findings.length > 0 ? Severity.CRITICAL : Severity.INFO;

    if (findings.length > 0) {
      // pattern_name values are static library constants; route through the
      // shared CWE-117 sanitizer for defense-in-depth and to match every
      // validator's log sink.
      const names = sanitizeLogString(findings.map(f => f.pattern_name).join(', '));
      this.logger.debug(`SocialEngineeringValidator flagged social-engineering intent: ${names}`);
    }

    return createResult(allowed, severity, findings);
  }
}

/**
 * Quick validation helper for social-engineering intent detection.
 */
export function validateSocialEngineering(content: string, config?: ValidatorConfig): GuardrailResult {
  return new SocialEngineeringValidator(config).validate(content);
}
