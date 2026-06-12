/**
 * CWE-117 sanitization contract — weaviate-connector regression.
 *
 * `createGuardedClient` in `guarded-weaviate.ts` wraps every
 * attacker-influenced log-meta value and dev-mode error interpolation with
 * the canonical `sanitizeMeta` primitive. The wrapped boundaries (located by
 * their log/message strings, not line numbers):
 *   - `'[Guardrails] Object blocked'` log meta (`obj.uuid`, `result.reason`)
 *     and the dev-mode `Object blocked: ...` throw (`result.reason`).
 *   - `'[Guardrails] Class not allowed'` log meta and the dev-mode
 *     `Class '...' ...` throws (`className`).
 *   - `'[Guardrails] Query blocked'` log meta and the dev-mode
 *     `Query blocked: ...` throw (`result.reason`).
 *   - `'[Guardrails] Filter rejected'` log meta (validator detail —
 *     connector-authored static strings; wrapped as defense-in-depth).
 *   - `'[Guardrails] Field contains invalid characters'` and
 *     `'[Guardrails] Invalid pattern regex'` log meta (`field` / `pattern`).
 *
 * Per the Sprint 40 pattern, this contract-lock asserts the canonical
 * primitive is reachable from the import surface and behaves as expected on
 * representative attacker inputs. End-to-end proof that the guarded paths
 * fire lives in `guarded-weaviate.test.ts` (block/abort/filter-rejection
 * suites assert the sanitized messages and callbacks).
 *
 * History: Sprint 42 architect LOW deferral → Sprint 43 closure (original
 * six boundaries) → real-client rewrite carried all six forward and added
 * the filter/field/pattern boundaries.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('weaviate-connector — Sprint 43 CWE-117 sanitization contract', () => {
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
    // Real-world vector: PromptInjectionValidator extracts the
    // matched-pattern slice into `result.reason`; an attacker
    // embedding `\n` in the prompt has that newline land in
    // `result.reason`. Pre-Sprint-43, the weaviate query-blocked
    // log + thrown Error message would embed the raw `\n`.
    const reason = 'matched "pattern"\nINJECTED:CRITICAL fake_severity';
    expect(sanitizeMeta(reason)).toBe('matched "pattern"\\nINJECTED:CRITICAL fake_severity');
  });

  it('sanitizes a caller-supplied Weaviate className', () => {
    // `options.className` is application-wired; a misbehaving caller
    // (or a future class-list-from-user-input scenario) could supply
    // a className with control chars.
    const className = 'Document\nINJECTED';
    expect(sanitizeMeta(className)).toBe('Document\\nINJECTED');
  });

  it('sanitizes an upstream-supplied Weaviate object UUID', () => {
    // `obj.uuid` is whatever the Weaviate client returned. A hostile
    // upstream may inject control chars to manipulate downstream
    // log aggregators.
    const objectUuid = 'doc-1234\nINJECTED:fake_status=processed';
    expect(sanitizeMeta(objectUuid)).toBe('doc-1234\\nINJECTED:fake_status=processed');
  });
});
