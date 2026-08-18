/**
 * CWE-117 sanitization primitive contract — chroma-connector.
 *
 * `createGuardedCollection` in `guarded-chroma.ts` wraps every
 * attacker-influenced log-meta value and dev-mode error interpolation with the
 * canonical `sanitizeMeta` primitive. The principal wrapped boundaries (located
 * by their log/message strings, not line numbers):
 *   - `'[Guardrails] Query blocked'` log meta + the `Query blocked: ...` throw.
 *   - `'[Guardrails] Document blocked'` log meta + the `Document blocked: ...`
 *     abort throw, and the inline 2D-batch `Document batch blocked: ...` throw.
 *   - `'[Guardrails] Document add blocked'` log meta + the `Document blocked: ...`
 *     throw (add path).
 *   - `'[Guardrails] Document structure validation failed'` log meta
 *     (`id` + validation `reason`).
 *
 * This contract-lock asserts the canonical primitive is reachable from the
 * import surface and behaves as expected on representative attacker inputs.
 * The END-TO-END proof that each guarded path actually applies `sanitizeMeta`
 * (and FAILS if a wrap is removed — the ADR-0001 non-vacuity standard) lives in
 * `guarded-chroma.test.ts`: the retrieved-document (batch + per-doc abort) sinks
 * under "CWE-117 batch-block reason sanitization (security regression)", and the query/add
 * sinks under "CWE-117 query/add reason sanitization is load-bearing
 * (ADR-0001)". Those tests drive a spy logger with control-char payloads and
 * assert the escaped form at each boundary.
 *
 * History: Sprint 43 cross-connector CWE-117 closure (original four boundaries)
 * → boundary-driving tests added when the import-only contract was found vacuous
 * (ADR-0001 anti-pattern).
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('chroma-connector — Sprint 43 CWE-117 sanitization contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString + serializeError', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes validator-extracted reason for query-blocked + document-blocked paths', () => {
    const reason = 'matched "pattern"\nINJECTED:CRITICAL bypass';
    expect(sanitizeMeta(reason)).toBe('matched "pattern"\\nINJECTED:CRITICAL bypass');
  });
});
