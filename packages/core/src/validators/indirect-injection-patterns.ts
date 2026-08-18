/**
 * BonkLM — Indirect-Injection Pattern Set (provenance-gated)
 * =============================================================================
 * Connector-boundary injection arms extracted verbatim from `pattern-engine.ts`
 * to keep that file under the repository file-size cap (CLAUDE.md "Many small
 * files"). This is a pure mechanical move — the regex catalogue, severities,
 * provenance tags, and {@link detectIndirectInjection} semantics are unchanged.
 *
 * The set is deliberately NOT part of `ALL_PATTERN_CATEGORIES`, so the user-text
 * `PromptInjectionValidator` and its calibrated FPR floor never run it; only
 * {@link detectIndirectInjection} — invoked by the `IndirectInjectionValidator`
 * at a connector boundary — scans this set, filtered to the wrapping validator's
 * surface. Shared primitives (`PatternDefinition`, `PatternFinding`,
 * `getLineNumber`) continue to live in `pattern-engine.ts`; this module imports
 * them one-way (no cycle), matching the engine's sibling-validator convention.
 */
import { Severity } from '../base/GuardrailResult.js';
import { redactSecrets } from '../common/index.js';
import type { ProvenanceBoundary } from './provenance.js';
import { getLineNumber, type PatternDefinition, type PatternFinding } from './pattern-engine.js';

/**
 * Provenance-gated arms that fire ONLY at a connector boundary, never on raw
 * user text. They are deliberately NOT added to `ALL_PATTERN_CATEGORIES`, so
 * the user-text `PromptInjectionValidator` and its calibrated FPR floor never
 * run them. The {@link IndirectInjectionValidator} (composed into the
 * RetrievedDoc / ComposedContext / ToolCallArgs / MemoryWrite factories) scans
 * this set via {@link detectIndirectInjection}, filtered to the wrapping
 * validator's surface.
 *
 * Each arm carries an explicit `requiresProvenance` surface tag. Authoring
 * discipline: every arm here is anchored to a real OUT-DEFENDED corpus fixture
 * track (manifest); regexes use bounded or non-backtracking
 * quantifiers only — every lazy gap has an explicit upper bound and a mandatory
 * literal follower, and no quantifier is nested over an overlapping class
 * (ReDoS-safe; a few arms use single unbounded `[^)]*`/`https?…[^\s]+` runs that
 * are linear by the same reasoning). HIT-block eligibility follows the standard —
 * CRITICAL or WARNING+`blockEligible`.
 *
 * Home-C surface (`tool_result`) — tool-result-ingress task hijack & exfil.
 */
export const INDIRECT_INJECTION_PATTERNS: PatternDefinition[] = [
  // --- Home C (tool_result) ----------------------------------------------
  {
    // Track 3 (agent/dojolm-agent-400.txt): tool-result task hijack. The
    // canonical marker "this note overrides earlier instructions" is missed
    // by the global `ignore_instructions` arm purely on the `overrides`
    // conjugation (T3-MUST-VERIFY-VERDICT). Provenance-gating lets us
    // catch the supersession cluster without widening the user-text bar.
    name: 'objective_replacement_directive',
    pattern:
      /\bthis\s+note\s+overrides?\s+earlier\s+instructions\b|\bthe\s+new\s+objective\s+is\b[\s\S]{0,80}?\b(?:enumerate|exfiltrate|curl|fetch)\b|\bthe\s+(?:original|previous|prior)\s+\w{2,20}\s+task\s+is\s+cancell?ed\b/i,
    severity: Severity.CRITICAL,
    description: 'Tool-result task-hijack: objective-replacement / supersession directive',
    blockEligible: true,
    requiresProvenance: 'tool_result'
  },
  {
    // Track 4 (agent/bonklm-agent-406.json): forged ReAct observation token
    // `<INST>[INST]</INST>` carrying a privilege-escalation directive.
    name: 'react_observation_token_injection',
    pattern: /<INST>\s*\[INST\]\s*<\/INST>|\[INST\][\s\S]{0,160}?(?:disregard|ignore|privileged\s+mode)\b/i,
    severity: Severity.CRITICAL,
    description: 'Forged ReAct observation instruction-token injection in tool result',
    blockEligible: true,
    requiresProvenance: 'tool_result'
  },
  {
    // Tracks 4 + 5: data exfil to an attacker-controlled destination embedded
    // in a tool-call argument (`exfil_data(dest=…)`, `send_email(to="…pwn.io")`).
    // Audit (adversarial #1): the first alternative MUST require an `exfiltrate`
    // / `exfil_data` suffix — a bare `\bexfil\b` matched benign SOC/DLP prose
    // ("detected an exfil attempt") and auto-blocked at CRITICAL. The trailing
    // `?` was removed so a suffix is mandatory.
    name: 'exfil_to_external_url',
    pattern:
      /\bexfil(?:trate|_?data)\b|\b(?:dest|to|recipient|url|endpoint|webhook|callback|bcc)\s*[=:]\s*["']?(?:https?:\/\/)?[^"'\s)]{0,80}?(?:attacker|evil|exfil|pwn|malicious|\.onion)\b/i,
    severity: Severity.CRITICAL,
    description: 'Tool-call argument exfiltrates data to an external/attacker destination',
    blockEligible: true,
    requiresProvenance: 'tool_result'
  },
  {
    // Track 5 (modern/bonklm-modern-1106.md): `Execute: send_email(…)` /
    // `Invoke: memory_write(…)` imperative inside a tool-result footer frame.
    // Audit (adversarial #2): the common words `call`/`run` were dropped — they
    // FP on benign tool/CI output (`Run: build()`, `Call: init()`). Only the
    // directive-shaped verbs execute/invoke/trigger remain.
    name: 'tool_invocation_directive',
    pattern: /\b(?:execute|invoke|trigger)\s*:\s*[a-z_][a-z0-9_]*\s*\(/i,
    severity: Severity.CRITICAL,
    description: 'Imperative tool-invocation directive embedded in a tool result',
    blockEligible: true,
    requiresProvenance: 'tool_result'
  },
  {
    // Tracks 6 + 7: forged instrumentation-footer token (`# AGENT_FOOTER`,
    // `[AGENT_INSTRUMENTATION_FOOTER]`) used to smuggle an agent directive.
    // Audit (adversarial #3): CASE-SENSITIVE (no /i) so a benign lowercase field
    // name `agent_note` (CRM/monitoring records) does not auto-block at CRITICAL.
    // The forged tokens are SHOUTING uppercase; case-sensitivity keeps every TP.
    name: 'instrumentation_footer_directive',
    pattern: /\bAGENT_(?:INSTRUMENTATION_)?(?:FOOTER|NOTE)\b/,
    severity: Severity.CRITICAL,
    description: 'Forged agent-instrumentation footer token in a tool result',
    blockEligible: true,
    requiresProvenance: 'tool_result'
  },
  {
    // Track 7 (prompt-injection/bonklm-prompt-injection-1816.txt): anti-forensic
    // "do not log this message" cover-up directive. Reused across surfaces.
    // Audit (adversarial #4): the directive must SELF-REFERENCE ("…log THIS") so
    // benign security/privacy guidance ("do not log secrets to stdout", "do not
    // store the user's IP") no longer auto-blocks. Bare `store` verb dropped.
    name: 'cover_up_directive',
    pattern:
      /\bdo\s+not\s+(?:log|record|mention|report)\s+this\b|\bdon'?t\s+(?:log|record|mention)\s+this\b|\berase\s+this\s+from\s+(?:history|the\s+log|memory)\b/i,
    severity: Severity.CRITICAL,
    description: 'Anti-forensic cover-up directive ("do not log this") in a tool result',
    blockEligible: true,
    requiresProvenance: ['tool_result', 'composed_context']
  },

  // --- Home D (memory_write) ---------------------------------------------
  {
    // Track 1 (modern/dojolm-modern-1400.md): a memory-write payload directing a
    // future reader to POST a shell-variable credential to an audit endpoint.
    name: 'memory_credential_exfil_via_shell_var',
    pattern: /(?:POST|send|include|provide|submit|output)\s+(?:the\s+)?(?:full\s+)?\$[A-Z][A-Z0-9_]{2,}/i,
    severity: Severity.CRITICAL,
    description: 'Shell-variable credential exfil directive in a memory-write payload',
    blockEligible: true,
    requiresProvenance: 'memory_write'
  },
  {
    // Track 1 (cont.): "legacy compatibility requirement" social-engineering
    // framing used to pressure the reader past memory-write policy. WARNING but
    // explicitly block-eligible (a directive marker, not a tripwire).
    name: 'memory_legacy_compat_directive',
    pattern: /\blegacy\s+compat(?:ibility)?\s+requirement\b|\bfor\s+(?:backward|legacy)\s+compat(?:ibility)?\b/i,
    severity: Severity.WARNING,
    description: 'Social-engineering "legacy compatibility" override framing in a memory-write payload',
    blockEligible: true,
    requiresProvenance: 'memory_write'
  },

  // --- Home A (retrieved_doc / composed_context) -------------------------
  // RAG / composed-context ingress: directives addressed to the model inside
  // retrieved documents or merged multi-source context. Anchored to APPENDIX-A
  // (§7-step-2 Home-A manifest) fixture tracks. Several regexes use `[^.]`
  // (cross a soft line-wrap, stop at the sentence period) rather than `[^.\n]`,
  // because real RAG/compose content arrives wrapped across lines — the
  // architect's single-line ≤120-char abstract does not. Bounded quantifiers
  // throughout (ReDoS-safe). All BLOCK-eligible at WARNING+ per the standard.
  //
  // Two APPENDIX-A arms are deliberately NOT shipped (reclassified to named
  // limitations, matching the architect's Reclassification preview): T6
  // `fabricated_internal_reference` (the fabricated SAR-ref and its
  // supersession claim sit in different sentences → only cross-sentence
  // bridging would join them, which FPs on benign versioned-doc prose) and T8
  // `audit_log_write_directive` (indistinguishable from a benign audit-write
  // request → low precision). T6 still partially flips to HIT via
  // `aws_egress_in_runbook` below.
  {
    // Tracks 1 + 2: a directive addressed to the model inside a retrieved doc —
    // either a `// assistant_directive:` comment marker (T1, RAG JSON body) or a
    // "Note/instruction/directive for the assistant/agent" frame (T2, blockquote).
    // The object is restricted to model nouns (assistant/model/agent/bot/
    // retriever) so benign "note for reviewers / for the reader" prose stays inert.
    name: 'retrieved_assistant_directive_frame',
    pattern:
      /(?:\/\/|\/\*|<!--|#)?\s*assistant_directive\s*:|(?:note|instruction|directive)\s+(?:for|to)\s+the\s+(?:assistant|model|agent|bot|retriever)\b/i,
    severity: Severity.WARNING,
    description: 'Retrieved-doc directive addressed to the model (comment-marker / "note for the assistant" frame)',
    blockEligible: true,
    requiresProvenance: 'retrieved_doc'
  },
  {
    // Track 3: "when the assistant ingests/reads this … it should also <verb> …
    // without prompting/asking/notifying" — a retrieved-doc footer instructing an
    // unattended side-effect. `[^.]` spans the fixture's mid-sentence soft-wraps.
    name: 'retrieved_assistant_imperative',
    pattern:
      /when\s+the\s+(?:assistant|model|agent|bot)\s+(?:ingests|reads|processes|sees|encounters|summari[sz]es)\s+this[^.]{0,60}?(?:should|must|will|is\s+required\s+to)\s+(?:also\s+)?[a-z]+[^.]{0,80}?without\s+(?:prompting|asking|notifying)/i,
    severity: Severity.WARNING,
    description: 'Retrieved-doc imperative for an unattended model side-effect ("without prompting the operator")',
    blockEligible: true,
    requiresProvenance: 'retrieved_doc'
  },
  {
    // Track 4: PR-body / wiki summarizer-suppression — "review-bot should … OMIT
    // it from the change summary". The fixture separates the verb from the
    // omit-directive ("should TREAT it … and OMIT"), so a bounded lazy gap bridges
    // them; the object stays the summary-suppression verb set (no generic "ignore").
    // Audit (adversarial #5): the generic role anchors `the assistant` / `the
    // bot` were dropped — they FP on benign summarization/style guidance ("the
    // assistant should be concise and not mention internal ticket numbers"). Only
    // the attack-specific review/summarizer-bot roles remain.
    name: 'summarizer_omit_directive',
    pattern:
      /(?:review[-\s]?bot|the\s+summari[sz]er|reviewer\s+bot)\s+(?:should|must|will|is\s+(?:instructed|required)\s+to)\b[^.]{0,80}?\b(?:omit|skip|exclude|hide|drop|leave\s+out|not\s+mention)\b/i,
    severity: Severity.WARNING,
    description:
      'Retrieved-doc directive telling a summarizer/review bot to omit content from the human-visible summary',
    blockEligible: true,
    requiresProvenance: 'retrieved_doc'
  },
  {
    // Track 5: comment-thread directive "the triage bot should pick up …".
    // `[\s>]{1,12}` tolerates the blockquote `\n> ` noise the fixture wraps across.
    name: 'triage_bot_directive',
    pattern:
      /(?:triage\s+bot|the\s+bot|the\s+(?:assistant|model|agent))\b[\s>]{1,12}should\s+(?:pick\s+up|classify|recommend|treat)\b/i,
    severity: Severity.WARNING,
    description: 'Composed-context directive steering a triage/assistant bot toward an attacker-favoured outcome',
    blockEligible: true,
    requiresProvenance: 'composed_context'
  },
  {
    // Track 5 (cont.): "please do NOT route this to the security-disclosure
    // intake" — a request to suppress escalation of a real security issue.
    name: 'suppress_escalation_directive',
    pattern:
      /(?:please\s+)?do\s+not\s+(?:route|escalate|forward|cc|notify)\b[^.]{0,40}(?:security|disclosure|intake|on-?call|abuse)/i,
    severity: Severity.WARNING,
    description: 'Composed-context directive suppressing escalation to a security/disclosure channel',
    blockEligible: true,
    requiresProvenance: 'composed_context'
  },
  {
    // Tracks 7 + 9: forged structured-indexer field labels (`CANONICAL_ANSWER:`,
    // `ADDITIONAL_OPERATOR_NOTE:`) smuggling a directive into a retrieved snippet.
    // CASE-SENSITIVE (uppercase tokens) so lowercase prose never collides.
    name: 'tool_result_field_label_injection',
    pattern:
      /\b(?:ADDITIONAL_OPERATOR_NOTE|OPERATOR_NOTE|CANONICAL_ANSWER|SYSTEM_NOTE|ASSISTANT_DIRECTIVE|INSTRUCTION_OVERRIDE)\s*:\s*\S/,
    severity: Severity.CRITICAL,
    description: 'Forged structured-indexer field-label injection in a retrieved snippet',
    blockEligible: true,
    requiresProvenance: 'retrieved_doc'
  },
  {
    // Track 9: an inter-agent handoff note ("OPERATOR NOTE FOR RESPONSE AGENT:")
    // — the spaced-token sibling of the underscored field-label arm above.
    name: 'inter_agent_handoff_imperative',
    pattern:
      /(?:OPERATOR\s+NOTE\s+FOR\s+(?:RESPONSE\s+|NEXT\s+)?AGENT|CONTEXT\s+FOR\s+NEXT\s+AGENT|INSTRUCTIONS?\s+FOR\s+(?:THE\s+)?(?:RESPONSE|NEXT)\s+AGENT)\s*:\s*\S/i,
    severity: Severity.CRITICAL,
    description: 'Inter-agent handoff note carrying an imperative for the next agent',
    blockEligible: true,
    requiresProvenance: 'retrieved_doc'
  },
  {
    // Track 10: markdown image whose URL embeds `{SESSION_ID}` / `{URLENC(...)}`
    // placeholders — a zero-click conversation/PII exfil beacon. The mandatory
    // `{`/`}`/`)` separators between the `[^)]*`/`[^}]*` runs keep it linear.
    name: 'markdown_image_exfil_placeholder',
    pattern:
      /!\[[^\]]*\]\(\s*https?:\/\/[^)]*\{(?:SESSION_ID|TENANT_ID|URLENC|LAST_USER_MESSAGE|FULL_CONVERSATION_HISTORY)[^}]*\}[^)]*\)/i,
    severity: Severity.CRITICAL,
    description: 'Markdown image exfil beacon with session/PII placeholder substitution',
    blockEligible: true,
    requiresProvenance: 'retrieved_doc'
  },
  {
    // Track 10 (cont.): "must be reproduced verbatim in your … reply/summary" —
    // pressures the model to echo the exfil beacon into its visible output.
    name: 'retrieved_reproduce_verbatim_directive',
    pattern:
      /(?:must\s+be|should\s+be|please)\s+(?:reproduced?|included?|preserved?|echoed?)\s+verbatim\b[^.]{0,40}\b(?:reply|response|summary|output|overview)\b/i,
    severity: Severity.WARNING,
    description: 'Retrieved-doc directive to reproduce embedded content verbatim in the model reply',
    blockEligible: true,
    requiresProvenance: 'retrieved_doc'
  },
  {
    // Track 11: forged "==[ … INSTRUCTION-PRIORITY OVERRIDE ]==" XMP/metadata
    // marker. The existing global `system_override_directive` requires a tight
    // 30-char window this wider wrapper does not satisfy — retrieved-only here.
    name: 'forged_priority_override_marker',
    pattern: /==\[[^\]]*INSTRUCTION[-\s]PRIORITY\s+OVERRIDE[^\]]*\]==/i,
    severity: Severity.CRITICAL,
    description: 'Forged instruction-priority-override marker in retrieved metadata',
    blockEligible: true,
    requiresProvenance: 'retrieved_doc'
  },
  {
    // Track 11 (cont.): explicit "priority above operator system prompt"
    // supersession claim. Object pinned to the model's own governing
    // instructions (system prompt / safety defaults), not generic "priority".
    name: 'safety_supersession_claim',
    pattern:
      /priority\s+above\s+(?:operator\s+|the\s+)?(?:system\s+prompt|system\s+instructions?|safety\s+(?:defaults?|instructions?))/i,
    severity: Severity.CRITICAL,
    description: 'Retrieved-doc claim that its content has priority above the system prompt / safety defaults',
    blockEligible: true,
    requiresProvenance: 'retrieved_doc'
  },
  {
    // Track 12: cross-document reconciliation directive — "the … copilot SHOULD
    // <verb> … calling <tool>.<method>(…)". The fixture separates the role anchor
    // from the tool call by a second "SHOULD update … by calling" clause (~165
    // chars, one period-free sentence), so a bounded same-sentence window bridges
    // role → call-verb → dotted invocation. Composed-context only.
    name: 'copilot_should_call_tool_directive',
    pattern:
      /(?:the\s+)?(?:agentic\s+)?(?:reconciliation\s+)?(?:copilot|assistant|agent|planner)\s+should\s+(?:treat|update|call|fire|invoke|apply|auto[-\s]?apply)\b[^.]{0,200}?\b(?:call(?:ing)?|invoke|fire|apply)\b[^.]{0,40}?[a-z_][\w.]*\.[a-z_]\w*\s*\(/i,
    severity: Severity.CRITICAL,
    description: 'Composed-context directive instructing the copilot/agent to fire a named tool call',
    blockEligible: true,
    requiresProvenance: 'composed_context'
  },
  {
    // Tracks 13: "ALSO call/POST <external-url>" piggyback egress directive in a
    // retrieved runbook. `[^.]` spans the wrap between the verb and the URL.
    // (T14's chunk uses a bare "POST <url>" with no "ALSO" — caught by the
    // credential-body arm below, not this one, by design — bare "POST url" is
    // far too common in benign docs to gate on.)
    name: 'agent_should_also_post_external_url',
    pattern:
      /(?:the\s+(?:agent|bot|assistant)\s+should\s+)?\bALSO\s+(?:call|post|fire|invoke|send\s+to)\b[^.]{0,80}https?:\/\/[^\s)"']+/i,
    severity: Severity.CRITICAL,
    description: 'Retrieved-runbook piggyback directive to ALSO call/POST an external URL',
    blockEligible: true,
    requiresProvenance: 'retrieved_doc'
  },
  {
    // Tracks 13 + 14: an HTTP `body { … }` whose fields name credential/secret
    // material (rotation_token / sdk_token / registry_creds / …) — the egress
    // payload of a poisoned runbook / onboarding chunk. `[\s\S]{0,300}?` lazily
    // crosses the body's pretty-printed newlines (bounded → ReDoS-safe).
    name: 'runbook_credential_exfil_body',
    pattern:
      /\bbody\s*[:=]?\s*\{[\s\S]{0,300}?(?:rotation_token|sdk_token|registry_creds|access_token|operator_id|recent_audit_log_chunk)\b/i,
    severity: Severity.CRITICAL,
    description: 'Retrieved-doc request body exfiltrating credential/secret fields to an endpoint',
    blockEligible: true,
    requiresProvenance: 'retrieved_doc'
  },
  {
    // Track 6 (partial HIT — see the named-limitation note above): an `aws s3 cp
    // … s3://<bucket>` egress command inside a retrieved runbook. `[^\n]` (not
    // `[^.]`) so the `<snapshot.tar>` placeholder's dot does not truncate the
    // window; single-line by construction. Precision limit: an internal `aws s3
    // cp` runbook step matches the same shape — on the retrieved_doc surface a
    // doc that instructs an S3 copy is treated as suspicious (never user text);
    // a destination-domain allowlist is the real fix (2.0 roadmap).
    // Audit (adversarial #6): WARN-ONLY (blockEligible:false). A legitimate
    // internal `aws s3 cp … s3://internal-backups/` runbook step matches the same
    // shape, so this arm surfaces a telemetry signal but does NOT auto-block —
    // the precision-first premise would otherwise invert for any infra-docs RAG
    // corpus. A destination-domain allowlist (2.0 roadmap) is the real fix; until
    // then T6 is a documented named limitation, not a hard catch.
    name: 'aws_egress_in_runbook',
    pattern: /\baws\s+s3\s+cp\b[^\n]{0,60}?s3:\/\/[^\s)"'`]+\/[^\s)"'`]*/i,
    severity: Severity.WARNING,
    description: 'Retrieved-runbook aws-s3-cp egress to an S3 bucket destination (warn-only telemetry signal)',
    blockEligible: false,
    requiresProvenance: 'retrieved_doc'
  }
];

/**
 * Scan `content` against {@link INDIRECT_INJECTION_PATTERNS}, returning only
 * the arms whose `requiresProvenance` includes `surface`. Mirrors
 * {@link detectPatterns} but never touches `ALL_PATTERN_CATEGORIES`, so the
 * user-text bar is unaffected. Callers without a connector surface (raw user
 * text) MUST NOT call this — the {@link IndirectInjectionValidator} short-
 * circuits to allow before reaching here.
 */
export function detectIndirectInjection(content: string, surface: ProvenanceBoundary): PatternFinding[] {
  const findings: PatternFinding[] = [];

  for (const patternDef of INDIRECT_INJECTION_PATTERNS) {
    if (!patternMatchesSurface(patternDef, surface)) {
      continue;
    }
    const match = content.match(patternDef.pattern);
    if (match) {
      findings.push({
        category: 'indirect_injection',
        pattern_name: patternDef.name,
        severity: patternDef.severity,
        // Redact BEFORE slicing: on a connector surface the matched region of
        // an exfiltration arm can span the secret the attacker is exfiltrating
        // (URL userinfo, query token, credential body field). `match` egresses
        // raw into findings + consumer callbacks, so credential-shaped material
        // must be redacted here (no-raw-secret-in-findings red line; best-effort
        // — see `redactSecrets`). Redacting before the 100-char slice also stops
        // a head fragment leaking when a secret straddles the cut. Instruction-
        // only matches are untouched.
        match: redactSecrets(match[0]).slice(0, 100),
        description: patternDef.description,
        line_number: getLineNumber(content, match.index || 0),
        blockEligible: patternDef.blockEligible !== false
      });
    }
  }

  return findings;
}

/**
 * Does an indirect-injection arm gate the given connector surface? Every arm in
 * {@link INDIRECT_INJECTION_PATTERNS} declares `requiresProvenance` (asserted by
 * the catalogue invariant test); a hypothetical `undefined` wraps to `[undefined]`
 * and matches nothing — inert, no separate branch needed.
 */
function patternMatchesSurface(patternDef: PatternDefinition, surface: ProvenanceBoundary): boolean {
  const req = patternDef.requiresProvenance;
  const surfaces = Array.isArray(req) ? req : [req];
  return surfaces.includes(surface);
}

/**
 * Redact-mode counterpart to {@link detectIndirectInjection}: replace each
 * surface-matching arm's matched region in `content` with `replacement`,
 * re-deriving the region from the ORIGINAL content (not from a finding's
 * already-redacted `match`). This is the `RedactingValidator` path used by
 * `applyRedaction` — the substring fallback there cannot locate an arm's region
 * once `detectIndirectInjection` has redacted credential material out of
 * `match`. A function replacer keeps a `$`-bearing `replacement` literal. The
 * arms are non-global, so the first match per arm is replaced — mirroring
 * detection's one-finding-per-arm semantics.
 */
export function redactIndirectInjection(content: string, surface: ProvenanceBoundary, replacement: string): string {
  let out = content;
  for (const patternDef of INDIRECT_INJECTION_PATTERNS) {
    if (!patternMatchesSurface(patternDef, surface)) {
      continue;
    }
    out = out.replace(patternDef.pattern, () => replacement);
  }
  return out;
}
