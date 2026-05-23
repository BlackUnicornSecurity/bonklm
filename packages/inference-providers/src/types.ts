/**
 * Story 3.6 — inference-providers types
 * =======================================
 *
 * OpenAI-compatible client structural typing. All 3 providers (Groq,
 * Cerebras, Together) expose nearly-identical `chat.completions.create`
 * surface; we wrap them via a shared internal helper.
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';

/**
 * OpenAI-shape chat completion request — the minimum subset we
 * validate (`messages`). Provider-specific extras (`model`,
 * `temperature`, etc.) pass through unchanged.
 */
export interface OpenAIChatRequest {
  messages: Array<{ role: string; content: string | unknown }>;
  stream?: boolean;
  [k: string]: unknown;
}

/**
 * OpenAI-shape non-streaming chat completion response chunk.
 */
export interface OpenAIChatResponse {
  choices: Array<{
    message?: { role: string; content: string | null };
    delta?: { role?: string; content?: string | null };
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

/**
 * OpenAI-shape streaming chunk — Story 3.6 AC smoke-test asserts
 * `chunk.choices[0].delta.content`.
 */
export interface OpenAIStreamChunk {
  choices: Array<{
    delta?: { role?: string; content?: string | null };
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

/**
 * Structural type for an OpenAI-compatible client. All 3 supported
 * providers (Groq, Cerebras, Together) match this surface — but we
 * type via the union of "expected method" rather than the SDK class
 * to keep the connector peer-optional.
 */
export interface OpenAICompatibleClient {
  chat: {
    completions: {
      create: (
        request: OpenAIChatRequest
      ) => Promise<OpenAIChatResponse | AsyncIterable<OpenAIStreamChunk>>;
    };
  };
}

export type InferenceProviderName = 'groq' | 'cerebras' | 'together';

export interface InferenceProviderBlockEvent {
  provider: InferenceProviderName;
  phase: 'input' | 'output';
  reason: string;
  category?: string;
  severity?: string;
}

export interface WrapInferenceOptions {
  engine: GuardrailEngine;
  /** Fires on BLOCK (input or output). */
  onBlock?: (event: InferenceProviderBlockEvent) => void;
  /** Error sink for validator exceptions. */
  onError?: (err: unknown) => void;
  /**
   * Skip output validation. Defaults to FALSE (output IS validated by
   * default). For low-latency streaming, set true and rely on input-
   * side filtering only.
   */
  skipOutputValidation?: boolean;
}

export class InferenceProviderBlockedError extends Error {
  override readonly name = 'InferenceProviderBlockedError';
  readonly provider: InferenceProviderName;
  readonly phase: 'input' | 'output';
  readonly category?: string;
  readonly severity?: string;

  constructor(
    message: string,
    provider: InferenceProviderName,
    phase: 'input' | 'output',
    extra?: { category?: string; severity?: string }
  ) {
    super(message);
    this.provider = provider;
    this.phase = phase;
    this.category = extra?.category;
    this.severity = extra?.severity;
  }
}
