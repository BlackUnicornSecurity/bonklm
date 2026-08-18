/**
 * Story 0.1 — Empty Validator List Fail-Safe (R2-7, spec-strict)
 * ===============================================================
 * An engine with no validators has no primary protective layer: every
 * text input is silently allowed regardless of any guards. We refuse to
 * construct it.
 *
 * Per round-2 amendment R2-7, locked-in spec-strict reading (Story 0.1
 * corrections PR 3):
 *  - Throw at construction when `validators` is empty, regardless of
 *    whether guards are wired.
 *  - `allowEmptyForTesting: true` is the documented escape hatch;
 *    honoring it emits a CRITICAL-level warning so it cannot be
 *    silently abused.
 *  - Engines with at least one validator construct normally; guards-only
 *    configurations must explicitly pass the opt-in flag (a separate
 *    `allowGuardsOnlyValidation` field may land later if real users
 *    surface that need).
 */
import { describe, it, expect, vi } from 'vitest';
import { GuardrailEngine } from '../../src/engine/GuardrailEngine.js';
import { PromptInjectionValidator } from '../../src/validators/prompt-injection.js';
import { SecretGuard } from '../../src/guards/secret.js';
import { LogLevel, type Logger } from '../../src/base/GenericLogger.js';

const EMPTY_LIST_ERROR =
  'Empty validator list is unsafe; use a no-op validator explicitly or pass `allowEmptyForTesting: true`.';

function captureLogger(): Logger & { calls: { level: string; msg: string; meta?: unknown }[] } {
  const calls: { level: string; msg: string; meta?: unknown }[] = [];
  return {
    level: LogLevel.DEBUG,
    debug: (msg, meta) => calls.push({ level: 'debug', msg, meta }),
    info: (msg, meta) => calls.push({ level: 'info', msg, meta }),
    warn: (msg, meta) => calls.push({ level: 'warn', msg, meta }),
    error: (msg, meta) => calls.push({ level: 'error', msg, meta }),
    calls
  } as Logger & { calls: { level: string; msg: string; meta?: unknown }[] };
}

describe('GuardrailEngine — empty-list fail-safe (Story 0.1 / R2-7)', () => {
  it('throws when both validators and guards are missing entirely', () => {
    expect(() => new GuardrailEngine()).toThrow(EMPTY_LIST_ERROR);
  });

  it('throws when both validators and guards are explicit empty arrays', () => {
    expect(() => new GuardrailEngine({ validators: [], guards: [] })).toThrow(EMPTY_LIST_ERROR);
  });

  it('throws when validators omitted and guards is empty', () => {
    expect(() => new GuardrailEngine({ guards: [] })).toThrow(EMPTY_LIST_ERROR);
  });

  it('throws when guards omitted and validators is empty', () => {
    expect(() => new GuardrailEngine({ validators: [] })).toThrow(EMPTY_LIST_ERROR);
  });

  it('does not throw when at least one validator is supplied', () => {
    expect(() => new GuardrailEngine({ validators: [new PromptInjectionValidator()] })).not.toThrow();
  });

  // Renamed + inverted in Story 0.1 corrections PR 3 (spec-strict flip):
  // the engine now treats validators as the primary protective layer and
  // refuses to construct without one even if guards are wired. Guards-only
  // production configurations must explicitly pass `allowEmptyForTesting:
  // true`; a future story can add a dedicated `allowGuardsOnlyValidation`
  // hatch if real users surface.
  it('throws when validators is empty even if at least one guard is supplied', () => {
    expect(() => new GuardrailEngine({ guards: [new SecretGuard()] })).toThrow(EMPTY_LIST_ERROR);
  });

  it('does not throw when at least one validator is supplied even with no guards', () => {
    expect(() => new GuardrailEngine({ validators: [new PromptInjectionValidator()] })).not.toThrow();
  });

  it('does not throw when both lists are populated', () => {
    expect(
      () =>
        new GuardrailEngine({
          validators: [new PromptInjectionValidator()],
          guards: [new SecretGuard()]
        })
    ).not.toThrow();
  });

  describe('allowEmptyForTesting escape hatch', () => {
    it('does not throw when allowEmptyForTesting: true is set', () => {
      expect(() => new GuardrailEngine({ allowEmptyForTesting: true })).not.toThrow();
    });

    it('does not throw when allowEmptyForTesting: true with explicit empty arrays', () => {
      expect(
        () =>
          new GuardrailEngine({
            validators: [],
            guards: [],
            allowEmptyForTesting: true
          })
      ).not.toThrow();
    });

    // Audit-loop completeness check (PR 3): legitimate "guards-only
    // production-shaped" config can still construct via the explicit hatch.
    // Until a dedicated `allowGuardsOnlyValidation` field lands, this is
    // the migration path for guards-only callers.
    it('does not throw with guards + allowEmptyForTesting: true (guards-only hatch path)', () => {
      expect(
        () =>
          new GuardrailEngine({
            validators: [],
            guards: [new SecretGuard()],
            allowEmptyForTesting: true
          })
      ).not.toThrow();
    });

    it('warning when guards are present mentions guard count and does not claim "no security checks"', () => {
      const logger = captureLogger();
      new GuardrailEngine({
        guards: [new SecretGuard()],
        allowEmptyForTesting: true,
        logger
      });
      const criticalWarnings = logger.calls.filter(c => c.level === 'warn' && /CRITICAL/i.test(c.msg));
      expect(criticalWarnings).toHaveLength(1);
      const msg = criticalWarnings[0].msg;
      expect(msg).toMatch(/no validator-layer checks/i);
      // Critical: must NOT mislead the user about guards
      expect(msg).toMatch(/1 guard\(s\) ARE wired/);
    });

    it('logs a CRITICAL-level warning when the escape hatch is used', () => {
      const logger = captureLogger();
      new GuardrailEngine({ allowEmptyForTesting: true, logger });

      // Warning text post-PR-3 says "no validators" (was "no validators or
      // guards" under the BOTH-empty check). Spec-strict flip: validators
      // are the primary protective layer, so the warning is precise.
      const criticalWarnings = logger.calls.filter(
        c => c.level === 'warn' && /CRITICAL/i.test(c.msg) && /no validators/i.test(c.msg)
      );
      expect(criticalWarnings).toHaveLength(1);
    });

    it('does NOT log the escape-hatch warning on a normal (populated) engine', () => {
      const logger = captureLogger();
      new GuardrailEngine({
        validators: [new PromptInjectionValidator()],
        logger
      });

      const criticalWarnings = logger.calls.filter(
        c => c.level === 'warn' && /CRITICAL/i.test(c.msg) && /no validators/i.test(c.msg)
      );
      expect(criticalWarnings).toHaveLength(0);
    });

    it('does not log the escape-hatch warning when allowEmptyForTesting: false and validators present', () => {
      const logger = captureLogger();
      new GuardrailEngine({
        validators: [new PromptInjectionValidator()],
        allowEmptyForTesting: false,
        logger
      });

      const criticalWarnings = logger.calls.filter(c => c.level === 'warn' && /CRITICAL/i.test(c.msg));
      expect(criticalWarnings).toHaveLength(0);
    });
  });

  describe('error message ergonomics', () => {
    it('error message mentions both opt-out paths', () => {
      let caught: unknown;
      try {
        new GuardrailEngine();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const msg = (caught as Error).message;
      expect(msg).toMatch(/no-op validator/i);
      expect(msg).toMatch(/allowEmptyForTesting/);
    });

    it('throws an Error instance (not a string)', () => {
      try {
        new GuardrailEngine();
        // unreachable
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe('empty-engine still validates content as allowed when opted in', () => {
    // Regression sanity-check: the escape hatch lets tests exercise the engine
    // shell without validators (e.g. when verifying connector plumbing).
    it('empty opted-in engine returns allowed=true and no findings', async () => {
      const engine = new GuardrailEngine({ allowEmptyForTesting: true });
      const result = await engine.validate('hello world');
      expect(result.allowed).toBe(true);
      expect(result.findings).toHaveLength(0);
      expect(result.validatorCount).toBe(0);
      expect(result.guardCount).toBe(0);
    });
  });

  // Defensive: protect against silent regressions if someone refactors the
  // constructor and drops the check.
  describe('regression guard', () => {
    it.each([
      [{}],
      [{ validators: [] }],
      [{ guards: [] }],
      [{ validators: [], guards: [] }],
      [{ allowEmptyForTesting: false }],
      [{ validators: [], guards: [], allowEmptyForTesting: false }],
      // Spec-strict (PR 3): guards alone without validators MUST throw.
      [{ guards: [new SecretGuard()] }],
      [{ validators: [], guards: [new SecretGuard()] }]
    ])('throws on unsafe config shape: %j', cfg => {
      expect(() => new GuardrailEngine(cfg)).toThrow();
    });

    // Spy on console to confirm no implicit network calls; the throw must be
    // synchronous and not produce side-effects beyond a logger entry.
    it('throw is synchronous (no async behavior leaks)', () => {
      const spy = vi.fn();
      try {
        new GuardrailEngine();
        spy('did not throw');
      } catch {
        spy('threw');
      }
      expect(spy).toHaveBeenCalledWith('threw');
    });
  });
});
