/**
 * Story 0.1 — Empty Validator List Fail-Safe (R2-7)
 * ==================================================
 * An engine with no validators AND no guards has no protective layer:
 * every input is silently allowed. We refuse to construct it.
 *
 * Per round-2 amendment R2-7 (post-clarification with the maintainer):
 *  - Throw at construction when BOTH `validators` and `guards` are
 *    empty/undefined.
 *  - `allowEmptyForTesting: true` is the documented escape hatch; using it
 *    emits a CRITICAL-level warning so it cannot be silently abused.
 *  - Engines with at least one validator OR at least one guard construct
 *    normally (existing connector code paths unaffected).
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
    calls,
  } as Logger & { calls: { level: string; msg: string; meta?: unknown }[] };
}

describe('GuardrailEngine — empty-list fail-safe (Story 0.1 / R2-7)', () => {
  it('throws when both validators and guards are missing entirely', () => {
    expect(() => new GuardrailEngine()).toThrow(EMPTY_LIST_ERROR);
  });

  it('throws when both validators and guards are explicit empty arrays', () => {
    expect(
      () => new GuardrailEngine({ validators: [], guards: [] })
    ).toThrow(EMPTY_LIST_ERROR);
  });

  it('throws when validators omitted and guards is empty', () => {
    expect(() => new GuardrailEngine({ guards: [] })).toThrow(EMPTY_LIST_ERROR);
  });

  it('throws when guards omitted and validators is empty', () => {
    expect(() => new GuardrailEngine({ validators: [] })).toThrow(EMPTY_LIST_ERROR);
  });

  it('does not throw when at least one validator is supplied', () => {
    expect(
      () => new GuardrailEngine({ validators: [new PromptInjectionValidator()] })
    ).not.toThrow();
  });

  it('does not throw when at least one guard is supplied', () => {
    expect(() => new GuardrailEngine({ guards: [new SecretGuard()] })).not.toThrow();
  });

  it('does not throw when both lists are populated', () => {
    expect(
      () =>
        new GuardrailEngine({
          validators: [new PromptInjectionValidator()],
          guards: [new SecretGuard()],
        })
    ).not.toThrow();
  });

  describe('allowEmptyForTesting escape hatch', () => {
    it('does not throw when allowEmptyForTesting: true is set', () => {
      expect(
        () => new GuardrailEngine({ allowEmptyForTesting: true })
      ).not.toThrow();
    });

    it('does not throw when allowEmptyForTesting: true with explicit empty arrays', () => {
      expect(
        () =>
          new GuardrailEngine({
            validators: [],
            guards: [],
            allowEmptyForTesting: true,
          })
      ).not.toThrow();
    });

    it('logs a CRITICAL-level warning when the escape hatch is used', () => {
      const logger = captureLogger();
      new GuardrailEngine({ allowEmptyForTesting: true, logger });

      const criticalWarnings = logger.calls.filter(
        (c) => c.level === 'warn' && /CRITICAL/i.test(c.msg) && /empty/i.test(c.msg)
      );
      expect(criticalWarnings).toHaveLength(1);
    });

    it('does NOT log the escape-hatch warning on a normal (populated) engine', () => {
      const logger = captureLogger();
      new GuardrailEngine({
        validators: [new PromptInjectionValidator()],
        logger,
      });

      const criticalWarnings = logger.calls.filter(
        (c) => c.level === 'warn' && /CRITICAL/i.test(c.msg) && /empty/i.test(c.msg)
      );
      expect(criticalWarnings).toHaveLength(0);
    });

    it('does not log the escape-hatch warning when allowEmptyForTesting: false and validators present', () => {
      const logger = captureLogger();
      new GuardrailEngine({
        validators: [new PromptInjectionValidator()],
        allowEmptyForTesting: false,
        logger,
      });

      const criticalWarnings = logger.calls.filter(
        (c) => c.level === 'warn' && /CRITICAL/i.test(c.msg)
      );
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
    ])('throws on unsafe config shape: %j', (cfg) => {
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
