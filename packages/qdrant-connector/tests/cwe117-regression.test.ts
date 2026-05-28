/**
 * Sprint 43 cross-connector CWE-117 sweep — qdrant-connector regression.
 *
 * Three src sites in `guarded-qdrant.ts` (peer of weaviate/pinecone):
 *   - line ~487 (point-blocked log raw `id` + raw `reason`).
 *   - line ~496 (point-blocked dev-mode throw raw reason).
 *   - line ~578 (point-upsert-blocked log + throw raw reason).
 *
 * Sprint 43 architect CRITICAL #3 closure — initial scoping missed
 * qdrant alongside its peers.
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
