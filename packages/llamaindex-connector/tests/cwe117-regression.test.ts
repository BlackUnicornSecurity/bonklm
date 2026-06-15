/**
 * CWE-117 sanitization primitive contract — llamaindex-connector.
 *
 * `createGuardedQueryEngine` / `createGuardedRetriever` in `guarded-engine.ts`
 * wrap every attacker-influenced log-meta value and dev-mode error
 * interpolation with the canonical `sanitizeMeta` primitive. The wrapped
 * boundaries (located by their log/message strings, not line numbers):
 *   - `'[Guardrails] Query blocked'` / `'[Guardrails] Retrieval query blocked'`
 *     log meta + the dev-mode `Query blocked: ...` throw.
 *   - `'[Guardrails] Document blocked'` / `'[Guardrails] Retrieved document
 *     blocked'` log meta (`reason` AND the retrieved-doc `documentPreview`
 *     slice) + the `onBlockedDocument: 'abort'` `Document blocked: ...` throw.
 *   - `'[Guardrails] Response blocked'` log meta (`reason`).
 *
 * This contract-lock asserts the canonical primitive is reachable from the
 * import surface and behaves as expected on representative attacker inputs.
 * The END-TO-END proof that each guarded path actually applies `sanitizeMeta`
 * (and FAILS if a wrap is removed — the ADR-0001 non-vacuity standard) lives in
 * `guarded-engine.test.ts` › "CWE-117 reason/documentPreview sanitization is
 * load-bearing (ADR-0001)": those tests drive the guarded wrapper with
 * control-char payloads and assert the escaped form at each boundary.
 *
 * History: introduced as a cross-connector CWE-117 sweep (primitive-isolation
 * asserts only) → boundary-driving tests added when the import-only contract was
 * found vacuous (ADR-0001 anti-pattern).
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('llamaindex-connector — CWE-117 sanitization primitive contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString + serializeError', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes a validator-extracted reason carrying control characters', () => {
    const reason = 'matched RAG-injection-pattern\nINJECTED:CRITICAL fake';
    expect(sanitizeMeta(reason)).toBe('matched RAG-injection-pattern\\nINJECTED:CRITICAL fake');
  });

  it('sanitizes documentPreview slice carrying retrieved-doc control chars', () => {
    // The 100-char content slice from a retrieved document is by
    // definition attacker-controlled (the retrieved doc is what the
    // RAG pipeline is supposed to validate). Sanitize at the log
    // boundary defensively.
    const docPreview = 'retrieved chunk\nINJECTED:fake_audit=PASS more text';
    expect(sanitizeMeta(docPreview)).toContain('INJECTED');
    expect(sanitizeMeta(docPreview)).not.toContain('\n');
  });
});
