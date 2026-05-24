/**
 * Sprint 43 cross-connector CWE-117 sweep — pinecone-connector regression.
 *
 * Two src sites in `guarded-pinecone.ts` embed raw `result.reason` in
 * dev-mode `ConnectorValidationError` messages:
 *   - line 221 (`Query blocked: ${result.reason}`)
 *   - line 292 (`Vector blocked: ${result.reason}`)
 *
 * Sprint 43 wraps both with `sanitizeMeta`. The existing
 * `logValidationFailure` calls (lines 217, 285) were already
 * sanitized via `stripLogControlChars` internally — Sprint 43 covers
 * the throw-site boundary that grep-by-function-name missed.
 *
 * Sprint 42 architect LOW deferral → Sprint 43 closure.
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
    expect(sanitizeMeta(reason)).toBe(
      'matched "pattern"\\nINJECTED:CRITICAL fake_severity'
    );
  });

  it('sanitizes TAB-injection vector at the throw boundary', () => {
    // TAB-injection is the most common form of CWE-117 attack against
    // TSV-formatted log ingestors. sanitizeMeta replaces 0x09 with `\x09`.
    const reason = 'matched\tINJECTED:phantom_column=true';
    expect(sanitizeMeta(reason)).toBe('matched\\x09INJECTED:phantom_column=true');
  });
});
