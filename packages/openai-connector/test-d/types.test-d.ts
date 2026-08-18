/**
 * tsd type-surface suite — @blackunicorn/bonklm-openai (ST-04-201).
 *
 * Locks the published public type surface (imports by package name):
 * the `createGuardedOpenAI` factory + `messagesToText` helper, the
 * re-exported `StreamValidationError` class, the options / completion /
 * content types, and the three numeric constants (literal-vs-widened
 * is asserted exactly). The OpenAI SDK client type is referenced via
 * `Parameters<...>`. Run via `pnpm exec tsd`. Lives in test-d/.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedOpenAI,
  messagesToText,
  StreamValidationError,
  VALIDATION_INTERVAL,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
  type GuardedOpenAIOptions,
  type GuardedChatCompletionOptions,
  type GuardedChatCompletion,
  type MessageContent
} from '@blackunicorn/bonklm-openai';

// The first arg is the OpenAI SDK client — not re-exported, reach it via Parameters<>.
declare const client: Parameters<typeof createGuardedOpenAI>[0];

// --- createGuardedOpenAI: client required, options optional -----------------
createGuardedOpenAI(client);
createGuardedOpenAI(client, { validators: [], guards: [], validateStreaming: true, streamingMode: 'incremental' });
expectError(createGuardedOpenAI()); // client required
expectError(createGuardedOpenAI(client, { streamingMode: 'nope' })); // 'incremental' | 'buffer'

// --- messagesToText ---------------------------------------------------------
declare const msgs: Parameters<typeof messagesToText>[0];
expectType<string>(messagesToText(msgs));

// --- constants: literal preserved for `= 10` / `= 30000`, widened for `a * b`
expectType<10>(VALIDATION_INTERVAL);
expectType<number>(DEFAULT_MAX_BUFFER_SIZE); // `1024 * 1024` widens to number
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);

// --- GuardedOpenAIOptions (every field optional) ----------------------------
expectAssignable<GuardedOpenAIOptions>({});
expectAssignable<GuardedOpenAIOptions>({
  validators: [],
  guards: [],
  validateStreaming: true,
  streamingMode: 'buffer',
  maxStreamBufferSize: 2048,
  productionMode: false,
  validationTimeout: 5000,
  onBlocked: () => {},
  onStreamBlocked: () => {}
});
expectNotAssignable<GuardedOpenAIOptions>({ streamingMode: 'x' });
expectNotAssignable<GuardedOpenAIOptions>({ productionMode: 'no' });

// --- GuardedChatCompletionOptions (SDK params union — model+messages bound) -
declare const chatOpts: GuardedChatCompletionOptions;
expectType<GuardedChatCompletionOptions>(chatOpts);
expectNotAssignable<GuardedChatCompletionOptions>({}); // both union members require model + messages

// --- GuardedChatCompletion (content required) -------------------------------
expectAssignable<GuardedChatCompletion>({ content: 'text' });
expectAssignable<GuardedChatCompletion>({ content: null, filtered: true, raw: {} });
expectNotAssignable<GuardedChatCompletion>({}); // content required
expectNotAssignable<GuardedChatCompletion>({ content: 123 });

// --- MessageContent (string | ContentPart[]) --------------------------------
expectAssignable<MessageContent>('plain text');
expectAssignable<MessageContent>([{ type: 'text', text: 'x' }]);
expectAssignable<MessageContent>([{ type: 'image_url', image_url: { url: 'https://x' } }]);
expectNotAssignable<MessageContent>(123);
expectNotAssignable<MessageContent>([{ type: 'nope' }]); // type must be the ContentPart union

// --- StreamValidationError (re-export class) --------------------------------
const sve = new StreamValidationError('stream blocked');
expectType<StreamValidationError>(sve);
expectType<string>(sve.reason);
expectType<boolean>(sve.blocked);
expectError(new StreamValidationError()); // message required
