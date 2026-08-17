/**
 * tsd type-surface suite — @blackunicorn/bonklm-temporal (ST-04-223).
 *
 * Locks the published public type surface (imports by package name):
 * `createValidateInputActivity` (activity factory), the workflow-side
 * `guardrailGate` + `TemporalGuardrailBlockedError`, and the three activity
 * types. Mirrors the SDK split — the activity factory comes from the
 * activity module, the gate + error from the workflow module, both via the
 * single barrel. Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { Validator, ValidatorCache } from '@blackunicorn/bonklm';
import {
  createValidateInputActivity,
  guardrailGate,
  TemporalGuardrailBlockedError,
  type ValidateInputActivityArgs,
  type ValidateInputActivityResult,
  type ValidatorActivityConfig
} from '@blackunicorn/bonklm-temporal';

declare const validators: Validator[];
declare const cache: ValidatorCache;

// --- createValidateInputActivity: (args) => Promise<result> -----------------
const activity = createValidateInputActivity({ validators });
expectType<(args: ValidateInputActivityArgs) => Promise<ValidateInputActivityResult>>(activity);
expectType<Promise<ValidateInputActivityResult>>(activity({ content: 'hello' }));
expectType<Promise<ValidateInputActivityResult>>(activity({ content: 'hello', cacheNamespace: 'tenant-a' }));
expectError(createValidateInputActivity({})); // validators required
expectError(activity({})); // content required
expectError(activity({ content: 42 })); // content must be a string

// --- ValidatorActivityConfig shape ------------------------------------------
expectAssignable<ValidatorActivityConfig>({ validators });
expectAssignable<ValidatorActivityConfig>({ validators, cache });
expectNotAssignable<ValidatorActivityConfig>({}); // validators required

// --- ValidateInputActivityArgs / Result shapes ------------------------------
expectAssignable<ValidateInputActivityArgs>({ content: 'x' });
expectAssignable<ValidateInputActivityArgs>({ content: 'x', cacheNamespace: 'ns' });
expectNotAssignable<ValidateInputActivityArgs>({}); // content required
expectNotAssignable<ValidateInputActivityArgs>({ content: 1 }); // content is a string

expectAssignable<ValidateInputActivityResult>({ blocked: false });
expectAssignable<ValidateInputActivityResult>({
  blocked: true,
  reason: 'r',
  validatorName: 'v',
  category: 'c',
  severity: 'critical'
});
expectNotAssignable<ValidateInputActivityResult>({}); // blocked required

// --- guardrailGate: workflow-side throw helper, returns void ----------------
declare const result: ValidateInputActivityResult;
expectType<void>(guardrailGate(result));
expectError(guardrailGate({})); // requires a ValidateInputActivityResult

// --- TemporalGuardrailBlockedError class ------------------------------------
const err = new TemporalGuardrailBlockedError('blocked', 'JailbreakValidator', {
  category: 'jailbreak',
  severity: 'high'
});
expectType<TemporalGuardrailBlockedError>(err);
expectType<'TemporalGuardrailBlockedError'>(err.name);
expectType<string>(err.validatorName);
expectType<string | undefined>(err.category);
expectType<string | undefined>(err.severity);
expectError(new TemporalGuardrailBlockedError('blocked')); // validatorName required
