/**
 * tsd type-surface suite — @blackunicorn/bonklm-restate (ST-04-222).
 *
 * Locks the published public type surface (imports by package name):
 * `withRestateGuardrails` (generic handler-preserving), the
 * `RestateGuardrailBlockedError` class, and the `RestateMiddlewareOptions` +
 * `RestateGuardrailBlockEvent` types. Run via `pnpm exec tsd`. Lives in
 * test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { Validator, ValidatorCache } from '@blackunicorn/bonklm';
import {
  withRestateGuardrails,
  RestateGuardrailBlockedError,
  type RestateMiddlewareOptions,
  type RestateGuardrailBlockEvent
} from '@blackunicorn/bonklm-restate';

declare const validators: Validator[];
declare const cache: ValidatorCache;

// --- withRestateGuardrails: preserves the wrapped handler's (ctx, in, out) --
declare const handler: (
  ctx: { run?: <T>(name: string, fn: () => Promise<T>) => Promise<T> },
  input: string
) => Promise<number>;
const wrapped = withRestateGuardrails(handler, { validators });
expectType<typeof handler>(wrapped);
// Negative control: widening the output (Promise<string>) must NOT stay
// assignable to the original handler — proves the wrapper preserves `Out`.
declare const handlerWrongOut: (ctx: Parameters<typeof handler>[0], input: string) => Promise<string>;
expectNotAssignable<typeof handler>(withRestateGuardrails(handlerWrongOut, { validators }));
expectError(withRestateGuardrails(handler, {})); // validators required
expectError(withRestateGuardrails(handler, { validators, cache: 'nope' })); // cache must be ValidatorCache

// --- RestateMiddlewareOptions shape -----------------------------------------
expectAssignable<RestateMiddlewareOptions>({ validators });
expectAssignable<RestateMiddlewareOptions>({
  validators,
  cache,
  journalKeySuffix: 'orders',
  lastDecisionStateKey: 'bonklm:last',
  onBlock: _event => {},
  onError: _err => {}
});
expectAssignable<RestateMiddlewareOptions>({ validators, lastDecisionStateKey: false }); // opt-out arm
expectNotAssignable<RestateMiddlewareOptions>({}); // validators required
expectNotAssignable<RestateMiddlewareOptions>({ validators, lastDecisionStateKey: true }); // string | false only

// --- RestateGuardrailBlockEvent shape (kind + runtime discriminators) -------
expectAssignable<RestateGuardrailBlockEvent>({
  kind: 'durable-exec',
  runtime: 'restate',
  reason: 'r',
  validatorName: 'PromptInjectionValidator'
});
expectNotAssignable<RestateGuardrailBlockEvent>({ kind: 'voice', runtime: 'restate', reason: 'r', validatorName: 'v' });
expectNotAssignable<RestateGuardrailBlockEvent>({
  kind: 'durable-exec',
  runtime: 'temporal',
  reason: 'r',
  validatorName: 'v'
});
expectNotAssignable<RestateGuardrailBlockEvent>({ kind: 'durable-exec', runtime: 'restate', reason: 'r' }); // validatorName required

// --- RestateGuardrailBlockedError class -------------------------------------
const err = new RestateGuardrailBlockedError('blocked', 'PromptInjectionValidator', {
  category: 'injection',
  severity: 'critical'
});
expectType<RestateGuardrailBlockedError>(err);
expectType<'RestateGuardrailBlockedError'>(err.name);
expectType<string>(err.validatorName);
expectType<string | undefined>(err.category);
expectType<string | undefined>(err.severity);
expectError(new RestateGuardrailBlockedError('blocked')); // validatorName required
