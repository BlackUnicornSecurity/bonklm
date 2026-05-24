/**
 * Sprint 43 cross-connector CWE-117 sweep — anthropic-connector regression.
 *
 * Two additional src sites surfaced post-Sprint-40:
 *   - line ~353 (`throw new Error(\`Content blocked: ${blocked.reason}\`)`)
 *     — dev-mode raw, sister to the Sprint-40-sanitized log-meta at
 *     line ~346.
 *   - line ~458 (`filteredContent = \`[Content filtered by guardrails:
 *     ${outputBlocked.reason}]\``) — raw reason flows into the
 *     application-output surface (response.content[0].text returned
 *     to the LLM caller).
 *
 * Sprint 43 wraps both with `sanitizeMeta`. Co-located test (separate
 * filename from any existing test file).
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('anthropic-connector — Sprint 43 CWE-117 closure', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('sanitizes validator-extracted reason at the dev-mode throw boundary', () => {
    const reason = 'matched ignore_previous\nINJECTED:CRITICAL bypass';
    expect(sanitizeMeta(reason)).toBe(
      'matched ignore_previous\\nINJECTED:CRITICAL bypass'
    );
  });

  it('sanitizes validator-extracted reason in the filteredContent application-output surface', () => {
    // `response.content[0].text` is returned to the LLM caller —
    // frontend / agent transcript / terminal output. Raw control
    // chars would hijack rendering at downstream consumers.
    const reason = 'unsafe pattern matched\nFAKE_INJECTED:filtered=false';
    const filtered = `[Content filtered by guardrails: ${sanitizeMeta(reason)}]`;
    expect(filtered).not.toContain('\n');
    expect(filtered).toContain('FAKE_INJECTED');
  });

  it('imports serializeError + sanitizeLogString', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });
});
