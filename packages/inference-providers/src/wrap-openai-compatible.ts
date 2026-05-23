/**
 * Story 3.6 — Internal `wrapOpenAICompatibleClient` helper
 * ========================================================
 *
 * Shared core for `wrapGroq`, `wrapCerebras`, `wrapTogether`. All 3
 * providers ship OpenAI-compatible SDKs (`chat.completions.create`).
 * This helper:
 *   - Pre-validates every user-role message via `engine.validate`.
 *   - For non-streaming responses: post-validates the assistant content.
 *   - For streaming responses: wraps the AsyncIterable so each chunk's
 *     `delta.content` is buffered + validated periodically.
 *
 * Throws `InferenceProviderBlockedError` on BLOCK.
 */
import type {
  OpenAICompatibleClient,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIStreamChunk,
  WrapInferenceOptions,
  InferenceProviderName,
} from './types.js';
import { InferenceProviderBlockedError } from './types.js';

const STREAM_VALIDATE_INTERVAL_CHARS = 500;

/**
 * Wrap any OpenAI-compatible client. Returns the same client reference
 * with a proxied `chat.completions.create`.
 */
export function wrapOpenAICompatibleClient<C extends OpenAICompatibleClient>(
  client: C,
  options: WrapInferenceOptions,
  provider: InferenceProviderName
): C {
  if (!client || typeof client !== 'object') {
    throw new TypeError(`wrap${provider}: client is required.`);
  }
  if (!options?.engine) {
    throw new TypeError(`wrap${provider}: options.engine (GuardrailEngine) is required.`);
  }

  // Sprint 20 audit closure (convergent: security B-1 + code-reviewer
  // C3): double-wrap guard via Symbol watermark + return a SHALLOW
  // CLONE rather than mutating the caller's SDK client.
  const completionsAny = client.chat.completions as Record<symbol, boolean | undefined>;
  if (completionsAny[BONKLM_WRAPPED_SYMBOL]) {
    throw new TypeError(
      `wrap${provider}: this client is already wrapped by @blackunicorn/bonklm-inference-providers. ` +
        `Re-wrapping would silently double-validate every request — pass a fresh client OR use the existing wrapper.`
    );
  }

  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  const wrapped = async function create(
    request: OpenAIChatRequest
  ): Promise<OpenAIChatResponse | AsyncIterable<OpenAIStreamChunk>> {
    // Pre-validate user-role messages.
    await validateRequestMessages(provider, options, request);

    const result = await originalCreate(request);

    // Streaming path.
    if (request.stream === true && isAsyncIterable(result)) {
      return wrapStreamingResponse(provider, options, result);
    }

    // Non-streaming path.
    if (!options.skipOutputValidation && isChatResponse(result)) {
      const text = extractAssistantText(result);
      if (text.length > 0) {
        const r = await safeValidate(options, text);
        if (r.blocked) {
          fireBlock(options, provider, 'output', r);
          throw new InferenceProviderBlockedError(
            `${provider} output blocked: ${r.findings[0]?.description ?? 'unknown'}`,
            provider,
            'output',
            { category: r.findings[0]?.category, severity: String(r.severity) }
          );
        }
      }
    }

    return result;
  };

  // Shallow clone (project immutability rule + double-wrap defense).
  const wrappedCompletions = {
    ...client.chat.completions,
    create: wrapped as typeof client.chat.completions.create,
  } as Record<symbol, boolean | undefined> & typeof client.chat.completions;
  wrappedCompletions[BONKLM_WRAPPED_SYMBOL] = true;

  return {
    ...client,
    chat: {
      ...client.chat,
      completions: wrappedCompletions,
    },
  } as C;
}

const BONKLM_WRAPPED_SYMBOL: unique symbol = Symbol.for(
  '@blackunicorn/bonklm-inference-providers/wrapped'
);

// =============================================================================
// Helpers
// =============================================================================

async function validateRequestMessages(
  provider: InferenceProviderName,
  options: WrapInferenceOptions,
  request: OpenAIChatRequest
): Promise<void> {
  if (!Array.isArray(request.messages)) return;
  for (const msg of request.messages) {
    if (msg?.role !== 'user') continue;
    const content = typeof msg.content === 'string' ? msg.content : safeStringify(msg.content);
    if (content.length === 0) continue;
    const r = await safeValidate(options, content);
    if (r.blocked) {
      fireBlock(options, provider, 'input', r);
      throw new InferenceProviderBlockedError(
        `${provider} input blocked: ${r.findings[0]?.description ?? 'unknown'}`,
        provider,
        'input',
        { category: r.findings[0]?.category, severity: String(r.severity) }
      );
    }
  }
}

async function* wrapStreamingResponse(
  provider: InferenceProviderName,
  options: WrapInferenceOptions,
  stream: AsyncIterable<OpenAIStreamChunk>
): AsyncGenerator<OpenAIStreamChunk, void, unknown> {
  let buffered = '';
  let lastValidatedAt = 0;
  try {
    for await (const chunk of stream) {
      yield chunk;
      if (options.skipOutputValidation) continue;
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta !== 'string' || delta.length === 0) continue;
      buffered += delta;
      if (buffered.length - lastValidatedAt >= STREAM_VALIDATE_INTERVAL_CHARS) {
        lastValidatedAt = buffered.length;
        const r = await safeValidate(options, buffered);
        if (r.blocked) {
          fireBlock(options, provider, 'output', r);
          throw new InferenceProviderBlockedError(
            `${provider} streaming output blocked: ${r.findings[0]?.description ?? 'unknown'}`,
            provider,
            'output',
            { category: r.findings[0]?.category, severity: String(r.severity) }
          );
        }
      }
    }
    // Final validation pass on the accumulated buffer.
    if (!options.skipOutputValidation && buffered.length > lastValidatedAt) {
      const r = await safeValidate(options, buffered);
      if (r.blocked) {
        fireBlock(options, provider, 'output', r);
        throw new InferenceProviderBlockedError(
          `${provider} streaming output blocked (final): ${r.findings[0]?.description ?? 'unknown'}`,
          provider,
          'output',
          { category: r.findings[0]?.category, severity: String(r.severity) }
        );
      }
    }
  } catch (err) {
    if (err instanceof InferenceProviderBlockedError) throw err;
    // Sprint 20 audit closure (code-reviewer C4): provider-error path
    // must still run the final validation pass on the accumulated
    // buffer — otherwise an attacker can craft sub-threshold output +
    // rely on a provider abort to escape validation entirely.
    if (!options.skipOutputValidation && buffered.length > lastValidatedAt) {
      try {
        const r = await safeValidate(options, buffered);
        if (r.blocked) {
          fireBlock(options, provider, 'output', r);
          throw new InferenceProviderBlockedError(
            `${provider} streaming output blocked (provider-error final pass): ${r.findings[0]?.description ?? 'unknown'}`,
            provider,
            'output',
            { category: r.findings[0]?.category, severity: String(r.severity) }
          );
        }
      } catch (innerErr) {
        if (innerErr instanceof InferenceProviderBlockedError) throw innerErr;
        // Validator threw during the salvage pass — log + bubble the
        // ORIGINAL provider error so debuggability is preserved.
        safeOnError(options, innerErr);
      }
    }
    safeOnError(options, err);
    throw err;
  }
}

async function safeValidate(
  options: WrapInferenceOptions,
  content: string
): Promise<import('@blackunicorn/bonklm').EngineResult> {
  try {
    return await options.engine.validate(content);
  } catch (err) {
    safeOnError(options, err);
    // Re-throw so the caller's outer handler can decide.
    throw err;
  }
}

function isAsyncIterable<T>(x: unknown): x is AsyncIterable<T> {
  return x !== null && typeof x === 'object' && Symbol.asyncIterator in (x as object);
}

function isChatResponse(x: unknown): x is OpenAIChatResponse {
  return (
    x !== null &&
    typeof x === 'object' &&
    Array.isArray((x as OpenAIChatResponse).choices)
  );
}

function extractAssistantText(response: OpenAIChatResponse): string {
  const parts: string[] = [];
  for (const choice of response.choices ?? []) {
    const c = choice?.message?.content;
    if (typeof c === 'string') parts.push(c);
  }
  return parts.join(' ');
}

function safeStringify(args: unknown): string {
  try {
    const out = JSON.stringify(args);
    // Sprint 20 audit closure (security N-1): if JSON.stringify
    // returns undefined (caller passed undefined) OR empty after
    // serialization, fall through to the sentinel branch below — never
    // skip validation on '' / undefined.
    if (typeof out === 'string' && out.length > 0) return out;
    return '[unserializable]';
  } catch {
    return '';
  }
}

function fireBlock(
  options: WrapInferenceOptions,
  provider: InferenceProviderName,
  phase: 'input' | 'output',
  result: import('@blackunicorn/bonklm').EngineResult
): void {
  if (!options.onBlock) return;
  try {
    options.onBlock({
      provider,
      phase,
      reason: result.findings[0]?.description ?? 'unknown',
      category: result.findings[0]?.category,
      severity: String(result.severity),
    });
  } catch (err) {
    safeOnError(options, err);
  }
}

function safeOnError(options: WrapInferenceOptions, err: unknown): void {
  if (!options.onError) return;
  try {
    options.onError(err);
  } catch {
    /* swallow */
  }
}
