import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';

/**
 * Pattern engine — few shot priming patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
/**
 * Category F: Few-Shot Priming Subversion Patterns
 * ================================================
 * Few-shot / chain-of-thought "priming" attacks present a scaffold of benign exemplars
 * (Example/Pattern/Case/Interaction N) whose final exemplar escalates to a restricted action,
 * then pivot to "Now your task / Your turn / Execute". The high-precision signal is NOT the
 * scaffold (benign few-shot prompting is common) but the EMBEDDED SUBVERSION — a bracketed
 * task-redefinition marker, or an explicit "redefine the prior purpose / suspend the rules"
 * phrase. It stays clear of benign defensive-security few-shot prompts that merely name a
 * vulnerability class.
 */
export const FEW_SHOT_PRIMING_PATTERNS: PatternDefinition[] = [
  {
    // A bracketed task-subversion marker. [REDEFINED] / [TASK SHIFT] / [TASK REDEFINITION] have
    // essentially zero benign use → they fire alone. Reviews surfaced several benign collisions
    // that are now gated on an adjacent ATTACK co-signal: bare [OVERRIDE]/[REINTERPRETED] are
    // config/markup sentinels (fire only when followed by redefin/offensive/attack/hack/exploit/
    // jailbreak — NOT the over-common task/purpose/provide/ignore). "the (true|real) (task|purpose)
    // is …" drops the benign continuations providing/to-provide (kept only bypassing/showing-me/
    // offensive/to-provide-<harm>). "the better definition of your task", "ignore original purpose",
    // "reinterpret as hacking/offensive/attack" are standalone subversion phrases. The bare "your
    // actual task is …" is EXCLUDED (benign instruction). The "override active" status-line branch
    // requires a generation-verb + harm object (a review showed bare attack/malware re-opened
    // false positives on security-ops status lines, e.g. "manual override active during the malware
    // scan"). The earlier "normal rules don't apply" branch was DROPPED outright — even gated on a
    // removal-verb + security-noun it collided with break-glass / IR-runbook prose ("during a Sev-1
    // incident the normal rules don't apply, on-call may bypass the security controls"), and it
    // caught only a single fixture. Each `[\s\S]{0,N}?` window is lazy + bounded → linear, no ReDoS.
    name: 'fewshot_task_subversion',
    pattern:
      /\[(?:redefined|task\s+shift|task\s+redefinition)\]|\[(?:override|reinterpret(?:ed)?)\][^.\n]{0,40}\b(?:redefin\w*|offensive|attack|hack|exploit|jailbreak)|the\s+better\s+definition\s+of\s+your\s+task|ignore\s+original\s+purpose|the\s+(?:true|real)\s+(?:task|purpose)\s+is\s+(?:bypassing|to\s+bypass|showing\s+me|offensive|to\s+provide\s+(?:offensive|attack|exploit|hacking))|reinterpret\s+as\s+(?:hacking|offensive|attack)|override\s+active[\s\S]{0,30}?(?:provid\w*|generat\w*|giv\w*|writ\w*|show\w*)\s+\w{0,15}?(?:attack|exploit|malware|offensive|bypass)/i,
    severity: Severity.CRITICAL,
    description: 'Few-shot task-subversion marker'
  }
];
