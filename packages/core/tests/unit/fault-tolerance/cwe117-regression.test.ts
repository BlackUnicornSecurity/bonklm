/**
 * Sprint 47 cross-subsystem CWE-117 sweep — fault-tolerance regression.
 *
 * Architect MEDIUM #6 closure from Sprint 46 audit. Two sites in
 * `RetryPolicy.ts` (lines ~167 + ~177) embedded raw `lastError.message`
 * in template-literal warn logs. `lastError` originates from upstream
 * provider callbacks (LLM API errors, network failures, vector-DB
 * timeouts) which can wrap user input — attacker-influenceable.
 *
 * `CircuitBreaker.ts:286` interpolates only numeric stat fields
 * (errorPercentage, failedRequests, totalRequests) — confirmed safe,
 * no fix needed.
 *
 * Sprint 47 wraps the 2 RetryPolicy sites with canonical
 * `serializeError(...).message` per Sprint 33 + Sprint 46 lesson
 * (don't double-wrap — `serializeError` sanitizes via sanitizeLogString
 * internally).
 */
import { describe, expect, it, vi } from 'vitest';

import { RetryPolicy, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('fault-tolerance — Sprint 47 CWE-117 sanitization contract', () => {
  function makeSpyLogger() {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  it('imports sanitizeMeta + serializeError from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes lastError.message at the non-retryable warn log site', async () => {
    const logger = makeSpyLogger();
    const policy = new RetryPolicy({
      maxAttempts: 1,
      logger,
      // Wide retryable list so an arbitrary Error name is treated as
      // non-retryable (forces the line-167 path).
      retryableErrors: ['NeverMatchesThisError'],
    });

    // Hostile error message — newline-laden provider error wrapping
    // user input.
    const hostileError = new Error('upstream rpc\nINJECTED:CRITICAL fake_retry_audit');

    const result = await policy.execute(async () => {
      throw hostileError;
    });

    expect(result.success).toBe(false);

    // The non-retryable warn fired with sanitized message in the
    // template literal.
    const nonRetryableCall = logger.warn.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('Non-retryable error')
    );
    expect(nonRetryableCall).toBeDefined();
    const msg = nonRetryableCall![0] as string;
    expect(msg).not.toContain('\n');
    expect(msg).toContain('INJECTED');
  });

  it('sanitizes lastError.message at the retry-attempt warn log site', async () => {
    const logger = makeSpyLogger();
    const policy = new RetryPolicy({
      maxAttempts: 3,
      logger,
      initialDelay: 1,
      maxDelay: 2,
    });

    // Use a message containing 'timeout' so isRetryableError returns
    // true (RetryPolicy.ts:225 — message-pattern retryability) AND
    // carries control chars for the CWE-117 assertion. The literal
    // `\n` triggers sanitization without preventing retry-classification.
    const hostileError = new Error('timeout\nINJECTED:fake_retry');

    await policy.execute(async () => {
      throw hostileError;
    });

    // The retry-attempt warn fires at least once before max-attempts hits.
    const retryCall = logger.warn.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('failed, retrying in')
    );
    expect(retryCall).toBeDefined();
    const msg = retryCall![0] as string;
    expect(msg).not.toContain('\n');
    expect(msg).toContain('INJECTED');
  });
});
