/**
 * openai-agents-connector — CWE-117 sanitizer primitive contract.
 *
 * This file asserts the canonical `sanitizeMeta` / `sanitizeLogString`
 * primitives in ISOLATION (re-exported from the core barrel). The
 * end-to-end, load-bearing proof that each connector sink actually wraps
 * its attacker-influenced `reason` lives in `guarded-openai-agents.test.ts`
 * ("CWE-117 reason sanitization is load-bearing (ADR-0001)"), which drives
 * the guarded factories and asserts the ESCAPED form at the tripwire
 * `outputInfo.reason` sink. Per ADR-0001 a test that still passes with the
 * sanitizer removed is not a regression test — see that driving block.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('openai-agents-connector — CWE-117 sanitizer primitive contract', () => {
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
});
