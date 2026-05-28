/**
 * tsd type-surface suite — @blackunicorn/bonklm-inference-providers (ST-04-239).
 *
 * Locks the published public type surface (imports by package name):
 * the three provider wrappers (`wrapGroq` / `wrapCerebras` /
 * `wrapTogether`) + the shared `wrapOpenAICompatibleClient` (all generic
 * over the client type `C`, which is preserved — proven by an exact
 * `expectType` plus a discriminating `expectAssignable`), the
 * `InferenceProviderBlockedError` class, and the request / response /
 * options / event types. Run via `pnpm exec tsd`. Lives in test-d/.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  wrapGroq,
  wrapCerebras,
  wrapTogether,
  wrapOpenAICompatibleClient,
  InferenceProviderBlockedError,
  type OpenAICompatibleClient,
  type OpenAIChatRequest,
  type OpenAIChatResponse,
  type OpenAIStreamChunk,
  type WrapInferenceOptions,
  type InferenceProviderName,
  type InferenceProviderBlockEvent
} from '@blackunicorn/bonklm-inference-providers';

declare const engine: GuardrailEngine;

// --- wrapGroq / wrapCerebras / wrapTogether: generic <C>, options.engine req
declare const client: OpenAICompatibleClient & { extra: number };
expectType<OpenAICompatibleClient & { extra: number }>(wrapGroq(client, { engine }));
expectType<OpenAICompatibleClient & { extra: number }>(wrapCerebras(client, { engine }));
expectType<OpenAICompatibleClient & { extra: number }>(wrapTogether(client, { engine }));
// Discriminating control: a preserved `C` carries `extra: number`; the
// widened base `OpenAICompatibleClient` has no `extra` member at all.
expectAssignable<{ extra: number }>(wrapGroq(client, { engine }));
expectError(wrapGroq(client)); // options required
expectError(wrapGroq(client, {})); // options.engine required
expectError(wrapGroq(client, { engine, onBlock: 'no' })); // bad option type

// --- wrapOpenAICompatibleClient: third `provider` arg -----------------------
expectType<OpenAICompatibleClient & { extra: number }>(wrapOpenAICompatibleClient(client, { engine }, 'groq'));
expectAssignable<{ extra: number }>(wrapOpenAICompatibleClient(client, { engine }, 'groq')); // C preserved
expectError(wrapOpenAICompatibleClient(client, { engine })); // provider required
expectError(wrapOpenAICompatibleClient(client, { engine }, 'openai')); // provider must be InferenceProviderName

// --- WrapInferenceOptions (engine required) ---------------------------------
expectAssignable<WrapInferenceOptions>({ engine });
expectAssignable<WrapInferenceOptions>({ engine, onBlock: () => {}, onError: () => {}, skipOutputValidation: true });
expectNotAssignable<WrapInferenceOptions>({}); // engine required

// --- InferenceProviderName union --------------------------------------------
expectAssignable<InferenceProviderName>('groq');
expectAssignable<InferenceProviderName>('cerebras');
expectAssignable<InferenceProviderName>('together');
expectNotAssignable<InferenceProviderName>('openai');

// --- InferenceProviderBlockEvent --------------------------------------------
expectAssignable<InferenceProviderBlockEvent>({ provider: 'groq', phase: 'input', reason: 'r' });
expectAssignable<InferenceProviderBlockEvent>({
  provider: 'together',
  phase: 'output',
  reason: 'r',
  category: 'c',
  severity: 'high'
});
expectNotAssignable<InferenceProviderBlockEvent>({ provider: 'groq', phase: 'middle', reason: 'r' }); // 'input' | 'output'
expectNotAssignable<InferenceProviderBlockEvent>({ provider: 'groq', phase: 'input' }); // reason required

// --- request / response / chunk / client structural types ------------------
expectAssignable<OpenAIChatRequest>({ messages: [{ role: 'user', content: 'hi' }] });
expectAssignable<OpenAIChatRequest>({ messages: [], stream: true, model: 'llama3' }); // index sig allows extras
expectNotAssignable<OpenAIChatRequest>({}); // messages required
declare const chatRes: OpenAIChatResponse;
declare const chunk: OpenAIStreamChunk;
declare const occ: OpenAICompatibleClient;
expectType<OpenAIChatResponse>(chatRes);
expectType<OpenAIStreamChunk>(chunk);
expectType<OpenAICompatibleClient['chat']['completions']['create']>(occ.chat.completions.create);

// --- InferenceProviderBlockedError class ------------------------------------
const err = new InferenceProviderBlockedError('blocked', 'groq', 'input', { category: 'c', severity: 'high' });
expectType<InferenceProviderBlockedError>(err);
expectType<'InferenceProviderBlockedError'>(err.name); // declared as a literal on the class
expectType<InferenceProviderName>(err.provider);
expectType<'input' | 'output'>(err.phase);
expectType<string | undefined>(err.category);
expectType<string | undefined>(err.severity);
expectError(new InferenceProviderBlockedError('blocked')); // provider + phase required
expectError(new InferenceProviderBlockedError('blocked', 'openai', 'input')); // provider union
expectError(new InferenceProviderBlockedError('blocked', 'groq', 'middle')); // phase union
