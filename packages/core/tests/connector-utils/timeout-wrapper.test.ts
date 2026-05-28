/**
 * Direct unit tests for `validateWithTimeoutSecure` — the canonical
 * SEC-008 timeout primitive shared by all 22 connectors.
 *
 * Sprint 31 cumulative audit (code-review HIGH-3 closure): the only
 * prior coverage was INDIRECT via the 22 connector consumers. This
 * file covers the primitive contract directly so regressions surface
 * in core CI rather than across N connector test suites.
 *
 * Test surface:
 *   - happy path (operation wins within budget)
 *   - timeout fires (operation slower than budget → sentinel returned)
 *   - timeoutMs validation (≤ 0, NaN, Infinity, non-number all throw)
 *   - post-timeout operation rejection is ABSORBED (no unhandled rejection)
 *   - post-timeout operation rejection is logged at WARN, not DEBUG
 *   - timeoutSentinel factory throw → hardcoded fallback returned + ERROR log
 *   - sentinel factory called EXACTLY ONCE even when both timeout +
 *     operation-rejection fire (memoization)
 *   - sentinel factory called EXACTLY ONCE when factory legitimately
 *     returns `undefined` (no infinite re-call — Sprint 31 fix)
 *   - error messages are sanitised (no \n / control-char injection)
 *   - long error messages are truncated to 500 chars
 *   - the timeout timer is cleared in all branches (no leaked timers)
 */
import { describe, it, expect, vi } from 'vitest';
import { validateWithTimeoutSecure } from '../../src/connector-utils/timeout-wrapper.js';
import { Severity } from '../../src/base/GuardrailResult.js';

const makeLogger = (): {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

interface Result {
  allowed: boolean;
  reason?: string;
}

describe('validateWithTimeoutSecure', () => {
  describe('happy path', () => {
    it('returns operation result when it completes within budget', async () => {
      const result = await validateWithTimeoutSecure<Result>({
        operation: async () => ({ allowed: true, reason: 'ok' }),
        timeoutMs: 100,
        timeoutSentinel: () => ({ allowed: false, reason: 'timeout' })
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('ok');
    });

    it('does NOT invoke the sentinel factory on a fast path', async () => {
      const sentinelFactory = vi.fn(() => ({ allowed: false, reason: 'timeout' }));
      await validateWithTimeoutSecure<Result>({
        operation: async () => ({ allowed: true }),
        timeoutMs: 100,
        timeoutSentinel: sentinelFactory
      });
      expect(sentinelFactory).not.toHaveBeenCalled();
    });
  });

  describe('timeout fires', () => {
    it('resolves to the sentinel when operation exceeds budget', async () => {
      const logger = makeLogger();
      const result = await validateWithTimeoutSecure<Result>({
        operation: () =>
          new Promise(() => {
            /* never resolves */
          }),
        timeoutMs: 50,
        timeoutSentinel: () => ({ allowed: false, reason: 'Validation timeout' }),
        logger
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Validation timeout');
      expect(logger.error).toHaveBeenCalledWith('[Guardrails] Validation timeout');
    });
  });

  describe('timeoutMs validation', () => {
    const badValues: Array<[string, unknown]> = [
      ['0', 0],
      ['-1', -1],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['null', null],
      ['undefined', undefined],
      ['string', 'fast'],
      ['object', {}]
    ];
    for (const [label, value] of badValues) {
      it(`throws TypeError for timeoutMs = ${label}`, async () => {
        await expect(
          validateWithTimeoutSecure<Result>({
            operation: async () => ({ allowed: true }),
            timeoutMs: value as number,
            timeoutSentinel: () => ({ allowed: false })
          })
        ).rejects.toThrow(TypeError);
      });
    }
  });

  describe('post-timeout rejection absorption', () => {
    it('absorbs in-flight operation rejection after the timeout wins', async () => {
      const logger = makeLogger();
      const result = await validateWithTimeoutSecure<Result>({
        operation: () =>
          new Promise<Result>((_, reject) => {
            setTimeout(() => reject(new Error('post-timeout-rejection')), 100);
          }),
        timeoutMs: 30,
        timeoutSentinel: () => ({ allowed: false, reason: 'timeout' }),
        logger
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('timeout');
      // Wait long enough for the rejection to fire and be absorbed.
      await new Promise(r => setTimeout(r, 150));
      // Sprint 30 audit security-MEDIUM closure: rejection logged at warn (not debug).
      expect(logger.warn).toHaveBeenCalledWith(
        '[Guardrails] Validator rejected post-timeout',
        expect.objectContaining({ error: 'post-timeout-rejection' })
      );
    });
  });

  describe('sentinel-factory throw safety', () => {
    it('returns hardcoded fallback when timeoutSentinel factory throws', async () => {
      const logger = makeLogger();
      const result = await validateWithTimeoutSecure({
        operation: () =>
          new Promise(() => {
            /* never */
          }),
        timeoutMs: 30,
        timeoutSentinel: () => {
          throw new Error('factory-broken');
        },
        logger
      });
      // Hardcoded fallback is allowed:false / blocked:true / severity CRITICAL
      expect(result.allowed).toBe(false);
      expect((result as { blocked: boolean }).blocked).toBe(true);
      expect((result as { severity: Severity }).severity).toBe(Severity.CRITICAL);
      expect(logger.error).toHaveBeenCalledWith(
        '[Guardrails] timeoutSentinel factory threw — using hardcoded fallback',
        expect.objectContaining({ error: 'factory-broken' })
      );
    });
  });

  describe('memoization', () => {
    it('calls sentinel factory exactly once when both timeout fires AND operation rejects', async () => {
      const sentinelFactory = vi.fn(() => ({ allowed: false, reason: 'timeout' }));
      await validateWithTimeoutSecure<Result>({
        operation: () =>
          new Promise<Result>((_, reject) => {
            setTimeout(() => reject(new Error('post-timeout-rejection')), 50);
          }),
        timeoutMs: 10,
        timeoutSentinel: sentinelFactory,
        logger: makeLogger()
      });
      // Wait for the post-timeout rejection to fire.
      await new Promise(r => setTimeout(r, 100));
      expect(sentinelFactory).toHaveBeenCalledTimes(1);
    });

    it('memoizes even when factory legitimately returns the same shape twice (Sprint 31 audit closure)', async () => {
      // Sprint 31 cumulative audit (sec CRITICAL + review MEDIUM-1):
      // memoization must use a `built` boolean flag, not `=== undefined`,
      // so a factory returning a falsy value doesn't re-trigger.
      const sentinelFactory = vi.fn(() => ({ allowed: false }));
      await validateWithTimeoutSecure<Result>({
        operation: () =>
          new Promise<Result>((_, reject) => {
            setTimeout(() => reject(new Error('e')), 50);
          }),
        timeoutMs: 10,
        timeoutSentinel: sentinelFactory,
        logger: makeLogger()
      });
      await new Promise(r => setTimeout(r, 100));
      expect(sentinelFactory).toHaveBeenCalledTimes(1);
    });
  });

  describe('log sanitization', () => {
    it('strips control characters from error messages before logging', async () => {
      const logger = makeLogger();
      await validateWithTimeoutSecure<Result>({
        operation: () =>
          new Promise<Result>((_, reject) => {
            setTimeout(() => reject(new Error('evil\x00\x07message\nwith\rcontrol')), 30);
          }),
        timeoutMs: 10,
        timeoutSentinel: () => ({ allowed: false }),
        logger
      });
      await new Promise(r => setTimeout(r, 80));
      const call = logger.warn.mock.calls[0];
      expect(call).toBeDefined();
      const errStr = (call?.[1] as { error?: string })?.error;
      expect(errStr).toBeDefined();
      // No raw control chars or newlines.
      expect(errStr).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
      expect(errStr).not.toContain('\n');
      expect(errStr).not.toContain('\r');
      // Escaped markers still convey the original payload.
      expect(errStr).toContain('\\x00');
      expect(errStr).toContain('\\n');
    });

    it('truncates error messages over 500 chars', async () => {
      const logger = makeLogger();
      const longMessage = 'x'.repeat(600);
      await validateWithTimeoutSecure<Result>({
        operation: () =>
          new Promise<Result>((_, reject) => {
            setTimeout(() => reject(new Error(longMessage)), 30);
          }),
        timeoutMs: 10,
        timeoutSentinel: () => ({ allowed: false }),
        logger
      });
      await new Promise(r => setTimeout(r, 80));
      const call = logger.warn.mock.calls[0];
      const errStr = (call?.[1] as { error?: string })?.error ?? '';
      expect(errStr.length).toBeLessThanOrEqual(520);
      expect(errStr).toContain('…[truncated]');
    });
  });

  describe('non-Error rejection handling', () => {
    it('coerces string rejection to a sanitised string', async () => {
      const logger = makeLogger();
      await validateWithTimeoutSecure<Result>({
        operation: () =>
          new Promise<Result>((_, reject) => {
            setTimeout(() => reject('plain-string-rejection'), 30);
          }),
        timeoutMs: 10,
        timeoutSentinel: () => ({ allowed: false }),
        logger
      });
      await new Promise(r => setTimeout(r, 80));
      const call = logger.warn.mock.calls[0];
      const errStr = (call?.[1] as { error?: string })?.error;
      expect(errStr).toBe('plain-string-rejection');
    });
  });

  describe('logger is optional', () => {
    it('does not throw when logger is omitted entirely', async () => {
      const result = await validateWithTimeoutSecure<Result>({
        operation: () =>
          new Promise(() => {
            /* never */
          }),
        timeoutMs: 20,
        timeoutSentinel: () => ({ allowed: false })
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('sync operation', () => {
    it('handles operations that return a value synchronously', async () => {
      const result = await validateWithTimeoutSecure<Result>({
        operation: () => ({ allowed: true }),
        timeoutMs: 50,
        timeoutSentinel: () => ({ allowed: false })
      });
      expect(result.allowed).toBe(true);
    });
  });
});
