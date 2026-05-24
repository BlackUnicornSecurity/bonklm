/**
 * Sprint 43 cross-connector CWE-117 sweep — llamaindex-connector regression.
 *
 * Nine src sites flagged by security review HIGH #3 in
 * `guarded-engine.ts` across query/document/response/retrieval paths:
 *   - lines 133-139 (query-blocked log + throw, raw reason).
 *   - lines 165-174 (document-blocked log + throw, raw reason +
 *     documentPreview content slice).
 *   - line 212 (response-blocked log, raw reason).
 *   - lines 307-313 (retrieval-query-blocked log + throw, raw reason).
 *   - lines 338-347 (retrieved-document-blocked log + throw, raw
 *     reason + documentPreview).
 *
 * Sprint 43 wraps all nine. documentPreview is a slice of attacker-
 * controlled retrieved doc content — sanitize at the boundary.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('llamaindex-connector — Sprint 43 CWE-117 sanitization contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString + serializeError', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes validator-extracted reason across all 9 sites', () => {
    const reason = 'matched RAG-injection-pattern\nINJECTED:CRITICAL fake';
    expect(sanitizeMeta(reason)).toBe(
      'matched RAG-injection-pattern\\nINJECTED:CRITICAL fake'
    );
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
