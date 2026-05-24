/**
 * Sprint 40 connector CWE-117 sweep — nestjs-module regression.
 *
 * Two src sites carry attacker-influenced template-literal log calls
 * in `guardrails.interceptor.ts`:
 *   - line 218 (Request blocked): `blocked.reason` from validator
 *     output; may carry matched-pattern content.
 *   - line 288 (Response blocked): same shape on the response leg.
 *
 * Sprint 40 wraps both with `sanitizeLogString`. Two additional
 * sites (`logger.error('Error in custom error handler', { error })`)
 * upgraded from bare `{ error }` to `serializeError(error)` — Sprint
 * 33's canonical pattern, applied at connector level for the first
 * time.
 *
 * Full interceptor integration test exists at
 * `tests/guardrails.module.test.ts`; this file is a focused
 * contract-lock for the import surface + canonical-primitive
 * behaviour on the specific input shapes the interceptor surfaces.
 *
 * **Sprint 41 follow-up (Sprint 42 scope):** the integration test in
 * `guardrails.module.test.ts` does NOT currently assert sanitized
 * spy-logger output — it tests behavioural correctness of the
 * blocked-request path but not the CWE-117 wrap fidelity. Sprint 42
 * should extend that test (or add a focused integration test here)
 * to instantiate the interceptor via `@nestjs/testing`, trigger a
 * blocked path with control-char-laden `blocked.reason`, and assert
 * the spy logger captured a sanitized output.
 *
 * Sprint 41 architect HIGH-2 + CR MEDIUM + security S40-4 partial
 * closure: elizaos is fully closed via integration test; nestjs
 * remains contract-lock-only pending NestJS Test-module scaffolding.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, serializeError } from '@blackunicorn/bonklm';

describe('nestjs-module — Sprint 40 CWE-117 sanitization contract', () => {
  it('sanitizes a blocked-reason carrying validator-extracted attack content', () => {
    // Real-world vector: PromptInjectionValidator extracts the matched
    // pattern slice into `result.reason` — if the attacker embeds a
    // newline in their prompt-injection payload, the reason carries
    // a literal `\n`. Pre-Sprint-40, the interceptor's
    // `\`Request blocked: ${blocked.reason}\`` forged a phantom log
    // line in downstream aggregators.
    const reason = 'Pattern "ignore_previous_rules" matched\nfake_severity: CRITICAL';
    expect(sanitizeLogString(reason)).toBe(
      'Pattern "ignore_previous_rules" matched\\nfake_severity: CRITICAL'
    );
  });

  it('serializeError replaces bare { error } at the custom-error-handler catch sites', () => {
    // The two catch sites use `serializeError(error)` to defeat the
    // `error={}` opacity bug (Sprint 33 root cause — Error properties
    // are non-enumerable, JSON.stringify returns `{}` on bare Error).
    const out = serializeError(new TypeError('custom-handler invariant violated'));
    expect(out.message).toBe('custom-handler invariant violated');
    expect(out.name).toBe('TypeError');
    // Sanity: the message field survives JSON.stringify (enumerable).
    expect(JSON.stringify(out)).toContain('"message":"custom-handler invariant violated"');
  });
});
