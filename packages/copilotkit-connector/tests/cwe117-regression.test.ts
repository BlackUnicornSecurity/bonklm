/**
 * Sprint 43 cross-connector CWE-117 sweep — copilotkit-connector regression.
 *
 * Two src sites in `copilotkit-guardrail.ts`:
 *   - line ~337 (input-blocked log raw reason).
 *   - line ~362 (output-blocked log raw reason).
 *
 * Sprint 43 wraps both with `sanitizeMeta`. The `blockedReason` field
 * passed to `createErrorMessage` is separately formatted and is the
 * caller's responsibility — Sprint 43 covers the log-meta boundary
 * only per the established Sprint 42 elizaos pattern.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('copilotkit-connector — Sprint 43 CWE-117 sanitization contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString + serializeError', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes validator-extracted reason for input/output log paths', () => {
    const reason = 'matched copilot-pattern\nINJECTED:fake_status';
    expect(sanitizeMeta(reason)).toBe('matched copilot-pattern\\nINJECTED:fake_status');
  });
});
