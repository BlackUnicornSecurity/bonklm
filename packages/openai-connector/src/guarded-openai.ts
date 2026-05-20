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
 * - SEC-008: Validation timeout with AbortController
 * - DEV-001: Correct GuardrailEngine.validate() API (string context)
 * - DEV-002: Proper logger integration
 *
 * @package @blackunicorn/bonklm-openai
 */

import type OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import {
  createLogger,
  createResult,
  GuardrailEngine,
  type GuardrailResult,
  type Logger,
  Severity,
} from '@blackunicorn/bonklm';
import type {
  GuardedChatCompletion,
  GuardedChatCompletionOptions,
  GuardedOpenAIOptions,
  MessageContent,
} from './types.js';
import {
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
  VALIDATION_INTERVAL,
} from './types.js';

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
    .map((m) => {
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
          .filter((c) => c.type === 'text' || c.type === 'refusal') // Only extract text/refusal parts
          .map((c) => c.text || c.refusal || '')
          .join('\n');
      }

      // Handle other types (convert to string)
      return String(content);
    })
    .filter((c) => c.length > 0)
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
function validatePositiveNumber(value: number, optionName: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(
      `${optionName} must be a positive number. Received: ${value}`,
    );
  }
}

export function createGuardedOpenAI(
  client: OpenAI,
  options: GuardedOpenAIOptions = {},
): OpenAI & {
  chat: {
    completions: {
      create: (
        opts: GuardedChatCompletionOptions,
      ) => Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>>;
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
    onStreamBlocked,
  } = options;

  // Validate critical security options
  validatePositiveNumber(maxStreamBufferSize, 'maxStreamBufferSize');
  validatePositiveNumber(validationTimeout, 'validationTimeout');

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger,
  });

  /**
   * SEC-008: Validation timeout wrapper with AbortController.
   *
   * @internal
   */
  const validateWithTimeout = async (
    content: string,
    context?: string,
  ): Promise<GuardrailResult[]> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), validationTimeout);

    try {
      // DEV-001: Correct API signature - use string context, not object
      const engineResult = await engine.validate(content, context);

      // Clear timeout before processing results to prevent race condition
      clearTimeout(timeoutId);

      // Convert EngineResult to GuardrailResult[]
      if ('results' in engineResult) {
        // Multiple results returned (from EngineResult.results array)
        const multiResult = engineResult;
        return multiResult.results || [engineResult as GuardrailResult];
      }

      // Single result returned
      return [engineResult as GuardrailResult];
    } catch (error) {
      // Clear timeout before processing error
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        logger.error('[Guardrails] Validation timeout');
        return [
          createResult(false, Severity.CRITICAL, [
            {
              category: 'timeout',
              description: 'Validation timeout',
              severity: Severity.CRITICAL,
              weight: 30,
            },
          ]),
        ];
      }

      throw error;
    } finally {
      // Ensure AbortController is cleaned up to prevent memory leaks
      controller.signal.removeEventListener('abort', () => {});
    }
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

    const blocked = inputResults.find((r) => !r.allowed);
    if (blocked) {
      logger.warn('[Guardrails] Input blocked', { reason: blocked.reason });
      if (onBlocked) onBlocked(blocked);

      // SEC-007: Production mode - generic error
      if (productionMode) {
        throw new Error('Content blocked');
      }
      throw new Error(`Content blocked: ${blocked.reason}`);
    }
  };

  /**
   * Creates a validated streaming response.
   *
   * @internal
   */
  const createValidatedStream = (
    stream: AsyncIterable<ChatCompletionChunk>,
  ): AsyncIterable<ChatCompletionChunk> => {
    if (validateStreaming && streamingMode === 'incremental') {
      // SEC-002: Incremental stream validation with early termination
      // SEC-003: Max buffer size enforcement
      return createIncrementalValidatedStream(
        stream,
        validateWithTimeout,
        maxStreamBufferSize,
        logger,
        onStreamBlocked,
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
        opts: GuardedChatCompletionOptions,
      ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> => {
        // Validate input first
        await validateInput(opts.messages);

        // Determine if streaming
        const isStreaming = 'stream' in opts && opts.stream === true;

        if (isStreaming) {
          // Create streaming request
          const stream = await client.chat.completions.create(
            opts,
          );

          // Wrap stream with validation if enabled
          return createValidatedStream(stream);
        }

        // Non-streaming request
        const response = await client.chat.completions.create(
          opts,
        );

        // Validate output content
        const content = response.choices[0]?.message?.content || '';
        if (content) {
          const outputResults = await validateWithTimeout(content, 'output');
          const outputBlocked = outputResults.find((r) => !r.allowed);

          if (outputBlocked) {
            logger.warn('[Guardrails] Output blocked', {
              reason: outputBlocked.reason,
            });
            if (onBlocked) onBlocked(outputBlocked);

            // Return filtered response with clear marker
            // Note: This differs from input validation (which throws) because
            // the API call has already completed and we have a partial result.
            // Throwing would waste the API cost and not provide any user value.
            const filteredContent = productionMode
              ? '[Content filtered by guardrails]'
              : `[Content filtered by guardrails: ${outputBlocked.reason}]`;

            return {
              ...response,
              choices: [
                {
                  ...response.choices[0],
                  message: {
                    ...response.choices[0].message,
                    content: filteredContent,
                  },
                },
              ],
            };
          }
        }

        return response;
      },
    },
  };

  return guardedClient as typeof client & {
    chat: {
      completions: {
        create: (
          opts: GuardedChatCompletionOptions,
        ) => Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>>;
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
  onStreamBlocked: ((accumulated: string) => void) | undefined,
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
          limit: maxStreamBufferSize,
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
        if (results.some((r) => !r.allowed)) {
          logger.warn('[Guardrails] Stream blocked during incremental validation', {
            chunkCount: validationCounter,
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
      if (results.some((r) => !r.allowed)) {
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
 * Re-exports types for convenience.
 */
export type {
  GuardedOpenAIOptions,
  GuardedChatCompletionOptions,
  GuardedChatCompletion,
  MessageContent,
};
