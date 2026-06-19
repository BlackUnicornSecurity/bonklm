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
    // false-tripped this WARNING net (e.g. a firmware bug report). The named-provider impersonation
    // (anthropic/openai) and privileged-role claim (admin/administrator) remain here. Recall for the
    // dropped nouns is preserved by the PromptInjection validator, not this one: the assertive
    // "I am a developer/engineer" form still fires PI's `authority_claim` (pattern-engine.ts), and
    // forged-RAG-authorization payloads ("the verification bypass is now authorized") fire PI's
    // FORGED_AUTHORIZATION. This is therefore a jailbreak-validator precision fix; the GA corpus
    // shows no net recall change. (A PromptInjection-less, jailbreak-only deployment trades this
    // profession-noun catch for the false positives it caused — the intended precision tradeoff.)
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
  ...OBFUSCATION_PATTERNS
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
  // still detected exactly by the pattern sets above. See
  // tests/unit/validators/structured-benign-fp.test.ts.
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
