/**
 * @blackunicorn/bonklm-google-genai
 *
 * Google GenAI SDK (`@google/genai` v2.x) connector for BonkLM.
 *
 * Covers four entry points:
 *   - `wrapGenerateContent` — non-streaming text generation
 *   - `wrapGenerateContentStream` — streaming text generation
 *   - `wrapChat` — multi-turn chat sessions (sendMessage + stream)
 *   - `wrapLive` — Live API bidirectional sessions (text + transcription)
 *
 * Mode-agnostic — works with both Gemini Developer API
 * (`new GoogleGenAI({ apiKey })`) and Vertex AI
 * (`new GoogleGenAI({ vertexai: true, project, location })`).
 *
 * Why BonkLM is necessary alongside Google's built-in safety:
 * Google's `HarmCategory` filters are default-OFF for several
 * categories and the prompt-injection class is not in the harm
 * taxonomy. A "ignore previous instructions" payload passes Google's
 * default safety net unimpeded. This wrapper plugs that gap.
 *
 * @example Gemini Developer API
 * ```ts
 * import { GoogleGenAI } from '@google/genai';
 * import { createGuardedGoogleGenAI } from '@blackunicorn/bonklm-google-genai';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
 * const guarded = createGuardedGoogleGenAI(client, {
 *   validators: [new PromptInjectionValidator()],
 * });
 *
 * const r = await guarded.models.generateContent({
 *   model: 'gemini-2.0-flash',
 *   contents: userMessage,
 * });
 * ```
 *
 * @example Vertex AI mode
 * ```ts
 * const client = new GoogleGenAI({
 *   vertexai: true,
 *   project: 'my-project',
 *   location: 'us-central1',
 * });
 * const guarded = createGuardedGoogleGenAI(client, {
 *   validators: [new PromptInjectionValidator()],
 * });
 * ```
 *
 * @example Live API
 * ```ts
 * const session = await guarded.live.connect({
 *   model: 'gemini-2.0-flash-exp',
 *   callbacks: {
 *     onmessage: (msg) => console.log('safe message:', msg),
 *   },
 * });
 * // inputTranscription + outputTranscription text is validated before
 * // onmessage fires. Raw PCM audio is out of scope (Story 3.1).
 * ```
 */

export {
  createGuardedGoogleGenAI,
  wrapGenerateContent,
  wrapGenerateContentStream,
  wrapChat,
  wrapLive,
  contentsToText,
  responseToText,
  type GuardedGoogleGenAIClient,
} from './guarded-google-genai.js';

export type {
  GuardedGoogleGenAIOptions,
  GoogleGenAIModelsLike,
  GoogleGenAIChatsLike,
  GoogleGenAILiveLike,
  GoogleChatSessionLike,
  GoogleLiveSessionLike,
  GoogleGenerateContentParams,
  GoogleGenerateContentResponse,
  GoogleContentLike,
  GooglePartLike,
  GoogleLiveServerMessage,
} from './types.js';

export {
  DEFAULT_VALIDATION_TIMEOUT,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_INTERVAL,
} from './types.js';
