/**
 * Sprint 43 cross-connector CWE-117 sweep — openai-agents-connector regression.
 *
 * Three src sites in `guarded-openai-agents.ts` carry attacker-influenced
 * template-literal interpolations of validator-extracted reasons:
 *   - line ~317 (tripwire `outputInfo.reason` field — dev-mode embeds
 *     raw `r.reason` in the structure returned to the agent SDK).
 *   - line ~431 (`throw new ConnectorValidationError(\`Handoff blocked: ${r.reason}\`)`)
 *   - line ~460 (same shape — handoff tool-args path).
 *
 * Sprint 43 wraps each with `sanitizeMeta`. The existing
 * `logValidationFailure` calls were already sanitized.
 *
 * Sprint 42 architect LOW deferral → Sprint 43 closure.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('openai-agents-connector — Sprint 43 CWE-117 sanitization contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString from the core barrel', () => {
    expect(typeof sanitizeLogString).toBe('function');
  });

  it('imports serializeError from the core barrel', () => {
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes a validator-extracted reason for the handoff-blocked throw', () => {
    // Handoff payload is one agent's tool-output crossing into another
    // agent's input — explicit attacker-influence vector ("tool-result
    // as carrier" attack class). Sanitize at the throw boundary.
    const reason = 'matched cross_agent_injection\nINJECTED:fake_handoff=allowed';
    expect(sanitizeMeta(reason)).toBe('matched cross_agent_injection\\nINJECTED:fake_handoff=allowed');
  });

  it('sanitizes a validator-extracted reason for the tripwire outputInfo.reason field', () => {
    // tripwire `outputInfo` flows back through the agents SDK and may
    // surface in run-history transcripts (UI / log). Sanitize at
    // the connector boundary.
    const reason = 'tool_output unsafe\nINJECTED:tripwire=ignored';
    expect(sanitizeMeta(reason)).toBe('tool_output unsafe\\nINJECTED:tripwire=ignored');
  });
});
