/**
 * Validator-crash fail-closed contract (audit F13 verification).
 *
 * The audit reported the engine fails OPEN when a validator throws.
 * Re-verification against the shipped code shows the opposite: every
 * catch path converts a validator/guard exception into a BLOCKED
 * result (`createResult(false, …)` — first parameter is `allowed`).
 * This suite PINS that fail-closed behavior on all execution paths so
 * the property can never silently regress. If any assertion here
 * fails, the engine has become fail-open on validator crash — treat
 * it as a release blocker.
 */
import { describe, expect, it } from 'vitest';
import { GuardrailEngine } from '../../src/engine/GuardrailEngine.js';
import type { GuardrailResult } from '../../src/base/GuardrailResult.js';

class ThrowingValidator {
  readonly name = 'ThrowingValidator';
  validate(): GuardrailResult {
    throw new Error('adversarial input crashed the validator');
  }
}

class AllowAllValidator {
  readonly name = 'AllowAll';
  validate(): GuardrailResult {
    return {
      allowed: true,
      blocked: false,
      severity: 'info' as never,
      risk_level: 'low' as never,
      risk_score: 0,
      findings: [],
      timestamp: Date.now()
    };
  }
}

class ThrowingGuard {
  readonly name = 'ThrowingGuard';
  validate(): GuardrailResult {
    throw new Error('adversarial input crashed the guard');
  }
}

describe('engine fails closed when a validator crashes (pinned contract)', () => {
  it('sequential execution blocks when any validator throws', async () => {
    const engine = new GuardrailEngine({
      validators: [new AllowAllValidator(), new ThrowingValidator()]
    });
    const result = await engine.validate('benign text');
    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it('parallel execution blocks when any validator throws', async () => {
    const engine = new GuardrailEngine({
      validators: [new AllowAllValidator(), new ThrowingValidator()],
      executionOrder: 'parallel'
    });
    const result = await engine.validate('benign text');
    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it('validateInput (structured surface) blocks when a validator throws', async () => {
    const engine = new GuardrailEngine({
      validators: [new AllowAllValidator(), new ThrowingValidator()]
    });
    const result = await engine.validateInput({ kind: 'text', content: 'benign text' });
    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it('guard pipeline blocks when a guard throws', async () => {
    const engine = new GuardrailEngine({
      validators: [new AllowAllValidator()],
      guards: [new ThrowingGuard()]
    });
    const result = await engine.validate('benign text');
    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it('a throwing validator alone (no clean siblings) still blocks', async () => {
    const engine = new GuardrailEngine({ validators: [new ThrowingValidator()] });
    const result = await engine.validate('anything');
    expect(result.blocked).toBe(true);
  });
});
