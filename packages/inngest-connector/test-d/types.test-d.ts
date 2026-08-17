/**
 * tsd type-surface suite — @blackunicorn/bonklm-inngest (ST-04-226).
 *
 * Locks the published public type surface (imports by package name): the
 * `bonklmInngestMiddleware` factory (returns an Inngest BaseMiddleware
 * subclass), the `createBonklmInngestContextSurface` constructor, the
 * `StepRunner` structural type, and the context-surface / result / options
 * types. Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { Middleware } from 'inngest';
import type { GuardrailEngine, Validator, ValidatorInput } from '@blackunicorn/bonklm';
import {
  bonklmInngestMiddleware,
  createBonklmInngestContextSurface,
  type StepRunner,
  type BonklmInngestContextSurface,
  type BonklmInngestMiddlewareOptions,
  type BonklmInngestValidateResult
} from '@blackunicorn/bonklm-inngest';

declare const engine: GuardrailEngine;
declare const validators: Validator[];
declare const step: StepRunner;

// --- bonklmInngestMiddleware: returns an Inngest BaseMiddleware subclass -----
expectType<typeof Middleware.BaseMiddleware>(bonklmInngestMiddleware({ validators }));
expectError(bonklmInngestMiddleware({})); // validators required

// --- createBonklmInngestContextSurface --------------------------------------
expectType<BonklmInngestContextSurface>(createBonklmInngestContextSurface(step, { validators }));
expectError(createBonklmInngestContextSurface(step, {})); // validators required
expectError(createBonklmInngestContextSurface({}, { validators })); // step must be a StepRunner

// --- StepRunner.run is generic over the handler's resolved value ------------
expectType<Promise<number>>(step.run('id', () => 1));
expectType<Promise<string>>(step.run('id', async () => 'x'));

// --- BonklmInngestContextSurface helper signatures --------------------------
declare const surface: BonklmInngestContextSurface;
declare const vi: ValidatorInput;
expectType<Promise<BonklmInngestValidateResult>>(surface.validateInput('prompt'));
expectType<Promise<BonklmInngestValidateResult>>(surface.validateInput(vi)); // string | ValidatorInput
expectType<Promise<BonklmInngestValidateResult>>(surface.validateOutput('generated'));
expectType<Promise<BonklmInngestValidateResult>>(surface.validateToolArgs('search', { q: 'x' }));
expectError(surface.validateOutput(123)); // output must be a string
expectError(surface.validateToolArgs(123, {})); // toolName must be a string

// --- BonklmInngestValidateResult shape --------------------------------------
expectAssignable<BonklmInngestValidateResult>({ blocked: false, allowed: true, results: [] });
expectAssignable<BonklmInngestValidateResult>({ blocked: true, allowed: false, reason: 'r', results: [] });
expectNotAssignable<BonklmInngestValidateResult>({ blocked: false, allowed: true }); // results required
expectNotAssignable<BonklmInngestValidateResult>({ blocked: false, results: [] }); // allowed required

// --- BonklmInngestMiddlewareOptions shape -----------------------------------
expectAssignable<BonklmInngestMiddlewareOptions>({ validators });
expectAssignable<BonklmInngestMiddlewareOptions>({
  validators,
  engine,
  defaultTtlMs: 1000,
  blockedTtlMs: 60_000,
  cacheNamespace: 'app',
  stepNamePrefix: 'guard'
});
// keyFn + logger are optional slice types — exercise them via the option
// type's own field types so a regression in either is caught.
declare const inngestOpts: BonklmInngestMiddlewareOptions;
expectAssignable<BonklmInngestMiddlewareOptions>({ validators, keyFn: inngestOpts.keyFn, logger: inngestOpts.logger });
expectNotAssignable<BonklmInngestMiddlewareOptions>({}); // validators required
