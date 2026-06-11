/**
 * OpenAI SDK Guarded Wrapper
 * ==========================
 *
 * Provides security guardrails for OpenAI SDK operations.
 *
 * Security Features:
 * - SEC-002: Incremental stream validation with early termination
 * - SEC-003: Max buffer size enforcement to prevent DoS
 * - SEC-006: Complex message content handling (arrays, images, structured data)
 * - SEC-007: Production mode error messages
 * - SEC-008: Validation timeout via validateWithTimeoutSecure (Sprint 30)
 * - DEV-001: Correct GuardrailEngine.validate() API (string context)
 * - DEV-002: Proper logger integration
 *
 * @package @blackunicorn/bonklm-openai
 */

import type OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageParam
} from 'openai/resources/chat/completions';
import {
  createLogger,
  createResult,
  GuardrailEngine,
  type GuardrailResult,
  type Logger,
  sanitizeMeta,
  Severity,
  validateWithTimeoutSecure
} from '@blackunicorn/bonklm';
import type {
  GuardedChatCompletion,
  GuardedChatCompletionOptions,
  GuardedOpenAIOptions,
  MessageContent
} from './types.js';
import { DEFAULT_MAX_BUFFER_SIZE, DEFAULT_VALIDATION_TIMEOUT, VALIDATION_INTERVAL } from './types.js';
import { validatePositiveNumber } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Extracts text content from OpenAI messages.
 *
 * @remarks
 * Handles complex message content types per SEC-006:
 * - String content: "Hello"
 * - Array content: [{type: 'text', text: 'Hello'}, {type: 'image_url', image_url: '...'}]
 *
 * This is a critical security function as it prevents validation bypass
 * when messages contain structured data or images.
 *
 * @param messages - Array of ChatCompletionMessageParam objects
 * @returns Concatenated text content from all messages
 *
 * @example
 * ```ts
 * const messages: ChatCompletionMessageParam[] = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'user', content: [{ type: 'text', text: 'Hi there' }] }
 * ];
 * const text = messagesToText(messages); // "Hello\nHi there"
 * ```
 */
export function messagesToText(messages: ChatCompletionMessageParam[]): string {
  return messages
    .map(m => {
      const content = m.content as MessageContent | undefined;

      // Handle messages without content (e.g., tool call messages)
      if (content === undefined || content === null) {
        return '';
      }

      // Handle string content (most common case)
      if (typeof content === 'string') {
        return content;
      }

      // Handle array content (SEC-006: structured data, images, etc.)
      if (Array.isArray(content)) {
        return content
          .filter(c => c.type === 'text' || c.type === 'refusal') // Only extract text/refusal parts
          .map(c => c.text || c.refusal || '')
          .join('\n');
      }

      // Handle other types (convert to string)
      return String(content);
    })
    .filter(c => c.length > 0)
    .join('\n');
}

/**
 * Creates a guarded OpenAI wrapper that intercepts and validates all API calls.
 *
 * @param client - The OpenAI client instance to wrap
 * @param options - Configuration options for the guarded wrapper
 * @returns An object with chat.completions.create method that validates input/output
 *
 * @example
 * ```ts
 * import OpenAI from 'openai';
 * import { createGuardedOpenAI } from '@blackunicorn/bonklm-openai';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const openai = new OpenAI();
 * const guardedOpenAI = createGuardedOpenAI(openai, {
 *   validators: [new PromptInjectionValidator()],
 *   validateStreaming: true,
 *   streamingMode: 'incremental',
 * });
 *
 * const response = await guardedOpenAI.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: userInput }]
 * });
 * ```
 */
/**
 * Validates that a numeric option is a positive number.
 *
 * @internal
 * @throws {TypeError} If value is not a positive finite number
 */

export function createGuardedOpenAI(
  client: OpenAI,
  options: GuardedOpenAIOptions = {}
): OpenAI & {
  chat: {
    completions: {
      create: (opts: GuardedChatCompletionOptions) => Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>>;
    };
  };
} {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER, // DEV-002: Use proper logger
    validateStreaming = false,
    streamingMode = 'incremental', // SEC-002: Default to incremental
    maxStreamBufferSize = DEFAULT_MAX_BUFFER_SIZE, // SEC-003: Default 1MB
    productionMode = process.env.NODE_ENV === 'production', // SEC-007
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT, // SEC-008: Default 30s
    onBlocked,
    onStreamBlocked
  } = options;

  // Validate critical security options
  validatePositiveNumber(maxStreamBufferSize, 'maxStreamBufferSize');
  validatePositiveNumber(validationTimeout, 'validationTimeout');

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  /**
   * SEC-008: Validation timeout wrapper.
   *
   * Sprint 30: routes through the canonical `validateWithTimeoutSecure`
   * primitive from core/connector-utils. Replaces the broken
   * AbortController pattern (signal never propagated to engine.validate).
   *
   * @internal
   */
  const validateWithTimeout = async (content: string, context?: string): Promise<GuardrailResult[]> => {
    // DEV-001: Correct API signature - use string context, not object
    const engineResult = await validateWithTimeoutSecure({
      operation: () => engine.validate(content, context),
      timeoutMs: validationTimeout,
      timeoutSentinel: () =>
        createResult(false, Severity.CRITICAL, [
          {
            category: 'timeout',
            description: 'Validation timeout',
            severity: Severity.CRITICAL,
            weight: 30
          }
        ]),
      logger
    });

    // Convert EngineResult to GuardrailResult[]
    const er = engineResult as unknown as { results?: GuardrailResult[] };
    if (er.results !== undefined && er.results.length > 0) {
      return er.results;
    }
    return [engineResult];
  };

  /**
   * Validates input messages and throws if blocked.
   *
   * @internal
   */
  const validateInput = async (messages: ChatCompletionMessageParam[]): Promise<void> => {
    // SEC-006: Handle complex message content (arrays, images, etc.)
    const prompt = messagesToText(messages);
    const inputResults = await validateWithTimeout(prompt, 'input');

    const blocked = inputResults.find(r => !r.allowed);
    if (blocked) {
      // Sprint 43 CWE-117 sweep: sanitize `blocked.reason` at both
      // log-meta + dev-mode throw boundaries.
      const safeReason = sanitizeMeta(blocked.reason);
      logger.warn('[Guardrails] Input blocked', { reason: safeReason });
      if (onBlocked) onBlocked(blocked);

      // SEC-007: Production mode - generic error
      if (productionMode) {
        throw new Error('Content blocked');
      }
      throw new Error(`Content blocked: ${safeReason}`);
    }
  };

  /**
   * Creates a validated streaming response.
   *
   * @internal
   */
  const createValidatedStream = (stream: AsyncIterable<ChatCompletionChunk>): AsyncIterable<ChatCompletionChunk> => {
    if (validateStreaming && streamingMode === 'incremental') {
      // SEC-002: Incremental stream validation with early termination
      // SEC-003: Max buffer size enforcement
      return createIncrementalValidatedStream(
        stream,
        validateWithTimeout,
        maxStreamBufferSize,
        logger,
        onStreamBlocked
      );
    }
    if (validateStreaming && streamingMode === 'buffer') {
      // SEC-002: Buffered full-stream validation (hold-back-and-release)
      // SEC-003: Max buffer size enforcement
      return createBufferedValidatedStream(
        stream,
        validateWithTimeout,
        maxStreamBufferSize,
        logger,
        onStreamBlocked,
        productionMode
      );
    }

    // No streaming validation - return original stream
    return stream;
  };

  // Create a wrapper that replaces only the chat.completions.create method
  const guardedClient = Object.create(client);
  guardedClient.chat = {
    ...client.chat,
    completions: {
      ...client.chat.completions,
      create: async (
        opts: GuardedChatCompletionOptions
      ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> => {
        // Validate input first
        await validateInput(opts.messages);

        // Determine if streaming
        const isStreaming = 'stream' in opts && opts.stream === true;

        if (isStreaming) {
          // Create streaming request
          const stream = await client.chat.completions.create(opts);

          // Wrap stream with validation if enabled
          return createValidatedStream(stream);
        }

        // Non-streaming request
        const response = await client.chat.completions.create(opts);

        // Validate output content
        const content = response.choices[0]?.message?.content || '';
        if (content) {
          const outputResults = await validateWithTimeout(content, 'output');
          const outputBlocked = outputResults.find(r => !r.allowed);

          if (outputBlocked) {
            // Sprint 43 CWE-117 sweep: sanitize `outputBlocked.reason`
            // at log-meta + dev-mode filteredContent boundaries.
            const safeReason = sanitizeMeta(outputBlocked.reason);
            logger.warn('[Guardrails] Output blocked', {
              reason: safeReason
            });
            if (onBlocked) onBlocked(outputBlocked);

            // Return filtered response with clear marker
            // Note: This differs from input validation (which throws) because
            // the API call has already completed and we have a partial result.
            // Throwing would waste the API cost and not provide any user value.
            const filteredContent = productionMode
              ? '[Content filtered by guardrails]'
              : `[Content filtered by guardrails: ${safeReason}]`;

            return {
              ...response,
              choices: [
                {
                  ...response.choices[0],
                  message: {
                    ...response.choices[0].message,
                    content: filteredContent
                  }
                }
              ]
            };
          }
        }

        return response;
      }
    }
  };

  return guardedClient as typeof client & {
    chat: {
      completions: {
        create: (opts: GuardedChatCompletionOptions) => Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>>;
      };
    };
  };
}

/**
 * Creates an incrementally validated stream.
 *
 * @internal
 *
 * @remarks
 * Implements SEC-002 (incremental validation) and SEC-003 (buffer size limit).
 */
async function* createIncrementalValidatedStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  validateWithTimeout: (content: string, context?: string) => Promise<GuardrailResult[]>,
  maxStreamBufferSize: number,
  logger: Logger,
  onStreamBlocked: ((accumulated: string) => void) | undefined
): AsyncIterable<ChatCompletionChunk> {
  let accumulatedText = '';
  let validationCounter = 0;

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const content = delta?.content;

      // Skip chunks with no content (e.g., role-only chunks)
      if (!content) {
        yield chunk;
        continue;
      }

      // SEC-003: Check buffer size BEFORE accumulating
      if (accumulatedText.length + content.length > maxStreamBufferSize) {
        logger.warn('[Guardrails] Stream buffer exceeded', {
          size: accumulatedText.length + content.length,
          limit: maxStreamBufferSize
        });
        // Throw StreamValidationError for proper error handling
        const error: any = new Error('Stream buffer exceeded maximum size');
        error.name = 'StreamValidationError';
        error.isStreamValidation = true;
        error.reason = 'buffer_exceeded';
        throw error;
      }

      // Accumulate content
      accumulatedText += content;
      validationCounter++;

      // SEC-002: Incremental validation every N chunks
      if (validationCounter % VALIDATION_INTERVAL === 0) {
        const results = await validateWithTimeout(accumulatedText, 'output');
        if (results.some(r => !r.allowed)) {
          logger.warn('[Guardrails] Stream blocked during incremental validation', {
            chunkCount: validationCounter
          });
          if (onStreamBlocked) onStreamBlocked(accumulatedText);

          // Stop yielding chunks - stream will end
          break;
        }
      }

      // Yield the original chunk
      yield chunk;
    }

    // Final validation on stream completion
    if (accumulatedText.length > 0) {
      const results = await validateWithTimeout(accumulatedText, 'output');
      if (results.some(r => !r.allowed)) {
        logger.warn('[Guardrails] Stream blocked at final validation');
        if (onStreamBlocked) onStreamBlocked(accumulatedText);
        // Stream already ended, just log
      }
    }
  } catch (error) {
    // Re-throw non-validation errors (including StreamValidationError)
    if (error instanceof Error && (error as any).isStreamValidation !== true) {
      throw error;
    }
    // StreamValidationError is caught and swallowed - stream ends
  }
}

/**
 * Creates a buffered, full-stream validated stream (hold-back-and-release).
 *
 * @internal
 *
 * @remarks
 * Implements `streamingMode: 'buffer'`. Every chunk is held back (never
 * forwarded) while the full response text is accumulated. At stream completion
 * a single validation pass runs over the complete text; the buffered chunks are
 * released unchanged only if validation passes. On a violation the buffered
 * content is withheld entirely and a single filtered marker chunk is emitted.
 *
 * Trade-off vs {@link createIncrementalValidatedStream}: one validation pass
 * instead of one per {@link VALIDATION_INTERVAL} chunks, and zero
 * pre-validation leakage (nothing reaches the consumer until the full text is
 * cleared), at the cost of progressive delivery. Mirrors the vercel connector's
 * buffer semantics.
 *
 * SEC-003 (buffer-size cap) is still enforced per chunk before accumulation.
 */
async function* createBufferedValidatedStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  validateWithTimeout: (content: string, context?: string) => Promise<GuardrailResult[]>,
  maxStreamBufferSize: number,
  logger: Logger,
  onStreamBlocked: ((accumulated: string) => void) | undefined,
  productionMode: boolean
): AsyncIterable<ChatCompletionChunk> {
  const buffered: ChatCompletionChunk[] = [];
  let accumulatedText = '';

  // SEC-003: single buffer-exceeded path (text size OR retained-event count).
  const failBufferExceeded = (detail: Record<string, number>): never => {
    logger.warn('[Guardrails] Stream buffer exceeded', { ...detail, limit: maxStreamBufferSize });
    const error: any = new Error('Stream buffer exceeded maximum size');
    error.name = 'StreamValidationError';
    error.isStreamValidation = true;
    error.reason = 'buffer_exceeded';
    throw error;
  };

  try {
    for await (const chunk of stream) {
      // Optional-chain the array access: providers/gateways (e.g. Azure content
      // filtering) can emit a chunk whose `choices` is absent or empty.
      const content = chunk.choices?.[0]?.delta?.content;

      if (content) {
        // SEC-003: cap accumulated text BEFORE accumulating.
        if (accumulatedText.length + content.length > maxStreamBufferSize) {
          failBufferExceeded({ size: accumulatedText.length + content.length });
        }
        accumulatedText += content;
      }

      // SEC-003: also cap the retained-event count. Buffer mode holds one object
      // per event, so a flood of zero-text/structural chunks would otherwise grow
      // memory unbounded while the text cap above stays untouched.
      if (buffered.length >= maxStreamBufferSize) {
        failBufferExceeded({ events: buffered.length });
      }

      // Hold the chunk back — nothing is forwarded until the full text validates.
      buffered.push(chunk);
    }

    // Single full-text validation on stream completion.
    if (accumulatedText.length > 0) {
      const results = await validateWithTimeout(accumulatedText, 'output');
      const blocked = results.find(r => !r.allowed);
      if (blocked) {
        logger.warn('[Guardrails] Stream blocked at buffered validation');
        if (onStreamBlocked) onStreamBlocked(accumulatedText);

        // Withhold every buffered chunk; emit a single filtered marker instead.
        // Sprint 43 CWE-117 sweep: sanitize the attacker-influenced reason.
        const safeReason = sanitizeMeta(blocked.reason);
        const filteredContent = productionMode
          ? '[Content filtered by guardrails]'
          : `[Content filtered by guardrails: ${safeReason}]`;
        const meta = buffered[0];
        yield {
          id: meta?.id ?? 'guardrail-blocked',
          object: 'chat.completion.chunk',
          created: meta?.created ?? 0,
          model: meta?.model ?? '',
          choices: [
            {
              index: 0,
              delta: { content: filteredContent },
              finish_reason: 'content_filter',
              logprobs: null
            }
          ]
        } as ChatCompletionChunk;
        return;
      }
    }

    // Validation passed (or the stream carried no text) — release all chunks.
    for (const chunk of buffered) {
      yield chunk;
    }
  } catch (error) {
    // Re-throw non-validation errors (including network/iterator failures).
    if (error instanceof Error && (error as any).isStreamValidation !== true) {
      throw error;
    }
    // StreamValidationError (buffer exceeded): the buffered content is dropped
    // and the stream ends with nothing released — the DoS-protection response.
  }
}

/**
 * Re-exports types for convenience.
 */
export type { GuardedOpenAIOptions, GuardedChatCompletionOptions, GuardedChatCompletion, MessageContent };
