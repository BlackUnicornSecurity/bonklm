/**
 * tsd type-surface suite — @blackunicorn/bonklm-anthropic (ST-04-200).
 *
 * Locks the published public type surface (imports by package name):
 * the `createGuardedAnthropic` factory + `messagesToText` helper, the
 * re-exported `StreamValidationError` class, and the options / message
 * / result types. The Anthropic SDK client type is referenced via
 * `Parameters<...>` so the suite does not depend on the SDK being
 * importable by name. Run via `pnpm exec tsd`. Lives in test-d/ (tsd's
 * default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedAnthropic,
  messagesToText,
  StreamValidationError,
  type GuardedAnthropicOptions,
  type GuardedMessageOptions,
  type GuardedMessage
} from '@blackunicorn/bonklm-anthropic';

// The first arg is the Anthropic SDK class — not re-exported, so reach it via Parameters<>.
declare const client: Parameters<typeof createGuardedAnthropic>[0];
declare const msgOpts: GuardedMessageOptions;

// --- createGuardedAnthropic: client required, options optional --------------
const guarded = createGuardedAnthropic(client);
createGuardedAnthropic(client, {
  validators: [],
  guards: [],
  validateStreaming: true,
  streamingMode: 'incremental'
});
expectError(createGuardedAnthropic()); // client required
expectError(createGuardedAnthropic(client, { streamingMode: 'nope' })); // 'incremental' | 'buffer'

// guarded.messages.create accepts GuardedMessageOptions and rejects partials.
void guarded.messages.create(msgOpts);
expectError(guarded.messages.create({})); // model + messages required

// --- messagesToText ---------------------------------------------------------
declare const msgs: Parameters<typeof messagesToText>[0];
expectType<string>(messagesToText(msgs));

// --- GuardedAnthropicOptions (every field optional) -------------------------
expectAssignable<GuardedAnthropicOptions>({});
expectAssignable<GuardedAnthropicOptions>({
  validators: [],
  guards: [],
  validateStreaming: false,
  streamingMode: 'buffer',
  maxStreamBufferSize: 1024,
  productionMode: true,
  validationTimeout: 1000,
  onBlocked: () => {},
  onStreamBlocked: () => {},
  enableRetry: true,
  maxRetries: 3
});
expectNotAssignable<GuardedAnthropicOptions>({ streamingMode: 'x' });
expectNotAssignable<GuardedAnthropicOptions>({ validateStreaming: 'yes' });

// --- GuardedMessageOptions (model + messages required) ----------------------
expectAssignable<GuardedMessageOptions>({ model: 'claude-3-opus', messages: [{ role: 'user', content: 'hi' }] });
expectAssignable<GuardedMessageOptions>({
  model: 'claude-3-opus',
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 10,
  stream: true,
  temperature: 0.5,
  top_p: 1,
  top_k: 40,
  system: 'be safe'
});
expectNotAssignable<GuardedMessageOptions>({ model: 'm' }); // messages required
expectNotAssignable<GuardedMessageOptions>({ messages: [{ role: 'user', content: 'hi' }] }); // model required

// --- GuardedMessage (content required) --------------------------------------
expectAssignable<GuardedMessage>({ content: 'text' });
expectAssignable<GuardedMessage>({ content: null, filtered: true });
expectNotAssignable<GuardedMessage>({}); // content required
expectNotAssignable<GuardedMessage>({ content: 123 });

// --- StreamValidationError (re-export class) --------------------------------
const sve = new StreamValidationError('stream blocked');
expectType<StreamValidationError>(sve);
expectType<string>(sve.reason);
expectType<boolean>(sve.blocked);
expectType<string>(sve.name);
new StreamValidationError('blocked', 'buffer_exceeded', true);
expectError(new StreamValidationError()); // message required
expectError(new StreamValidationError(123)); // message must be a string
