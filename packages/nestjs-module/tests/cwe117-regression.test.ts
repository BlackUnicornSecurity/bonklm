/**
 * Sprint 40 connector CWE-117 sweep — nestjs-module regression.
 *
 * Two src sites carry attacker-influenced template-literal log calls
 * in `guardrails.interceptor.ts`:
 *   - line ~221 (Request blocked): `blocked.reason` from validator
 *     output; may carry matched-pattern content.
 *   - line ~296 (Response blocked): same shape on the response leg.
 *
 * Sprint 40 wraps both with `sanitizeMeta`. Two additional sites
 * (`logger.error('Error in custom error handler', { error })`)
 * upgraded from bare `{ error }` to `serializeError(error)` — Sprint
 * 33's canonical pattern, applied at connector level for the first
 * time.
 *
 * Sprint 42 (this file): upgraded from contract-lock-only to real
 * integration tests mirroring the elizaos `installSealedWrapMemory`
 * pattern. The integration suite instantiates `GuardrailsInterceptor`
 * directly with a spy on `Logger.prototype.warn`, drives the blocked-
 * input path with control-char-laden `blocked.reason`, and asserts
 * the spy captured sanitized output. Closes Sprint 40 architect HIGH-2
 * + code-reviewer MEDIUM + security S40-4 for the nestjs module.
 *
 * Per Sprint 41 lesson — "integration tests find what grep sweeps
 * miss" — this suite surfaced an unsanitized site at
 * `guardrails.interceptor.ts` line ~137 (`BadRequestException`'s
 * `error` body field embeds raw `blocked.reason` via
 * `GuardrailsService.getErrorMessage`). Fixed in the same commit as
 * this test.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';

import { Logger as NestLogger } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { sanitizeLogString, serializeError } from '@blackunicorn/bonklm';
import type { GuardrailResult, Validator } from '@blackunicorn/bonklm';

import { GuardrailsInterceptor } from '../src/guardrails.interceptor.js';
import { GuardrailsService } from '../src/guardrails.service.js';
import { USE_GUARDRAILS_KEY } from '../src/constants.js';
import type { UseGuardrailsDecoratorOptions } from '../src/types.js';

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

// Sprint 42 integration tests (architect HIGH-2 + code-reviewer MEDIUM
// + security S40-4 closure for nestjs): exercises the real
// GuardrailsInterceptor.intercept path with a hostile validator
// returning control-char-laden `blocked.reason`. Spies on
// NestLogger.prototype.warn to capture the interceptor's blocked-
// input warn output and verify the sanitization wrap fires.
describe('nestjs-module — Sprint 42 CWE-117 integration tests', () => {
  /**
   * Build a hostile validator that returns blocked with a
   * control-char-laden reason — mirrors what
   * `PromptInjectionValidator` can surface when the matched pattern
   * slice includes a literal CR/LF.
   */
  function hostileValidator(hostileReason: string): Validator {
    return {
      name: 'HostileReasonValidator',
      validate: vi.fn().mockReturnValue({
        allowed: false,
        blocked: true,
        severity: 'critical',
        risk_level: 'high',
        risk_score: 100,
        reason: hostileReason,
        findings: [],
        timestamp: Date.now(),
      } satisfies GuardrailResult),
    } as unknown as Validator;
  }

  /**
   * Build a minimal ExecutionContext mock for HTTP with the given
   * request body. The interceptor only consumes `getType()`,
   * `switchToHttp().getRequest()`, `getHandler()`, and `getClass()`.
   */
  function makeHttpContext(body: unknown): ExecutionContext {
    const handler = function dummyHandler() { /* test handler */ };
    class DummyController { /* test controller */ }
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ body }),
        getResponse: () => ({}),
        getNext: () => () => undefined,
      }),
      getHandler: () => handler,
      getClass: () => DummyController,
      getArgs: () => [],
      getArgByIndex: () => undefined,
    } as unknown as ExecutionContext;
  }

  /**
   * Build a Reflector that returns the supplied decorator options
   * from `getAllAndOverride(USE_GUARDRAILS_KEY, …)` — the only call
   * the interceptor makes during `intercept()`.
   */
  function makeReflector(options: UseGuardrailsDecoratorOptions): Reflector {
    return {
      getAllAndOverride: (key: string) =>
        key === USE_GUARDRAILS_KEY ? options : undefined,
      get: () => undefined,
    } as unknown as Reflector;
  }

  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Sprint 42 — the interceptor instantiates its own
    // `new NestLogger('GuardrailsInterceptor')` internally; it is NOT
    // an injectable. Spy on `Logger.prototype` so every instance
    // delegates to our captured spy.
    warnSpy = vi.spyOn(NestLogger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(NestLogger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('sanitizes hostile blocked.reason in the input-validation warn log path', async () => {
    const hostileReason =
      'Pattern matched: ignore_previous\nINJECTED:CRITICAL fake_alert';
    const service = new GuardrailsService({
      validators: [hostileValidator(hostileReason)],
      productionMode: false,
    });
    const interceptor = new GuardrailsInterceptor(
      makeReflector({ validateInput: true }),
      service
    );

    const ctx = makeHttpContext({ message: 'irrelevant — validator forces block' });
    const nextHandler: CallHandler = {
      handle: () => of({ response: 'should not run' }),
    };

    // The blocked input path emits a BadRequestException; awaiting
    // the observable rejects with it.
    let thrown: unknown = null;
    try {
      await firstValueFrom(interceptor.intercept(ctx, nextHandler));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();

    // The interceptor's `logger.warn(\`Request blocked: ${sanitizeMeta(...)}\`)`
    // must have fired with the hostile `\n` replaced by the literal
    // `\\n` marker — defeating phantom log lines in downstream
    // aggregators.
    expect(warnSpy).toHaveBeenCalled();
    const requestBlockedCall = warnSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].startsWith('Request blocked:')
    );
    expect(requestBlockedCall).toBeDefined();
    const msg = requestBlockedCall![0] as string;
    // The literal newline MUST NOT appear in the log message.
    expect(msg).not.toContain('\n');
    // The hostile substring remains readable (escaped form intact).
    expect(msg).toContain('INJECTED');
  });

  it('sanitizes hostile blocked.reason in the BadRequestException body (Sprint 42 surfaced site)', async () => {
    // Sprint 42 integration-test surfaced site:
    // `guardrails.interceptor.ts` line ~137 throws a
    // `BadRequestException({ error: getErrorMessage(inputResult), ...})`
    // where `getErrorMessage` returns `result.reason` raw in dev mode.
    // The exception body is serialized into the HTTP response — if a
    // downstream aggregator logs the response body, the raw `\n`
    // forges phantom log lines. Per Sprint 41 defensive-by-default:
    // sanitize at the boundary regardless of downstream context.
    const hostileReason =
      'Pattern matched: ignore_previous\nINJECTED:CRITICAL fake_severity';
    const service = new GuardrailsService({
      validators: [hostileValidator(hostileReason)],
      productionMode: false,
    });
    const interceptor = new GuardrailsInterceptor(
      makeReflector({ validateInput: true }),
      service
    );

    const ctx = makeHttpContext({ message: 'irrelevant — validator forces block' });
    const nextHandler: CallHandler = {
      handle: () => of({ response: 'should not run' }),
    };

    let thrown: unknown = null;
    try {
      await firstValueFrom(interceptor.intercept(ctx, nextHandler));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    // BadRequestException stores the body in `.getResponse()`.
    const body = (thrown as { getResponse?: () => unknown }).getResponse?.();
    expect(body).toBeDefined();
    const errorField = (body as { error?: string }).error;
    expect(typeof errorField).toBe('string');
    expect(errorField).not.toContain('\n');
    expect(errorField).toContain('INJECTED');
  });

  it('sanitizes hostile blocked.reason in the response-leg filtered body (Sprint 42 surfaced site)', async () => {
    // Sister test to the input-leg `getErrorMessage` wrap: the
    // response-validation leg also embeds `blocked.reason` in the
    // returned filtered body. Validator allows INPUT, blocks OUTPUT.
    const hostileReason =
      'Pattern matched: harmful_response\nINJECTED:CRITICAL fake_severity';
    const stateAwareValidator: Validator = {
      name: 'StateAwareValidator',
      validate: vi.fn((input: string) => {
        // Heuristic: input contains 'input-side', output is 'output-text'.
        const isInputLeg = String(input).includes('input-side');
        return {
          allowed: isInputLeg,
          blocked: !isInputLeg,
          severity: 'critical',
          risk_level: 'high',
          risk_score: 100,
          reason: isInputLeg ? '' : hostileReason,
          findings: [],
          timestamp: Date.now(),
        } satisfies GuardrailResult;
      }),
    } as unknown as Validator;

    const service = new GuardrailsService({
      validators: [stateAwareValidator],
      productionMode: false,
    });
    const interceptor = new GuardrailsInterceptor(
      makeReflector({ validateInput: true, validateOutput: true }),
      service
    );

    const ctx = makeHttpContext({ message: 'input-side payload' });
    const nextHandler: CallHandler = {
      handle: () => of({ text: 'output-text generated by handler' }),
    };

    const response = await firstValueFrom(
      interceptor.intercept(ctx, nextHandler)
    );

    // Filtered response shape: { error: 'Response filtered…', reason: sanitized }.
    const reasonField = (response as { reason?: string }).reason;
    expect(typeof reasonField).toBe('string');
    expect(reasonField).not.toContain('\n');
    expect(reasonField).toContain('INJECTED');
  });

  it('does not leak the raw reason in production-mode BadRequestException body', async () => {
    // Production mode: `getErrorMessage` returns the static
    // 'Content blocked by security policy' string — the raw reason
    // never reaches the body. Sanity-check this stays true post the
    // dev-mode wrap.
    const hostileReason =
      'Pattern matched: ignore_previous\nINJECTED:CRITICAL fake_severity';
    const service = new GuardrailsService({
      validators: [hostileValidator(hostileReason)],
      productionMode: true,
    });
    const interceptor = new GuardrailsInterceptor(
      makeReflector({ validateInput: true }),
      service
    );

    const ctx = makeHttpContext({ message: 'irrelevant — validator forces block' });
    const nextHandler: CallHandler = {
      handle: () => of({ response: 'should not run' }),
    };

    let thrown: unknown = null;
    try {
      await firstValueFrom(interceptor.intercept(ctx, nextHandler));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    const body = (thrown as { getResponse?: () => unknown }).getResponse?.();
    const errorField = (body as { error?: string }).error;
    expect(errorField).toBe('Content blocked by security policy');
    expect(errorField).not.toContain('INJECTED');
  });
});
