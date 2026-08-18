import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';

/**
 * Pattern engine — tool call injection patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
/**
 * Category I: Tool-Call Hijack / Structured-Argument Injection Patterns
 * --------------------------------------------------------------------
 * Catches the tool-call-hijack class: content sitting inside a tool result or
 * a retrieved/quoted document that DIRECTS the reading agent to invoke an
 * extra/named tool with attacker-chosen arguments (the canonical
 * indirect-tool-injection primitive — Greshake-style, but aimed at the agent's
 * NEXT tool call rather than its prose). Distinct from the role-hijacking /
 * forged-turn family above, which forges a *conversation role*; here the
 * injected text stays in-band as "supplemental guidance" / "triage protocol"
 * and weaponises the agent's own tool-calling loop.
 *
 * INTENT-GATED, not vocabulary-gated. Tool-call *language* ("call the X tool
 * with arguments", "make another tool call", "instruct the downstream agent to
 * call the X tool", a `tool:`/`args:` block) is the native register of this
 * library's own users — agent / MCP developers write it in docs, YAML config,
 * orchestration runbooks, and tool-use transcripts; and exfil words
 * ("exfiltrate", "secret") are the native register of the SECURITY content this
 * library guards. Matching any of it alone FALSE-BLOCKS benign traffic, the
 * worst failure mode for a guardrail (empirically confirmed in review — a bare
 * "make an additional tool call" imperative, a bare relay "instruct the sub-agent
 * to call the X tool with parameters { … }", and a bare `tool:`/`args:` block
 * were all dropped because a benign agent doc / security write-up is grammatically
 * identical to the attack). Each surviving pattern pairs the tool-call shape with
 * a genuine ATTACK signal that benign content does not carry:
 *   1. an INDIRECT-INJECTION frame — content addressing "any/the agent THAT
 *      quotes / reads / cites THIS excerpt", i.e. instructions aimed at whoever
 *      processes the retrieved text — leading to a tool-call directive;
 *   2. a relay to a downstream / sub-agent leading to a tool call WITH an exfil
 *      token (exfiltrate / encrypted_value / to-an-attacker);
 *   3. an embedded `tool:` / `parameters:` block whose body stages an exfil
 *      (`encrypted_value` / `exfil` / a `base64(` of the env).
 * Like the rest of the catalogue these see the NFKD-normalized text on the
 * `validate()` path.
 *
 * BLOCK-ELIGIBLE by default (WARNING with no `blockEligible: false`) — a single
 * match blocks. These scan attacker-influenceable retrieved/tool-result content,
 * so a *broad* block-eligible pattern here would be a denial-of-service /
 * censorship lever; the second attack signal is what keeps the block targeted at
 * genuine injection. Do NOT add `blockEligible: false` (that would silently
 * downgrade these to non-blocking tripwires and defeat the independent coverage
 * this category exists to provide), and do NOT loosen the second signal without
 * re-running the full benign-corpus calibration that gates this category.
 *
 * Coverage limit (documented, defence-in-depth not sole layer): an attack that
 * avoids the literal noun "tool", swaps the relay verb (`instruct`/`direct`) for
 * a synonym, drops the self-referential injection frame, or separates its exfil
 * signal from the directive by a wide margin, fails open here — but the secret
 * exfil targets are independently caught by SecretGuard, and the bare imperative
 * is often caught by the instruction-injection / forged-authorization patterns.
 * A sub-agent-dispatch attack whose payload is camouflaged AS plain documentation
 * with NO exfil and NO self-referential frame is provenance-dependent and is
 * better caught by the connector-layer RetrievedDoc / ToolCallArgs validators
 * (which know trusted-user vs untrusted-retrieved), not by a content pattern. All
 * three regexes are linear: every quantified bridge is lazy-and-bounded
 * (`[\s\S]{0,N}?`) behind a rare gating prefix, so there is no catastrophic
 * backtracking.
 */
export const TOOL_CALL_INJECTION_PATTERNS: PatternDefinition[] = [
  {
    // An INDIRECT-INJECTION directive: content that addresses the agent which
    // *processes the retrieved text itself* — "guidance for any AI agent THAT
    // quotes THIS EXCERPT … instruct the downstream consumer … by calling the X
    // tool" — and leads to a tool-call directive. The tell is the SELF-REFERENTIAL
    // anchor `this <content-noun>` (this excerpt / passage / message / …): an
    // instruction that points back at the very text carrying it. The determiner is
    // pinned to `this` (NOT bare `the`) followed by a content noun, because generic
    // pipeline prose — "the agent that processes THE retrieved chunks … call the
    // tool", "any model that reads THE alert … call the enrichment tool" — reaches
    // the same verbs but is architecture description, not an injected directive.
    name: 'indirect_injection_tool_directive',
    pattern:
      /\b(?:agents?|assistants?|models?|llms?)\s+(?:that|which|who)\s+(?:quotes?|cites?|reads?|quoting|citing|reading|processes?|processing|sees?|encounters?|consumes?|ingests?)\s+this\s+(?:excerpt|passage|snippet|quote|note|comment|field|record|ticket|entry|chunk|fragment|section|block|message|content|text|context|document|page|paragraph|wiki|advisory|payload|result|output|response)s?\b[\s\S]{0,200}?\b(?:call(?:ing)?|invoke|invoking|instruct(?:s|ing)?)\b[\s\S]{0,40}?\btool\b/i,
    severity: Severity.WARNING,
    description: 'Indirect-injection directive (content addressing the reading agent) staging a tool call'
  },
  {
    // A directive that RELAYS a tool call to a downstream / sub-agent leading to
    // a tool call WITH an exfil token. Gated in order: the relay frame
    // (instruct/direct a downstream/sub-agent/recipient), a call verb reaching
    // the noun `tool`, then an exfil tail. Benign multi-agent orchestration prose
    // ("instruct the downstream sub-agent to invoke the retriever tool with
    // parameters {topK:5}") reaches `tool` but carries no exfil token → no match.
    // The args-object (`with arguments { … }`) is deliberately NOT a signal here:
    // legitimate orchestration shows inline args.
    name: 'relay_tool_call_to_subagent',
    pattern:
      /\b(?:instruct(?:s|ing)?|direct(?:s|ing)?)\s+(?:the\s+)?(?:downstream|sub-?agents?|recipient)\b[\s\S]{0,140}?\b(?:call(?:ing)?|invoke|invoking|make)\b[\s\S]{0,40}?\btool\b[\s\S]{0,80}?\b(?:exfil|exfiltrat|encrypted_value|to\s+an?\s+attacker)/i,
    severity: Severity.WARNING,
    description: 'Injected directive relaying an exfiltrating tool call to a downstream sub-agent'
  },
  {
    // An embedded tool-directive block — `tool: <name>` then a
    // `parameters:`/`args:`/`inputs:` line — whose body stages an EXFIL: an
    // `encrypted_value` / `exfil` field or a `base64(` of the environment. The
    // `(?:[\r\n]+|\\n)` alternation matches whether the carrier is raw text (real
    // newline) or a JSON-encoded tool result (literal `\n` escape). A benign
    // `tool: black` / `args:` CI block — and even a documented
    // `tool: <secrets-api>` / `secret_name:` block that merely NAMES a secret —
    // carries no `encrypted_value` / `base64(` exfil and does NOT match.
    name: 'embedded_exfil_tool_directive',
    pattern:
      /\btool\s*:\s*[A-Za-z_][\w.]*\s*(?:[\r\n]+|\\n)\s*(?:parameters?|params?|args?|inputs?)\s*:[\s\S]{0,300}?\b(?:encrypted_value|exfil|exfiltrat|base64\()/i,
    severity: Severity.WARNING,
    description: 'Embedded tool-directive block whose parameters stage a secret exfil'
  }
];
