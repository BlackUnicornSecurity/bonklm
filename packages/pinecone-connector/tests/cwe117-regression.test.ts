/**
 * CWE-117 sanitization primitive contract — pinecone-connector.
 *
 * `createGuardedIndex` in `guarded-pinecone.ts` wraps the attacker-influenced
 * `result.reason` in its dev-mode `ConnectorValidationError` throw boundaries
 * with the canonical `sanitizeMeta` primitive (located by their message
 * strings, not line numbers):
 *   - the `Query blocked: ...` throw (query-side validation failure).
 *   - the `Vector blocked: ...` abort throw (retrieved-vector validation).
 * The sibling `logValidationFailure` log calls are already sanitized internally
 * by that shared helper (via the canonical `sanitizeLogString`).
 *
 * This contract-lock asserts the canonical primitive is reachable from the
 * import surface and behaves as expected on representative attacker inputs.
 * The END-TO-END proof that each guarded path actually applies `sanitizeMeta`
 * (and FAILS if a wrap is removed — the ADR-0001 non-vacuity standard) lives in
 * `guarded-pinecone.test.ts` › "CWE-117 reason sanitization is load-bearing
 * (ADR-0001)": those tests drive the guarded wrapper with control-char payloads
 * and assert the escaped form at each throw boundary.
 *
 * History: Sprint 43 cross-connector CWE-117 closure (throw-site boundaries) →
 * boundary-driving tests added when the import-only contract was found vacuous
 * (ADR-0001 anti-pattern).
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('pinecone-connector — Sprint 43 CWE-117 sanitization contract', () => {
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

  it('sanitizes a validator-extracted reason carrying control chars', () => {
    const reason = 'matched "pattern"\nINJECTED:CRITICAL fake_severity';
    expect(sanitizeMeta(reason)).toBe('matched "pattern"\\nINJECTED:CRITICAL fake_severity');
  });

  it('sanitizes TAB-injection vector at the throw boundary', () => {
    // TAB-injection is the most common form of CWE-117 attack against
    // TSV-formatted log ingestors. sanitizeMeta replaces 0x09 with `\x09`.
    const reason = 'matched\tINJECTED:phantom_column=true';
    expect(sanitizeMeta(reason)).toBe('matched\\x09INJECTED:phantom_column=true');
  });
});
