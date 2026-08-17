import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';
import { INJECTED_DIRECTIVE_SRC } from './shared-sources.js';

/**
 * Pattern engine — role hijacking patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
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
