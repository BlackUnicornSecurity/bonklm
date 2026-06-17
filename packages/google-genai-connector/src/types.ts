/**
 * Google GenAI Connector Types
 * ============================
 * Public option / result types for the `@google/genai` v2 connector.
 */
import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';
import type { ClientSafeStreamOptions } from '@blackunicorn/bonklm/core/connector-utils';

/** Default validation timeout (ms). */
export const DEFAULT_VALIDATION_TIMEOUT = 30_000;
/** Default max buffer size for streaming validation (1MB). */
export const DEFAULT_MAX_BUFFER_SIZE = 1024 * 1024;
/** Default validation interval (chunks). */
export const DEFAULT_VALIDATION_INTERVAL = 10;

/**
 * Configuration for the Google GenAI guarded wrapper.
 *
 * The wrapper is shape-compatible with both the Gemini Developer API
 * (`new GoogleGenAI({ apiKey })`) and Vertex AI
 * (`new GoogleGenAI({ vertexai: true, project, location })`) modes —
 * mode is chosen on the caller's SDK constructor, not here.
 */
export interface GuardedGoogleGenAIOptions extends ClientSafeStreamOptions {
  /** Validators applied to input text + tool-call args + retrieved-doc-shaped responses. */
  validators?: Validator[];
  /** Guards applied to retrieved content (e.g. function-call arg strings). */
  guards?: Guard[];
  /** Logger instance. @default `createLogger('console')` */
  logger?: Logger;
  /**
   * Whether to validate streaming output chunks incrementally.
   * @default true
   */
  validateStreaming?: boolean;
  /**
   * Production mode flag — when true, error messages are generic
   * (no leakage of validator internals to clients).
   * @default `process.env.NODE_ENV === 'production'`
   */
  productionMode?: boolean;
  /** Per-validation timeout (ms). @default 30_000 */
  validationTimeout?: number;
  /** Max buffer size for streaming validation (bytes). @default 1MB */
  maxBufferSize?: number;
  /** Chunks-between-validation interval for streaming. @default 10 */
  validationInterval?: number;
  /** Callback when input is blocked. */
  onInputBlocked?: (result: GuardrailResult) => void;
  /** Callback when streaming output is blocked. */
  onStreamBlocked?: (accumulated: string, reason: string) => void;
  /**
   * Callback when a function-call's accumulated args trigger a block.
   * Function-call args are accumulated across partial stream chunks
   * BEFORE validation — Google streams the JSON args one fragment at
   * a time and a single chunk's content cannot be validated in
   * isolation.
   */
  onFunctionCallBlocked?: (functionName: string, args: unknown, result: GuardrailResult) => void;
}

/**
 * Minimal shape of `@google/genai` v2 models surface that the wrapper
 * relies on. Defined here so the connector does not need a hard
 * dependency on `@google/genai` at compile time — the SDK is a peer
 * dep and consumers pass their own instance.
 */
export interface GoogleGenAIModelsLike {
  generateContent(params: GoogleGenerateContentParams): Promise<GoogleGenerateContentResponse>;
  generateContentStream(
    params: GoogleGenerateContentParams
  ): Promise<AsyncIterable<GoogleGenerateContentResponse>> | AsyncIterable<GoogleGenerateContentResponse>;
}

export interface GoogleGenAIChatsLike {
  create(params: { model: string; history?: GoogleContentLike[] }): GoogleChatSessionLike;
}

export interface GoogleChatSessionLike {
  sendMessage(params: { message: string | GoogleContentLike }): Promise<GoogleGenerateContentResponse>;
  sendMessageStream(params: {
    message: string | GoogleContentLike;
  }): Promise<AsyncIterable<GoogleGenerateContentResponse>> | AsyncIterable<GoogleGenerateContentResponse>;
}

export interface GoogleGenAILiveLike {
  connect(params: {
    model: string;
    callbacks?: {
      onmessage?: (msg: GoogleLiveServerMessage) => void;
      onopen?: () => void;
      onclose?: (ev?: unknown) => void;
      onerror?: (err?: unknown) => void;
    };
  }): Promise<GoogleLiveSessionLike> | GoogleLiveSessionLike;
}

export interface GoogleLiveSessionLike {
  sendClientContent?(params: { turns: GoogleContentLike[] }): void | Promise<void>;
  sendRealtimeInput?(params: { text?: string; audio?: { data: string; mimeType: string } }): void | Promise<void>;
  /**
   * Story 1.7 audit-loop fix: Live API tool/function-call responses sent
   * BACK to the model carry attacker-influenced content (a compromised
   * tool returning a prompt-injection payload). Must be validated.
   */
  sendToolResponse?(params: {
    functionResponses: Array<{
      name: string;
      response?: Record<string, unknown>;
      id?: string;
    }>;
  }): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface GoogleGenerateContentParams {
  model: string;
  contents: string | GoogleContentLike | GoogleContentLike[];
  config?: Record<string, unknown>;
}

export interface GoogleContentLike {
  role?: 'user' | 'model' | 'system';
  parts?: GooglePartLike[];
}

export interface GooglePartLike {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response?: Record<string, unknown> };
  inlineData?: { mimeType: string; data: string };
}

export interface GoogleGenerateContentResponse {
  text?: string;
  candidates?: Array<{
    content?: GoogleContentLike;
    finishReason?: string;
  }>;
}

export interface GoogleLiveServerMessage {
  serverContent?: {
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: GoogleContentLike;
    turnComplete?: boolean;
  };
  toolCall?: { functionCalls?: Array<{ name: string; args?: Record<string, unknown> }> };
}
