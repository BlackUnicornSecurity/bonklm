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

interface LLMInstructionFields {
  functions?: unknown;
  response_format?: unknown;
  tool_choice?: unknown;
  tools?: unknown;
}

/**
 * LiteLLM pre-call hook payload shape (closest approximation of the
 * published guardrail-plugin contract — LiteLLM's exact shape evolves
 * across versions; this mapper handles the common envelope).
 *
 * Reference: https://docs.litellm.ai/docs/proxy/guardrails/custom_guardrail
 */
export interface LiteLLMHookPayload {
  data?: LLMInstructionFields & {
    messages?: OpenAIChatMessage[];
    model?: string;
  };
  request_data?: LLMInstructionFields & {
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
export interface PortkeyHookPayload extends LLMInstructionFields {
  eventType: 'beforeRequestHook' | 'afterRequestHook';
  request?: {
    json?: LLMInstructionFields & {
      messages?: OpenAIChatMessage[];
      model?: string;
      prompt?: string;
    };
    text?: string;
  };
  response?: {
    json?: unknown;
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
export interface OpenAICompatPayload extends LLMInstructionFields {
  messages?: OpenAIChatMessage[];
  model?: string;
  prompt?: string;
}

function messageArray(value: unknown, field: string): OpenAIChatMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} messages must be an array`);
  return value as OpenAIChatMessage[];
}

function mergeText(...values: unknown[]): string {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ');
}

function instructionText(fields: LLMInstructionFields | undefined): string {
  if (fields === undefined) return '';
  return [fields.tools, fields.functions, fields.tool_choice, fields.response_format]
    .filter(value => value !== undefined)
    .map(value => JSON.stringify(value))
    .join(' ');
}

function requireScannableText(source: string, content: string): string {
  if (content.trim() === '') throw new TypeError(`${source} payload must contain scannable text`);
  return content;
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
  for (const message of messages) {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      throw new TypeError('Each message must be an object');
    }
    const c = message.content;
    if (typeof c === 'string') {
      parts.push(c);
      continue;
    }
    if (Array.isArray(c)) {
      // Union scan (Sprint 15 rev R2#7): push the RAW text fields so
      // multi-line injection text inside array content matches with
      // real whitespace (JSON.stringify escapes \n to \\n and every
      // \s-separated phrase pattern silently missed it), AND keep the
      // full stringify copy so non-text parts (image_url etc.) stay
      // visible to secret/pattern scanning.
      const textParts = c
        .filter(
          (p): p is { type: 'text'; text: string } =>
            typeof p === 'object' &&
            p !== null &&
            !Array.isArray(p) &&
            (p as { type?: unknown }).type === 'text' &&
            typeof (p as { text?: unknown }).text === 'string'
        )
        .map(p => p.text);
      if (textParts.length > 0) parts.push(textParts.join(' '));
      parts.push(JSON.stringify(c));
      continue;
    }
    if (c !== undefined && c !== null) throw new TypeError('Each message content must be a string or array');
  }
  return parts.join(' ');
}

/**
 * Map a LiteLLM pre-call hook payload to the shared guard input.
 *
 * LiteLLM's payload structure varies by version + call type — both
 * `data.messages` and `request_data.messages` envelopes are
 * supported. BOTH envelopes are
 * MERGED before validation (rather than taking the first non-empty
 * one) to defeat the confused-deputy attack where benign content
 * is placed in the read envelope while attack content is hidden in
 * the unread envelope.
 */
export function mapLiteLLM(payload: LiteLLMHookPayload): MappedGuardInput {
  const merged = [
    ...messageArray(payload.data?.messages, 'LiteLLM data'),
    ...messageArray(payload.request_data?.messages, 'LiteLLM request_data')
  ];
  const model = payload.data?.model ?? payload.request_data?.model;
  return {
    content: requireScannableText(
      'LiteLLM',
      mergeText(joinMessagesContent(merged), instructionText(payload.data), instructionText(payload.request_data))
    ),
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
 * Both envelope shapes are MERGED
 * before validation (confused-deputy defense — see `mapLiteLLM`).
 */
export function mapPortkey(payload: PortkeyHookPayload): MappedGuardInput {
  if (payload.eventType !== 'beforeRequestHook' && payload.eventType !== 'afterRequestHook') {
    throw new TypeError('Portkey eventType must be beforeRequestHook or afterRequestHook');
  }
  if (payload.eventType === 'afterRequestHook') {
    const responseJson = payload.response?.json;
    const content = requireScannableText(
      'Portkey',
      mergeText(payload.response?.text, responseJson === undefined ? undefined : JSON.stringify(responseJson))
    );
    return {
      content,
      metadata: { source: 'portkey', messageCount: 0 }
    };
  }
  const merged = [
    ...messageArray(payload.request?.json?.messages, 'Portkey request.json'),
    ...messageArray(payload.messages, 'Portkey top-level')
  ];
  const model = payload.request?.json?.model ?? payload.model;
  const content = requireScannableText(
    'Portkey',
    mergeText(
      joinMessagesContent(merged),
      payload.request?.json?.prompt,
      payload.request?.text,
      instructionText(payload.request?.json),
      instructionText(payload)
    )
  );
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
  const messages = messageArray(payload.messages, 'OpenAI-compatible');
  const content = requireScannableText(
    'OpenAI-compatible',
    mergeText(joinMessagesContent(messages), payload.prompt, instructionText(payload))
  );
  return {
    content,
    metadata: {
      source: 'openai-compatible',
      model: payload.model,
      messageCount: messages.length
    }
  };
}
