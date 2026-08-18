/**
 * tsd type-surface suite — @blackunicorn/bonklm-ollama (ST-04-204).
 *
 * Locks the published public type surface (imports by package name):
 * the `createGuardedOllama` factory + `messagesToText` helper, the
 * connector's own option / result types + `OllamaMessage`, the five
 * Ollama SDK types re-exported for convenience, the re-exported
 * `StreamValidationError` class, and the three numeric constants
 * (literal-vs-widened asserted exactly). The Ollama SDK client type is
 * referenced via `Parameters<...>`. Run via `pnpm exec tsd`. Lives in
 * test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedOllama,
  messagesToText,
  StreamValidationError,
  VALIDATION_INTERVAL,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
  type GuardedOllamaOptions,
  type GuardedChatOptions,
  type GuardedGenerateOptions,
  type GuardedChatResult,
  type GuardedGenerateResult,
  type OllamaMessage,
  type Message,
  type ChatRequest,
  type ChatResponse,
  type GenerateRequest,
  type GenerateResponse
} from '@blackunicorn/bonklm-ollama';

// The first arg is the Ollama SDK client — not re-exported, reach it via Parameters<>.
declare const client: Parameters<typeof createGuardedOllama>[0];

// --- createGuardedOllama: client required, options optional -----------------
createGuardedOllama(client);
createGuardedOllama(client, { validators: [], guards: [], validateStreaming: true, streamingMode: 'incremental' });
expectError(createGuardedOllama()); // client required
expectError(createGuardedOllama(client, { streamingMode: 'nope' })); // 'incremental' | 'buffer'

// --- messagesToText ---------------------------------------------------------
declare const msgs: Parameters<typeof messagesToText>[0];
expectType<string>(messagesToText(msgs));

// --- constants: literal for `= 10` / `= 30000`, widened for `a * b` ---------
expectType<10>(VALIDATION_INTERVAL);
expectType<number>(DEFAULT_MAX_BUFFER_SIZE); // `1024 * 1024` widens to number
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);

// --- OllamaMessage (role + content required) --------------------------------
expectAssignable<OllamaMessage>({ role: 'user', content: 'hi' });
expectAssignable<OllamaMessage>({ role: 'assistant', content: 'hi', thinking: 't', images: ['b64'], tool_name: 'fn' });
expectNotAssignable<OllamaMessage>({ role: 'user' }); // content required
expectNotAssignable<OllamaMessage>({}); // role + content required

// --- GuardedOllamaOptions (every field optional) ----------------------------
expectAssignable<GuardedOllamaOptions>({});
expectAssignable<GuardedOllamaOptions>({
  validators: [],
  guards: [],
  validateStreaming: false,
  streamingMode: 'buffer',
  maxStreamBufferSize: 4096,
  productionMode: true,
  validationTimeout: 1000,
  onBlocked: () => {},
  onStreamBlocked: () => {},
  enableRetry: false,
  maxRetries: 2
});
expectNotAssignable<GuardedOllamaOptions>({ streamingMode: 'x' });

// --- GuardedChatOptions (model + messages required) -------------------------
expectAssignable<GuardedChatOptions>({ model: 'llama3.1', messages: [{ role: 'user', content: 'hi' }] });
expectAssignable<GuardedChatOptions>({
  model: 'llama3.1',
  messages: [{ role: 'user', content: 'hi' }],
  stream: true,
  think: 'high',
  logprobs: true
});
expectNotAssignable<GuardedChatOptions>({ model: 'm' }); // messages required
expectNotAssignable<GuardedChatOptions>({ messages: [{ role: 'user', content: 'hi' }] }); // model required

// --- GuardedGenerateOptions (model + prompt required) -----------------------
expectAssignable<GuardedGenerateOptions>({ model: 'llama3.1', prompt: 'write a poem' });
expectAssignable<GuardedGenerateOptions>({ model: 'm', prompt: 'p', stream: true, suffix: 's', raw: false });
expectNotAssignable<GuardedGenerateOptions>({ model: 'm' }); // prompt required
expectNotAssignable<GuardedGenerateOptions>({ prompt: 'p' }); // model required

// --- GuardedChatResult (message required) / GuardedGenerateResult (response) -
expectAssignable<GuardedChatResult>({ message: { role: 'assistant', content: 'c' } });
expectAssignable<GuardedChatResult>({ message: { role: 'assistant', content: 'c' }, filtered: true, raw: {} });
expectNotAssignable<GuardedChatResult>({}); // message required
expectAssignable<GuardedGenerateResult>({ response: 'text' });
expectAssignable<GuardedGenerateResult>({ response: 'text', filtered: false, raw: {} });
expectNotAssignable<GuardedGenerateResult>({}); // response required
expectNotAssignable<GuardedGenerateResult>({ response: 123 });

// --- Ollama SDK types re-exported for convenience (lock the re-export) ------
declare const sdkMessage: Message;
declare const chatReq: ChatRequest;
declare const chatRes: ChatResponse;
declare const genReq: GenerateRequest;
declare const genRes: GenerateResponse;
expectType<Message>(sdkMessage);
expectType<ChatRequest>(chatReq);
expectType<ChatResponse>(chatRes);
expectType<GenerateRequest>(genReq);
expectType<GenerateResponse>(genRes);

// --- StreamValidationError (re-export class) --------------------------------
const sve = new StreamValidationError('stream blocked');
expectType<StreamValidationError>(sve);
expectType<string>(sve.reason);
expectType<boolean>(sve.blocked);
expectError(new StreamValidationError()); // message required
