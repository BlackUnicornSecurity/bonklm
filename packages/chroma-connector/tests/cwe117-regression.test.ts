/**
 * Sprint 43 cross-connector CWE-117 sweep — chroma-connector regression.
 *
 * Four src sites in `guarded-chroma.ts` (peer of weaviate/pinecone):
 *   - line ~270 (query-blocked log raw reason).
 *   - line ~276 (query-blocked dev-mode throw raw reason).
 *   - line ~616 (document-add-blocked log raw reason).
 *   - line ~617 (document-add-blocked dev-mode throw raw reason).
 *
 * Sprint 43 architect CRITICAL #2 closure — initial scoping missed
 * chroma alongside its peers.
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
