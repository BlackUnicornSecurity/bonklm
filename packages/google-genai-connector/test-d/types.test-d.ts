/**
 * tsd type-surface suite — @blackunicorn/bonklm-google-genai (ST-04-203).
 *
 * Heaviest provider surface (22 symbols). Locks the published public
 * type surface (imports by package name): the four `wrap*` factories +
 * the one-call `createGuardedGoogleGenAI`, the `contentsToText` /
 * `responseToText` helpers, the `GuardedGoogleGenAIClient` result type,
 * the ten `Google*Like` / params / response structural types, and the
 * three numeric constants (literal-vs-widened asserted exactly). Run
 * via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedGoogleGenAI,
  wrapGenerateContent,
  wrapGenerateContentStream,
  wrapChat,
  wrapLive,
  contentsToText,
  responseToText,
  DEFAULT_VALIDATION_TIMEOUT,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_INTERVAL,
  type GuardedGoogleGenAIClient,
  type GuardedGoogleGenAIOptions,
  type GoogleGenAIModelsLike,
  type GoogleGenAIChatsLike,
  type GoogleGenAILiveLike,
  type GoogleChatSessionLike,
  type GoogleLiveSessionLike,
  type GoogleGenerateContentParams,
  type GoogleGenerateContentResponse,
  type GoogleContentLike,
  type GooglePartLike,
  type GoogleLiveServerMessage
} from '@blackunicorn/bonklm-google-genai';

declare const models: GoogleGenAIModelsLike;
declare const chats: GoogleGenAIChatsLike;
declare const live: GoogleGenAILiveLike;
declare const session: GoogleChatSessionLike;
declare const params: GoogleGenerateContentParams;
declare const resp: GoogleGenerateContentResponse;

// --- wrap* factories return the matching SDK-surface method type ------------
expectType<GoogleGenAIModelsLike['generateContent']>(wrapGenerateContent(models));
expectType<GoogleGenAIModelsLike['generateContentStream']>(wrapGenerateContentStream(models));
expectType<GoogleGenAIChatsLike['create']>(wrapChat(chats));
expectType<GoogleGenAILiveLike['connect']>(wrapLive(live));
wrapGenerateContent(models, { validators: [], validateStreaming: true });
expectError(wrapGenerateContent(models, { validateStreaming: 'x' }));
expectError(wrapGenerateContent()); // models required

// --- createGuardedGoogleGenAI: one-call wrap → GuardedGoogleGenAIClient ------
declare const client: Parameters<typeof createGuardedGoogleGenAI>[0];
expectType<GuardedGoogleGenAIClient>(createGuardedGoogleGenAI(client));
expectType<GuardedGoogleGenAIClient>(createGuardedGoogleGenAI(client, { productionMode: true }));
expectError(createGuardedGoogleGenAI()); // client required
// Drill the result's required namespaces so a dropped/renamed field is caught.
declare const guardedClient: GuardedGoogleGenAIClient;
expectType<GoogleGenAIModelsLike['generateContent']>(guardedClient.models.generateContent);
expectType<GoogleGenAIModelsLike['generateContentStream']>(guardedClient.models.generateContentStream);
expectType<GoogleGenAIChatsLike['create']>(guardedClient.chats.create);
expectType<GoogleGenAILiveLike['connect']>(guardedClient.live.connect);

// --- contentsToText / responseToText ----------------------------------------
expectType<string>(contentsToText(params.contents));
expectType<string>(contentsToText('plain'));
expectType<string>(responseToText(resp));
expectType<string>(responseToText(undefined));

// --- constants: literal for `= 30_000` / `= 10`, widened for `a * b` --------
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);
expectType<number>(DEFAULT_MAX_BUFFER_SIZE); // `1024 * 1024` widens to number
expectType<10>(DEFAULT_VALIDATION_INTERVAL);

// --- GuardedGoogleGenAIOptions (every field optional) -----------------------
expectAssignable<GuardedGoogleGenAIOptions>({});
expectAssignable<GuardedGoogleGenAIOptions>({
  validators: [],
  guards: [],
  validateStreaming: true,
  productionMode: false,
  validationTimeout: 1000,
  maxBufferSize: 2048,
  validationInterval: 5,
  onInputBlocked: () => {},
  onStreamBlocked: () => {},
  onFunctionCallBlocked: () => {}
});
expectNotAssignable<GuardedGoogleGenAIOptions>({ validateStreaming: 'x' });

// --- GoogleGenAIModelsLike / Chats / Live method shapes ---------------------
expectType<(params: GoogleGenerateContentParams) => Promise<GoogleGenerateContentResponse>>(models.generateContent);
expectType<GoogleChatSessionLike>(chats.create({ model: 'gemini-2.0-flash' }));
declare const liveLike: GoogleGenAILiveLike;
expectType<GoogleGenAILiveLike>(liveLike);

// --- GoogleGenerateContentParams (model + contents required) ----------------
expectAssignable<GoogleGenerateContentParams>({ model: 'gemini-2.0-flash', contents: 'hi' });
expectAssignable<GoogleGenerateContentParams>({ model: 'm', contents: [{ role: 'user', parts: [{ text: 'x' }] }] });
expectNotAssignable<GoogleGenerateContentParams>({ model: 'm' }); // contents required
expectNotAssignable<GoogleGenerateContentParams>({ contents: 'x' }); // model required

// --- GoogleContentLike / GooglePartLike -------------------------------------
expectAssignable<GoogleContentLike>({});
expectAssignable<GoogleContentLike>({ role: 'user', parts: [{ text: 'x' }] });
expectNotAssignable<GoogleContentLike>({ role: 'invalid' }); // 'user' | 'model' | 'system'
expectAssignable<GooglePartLike>({});
expectAssignable<GooglePartLike>({ text: 'x' });
expectAssignable<GooglePartLike>({ functionCall: { name: 'fn', args: { a: 1 } } });

// --- GoogleGenerateContentResponse (all optional) ---------------------------
expectAssignable<GoogleGenerateContentResponse>({});
expectAssignable<GoogleGenerateContentResponse>({ text: 'x', candidates: [{ finishReason: 'STOP' }] });

// --- GoogleChatSessionLike / GoogleLiveSessionLike --------------------------
expectType<GoogleChatSessionLike['sendMessage']>(session.sendMessage);
expectAssignable<GoogleLiveSessionLike>({}); // all methods optional

// --- GoogleLiveServerMessage (all optional) ---------------------------------
expectAssignable<GoogleLiveServerMessage>({});
expectAssignable<GoogleLiveServerMessage>({
  serverContent: { inputTranscription: { text: 't' }, turnComplete: true },
  toolCall: { functionCalls: [{ name: 'fn' }] }
});
