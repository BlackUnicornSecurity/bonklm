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
 *   - `'[Guardrails] Regex test timeout'` / `'[Guardrails] Regex test failed'`
 *     filterPayload log meta (`key` — an unconstrained retrieved-payload field
 *     name — plus the operator-supplied `pattern`).
 *   - `'[Guardrails] Dangerous filter key detected'` log meta + the dev-mode
 *     `Filter contains dangerous key: ...` throw (`key`; consistency-only — the
 *     key is gated to a fixed allow-listed constant, control-char-free by
 *     construction).
 *   - Consistency-only advisory sinks (control-char-free by construction, not
 *     mutation-testable): `'[Guardrails] Suspicious Unicode escape detected'`
 *     (`escape` — a `\uXXXX` match) and the operator-supplied `pattern` at the
 *     `'[Guardrails] Pattern has too many consecutive wildcards'` /
 *     `'[Guardrails] Invalid pattern regex'` sinks. Wrapped so every interpolated
 *     log value in the connector is uniform.
 *
 * This contract-lock asserts the canonical primitive is reachable from the
 * import surface and behaves as expected on representative attacker inputs.
 * The END-TO-END proof that each guarded path actually applies `sanitizeMeta`
 * (and FAILS if a wrap is removed — the ADR-0001 non-vacuity standard) lives in
 * `guarded-qdrant.test.ts` › "CWE-117 reason/id sanitization is load-bearing
 * (ADR-0001)" (reason/id sinks) and "CWE-117 filterPayload + dangerous-key
 * sanitization is load-bearing (ADR-0001)" (the filterPayload `key` sinks; the
 * dangerous-key sink is covered but consistency-only): those tests drive a spy
 * logger with control-char payloads and assert the escaped form at each
 * boundary.
 *
 * History: Sprint 43 cross-connector CWE-117 closure (original Point-blocked /
 * upsert boundaries) → boundary-driving tests added when the import-only
 * contract was found vacuous (ADR-0001 anti-pattern) → filterPayload `key` /
 * `pattern` and dangerous-filter-key sinks wrapped + driven in a later
 * cross-connector uniformity pass.
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
