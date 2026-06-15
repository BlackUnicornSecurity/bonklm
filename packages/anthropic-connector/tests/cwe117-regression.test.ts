/**
 * CWE-117 sanitization primitive contract — anthropic-connector.
 *
 * `createGuardedAnthropic` in `guarded-anthropic.ts` wraps every
 * attacker-influenced log-meta value and caller-facing interpolation with the
 * canonical `sanitizeMeta` primitive. The wrapped boundaries (located by their
 * log/message strings, not line numbers):
 *   - `'[Guardrails] Input blocked'` log meta + the dev-mode `Content blocked: ...`
 *     input throw.
 *   - `'[Guardrails] Output blocked'` log meta + the `[Content filtered by
 *     guardrails: ...]` marker placed in `response.content[0].text` (returned to
 *     the LLM caller — frontend / agent transcript — where raw control chars
 *     could hijack rendering).
 *   - the incremental-stream final-block `[Content filtered by guardrails: ...]`
 *     delta and the buffer-mode `[Stream blocked by guardrails: ...]` marker
 *     delta streamed in place of withheld content.
 *
 * This contract-lock asserts the canonical primitive is reachable from the
 * import surface and behaves as expected on representative attacker inputs.
 * The END-TO-END proof that each guarded path actually applies `sanitizeMeta`
 * (and FAILS if a wrap is removed — the ADR-0001 non-vacuity standard) lives in
 * `guarded-anthropic.test.ts` › "Anthropic Guarded Wrapper — CWE-117 reason
 * sanitization is load-bearing (ADR-0001)": those tests drive the guarded
 * wrapper with control-char payloads and assert the escaped form at each
 * boundary.
 *
 * History: introduced as a cross-connector CWE-117 sweep (primitive-isolation
 * asserts only) → boundary-driving tests added when the import-only contract was
 * found vacuous (ADR-0001 anti-pattern).
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('anthropic-connector — CWE-117 sanitization primitive contract', () => {
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

  it('sanitizes a validator-extracted reason for the input-blocked path', () => {
    const reason = 'matched "ignore_previous"\nINJECTED:CRITICAL bypass';
    expect(sanitizeMeta(reason)).toBe('matched "ignore_previous"\\nINJECTED:CRITICAL bypass');
  });

  it('sanitizes a validator-extracted reason for the output-filteredContent path', () => {
    // This value lands in `response.content[0].text` — raw control chars would
    // propagate into the application's UI / agent transcript via the LLM
    // caller's return-value flow.
    const reason = 'unsafe pattern matched\nINJECTED:fake_filtered=false';
    const filtered = `[Content filtered by guardrails: ${sanitizeMeta(reason)}]`;
    expect(filtered).not.toContain('\n');
    expect(filtered).toBe('[Content filtered by guardrails: unsafe pattern matched\\nINJECTED:fake_filtered=false]');
  });
});
