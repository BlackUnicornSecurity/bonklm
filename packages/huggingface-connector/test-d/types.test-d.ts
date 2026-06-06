/**
 * tsd type-surface suite — @blackunicorn/bonklm-huggingface (ST-04-205).
 *
 * Locks the published public type surface (imports by package name).
 * `createGuardedInference` is intentionally loose at the value level
 * (the HF inference client is `any`, return is `any` — it Proxy-wraps a
 * broad method set), so the connector's type contract lives in the
 * three exported interfaces: `GuardedHuggingFaceOptions`,
 * `TextGenerationOptions`, and `GuardedInferenceResult`. Those are
 * locked exhaustively here.
 *
 * Run via `pnpm exec tsd`. Lives in test-d/.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedInference,
  type GuardedHuggingFaceOptions,
  type TextGenerationOptions,
  type GuardedInferenceResult
} from '@blackunicorn/bonklm-huggingface';

// --- createGuardedInference: client required, options typed -----------------
expectType<any>(createGuardedInference({}, {}));
expectType<any>(createGuardedInference({})); // options optional
expectError(createGuardedInference()); // hfClient required
expectError(createGuardedInference({}, { productionMode: 'no' })); // option type enforced

// --- GuardedHuggingFaceOptions (every field optional) -----------------------
expectAssignable<GuardedHuggingFaceOptions>({});
expectAssignable<GuardedHuggingFaceOptions>({
  validators: [],
  guards: [],
  productionMode: true,
  validationTimeout: 1000,
  maxInputLength: 10000,
  allowedModels: ['meta-llama/*'],
  onInputBlocked: () => {},
  onOutputBlocked: () => {},
  onModelNotAllowed: () => {}
});
expectNotAssignable<GuardedHuggingFaceOptions>({ productionMode: 'no' });
expectNotAssignable<GuardedHuggingFaceOptions>({ maxInputLength: 'big' });

// --- TextGenerationOptions (model + inputs required) ------------------------
expectAssignable<TextGenerationOptions>({ model: 'gpt2', inputs: 'hello' });
expectAssignable<TextGenerationOptions>({
  model: 'gpt2',
  inputs: 'hello',
  parameters: { max_new_tokens: 32, temperature: 0.7, stop: ['\n'] },
  task: 'text-generation'
});
expectNotAssignable<TextGenerationOptions>({ model: 'gpt2' }); // inputs required
expectNotAssignable<TextGenerationOptions>({ inputs: 'hello' }); // model required

// --- GuardedInferenceResult (every field optional) --------------------------
expectAssignable<GuardedInferenceResult>({});
expectAssignable<GuardedInferenceResult>({ output: 'text' });
expectAssignable<GuardedInferenceResult>({ output: ['a', 'b'], filtered: true, tokensGenerated: 3, raw: {} });
expectNotAssignable<GuardedInferenceResult>({ tokensGenerated: 'three' }); // must be number
