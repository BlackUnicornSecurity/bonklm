/**
 * tsd type-surface suite — @blackunicorn/bonklm-web-middleware-utils (ST-04-247).
 *
 * Locks the published public type surface (imports by package name, so it
 * resolves the package `types` entry exactly as a consumer would) and proves
 * the signatures reject misuse. Run with `pnpm exec tsd` from the package dir.
 * Lives in test-d/ (tsd's default dir) so vitest test files stay out of scope.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  runRequestValidation,
  runResponseValidation,
  getRequestBody,
  WebMiddlewareBlockedError,
  type RunValidationOptions,
  type RunValidationResult,
  type SupportedFramework,
  type RequestLike,
  type WebMiddlewareBlockEvent,
  type WebMiddlewarePhase
} from '@blackunicorn/bonklm-web-middleware-utils';

declare const engine: GuardrailEngine;

// --- runRequestValidation / runResponseValidation ---------------------------
expectType<Promise<RunValidationResult>>(runRequestValidation({ engine }, 'body'));
expectType<Promise<RunValidationResult>>(runRequestValidation({ engine, returnInsteadOfThrow: true }, 'body'));
expectType<Promise<RunValidationResult>>(runResponseValidation({ engine }, 'body'));
expectError(runRequestValidation({ engine })); // body is required
expectError(runRequestValidation({}, 'body')); // engine is required
expectError(runRequestValidation('body')); // options object, not a string

// --- getRequestBody ---------------------------------------------------------
declare const reqLike: RequestLike;
expectType<Promise<string>>(getRequestBody(reqLike, 'web'));
expectType<Promise<string>>(getRequestBody(reqLike, 'node'));
expectError(getRequestBody(reqLike)); // framework is required
expectError(getRequestBody(reqLike, 'express')); // not a SupportedFramework

// --- WebMiddlewareBlockedError ----------------------------------------------
const blocked = new WebMiddlewareBlockedError('reason', 'request');
expectAssignable<Error>(blocked);
expectType<'WebMiddlewareBlockedError'>(blocked.name);
expectType<WebMiddlewarePhase>(blocked.phase);
expectType<string | undefined>(blocked.category);
expectType<string | undefined>(blocked.severity);
expectType<WebMiddlewareBlockedError>(
  new WebMiddlewareBlockedError('reason', 'response', { category: 'c', severity: 's' })
);
expectError(new WebMiddlewareBlockedError('reason')); // phase is required
expectError(new WebMiddlewareBlockedError('reason', 'neither')); // phase must be a WebMiddlewarePhase

// --- exported type shapes ---------------------------------------------------
expectAssignable<RunValidationOptions>({ engine });
expectAssignable<RunValidationOptions>({
  engine,
  returnInsteadOfThrow: true,
  shouldValidate: body => body.length > 0,
  onBlock: event => void event,
  onError: err => void err
});
expectNotAssignable<RunValidationOptions>({}); // engine required

expectAssignable<RunValidationResult>({ blocked: false });
expectAssignable<RunValidationResult>({
  blocked: true,
  reason: 'r',
  category: 'c',
  severity: 's',
  excerpt: 'e',
  skipped: false
});

expectAssignable<SupportedFramework>('web');
expectAssignable<SupportedFramework>('elysia');
expectAssignable<SupportedFramework>('next-action');
expectAssignable<SupportedFramework>('node');
expectNotAssignable<SupportedFramework>('express');

expectAssignable<WebMiddlewarePhase>('request');
expectAssignable<WebMiddlewarePhase>('response');
expectNotAssignable<WebMiddlewarePhase>('both');

expectAssignable<RequestLike>({ text: () => Promise.resolve('x') });
expectAssignable<RequestLike>({ body: { any: 'shape' } });

expectAssignable<WebMiddlewareBlockEvent>({ kind: 'web-middleware', phase: 'request', reason: 'r' });
expectNotAssignable<WebMiddlewareBlockEvent>({ kind: 'other', phase: 'request', reason: 'r' });
