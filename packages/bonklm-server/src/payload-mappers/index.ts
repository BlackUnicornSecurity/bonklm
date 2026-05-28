/**
 * Payload mappers — convert LiteLLM / Portkey / OpenAI-compatible
 * request payloads into a shared string content for the BonkLM
 * validator pipeline.
 *
 * Per Story 2.13 AC: "LiteLLM payload + Portkey payload + OpenAI-
 * compatible all map to shared `Guard`."
 *
 * Each mapper returns the validator-targetable content string +
 * normalized metadata. The server then calls `engine.validate(content)`
 * on the mapped result.
 *
 * @package @blackunicorn/bonklm-server/payload-mappers
 */

/**
 * Normalized guard input shared by all three route mappers.
 */
export interface MappedGuardInput {
  /** Concatenated text content for the validator pipeline. */
  content: string;
  /** Normalized metadata for telemetry / request tagging. */
  metadata: {
    source: 'litellm' | 'portkey' | 'openai-compatible';
    model?: string;
    messageCount: number;
  };
}

/**
 * Generic OpenAI-compatible message shape used by chat-completion-
 * style endpoints (LiteLLM proxies them, Portkey wraps them, OpenAI
 * defines them).
 */
export interface OpenAIChatMessage {
  role?: string;
  content?: unknown;
}

/**
 * LiteLLM pre-call hook payload shape (closest approximation of the
 * published guardrail-plugin contract — LiteLLM's exact shape evolves
 * across versions; this mapper handles the common envelope).
 *
 * Reference: https://docs.litellm.ai/docs/proxy/guardrails/custom_guardrail
 */
export interface LiteLLMHookPayload {
  data?: {
    messages?: OpenAIChatMessage[];
    model?: string;
  };
  request_data?: {
    messages?: OpenAIChatMessage[];
    model?: string;
  };
  call_type?: string;
}

/**
 * Portkey guardrail webhook payload shape.
 *
 * Reference: https://portkey.ai/docs/product/guardrails/list-of-guardrail-checks/webhook-call
 */
export interface PortkeyHookPayload {
  request?: {
    json?: {
      messages?: OpenAIChatMessage[];
      model?: string;
      prompt?: string;
    };
    text?: string;
  };
  /** Alternative shape — flat at top level. */
  messages?: OpenAIChatMessage[];
  model?: string;
}

/**
 * OpenAI-compatible chat-completion request body (the standard
 * `POST /v1/chat/completions` shape used by every major LLM provider's
 * OpenAI-compat endpoint).
 */
export interface OpenAICompatPayload {
  messages?: OpenAIChatMessage[];
  model?: string;
  prompt?: string;
}

/**
 * Extract joined message content from an OpenAI-style messages array.
 * Each message's `content` may be a string OR a structured-content
 * array (multimodal). Text parts are joined with a space (defends
 * against split-text injection bypass — Sprint 15 Story 2.12 rev R1#4
 * pattern).
 */
function joinMessagesContent(messages: OpenAIChatMessage[] | undefined): string {
  if (!Array.isArray(messages)) return '';
  const parts: string[] = [];
  for (const m of messages) {
    const c = m.content;
    if (typeof c === 'string') {
      parts.push(c);
      continue;
    }
    if (Array.isArray(c)) {
      for (const sub of c) {
        if (
          typeof sub === 'object' &&
          sub !== null &&
          (sub as { type?: unknown }).type === 'text' &&
          typeof (sub as { text?: unknown }).text === 'string'
        ) {
          parts.push((sub as { text: string }).text);
        }
      }
    }
  }
  return parts.join(' ');
}

/**
 * Map a LiteLLM pre-call hook payload to the shared guard input.
 *
 * LiteLLM's payload structure varies by version + call type — both
 * `data.messages` and `request_data.messages` envelopes are
 * supported. Story 2.13 audit sec S7 closure: BOTH envelopes are
 * MERGED before validation (rather than taking the first non-empty
 * one) to defeat the confused-deputy attack where benign content
 * is placed in the read envelope while attack content is hidden in
 * the unread envelope.
 */
export function mapLiteLLM(payload: LiteLLMHookPayload): MappedGuardInput {
  const merged: OpenAIChatMessage[] = [...(payload.data?.messages ?? []), ...(payload.request_data?.messages ?? [])];
  const model = payload.data?.model ?? payload.request_data?.model;
  return {
    content: joinMessagesContent(merged),
    metadata: {
      source: 'litellm',
      model,
      messageCount: merged.length
    }
  };
}

/**
 * Map a Portkey webhook payload to the shared guard input.
 * Portkey wraps the request body under `request.json`; the mapper
 * also tolerates a flat top-level shape for guardrail-plugin
 * payloads that bypass the envelope.
 *
 * Story 2.13 audit sec S7 closure: both envelope shapes are MERGED
 * before validation (confused-deputy defense — see `mapLiteLLM`).
 */
export function mapPortkey(payload: PortkeyHookPayload): MappedGuardInput {
  const merged: OpenAIChatMessage[] = [...(payload.request?.json?.messages ?? []), ...(payload.messages ?? [])];
  const model = payload.request?.json?.model ?? payload.model;
  const prompt = payload.request?.json?.prompt ?? payload.request?.text;
  let content = joinMessagesContent(merged);
  if (content === '' && typeof prompt === 'string') content = prompt;
  return {
    content,
    metadata: {
      source: 'portkey',
      model,
      messageCount: merged.length
    }
  };
}

/**
 * Map an OpenAI-compatible chat-completion request to the shared
 * guard input. Handles both `messages: [...]` (chat completion) and
 * `prompt: string` (legacy completions) shapes.
 */
export function mapOpenAICompat(payload: OpenAICompatPayload): MappedGuardInput {
  const messages = payload.messages ?? [];
  let content = joinMessagesContent(messages);
  if (content === '' && typeof payload.prompt === 'string') {
    content = payload.prompt;
  }
  return {
    content,
    metadata: {
      source: 'openai-compatible',
      model: payload.model,
      messageCount: messages.length
    }
  };
}
