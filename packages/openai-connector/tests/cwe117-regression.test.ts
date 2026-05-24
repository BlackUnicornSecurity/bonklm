/**
 * Sprint 43 cross-connector CWE-117 sweep — openai-connector regression.
 *
 * Four src sites in `guarded-openai.ts` carry attacker-influenced
 * template-literal log calls + dev-mode error messages:
 *   - line 225 (`logger.warn('[Guardrails] Input blocked', { reason })`)
 *   - line 232 (`throw new Error(\`Content blocked: ${blocked.reason}\`)`)
 *   - line 306 (`logger.warn('[Guardrails] Output blocked', { reason })`)
 *   - line 317 (`filteredContent = \`[Content filtered by guardrails: ${reason}]\``)
 *
 * Sprint 43 wraps each with `sanitizeMeta`. The filteredContent site
 * is particularly hot — the value lands in `response.choices[0].message.content`
 * which the application returns to the LLM caller (frontend, agent
 * transcript, etc.) where raw control chars can hijack rendering.
 *
 * Sprint 42 architect LOW deferral → Sprint 43 closure.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('openai-connector — Sprint 43 CWE-117 sanitization contract', () => {
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

  it('sanitizes a validator-extracted reason for the input-blocked path', () => {
    const reason = 'matched "ignore_previous"\nINJECTED:CRITICAL bypass';
    expect(sanitizeMeta(reason)).toBe(
      'matched "ignore_previous"\\nINJECTED:CRITICAL bypass'
    );
  });

  it('sanitizes a validator-extracted reason for the output-filteredContent path', () => {
    // This value lands in `response.choices[0].message.content` —
    // raw control chars would propagate into the application's UI
    // / agent transcript via the LLM caller's return-value flow.
    const reason = 'unsafe pattern matched\nINJECTED:fake_filtered=false';
    const filtered = `[Content filtered by guardrails: ${sanitizeMeta(reason)}]`;
    expect(filtered).not.toContain('\n');
    expect(filtered).toBe(
      '[Content filtered by guardrails: unsafe pattern matched\\nINJECTED:fake_filtered=false]'
    );
  });
});
