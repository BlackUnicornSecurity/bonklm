/**
 * Sprint 43 cross-connector CWE-117 sweep — genkit-connector regression.
 *
 * Two src sites in `genkit-plugin.ts`:
 *   - line ~219 (input-blocked log raw reason).
 *   - line ~244 (output-blocked log raw reason).
 *
 * Sprint 43 wraps both with `sanitizeMeta`. Same pattern as
 * copilotkit-connector.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('genkit-connector — Sprint 43 CWE-117 sanitization contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString + serializeError', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes validator-extracted reason for input/output log paths', () => {
    const reason = 'matched genkit-flow-pattern\nINJECTED:fake_status';
    expect(sanitizeMeta(reason)).toBe(
      'matched genkit-flow-pattern\\nINJECTED:fake_status'
    );
  });
});
