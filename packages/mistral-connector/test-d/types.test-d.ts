/**
 * tsd type-surface suite — @blackunicorn/bonklm-mistral (ST-04-202).
 *
 * Locks the published public type surface (imports by package name):
 * the generic `wrapMistral` factory (client type `T` is preserved, not
 * widened — proven by an exact `expectType` plus a discriminating
 * `expectAssignable`), the `MistralGuardrailBlockedError` class, and
 * the engine / client / options / shape types. Run via `pnpm exec tsd`.
 * Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  wrapMistral,
  MistralGuardrailBlockedError,
  type MistralEngineLike,
  type MistralGuardrailBlockedErrorShape,
  type MistralLike,
  type WrapMistralOptions,
  type WrappedMistralClient
} from '@blackunicorn/bonklm-mistral';

declare const engine: GuardrailEngine;

// --- wrapMistral: generic <T extends MistralLike>, preserves the client type
declare const client: MistralLike & { extra: number };
expectType<MistralLike & { extra: number }>(wrapMistral(client, engine));
expectType<MistralLike & { extra: number }>(wrapMistral(client, engine, { defaultLocale: 'auto' }));
// Discriminating control: a preserved `T` carries `extra: number`; the
// widened base `MistralLike` would only expose `extra: unknown`.
expectAssignable<{ extra: number }>(wrapMistral(client, engine));
expectNotAssignable<{ extra: string }>(wrapMistral(client, engine));
expectError(wrapMistral(client)); // engine required (shape #1 — 2nd positional)
expectError(wrapMistral(client, engine, { validateInputs: 'yes' })); // bad option type

// --- MistralLike (index signature → {} assignable) --------------------------
expectAssignable<MistralLike>({});
expectAssignable<MistralLike>({ chat: {}, agents: {}, fim: {}, embeddings: {}, classifiers: {} });

// --- WrapMistralOptions (every field optional) ------------------------------
expectAssignable<WrapMistralOptions>({});
expectAssignable<WrapMistralOptions>({
  defaultLocale: 'en',
  enableModerateSecondOpinion: true,
  productionMode: false,
  validateInputs: true,
  validateOutputs: true,
  validateAllMessages: false
});
expectNotAssignable<WrapMistralOptions>({ validateInputs: 'no' });

// --- WrappedMistralClient (extends MistralLike + readonly raw) --------------
expectAssignable<WrappedMistralClient>({ raw: {} });
expectNotAssignable<WrappedMistralClient>({}); // raw required

// --- MistralEngineLike (Pick subset — a full engine satisfies it) -----------
expectAssignable<MistralEngineLike>(engine);

// --- MistralGuardrailBlockedError class -------------------------------------
const err = new MistralGuardrailBlockedError('chat:complete:input', 'reason', false);
expectType<MistralGuardrailBlockedError>(err);
expectType<string>(err.surface);
expectType<string | undefined>(err.reason);
expectAssignable<MistralGuardrailBlockedErrorShape>(err); // instance satisfies the structural shape
new MistralGuardrailBlockedError('agents:stream:output', undefined, true);
expectError(new MistralGuardrailBlockedError('s')); // reason + productionMode required
expectError(new MistralGuardrailBlockedError('s', 'r')); // productionMode required
