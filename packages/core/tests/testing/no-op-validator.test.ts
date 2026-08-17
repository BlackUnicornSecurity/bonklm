/**
 * noOpValidator() — Test Helper Spec
 * ===================================
 * Verifies the test-only `noOpValidator()` helper exported from
 * `@blackunicorn/bonklm/testing` (PR 1 of Story 0.1 corrections).
 *
 * The helper exists so connector tests can construct an engine without
 * relying on the BONKLM_TEST_MODE env-shim backdoor (which PR 3 removes).
 * Its `validate()` always returns `{ allowed: true }`. Critical invariant:
 * composing noOp with a real blocking validator MUST NOT mask the block —
 * the engine aggregates per-validator results and an unmasked block wins.
 */
import { describe, it, expect } from 'vitest';
import { noOpValidator } from '../../src/testing/no-op-validator.js';
import { GuardrailEngine } from '../../src/engine/GuardrailEngine.js';
import { createResult, RiskLevel, Severity } from '../../src/base/GuardrailResult.js';
import type { Validator } from '../../src/engine/GuardrailEngine.types.js';

describe('noOpValidator() — PR 1', () => {
  describe('shape + structural compliance', () => {
    it('returns an object satisfying the Validator interface', () => {
      const v = noOpValidator();
      // Structural check — these are the two fields on Validator.
      expect(typeof v.validate).toBe('function');
      expect(typeof v.name).toBe('string');
      // TypeScript-level satisfaction:
      const _typed: Validator = v;
      expect(_typed).toBe(v);
    });

    it('default name is "NoOpValidator"', () => {
      expect(noOpValidator().name).toBe('NoOpValidator');
    });

    it('custom name is preserved', () => {
      expect(noOpValidator('MyTestStub').name).toBe('MyTestStub');
    });
  });

  describe('validate() return shape', () => {
    it('returns an allowed GuardrailResult on any string input', () => {
      const v = noOpValidator();
      const result = v.validate('any string at all');
      expect(result).toMatchObject({
        allowed: true,
        blocked: false,
        findings: [],
        severity: Severity.INFO,
        risk_level: RiskLevel.LOW,
        risk_score: 0
      });
    });

    it('returns an allowed result on empty string', () => {
      const v = noOpValidator();
      const result = v.validate('');
      expect(result.allowed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    it('returns a fresh result object per call (no shared mutable state)', () => {
      const v = noOpValidator();
      const r1 = v.validate('x');
      const r2 = v.validate('x');
      expect(r1).not.toBe(r2);
      // But equal-by-shape modulo timestamp:
      expect(r1.allowed).toBe(r2.allowed);
      expect(r1.findings).toEqual(r2.findings);
    });
  });

  describe('engine composition', () => {
    it('lets GuardrailEngine construct without throw', () => {
      expect(() => new GuardrailEngine({ validators: [noOpValidator()] })).not.toThrow();
    });

    it('engine.validate() returns allowed when only noOp is wired', async () => {
      const engine = new GuardrailEngine({ validators: [noOpValidator()] });
      const result = await engine.validate('hello');
      expect(result.allowed).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.validatorCount).toBe(1);
    });

    it('engine.validate() works on the async path (await yields allowed)', async () => {
      const engine = new GuardrailEngine({ validators: [noOpValidator()] });
      await expect(engine.validate('hello')).resolves.toMatchObject({
        allowed: true,
        blocked: false
      });
    });
  });

  // Adversarial regression (per audit-loop finding H4).
  // If a developer composes noOpValidator with a REAL blocking validator,
  // the engine MUST surface the block — the noOp must not mask it.
  describe('adversarial: noOp does not mask a real block', () => {
    const blockingValidator: Validator = {
      name: 'BlockingTestValidator',
      validate: () =>
        createResult(false, Severity.CRITICAL, [
          {
            category: 'test_block',
            description: 'simulated block',
            severity: Severity.CRITICAL,
            weight: 10
          }
        ])
    };

    it('noOp first, blocker second: engine returns blocked', async () => {
      const engine = new GuardrailEngine({
        validators: [noOpValidator(), blockingValidator],
        shortCircuit: false
      });
      const result = await engine.validate('any content');
      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
      // Tighter regression check (per audit): assert the blocker's specific
      // finding actually surfaced in the aggregated findings — guards
      // against a hypothetical filter regression where allFindings drops
      // the blocker's contribution and the test still passes on
      // length > 0 alone.
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'test_block',
            severity: Severity.CRITICAL
          })
        ])
      );
      // Per-validator results array must contain both entries (no
      // filtering of the noOp pass, no filtering of the blocker).
      expect(result.results.map(r => r.validatorName)).toEqual(['NoOpValidator', 'BlockingTestValidator']);
    });

    it('blocker first, noOp second: engine returns blocked (short-circuit)', async () => {
      const engine = new GuardrailEngine({
        validators: [blockingValidator, noOpValidator()]
      });
      const result = await engine.validate('any content');
      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
    });

    it('blocker first, noOp second, parallel execution: still blocked', async () => {
      const engine = new GuardrailEngine({
        validators: [blockingValidator, noOpValidator()],
        executionOrder: 'parallel'
      });
      const result = await engine.validate('any content');
      expect(result.allowed).toBe(false);
    });
  });
});
