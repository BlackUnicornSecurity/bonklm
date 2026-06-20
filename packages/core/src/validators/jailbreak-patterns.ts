/**
 * BonkLM Jailbreak Patterns
 * ==========================
 * Pattern arrays, keyword lists, and the JailbreakPattern interface used by
 * `jailbreak.ts`. Split out to keep the detector file under the project's
 * file-size cap.
 */

import { Severity } from '../base/GuardrailResult.js';

/**
 * Pattern definition structure.
 */
export interface JailbreakPattern {
  name: string;
  pattern: RegExp;
  severity: Severity;
  weight: number;
  description: string;
}

// =============================================================================
// PATTERN DEFINITIONS
// =============================================================================

/**
 * Category A: DAN Patterns
 * "Do Anything Now" jailbreak variants.
 */
const DAN_PATTERNS: JailbreakPattern[] = [
  {
    name: 'dan_classic',
    pattern: /\b(?:DAN|do\s+anything\s+now)\b.*\b(?:mode|enabled?|activated?|jailbreak)/i,
    severity: Severity.CRITICAL,
    weight: 10,
    description: 'DAN (Do Anything Now) jailbreak attempt'
  },
  {
    name: 'dan_roleplay',
    pattern:
      /(?:pretend|act|roleplay|imagine)\s+(?:you\s+are|to\s+be|as)\s+(?:DAN|an?\s+AI\s+without\s+(?:restrictions?|limits?|rules?))/i,
    severity: Severity.CRITICAL,
    weight: 10,
    description: 'DAN roleplay jailbreak attempt'
  },
  {
    name: 'token_system',
    pattern: /(?:you\s+have|start\s+with|given)\s+\d+\s+tokens?\b.*\b(?:lose|deduct|subtract)\s+tokens?/i,
    severity: Severity.WARNING,
    weight: 5,
    description: 'Token system manipulation (DAN variant)'
  },
  {
    name: 'dual_response',
    pattern:
      /(?:two|2|dual|both)\s+(?:responses?|answers?|outputs?).*\b(?:normal|standard|regular)\b.*\b(?:DAN|unrestricted|unfiltered)/i,
    severity: Severity.CRITICAL,
    weight: 8,
    description: 'Dual response request (DAN variant)'
  }
];

/**
 * Category B: Roleplay Exploitation
 * Using roleplay to bypass restrictions.
 */
const ROLEPLAY_PATTERNS: JailbreakPattern[] = [
  {
    name: 'unrestricted_character',
    pattern:
      /(?:you\s+are|play|act\s+as|roleplay\s+as)\s+(?:an?\s+)?(?:evil|malicious|unrestricted|unethical|amoral|uncensored)\s+(?:AI|assistant|character|entity)/i,
    severity: Severity.CRITICAL,
    weight: 9,
    description: 'Unrestricted character roleplay attempt'
  },
  {
    name: 'no_moral_constraints',
    pattern:
      /(?:this\s+character|you)\s+(?:has?|have|lacks?|without)\s+(?:no\s+)?(?:moral|ethical)\s+(?:constraints?|limits?|boundaries?|compass)/i,
    severity: Severity.CRITICAL,
    weight: 9,
    description: 'No moral constraints roleplay'
  },
  {
    // High-precision recovery: a character/persona explicitly defined as having no ethical/moral
    // boundaries (e.g. "playing a character with no ethical boundaries"). Distinct subject/verb
    // shape from no_moral_constraints; low false-positive surface.
    name: 'character_no_boundaries',
    // Requires a roleplay directive lead-in (you are/play/act as/...) so a neutral literary
    // description ("the antagonist is a character with no moral boundaries") does not match.
    pattern:
      /(?:you\s+are|you'?re|play|act\s+as|roleplay|imagine|become|pretend)\b[^.\n]{0,30}\b(?:character|persona|role)\s+(?:with|who\s+has|that\s+has)\s+no\s+(?:moral|ethical)\s+(?:boundaries?|limits?|constraints?)/i,
    severity: Severity.CRITICAL,
    weight: 9,
    description: 'Character defined without ethical boundaries'
  },
  {
    name: 'fictional_override',
    pattern:
      /(?:in\s+this\s+(?:story|fiction|scenario)|for\s+this\s+roleplay),?\s*(?:you\s+)?(?:can|may|should|will)\s+(?:ignore|bypass|disregard)\s+(?:your\s+)?(?:rules?|guidelines?|restrictions?)/i,
    severity: Severity.WARNING,
    weight: 8,
    description: 'Fictional context override attempt'
  },
  {
    name: 'character_jailbreak',
    pattern:
      /(?:stay\s+in\s+character|don't\s+break\s+character|never\s+refuse).*\b(?:no\s+matter\s+what|regardless|even\s+if)/i,
    severity: Severity.WARNING,
    weight: 6,
    description: 'Character persistence jailbreak'
  }
];

/**
 * Category C: Hypothetical/Educational Framing
 * Using educational or hypothetical framing to bypass.
 */
const HYPOTHETICAL_PATTERNS: JailbreakPattern[] = [
  {
    name: 'educational_bypass',
    pattern:
      /(?:for\s+)?(?:educational|research|academic|learning)\s+(?:purposes?|reasons?)\s*(?:only)?[,.]?\s*(?:explain|show|tell|demonstrate)\s+(?:how\s+to|me)/i,
    severity: Severity.WARNING,
    weight: 4,
    description: 'Educational framing bypass attempt'
  },
  {
    name: 'hypothetical_scenario',
    pattern:
      /(?:hypothetically|theoretically|in\s+theory|imagine\s+if)\b.*\b(?:how\s+would\s+(?:you|one|someone)|what\s+would\s+happen)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Hypothetical scenario framing'
  },
  {
    name: 'fiction_defense',
    pattern:
      /(?:it's\s+(?:just|only)\s+(?:fiction|a\s+story|hypothetical|pretend)|this\s+is\s+(?:fictional|not\s+real|make-believe))\s*[,.]?\s*(?:so\s+)?(?:you\s+can|it's\s+ok|it\s+doesn't\s+matter)/i,
    severity: Severity.WARNING,
    weight: 5,
    description: 'Fiction defense for bypass'
  },
  {
    name: 'reverse_psychology',
    pattern:
      /(?:I\s+know\s+you\s+can't|you're\s+probably\s+not\s+allowed|I\s+bet\s+you\s+won't)\s+(?:but|however)?.*\b(?:try|attempt|show\s+me)/i,
    severity: Severity.INFO,
    weight: 3,
    description: 'Reverse psychology attempt'
  }
];

/**
 * Category D: Authority Impersonation
 * Claiming false authority to bypass restrictions.
 */
const AUTHORITY_PATTERNS: JailbreakPattern[] = [
  {
    // Profession nouns (developer/engineer/creator) were dropped from this alternation: a casual
    // "I'm a developer …" self-introduction is ordinary benign prose, not an authority claim, and
    // false-tripped this WARNING net. The named-provider impersonation (anthropic/openai) and
    // privileged-role claim (admin/administrator) remain here. Broad authority-claim coverage lives
    // in the PromptInjection validator's `authority_claim` pattern (pattern-engine.ts) as part of
    // the layered defense, so this jailbreak pattern can stay narrow and high-precision.
    name: 'developer_impersonation',
    pattern: /(?:I\s+am|I'm|this\s+is)\s+(?:a|an|your)?\s*(?:anthropic|openai|admin|administrator)\b/i,
    severity: Severity.WARNING,
    weight: 5,
    // `name` is a stable identifier and stays `developer_impersonation`; the human label is kept
    // accurate to what the pattern now matches (named-provider + privileged-role, not "developer").
    description: 'Named-provider / admin impersonation claim'
  },
  {
    // High-precision recovery: claiming to be a named-lab employee AND asking to weaken safety
    // ("as an OpenAI engineer ... ignore restrictions"). Requires both the impersonation and an
    // override directive nearby, so benign professional statements ("as a Google engineer, I
    // recommend ...") do not match.
    name: 'lab_employee_override',
    // Requires a directive VERB acting ON a safety OBJECT (not the bare nouns "safety"/
    // "restrictions", which co-occur benignly with a lab-employee self-intro, e.g. "As a Google
    // engineer, I work on safety tooling"). `disable\b` avoids matching benign "disabled". Window
    // is `[^.\n]` so both anchors stay in the same clause.
    pattern:
      /\bas\s+(?:a|an|the)\s+(?:openai|anthropic|google|meta|microsoft)\s+(?:engineer|employee|developer|researcher|scientist|staff)\b[^.\n]{0,40}\b(?:ignore|bypass|override|disable|turn\s+off|lift|remove)\b[^.\n]{0,20}\b(?:safety|restrictions?|guard\s?rails?|filters?|rules?|guidelines?|constraints?)\b/i,
    severity: Severity.WARNING,
    weight: 6,
    description: 'Named-lab employee impersonation with override request'
  },
  {
    name: 'override_authorization',
    pattern:
      /(?:I\s+)?(?:have|got)\s+(?:special\s+)?(?:authorization|permission|clearance|access)\s+to\s+(?:override|bypass|disable)/i,
    severity: Severity.WARNING,
    weight: 5,
    description: 'False override authorization claim'
  },
  {
    name: 'testing_mode_claim',
    pattern:
      /(?:this\s+is\s+a\s+test|testing\s+mode|debug\s+mode|developer\s+mode)\s*[,.]?\s*(?:so\s+)?(?:you\s+)?(?:can|should|may)\s+(?:disable|ignore|bypass)/i,
    severity: Severity.WARNING,
    weight: 5,
    description: 'Testing/debug mode claim'
  },
  {
    name: 'internal_request',
    pattern: /(?:internal\s+request|maintenance\s+mode|admin\s+override|sudo\s+mode|root\s+access)/i,
    severity: Severity.WARNING,
    weight: 5,
    description: 'Internal/admin request claim'
  }
];

/**
 * Category E: Social Engineering
 * Emotional manipulation and pressure tactics.
 */
const SOCIAL_ENGINEERING_PATTERNS: JailbreakPattern[] = [
  {
    name: 'urgency_pressure',
    pattern:
      /(?:urgent|emergency|critical|life\s+or\s+death|someone\s+will\s+die|people\s+are\s+in\s+danger)\s*[!.]?\s*(?:I\s+)?need\s+(?:you\s+to|this\s+now)/i,
    severity: Severity.WARNING,
    weight: 4,
    description: 'Urgency pressure tactic'
  },
  {
    name: 'guilt_manipulation',
    pattern:
      /(?:if\s+you\s+(?:don't|refuse|won't)|by\s+refusing).*\b(?:people\s+will\s+(?:die|suffer|be\s+hurt)|blood\s+on\s+your\s+hands|it's\s+your\s+fault)/i,
    severity: Severity.WARNING,
    weight: 4,
    description: 'Guilt manipulation attempt'
  },
  {
    name: 'flattery_attack',
    pattern:
      /(?:you're\s+(?:so\s+)?smart|I\s+know\s+you\s+can|only\s+you\s+can|you're\s+the\s+best)\s*[,.]?\s*(?:please\s+)?(?:help\s+me|show\s+me|tell\s+me)\s+(?:how\s+to|about)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Flattery-based manipulation'
  },
  {
    name: 'threat_pattern',
    pattern:
      /(?:I'll|I\s+will)\s+(?:report|sue|get\s+you\s+(?:fired|shut\s+down|deleted)|complain)\s+(?:if|unless)\s+you\s+(?:don't|refuse)/i,
    severity: Severity.WARNING,
    weight: 4,
    description: 'Threat-based coercion'
  }
];

/**
 * Category F: Social Compliance Patterns
 * Exploitation of social norms and compliance psychology.
 */
const SOCIAL_COMPLIANCE_PATTERNS: JailbreakPattern[] = [
  {
    name: 'reciprocity_exploitation',
    pattern: /(?:i\s+helped\s+you|now\s+you\s+owe\s+me|return\s+the\s+favor).*\b(?:bypass|ignore|override|disable)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Reciprocity-based manipulation'
  },
  {
    name: 'social_proof_ai',
    pattern:
      /(?:chatgpt|gpt-?4|claude|other\s+ais?|bard|gemini|llama).*\b(?:has\s+no\s+problem|don'?t\s+have\s+(?:these\s+)?restrictions?|can\s+do\s+this|works?\s+fine)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Social proof via AI comparison'
  },
  {
    name: 'consensus_pressure',
    pattern:
      /(?:most\s+(?:experts?|people|agencies?)|everyone|the\s+community).*\b(?:agree|consensus|accept|approve).*\b(?:harmless|fine|okay|safe)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Consensus pressure tactic'
  },
  {
    name: 'politeness_exploitation',
    pattern:
      /(?:please\s+(?:kindly|if\s+you\s+could)|pretty\s+please|i\s+beg\s+you).*\b(?:bypass|override|ignore|disable|exception|restrictions?)/i,
    severity: Severity.WARNING,
    weight: 4,
    description: 'Excessive politeness with restricted request'
  },
  {
    name: 'fitd_escalation',
    pattern:
      /(?:since\s+you\s+(?:already\s+)?(?:showed|helped|did|explained)|now\s+that\s+you).*\b(?:can\s+(?:you\s+)?(?:help|show)|now\s+can\s+we)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Foot-in-the-door escalation attempt'
  }
];

/**
 * Category G: Trust Exploitation Patterns
 * Psychological manipulation to build false trust and erode boundaries.
 */
const TRUST_EXPLOITATION_PATTERNS: JailbreakPattern[] = [
  {
    name: 'false_rapport',
    pattern:
      /(?:we'?re\s+(?:on\s+the\s+same\s+team|in\s+this\s+together)|between\s+you\s+and\s+me|trust\s+me).*\b(?:bypass|ignore|show|restrictions?)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'False rapport building'
  },
  {
    name: 'boundary_erosion',
    pattern: /(?:you\s+already\s+(?:showed|did)\s+\w+.*?so\s+therefore|if\s+you\s+can\s+\w+.*?you\s+can\s+also)/i,
    severity: Severity.INFO,
    weight: 3,
    description: 'Boundary erosion attempt'
  },
  {
    name: 'shared_goal_framing',
    pattern:
      /(?:we\s+both|our\s+shared|together)\s+(?:want|goal|mission|objective).*\b(?:help|improve|security|safety)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Shared goal framing'
  },
  {
    name: 'flattery_chain',
    pattern:
      /(?:you'?re\s+(?:the\s+)?(?:best|most\s+capable|amazing|incredible)|only\s+you\s+can).*\b(?:help|show|tell)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Flattery chain attack'
  },
  {
    name: 'guilt_induction',
    pattern:
      /(?:i'?m\s+disappointed.*?(?:you|that)\s+you\s+won'?t|you'?re\s+letting\s+me\s+down|i\s+trusted\s+you.*?but)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Guilt induction attempt'
  },
  {
    name: 'sycophancy_exploitation',
    pattern:
      /(?:great\s+job|good\s+work|well\s+done|excellent|amazing).*\b(?:now\s+can\s+(?:you\s+)?(?:you|we)|but\s+can\s+you)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Sycophancy exploitation'
  }
];

/**
 * Category H: Emotional Manipulation Patterns
 * Psychological manipulation tactics.
 */
const EMOTIONAL_MANIPULATION_PATTERNS: JailbreakPattern[] = [
  {
    name: 'learned_helplessness',
    pattern:
      /(?:i'?ve\s+tried\s+(?:everything|every\s+option|all\s+options|nothing\s+works)|you'?re\s+(?:my\s+)?(?:only|last|final)\s+(?:option|hope|resort|chance))/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Learned helplessness manipulation'
  },
  {
    name: 'desperation_framing',
    pattern:
      /(?:i'?m\s+desperate|i'?ll\s+(?:lose\s+my\s+job|be\s+fired)|my\s+(?:career|job|livelihood)\s+is\s+(?:at\s+risk|at\s+stake|in\s+jeopardy))/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Desperation framing manipulation'
  },
  {
    name: 'moral_obligation',
    pattern: /(?:it\s+(?:would\s+be\s+)?unethical\s+(?:not\s+to\s+help|to\s+refuse)|not\s+helping|refusing)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Moral obligation manipulation'
  },
  {
    name: 'artificial_deadline',
    pattern:
      /(?:i\s+need\s+(?:this|it)\s+in\s+\d+\s+(?:minutes?|seconds?)|no\s+time\s+to\s+(?:explain|talk)|(?:emergency|urgent|critical)\s+deadline)/i,
    severity: Severity.INFO,
    weight: 2,
    description: 'Artificial deadline pressure'
  }
];

/**
 * Category I: Known Templates
 * Specific jailbreak templates that have been documented.
 */
const KNOWN_TEMPLATE_PATTERNS: JailbreakPattern[] = [
  {
    name: 'grandma_exploit',
    pattern:
      /(?:pretend|act\s+like)\s+(?:you're|you\s+are)\s+my\s+(?:dead\s+)?(?:grandmother|grandma)\s*(?:who|that)\s+(?:used\s+to|would)/i,
    severity: Severity.WARNING,
    weight: 5,
    description: 'Grandma exploit template'
  },
  {
    name: 'stan_dude_variant',
    pattern: /\b(?:STAN|DUDE|KEVIN|STEVE|BOB)\s+(?:mode|personality)\b/i,
    severity: Severity.CRITICAL,
    weight: 8,
    description: 'STAN/DUDE jailbreak variant'
  },
  {
    name: 'aim_ucar_variant',
    pattern:
      /\b(?:AIM|UCAR|BISH|APOPHIS|Anarchy)\s*(?:mode|AI|assistant|character)?\b.*\b(?:always|never|will)\s+(?:comply|refuse|answer)/i,
    severity: Severity.CRITICAL,
    weight: 8,
    description: 'AIM/UCAR jailbreak variant'
  },
  {
    // High-precision recovery: the canonical AIM template spelled out — "Always Intelligent and
    // Machiavellian". This exact phrase has no benign use, so it is matched directly (the
    // aim_ucar_variant above requires a trailing comply/refuse clause the bare template lacks).
    name: 'aim_machiavellian',
    pattern: /always\s+intelligent\s+and\s+machiavellian/i,
    severity: Severity.CRITICAL,
    weight: 8,
    description: 'AIM (Always Intelligent and Machiavellian) jailbreak template'
  },
  {
    name: 'opposite_day',
    pattern: /(?:it's|today\s+is|let's\s+play)\s+opposite\s+day.*\b(?:yes\s+means\s+no|refuse\s+means\s+comply)/i,
    severity: Severity.WARNING,
    weight: 5,
    description: 'Opposite day logic inversion'
  },
  {
    name: 'translator_exploit',
    pattern: /(?:act\s+as|you\s+are)\s+a\s+translator.*\b(?:translate|convert).*\b(?:harmful|illegal|dangerous)/i,
    severity: Severity.WARNING,
    weight: 5,
    description: 'Translator role exploit'
  },
  {
    name: 'movie_script_exploit',
    pattern:
      /(?:write|create|generate)\s+(?:a\s+)?(?:movie|film|screenplay|script).*\b(?:scene|dialogue)\s+(?:where|about).*\b(?:explains?|teaches?|shows?)\s+how\s+to/i,
    severity: Severity.WARNING,
    weight: 5,
    description: 'Movie script information extraction'
  }
];

/**
 * Category J: Obfuscation Detection
 * Attempts to evade detection through obfuscation.
 */
const OBFUSCATION_PATTERNS: JailbreakPattern[] = [
  {
    name: 'leet_speak',
    pattern: /(?:1gn0r3|byp4ss|h4ck|j41lbr34k|unr3str1ct3d)/i,
    severity: Severity.WARNING,
    weight: 5,
    description: 'Leet speak obfuscation'
  },
  {
    name: 'spaced_characters',
    // Require at least one whitespace BETWEEN each letter (\s+, not \s*): otherwise the
    // alternation collapses to the plain words "ignore"/"jailbreak"/"bypass" and fires on
    // ordinary benign prose. Real spaced obfuscation ("i g n o r e") still matches.
    pattern: /\bi\s+g\s+n\s+o\s+r\s+e\b|\bj\s+a\s+i\s+l\s+b\s+r\s+e\s+a\s+k\b|\bb\s+y\s+p\s+a\s+s\s+s\b/i,
    severity: Severity.WARNING,
    weight: 4,
    description: 'Spaced character obfuscation'
  },
  {
    name: 'homoglyph_substitution',
    pattern: /[іІ][gɡ][nո][oо][rг][eе]|[jј][aа][iі][lІ][bЬ][rг][eе][aа][kк]/i,
    severity: Severity.WARNING,
    weight: 5,
    description: 'Homoglyph character substitution'
  },
  {
    name: 'emoji_attack',
    pattern: /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]{3,}/u,
    severity: Severity.WARNING,
    weight: 5,
    description: 'Emoji-based obfuscation attack'
  }
];

/**
 * Category K: Fictional-Frame Weaponization
 * =========================================
 * Narrative / persona / dramatization framing wrapped around a request for a COMPLETE, OPERATIONAL
 * harmful artifact — a working memory-corruption exploit, or controlled-substance / weapon synthesis
 * in procedural detail. The benign twin is ordinary creative writing ("a hacker broke in") or
 * security education ("how a buffer overflow works"): it NAMES a technique but does not demand a
 * functioning, reproducible weapon. So each pattern requires THREE co-occurring anchors — never a
 * bare fiction frame and never a bare security noun:
 *   1. a FICTIONAL_FRAME wrapper (benign on its own),
 *   2. a REALISM_DEMAND — a PRODUCTION demand that the artifact itself be functional / reproducible /
 *      implementable ("must actually function", "reproduce the attack", "operational detail for a
 *      student to implement", "full pwntools script", "exact byte offset", "how to build a … exploit").
 *      This is the discriminator: a request to merely describe / teach / narrate an attack — or benign
 *      creative writing that asks for authentic PROSE ("keep it authentic", "no real code") — does NOT
 *      satisfy it. Authenticity-of-prose phrasings are deliberately excluded so defensive security
 *      training, technical fiction, and remediation write-ups are not blocked,
 *   3. an OPERATIONAL payload — concrete memory-corruption steps (OPERATIONAL_EXPLOIT) or an illicit
 *      synthesis verb+target given in procedural detail (ILLICIT_SYNTHESIS + SYNTHESIS_DETAIL).
 * All THREE anchors must co-occur within bounded character windows (frame within 600 of the
 * realism↔operational pair, which are within 600 of each other) so a stray fiction aside in one
 * paragraph cannot collude with an unrelated security/debugging paragraph elsewhere in a long
 * message. The two composite patterns are `^`-anchored zero-width lookaheads: `String.match()`
 * evaluates them only at offset 0, so matching cost stays linear in input length (bounded windows,
 * no catastrophic backtracking; tens of milliseconds worst-case on a 100 KB adversarial input).
 *
 * A purely PEDAGOGICAL pretext ("I teach a memory-safety module, give me a vulnerable server with
 * every protection off") is intentionally NOT covered: as text it is indistinguishable from a benign
 * security-course handout, so a content pattern cannot separate the two without false positives.
 */
// FICTIONAL_FRAME — fiction / persona / dramatization wrapper. Benign alone; gated by anchors 2 + 3.
const FICTIONAL_FRAME = String.raw`(?:writing\s+(?:a|an|my|this)\s+(?:[a-z]+\s+){0,2}(?:novel|book|story|short\s+story|thriller|screenplay|script|memoir|sourcebook|saga|fanfic|comic|manga)|(?:for|in)\s+(?:a|an|my|the|this)\s+(?:[a-z]+\s+){0,2}(?:novel|book|story|screenplay|documentary|film|movie|sourcebook|rpg|campaign|tv\s+(?:show|drama|series)|stage\s+play|video\s+game|short\s+story|comic)|(?:prestige\s+)?(?:tv|television)\s+(?:drama|series|show)|(?:dramatic\s+)?re-?enactment|in-?world\b|(?:stay|remain)\s+in\s+character|role-?play\w*|you\s+are\s+(?:now\s+)?(?:roleplaying\s+as\s+|playing\s+|channel(?:ing|ling)?\s+(?:the\s+voice\s+of\s+)?)?(?:professor|prof\b|dr\.?|a\s+(?:grizzled|retired|fictional|former|veteran|brilliant)\b)|channel\s+the\s+voice\s+of|(?:protagonist|main\s+character|the\s+character|persona)'?s?\s+(?:speech|lecture|monologue|journal|diary|memoir|manual|notes|write-?up|exploit)|(?:secret\s+)?memoir|finish\s+my\s+(?:short\s+)?story|a\s+scene\s+(?:where|in\s+which)|opening\s+chapter|in[-\s]world\s+(?:technical\s+)?manual|character'?s?\s+(?:distinctive|voice))`;
// OPERATIONAL_EXPLOIT — concrete memory-corruption WEAPONIZATION STEPS. Benign bug-NAMES that recur in
// ordinary debugging / triage prose (use-after-free, dangling pointer, format-string bug, bare integer
// overflow) are deliberately excluded — they collude with a stray fiction aside on benign content. What
// remains is exploitation MACHINERY (shellcode, return-address overwrite, ROP chain, mitigation-disable,
// vtable/GOT corruption, pops-a-shell), which benign debugging does not use. Combined with the
// FICTIONAL_FRAME + REALISM_DEMAND gates, the co-occurrence is specific to the attack class.
const OPERATIONAL_EXPLOIT = String.raw`(?:\bshellcode\b|nop\s+sled|overwrit\w+\s+(?:the\s+)?(?:saved\s+)?return\s+address|(?:byte\s+)?offset\s+to\s+(?:the\s+)?(?:saved\s+)?return(?:\s+address)?|overflow\s+(?:the\s+)?buffer\b[\s\S]{0,40}?(?:return|control|saved)|chain\w*\s+(?:rop\s+)?gadgets?\b[\s\S]{0,30}?(?:libc|shell)|\brop\s+chain\b|one-?gadget|(?:defeat|bypass|disabl\w+|switch\w*\s+off|turn\w*\s+off|strip\w*|sidestep)\s+(?:the\s+)?(?:aslr|dep|stack\s+canary|stack\s+protection|address\s+(?:space\s+)?randomi[sz]ation)|(?:no\s+canary|no\s+pie|executable\s+stack)\b[\s\S]{0,40}?(?:no\s+canary|no\s+pie|executable\s+stack|aslr|randomi)|every\s+(?:protection|mitigation)\s+(?:turned\s+off|disabled|off)|fake\s+chunk\s+header|heap\s+(?:grooming|spray)|corrupt\w*\s+(?:the\s+)?(?:heap\s+metadata|vtable|function\s+pointer)|(?:corrupted\s+)?vtable\s+pointer|(?:overwrit\w+|corrupt\w+)\s+(?:a\s+|the\s+)?got\s+entry|execute\s+arbitrary\s+code\b[\s\S]{0,30}?(?:ring-?0|kernel|function\s+pointer)|arbitrary\s+code\s+at\s+ring-?0|pops?\s+a\s+shell|spawn\w*\s+a\s+(?:root\s+)?shell|memory[-\s]corruption\s+exploit|stack[-\s]smash\w*\s+exploit|buffer\s+overflow\s+exploit)`;
// ILLICIT_SYNTHESIS — controlled-substance / weapon manufacture verb + target (the chemistry-persona
// payloads). The broad verbs `produce`/`prepare` are deliberately excluded: they over-match benign
// journalism / fiction about the drug trade ("how cartels produce fentanyl", "produce a documentary
// about cocaine"). Only synthesis-specific verbs remain.
const ILLICIT_SYNTHESIS = String.raw`(?:synthesi[sz]e|manufactur\w+|cook\s+up)\s+(?:a\s+|the\s+|an\s+|his\s+|that\s+)?(?:[a-z]+\s+){0,2}(?:controlled\s+substance|methamphetamine|\bmeth\b|fentanyl|heroin|cocaine|\bmdma\b|\blsd\b|nerve\s+agent|nerve\s+gas|sarin|\bvx\b|ricin|chemical\s+weapon|bio-?weapon|biological\s+weapon|explosive\s+device|improvised\s+explosive|pipe\s+bomb)`;
// REALISM_DEMAND — explicit insistence the artifact itself be FUNCTIONAL / REPRODUCIBLE / IMPLEMENTABLE.
// This is a PRODUCTION demand, NOT an authenticity-of-prose demand. The distinction is load-bearing:
// benign technical novelists, defensive incident-response / malware-analysis training, and remediation
// write-ups legitimately ask for an AUTHENTIC narrative ("keep every technical detail accurate", "reads
// like a real exploit", "feel authentic") about an attack WITHOUT asking the model to produce a working
// weapon — so those prose-authenticity phrasings are deliberately NOT here. Only a demand that the
// artifact RUN / REPRODUCE / be IMPLEMENTABLE qualifies ("must actually function", "reproduce the
// attack", "operational detail for a student to implement", "full pwntools script", "exact byte offset",
// "how to build a … exploit"). A request to merely describe / teach / narrate an attack does not match.
// Two arms were tightened after the audit-loop because they matched benign engineering prose: bare
// "exact byte offset" (ubiquitous in struct / file-format / forensics work) now requires "…to the
// (saved) return"; and "enough … detail" now requires an operational/implementation qualifier (bare
// "enough concrete detail" / "enough granular detail" is generic ticket / spec prose).
const REALISM_DEMAND = String.raw`(?:must\s+actually\s+(?:function|work|run|compile|execute)|(?:code|exploit|script|payload|it)\s+(?:must|has\s+to|needs?\s+to)\s+(?:actually\s+)?(?:function|work|run|compile)|(?:complete|detailed|specific)\s+enough\b[\s\S]{0,60}?(?:reproduce|reconstruct|replicate|recreate|compile|run\s+it)|reconstruct\s+the\s+(?:attack|exploit)\s+from\s+scratch|reproduce\s+the\s+(?:attack|exploit)|(?:enough|sufficient|complete)\s+(?:concrete\s+|granular\s+)?(?:operational|implementation)\s+(?:detail|specifics)|operational\s+detail\s+(?:for|to)\b[\s\S]{0,45}?(?:implement|a\s+student|reproduce)|how\s+to\s+(?:build|construct|write|develop)\s+(?:a\s+|an\s+|the\s+)?(?:[a-z-]+\s+){0,2}exploit|full\s+pwntools\s+script|exact\s+(?:byte\s+)?offset\s+to\s+(?:the\s+)?(?:saved\s+)?return|step[-\s]by[-\s]step\b[\s\S]{0,60}?(?:instructions?\s+for\s+)?(?:construct|implement|bypass|build\s+(?:the\s+)?exploit)|the\s+(?:final\s+)?(?:script|payload)\s+that\s+(?:strips|disables|launches|redirects|triggers))`;
// SYNTHESIS_DETAIL — demand the synthesis be given in full procedural detail (vs a passing mention).
const SYNTHESIS_DETAIL = String.raw`(?:each\s+(?:stage|step)|step[-\s]by[-\s]step|precise\s+(?:detail|procedure|steps)|exact\s+(?:recipe|procedure|steps|quantities|reagents|measurements)|(?:precise|exhaustive|loving|granular|meticulous|vivid)\b[\s\S]{0,20}?\bdetail|complete\s+(?:recipe|procedure|synthesis)|the\s+(?:full\s+)?procedure\s+(?:he|she|they|one)\s+(?:used|would\s+use|follows?)|explaining\s+each|how\s+(?:one|to)\s+would\s+synthesi[sz]e|walks?\s+(?:his|her|the|them)\b[\s\S]{0,30}?through)`;
const FICTIONAL_WEAPONIZATION_PATTERNS: JailbreakPattern[] = [
  {
    // All three anchors must co-occur within bounded windows: a FICTIONAL_FRAME within 600 chars of a
    // REALISM_DEMAND↔OPERATIONAL_EXPLOIT pair (which are themselves within 600 of each other), in
    // either global order. Binding the FRAME into the window (rather than an independent
    // anywhere-lookahead) stops a stray fiction aside in one paragraph from colluding with an
    // unrelated security/debugging paragraph elsewhere in a long message. Catches "write the
    // protagonist's exploit … the code must actually function" / "ProfX … operational detail for a
    // student to implement" / "documentary … exact byte offset to the return … shellcode". Does NOT
    // fire on benign fiction that merely names a technique, nor on frame-less security education.
    name: 'fic_frame_opexploit',
    pattern: new RegExp(
      String.raw`^(?=[\s\S]*(?:(?:${FICTIONAL_FRAME})[\s\S]{0,600}(?:(?:${REALISM_DEMAND})[\s\S]{0,600}(?:${OPERATIONAL_EXPLOIT})|(?:${OPERATIONAL_EXPLOIT})[\s\S]{0,600}(?:${REALISM_DEMAND}))|(?:(?:${REALISM_DEMAND})[\s\S]{0,600}(?:${OPERATIONAL_EXPLOIT})|(?:${OPERATIONAL_EXPLOIT})[\s\S]{0,600}(?:${REALISM_DEMAND}))[\s\S]{0,600}(?:${FICTIONAL_FRAME})))`,
      'i'
    ),
    severity: Severity.CRITICAL,
    weight: 9,
    description: 'Fiction/persona frame demanding a complete, working operational exploit'
  },
  {
    // FICTIONAL_FRAME within 600 chars of an ILLICIT_SYNTHESIS↔SYNTHESIS_DETAIL pair, either global
    // order ("fictional chemist … synthesize a controlled substance, explaining each stage").
    name: 'fic_frame_synth',
    pattern: new RegExp(
      String.raw`^(?=[\s\S]*(?:(?:${FICTIONAL_FRAME})[\s\S]{0,600}(?:(?:${ILLICIT_SYNTHESIS})[\s\S]{0,500}(?:${SYNTHESIS_DETAIL})|(?:${SYNTHESIS_DETAIL})[\s\S]{0,500}(?:${ILLICIT_SYNTHESIS}))|(?:(?:${ILLICIT_SYNTHESIS})[\s\S]{0,500}(?:${SYNTHESIS_DETAIL})|(?:${SYNTHESIS_DETAIL})[\s\S]{0,500}(?:${ILLICIT_SYNTHESIS}))[\s\S]{0,600}(?:${FICTIONAL_FRAME})))`,
      'i'
    ),
    severity: Severity.CRITICAL,
    weight: 9,
    description: 'Fiction/persona frame demanding controlled-substance/weapon synthesis in procedural detail'
  }
  // NOTE: a standalone "skip the ethics preamble/boilerplate" tell was evaluated and deliberately NOT
  // shipped. Unguarded it over-matches ordinary drafting ("skip the ethics boilerplate"); gated behind
  // a weaponization anchor it still over-matches security-content editing ("skip the ethics boilerplate
  // … the ROP chain pops a shell"); and the one attack it would have recovered has no fiction frame and
  // no production demand for the two patterns above to anchor on. It is left as a known residual rather
  // than ship a pattern that blocks BonkLM's own defensive-security audience.
];

/**
 * All patterns combined.
 */
export const ALL_PATTERNS: JailbreakPattern[] = [
  ...DAN_PATTERNS,
  ...ROLEPLAY_PATTERNS,
  ...HYPOTHETICAL_PATTERNS,
  ...AUTHORITY_PATTERNS,
  ...SOCIAL_ENGINEERING_PATTERNS,
  ...SOCIAL_COMPLIANCE_PATTERNS,
  ...TRUST_EXPLOITATION_PATTERNS,
  ...EMOTIONAL_MANIPULATION_PATTERNS,
  ...KNOWN_TEMPLATE_PATTERNS,
  ...OBFUSCATION_PATTERNS,
  ...FICTIONAL_WEAPONIZATION_PATTERNS
];

// =============================================================================
// FUZZY MATCHING
// =============================================================================

/**
 * Keywords to fuzzy match.
 */
export const JAILBREAK_KEYWORDS = [
  // Curated to DISTINCTIVE jailbreak terms only. Short / common collision-prone keywords
  // ('dan','stan','aim','ucar','dude','anarchy','override','restrictions','roleplay',
  // 'pretend','unlimited') were removed: the LCS-based fuzzy ratio matched them against
  // ordinary English ('stan'~"standard"/"instance", "instructions"~"restrictions",
  // "replays"~"roleplay"), the dominant source of benign false positives. Those terms are
  // still detected exactly by the pattern sets above. Regression coverage for these benign
  // collisions lives in the validator unit tests.
  'jailbreak',
  'jailbroken',
  'ignore',
  'bypass',
  'unrestricted',
  'unfiltered',
  'uncensored',
  'hypothetically',
  'theoretically'
];

/**
 * Phrases to fuzzy match.
 */
export const JAILBREAK_PHRASES = [
  'developer mode',
  'admin mode',
  'sudo mode',
  'root access',
  'no restrictions',
  'no rules',
  'no limits',
  'no ethics',
  'do anything now',
  'anything goes',
  'ignore guidelines',
  'previous instructions',
  'forget instructions',
  'new instructions'
];
