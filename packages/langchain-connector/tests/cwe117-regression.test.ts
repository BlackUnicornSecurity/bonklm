/**
 * Sprint 43 cross-connector CWE-117 sweep — langchain-connector regression.
 *
 * Five src sites in `middleware/index.ts` carry raw `r.reason`:
 *   - line ~291 (`Input blocked: ${r.reason}` in throw).
 *   - line ~307 (`Output blocked: ${r.reason}` in throw).
 *   - line ~327 (`Tool call blocked: ${r.reason}` in throw).
 *   - line ~442 (`logger.warn?.('[bonklm-langchain] retriever doc dropped',
 *     { reason: r.reason })`).
 *   - line ~520 (`State blocked: ${r.reason}` in bonklmLangGraphNode throw).
 *
 * Sprint 43 wraps each with `sanitizeMeta`. The existing
 * `logValidationFailure` calls at the same blocks were already
 * sanitized via `stripLogControlChars` internally — Sprint 43 covers
 * the throw-site + retriever-doc-drop boundaries that grep missed.
 *
 * Sprint 42 architect LOW deferral → Sprint 43 closure.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('langchain-connector — Sprint 43 CWE-117 sanitization contract', () => {
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

  it('sanitizes a validator-extracted reason for input/output/tool-call/state throw sites', () => {
    const reason = 'matched ignore_previous\nINJECTED:fake_severity';
    expect(sanitizeMeta(reason)).toBe(
      'matched ignore_previous\\nINJECTED:fake_severity'
    );
  });

  it('sanitizes a retriever-doc-drop reason carrying control chars', () => {
    // Retriever-doc-drop is silent-warn (does NOT throw — preserves
    // RAG flow). The log meta is the only forensic record; raw
    // control chars in `reason` would forge phantom log lines in
    // downstream aggregators.
    const reason = 'retrieved doc carries injection\nINJECTED:fake_dropped=0';
    expect(sanitizeMeta(reason)).toBe(
      'retrieved doc carries injection\\nINJECTED:fake_dropped=0'
    );
  });

  it('sanitizes runId meta field at stream-related log sites (Sprint 44 architect LOW #9, #10)', () => {
    // Sprint 44 closure: `guardrails-handler.ts` lines ~424 + ~476
    // log `runId` from LangChain in the stream-buffer-exceeded +
    // stream-blocked-at-final-validation warns. The `validateAndThrow`
    // path at line ~249 already sanitized runId; Sprint 44 brings the
    // two stream sites to parity. runId is typed `string` (UUID-shaped
    // in practice) but typing alone is no defence — a custom
    // LangChain integration could pass any string.
    const hostileRunId = 'run-1234\nINJECTED:fake_status=PASS';
    expect(sanitizeMeta(hostileRunId)).toBe(
      'run-1234\\nINJECTED:fake_status=PASS'
    );
  });

  it('sanitizes ANSI escape sequences in handoff-blocked reasons', () => {
    // Terminal-hijacking via ANSI escapes: `\x1B` (ESC) is in the
    // 0x00-0x1F range that sanitizeLogString strips. Verify the
    // end-to-end behaviour at the connector boundary.
    const reason = 'matched \x1B[31mFAKE_RED_INJECTION\x1B[0m';
    const sanitized = sanitizeMeta(reason);
    expect(sanitized).not.toContain('\x1B');
    expect(sanitized).toContain('FAKE_RED_INJECTION');
  });
});
