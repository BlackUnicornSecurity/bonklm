/**
 * genkit-connector — CWE-117 sanitizer primitive contract.
 *
 * This file asserts the canonical `sanitizeMeta` / `sanitizeLogString`
 * primitives in ISOLATION (re-exported from the core barrel). The
 * end-to-end, load-bearing proof that the connector's dev-mode
 * `createErrorMessage` sink actually wraps its attacker-influenced `reason`
 * lives in `genkit-plugin.test.ts` ("CWE-117 reason sanitization is
 * load-bearing (ADR-0001)"), which drives the guarded plugin and asserts the
 * ESCAPED form on both the returned `blockedReason` and the thrown message.
 * Per ADR-0001 a test that still passes with the sanitizer removed is not a
 * regression test — see that driving block.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('genkit-connector — CWE-117 sanitizer primitive contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString + serializeError', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });
});
