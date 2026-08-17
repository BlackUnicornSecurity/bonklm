/**
 * Test-Only No-Op Validator
 * =========================
 * Returns a `Validator` whose `validate()` always allows content.
 *
 * Purpose: connector unit tests that exercise *wrapper plumbing* (logger
 * forwarding, timeout handling, callback paths) — not validation — need a
 * non-empty validators list to satisfy `GuardrailEngine`'s empty-list
 * fail-safe without standing up a real detector.
 *
 * IMPORTANT — DO NOT IMPORT FROM PRODUCTION CODE.
 * This helper is published under the `@blackunicorn/bonklm/testing` subpath
 * for unit-test ergonomics only. A production engine that wires a
 * `noOpValidator()` is functionally identical to an empty engine — every
 * input is silently allowed. The whole point of the fail-safe is to refuse
 * that shape; defeating it via this helper undoes the security guarantee
 * the fail-safe establishes.
 *
 * A future ESLint rule will enforce that this module cannot be imported
 * from non-test paths. Until then, code review is the gate.
 */

import { createResult, type GuardrailResult, Severity } from '../base/GuardrailResult.js';
import type { Validator } from '../engine/GuardrailEngine.types.js';

/**
 * Construct a Validator that always returns an allowed `GuardrailResult`.
 *
 * @param name - Optional override for the validator's reported name. Useful
 *   when a test asserts against `validatorName` in the engine result and
 *   needs to distinguish multiple no-op stubs in the same chain.
 *   @defaultValue `'NoOpValidator'`
 *
 * @example
 * ```ts
 * import { noOpValidator } from '@blackunicorn/bonklm/testing';
 *
 * const engine = new GuardrailEngine({
 *   validators: [noOpValidator()],
 * });
 * await engine.validate('anything'); // → { allowed: true, ... }
 * ```
 */
export function noOpValidator(name?: string): Validator {
  return {
    name: name ?? 'NoOpValidator',
    validate(_content: string): GuardrailResult {
      // Fresh object per call — callers may mutate / inspect freely without
      // affecting subsequent invocations.
      return createResult(true, Severity.INFO, []);
    }
  };
}
