/**
 * Sprint 43 cross-connector CWE-117 sweep — weaviate-connector regression.
 *
 * Six src sites in `guarded-weaviate.ts` carry attacker-influenced
 * template-literal log calls or dev-mode error messages:
 *   - line 364-370 (`logger.warn('[Guardrails] Object blocked', { id, reason })`)
 *     — both `obj.id` (caller-supplied) and `result.reason` (validator
 *     output) were raw.
 *   - line 373 (`throw new Error(\`Object blocked: ${result.reason}\`)`)
 *     — raw reason in dev-mode error message.
 *   - line 391 (`logger.warn('[Guardrails] Class not allowed', { className })`)
 *     — `options.className` is caller-supplied.
 *   - line 393 (`throw new Error(\`Class '${className}' is not allowed\`)`)
 *     — raw className in dev-mode error message.
 *   - line 418 (`logger.warn('[Guardrails] Query blocked', { reason })`) — raw.
 *   - line 420 (`throw new Error(\`Query blocked: ${result.reason}\`)`) — raw.
 *
 * Sprint 43 wraps each interpolation boundary with `sanitizeMeta`. Per
 * Sprint 40 pattern, this contract-lock test asserts the canonical
 * primitive is reachable from the import surface. A future integration
 * test (Sprint 44+) should instantiate `createGuardedWeaviate` with a
 * mock client + spy logger to prove the wraps fire end-to-end.
 *
 * Sprint 42 architect LOW deferral → Sprint 43 closure.
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

  it('sanitizes a caller-supplied Weaviate object ID', () => {
    // `obj.id` is whatever the Weaviate client passed in. A hostile
    // upstream may inject control chars to manipulate downstream
    // log aggregators.
    const objectId = 'doc-1234\nINJECTED:fake_status=processed';
    expect(sanitizeMeta(objectId)).toBe('doc-1234\\nINJECTED:fake_status=processed');
  });
});
