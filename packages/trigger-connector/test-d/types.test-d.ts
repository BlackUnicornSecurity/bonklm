/**
 * tsd type-surface suite — @blackunicorn/bonklm-trigger (ST-04-227).
 *
 * Locks the published public type surface (imports by package name): the
 * `withBonkLM` factory (returns the `{ middleware, onFailure }` bindings),
 * the `createBonklmTriggerHandle` + `getBonklmHandle` accessors, and the
 * handle / options / context / result types. Run via `pnpm exec tsd`. Lives
 * in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine, Validator, ValidatorInput } from '@blackunicorn/bonklm';
import {
  withBonkLM,
  createBonklmTriggerHandle,
  getBonklmHandle,
  type CreateBonklmTriggerHandleOptions,
  type BonklmTriggerBindings,
  type BonklmTriggerFailureParams,
  type BonklmTriggerHandle,
  type BonklmTriggerMiddlewareParams,
  type BonklmTriggerOptions,
  type BonklmTriggerRunContext,
  type BonklmTriggerValidateResult
} from '@blackunicorn/bonklm-trigger';

declare const engine: GuardrailEngine;
declare const validators: Validator[];

// --- withBonkLM: returns the { middleware, onFailure } bindings -------------
const bindings = withBonkLM({ validators });
expectType<BonklmTriggerBindings>(bindings);
expectType<(params: BonklmTriggerMiddlewareParams) => Promise<void>>(bindings.middleware);
expectType<(params: BonklmTriggerFailureParams) => Promise<void>>(bindings.onFailure);
expectError(withBonkLM({})); // validators required

// --- createBonklmTriggerHandle: direct handle constructor (needs runId) -----
expectType<BonklmTriggerHandle>(createBonklmTriggerHandle({ validators, runId: 'run_123' }));
expectError(createBonklmTriggerHandle({ validators })); // runId required
expectError(createBonklmTriggerHandle({ runId: 'run_123' })); // validators required

// --- getBonklmHandle: locals accessor, optional run-id assertion ------------
expectType<BonklmTriggerHandle>(getBonklmHandle());
expectType<BonklmTriggerHandle>(getBonklmHandle({ run: { id: 'run_123' } }));
expectError(getBonklmHandle({ run: {} })); // run.id required when ctx supplied

// --- BonklmTriggerHandle helper signatures ----------------------------------
declare const handle: BonklmTriggerHandle;
declare const vi: ValidatorInput;
expectType<Promise<BonklmTriggerValidateResult>>(handle.validateInput('prompt'));
expectType<Promise<BonklmTriggerValidateResult>>(handle.validateInput(vi)); // string | ValidatorInput
expectType<Promise<BonklmTriggerValidateResult>>(handle.validateOutput('generated'));
expectType<Promise<BonklmTriggerValidateResult>>(handle.validateToolArgs('search', { q: 'x' }));
expectError(handle.validateOutput(123)); // output must be a string

// --- BonklmTriggerValidateResult shape --------------------------------------
expectAssignable<BonklmTriggerValidateResult>({ blocked: false, allowed: true, results: [] });
expectAssignable<BonklmTriggerValidateResult>({ blocked: true, allowed: false, reason: 'r', results: [] });
expectNotAssignable<BonklmTriggerValidateResult>({ blocked: false, allowed: true }); // results required
expectNotAssignable<BonklmTriggerValidateResult>({ blocked: false, results: [] }); // allowed required

// --- options + context + params shapes --------------------------------------
expectAssignable<BonklmTriggerOptions>({ validators });
expectAssignable<BonklmTriggerOptions>({ validators, engine, cacheNamespace: 'app' });
// keyFn / logger / ttl slice types exercised via the option type's own fields.
declare const triggerOpts: BonklmTriggerOptions;
expectAssignable<BonklmTriggerOptions>({
  validators,
  keyFn: triggerOpts.keyFn,
  logger: triggerOpts.logger,
  defaultTtlMs: triggerOpts.defaultTtlMs,
  blockedTtlMs: triggerOpts.blockedTtlMs
});
expectNotAssignable<BonklmTriggerOptions>({}); // validators required

expectAssignable<CreateBonklmTriggerHandleOptions>({ validators, runId: 'r' });
expectNotAssignable<CreateBonklmTriggerHandleOptions>({ validators }); // runId required

expectAssignable<BonklmTriggerRunContext>({ run: { id: 'r', isReplay: false } });
expectNotAssignable<BonklmTriggerRunContext>({ run: { id: 'r' } }); // isReplay required

expectAssignable<BonklmTriggerMiddlewareParams>({ ctx: { run: { id: 'r', isReplay: false } }, next: async () => {} });
expectAssignable<BonklmTriggerFailureParams>({ ctx: { run: { id: 'r', isReplay: true } }, error: new Error('x') });
