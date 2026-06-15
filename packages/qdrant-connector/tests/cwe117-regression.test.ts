/**
 * CWE-117 sanitization primitive contract — qdrant-connector.
 *
 * `createGuardedClient` in `guarded-qdrant.ts` wraps every attacker-influenced
 * log-meta value and dev-mode error interpolation with the canonical
 * `sanitizeMeta` primitive. The wrapped boundaries (located by their
 * log/message strings, not line numbers):
 *   - `'[Guardrails] Point blocked'` (search) log meta (`point.id`,
 *     `result.reason`) and the dev-mode `Point blocked: ...` abort throw.
 *   - `'[Guardrails] Point upsert blocked'` log meta and the dev-mode
 *     `Point blocked: ...` throw (`result.reason`).
 *
 * This contract-lock asserts the canonical primitive is reachable from the
 * import surface and behaves as expected on representative attacker inputs.
 * The END-TO-END proof that each guarded path actually applies `sanitizeMeta`
 * (and FAILS if a wrap is removed — the ADR-0001 non-vacuity standard) lives in
 * `guarded-qdrant.test.ts` › "CWE-117 reason/id sanitization is load-bearing
 * (ADR-0001)": those tests drive a spy logger with control-char payloads and
 * assert the escaped form at each boundary.
 *
 * History: Sprint 43 cross-connector CWE-117 closure (original three
 * boundaries) → boundary-driving tests added when the import-only contract was
 * found vacuous (ADR-0001 anti-pattern).
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('qdrant-connector — Sprint 43 CWE-117 sanitization contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString + serializeError', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes validator-extracted reason for point-blocked + upsert-blocked', () => {
    const reason = 'matched payload-pattern\nINJECTED:fake_status=ok';
    expect(sanitizeMeta(reason)).toBe('matched payload-pattern\\nINJECTED:fake_status=ok');
  });

  it('sanitizes caller-supplied point.id field', () => {
    const pointId = 'point-id-1234\nINJECTED:fake_audit=PASS';
    expect(sanitizeMeta(pointId)).toBe('point-id-1234\\nINJECTED:fake_audit=PASS');
  });
});
