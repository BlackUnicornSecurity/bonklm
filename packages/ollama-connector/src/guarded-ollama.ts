/**
 * Ollama SDK Guarded Wrapper
 * =============================
 *
 * Provides security guardrails for Ollama SDK operations.
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
 * @package @blackunicorn/bonklm-ollama
 */

import type { ChatResponse, GenerateResponse, Ollama } from 'ollama';
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
  GuardedChatOptions,
  GuardedChatResult,
  GuardedGenerateOptions,
  GuardedGenerateResult,
  GuardedOllamaOptions,
  OllamaMessage
} from './types.js';
import {
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
  StreamValidationError,
  VALIDATION_INTERVAL
} from './types.js';
import { validatePositiveNumber } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Extracts text content from Ollama messages.
 *
 * @remarks
 * Handles complex message content types per SEC-006:
 * - String content: "Hello"
 * - Messages with images: { role: 'user', content: 'Hello', images: [...] }
 *
 * This is a critical security function as it prevents validation bypass
 * when messages contain structured data or images.
 *
 * @param messages - Array of Ollama message objects
 * @returns Concatenated text content from all messages
 *
 * @example
 * ```ts
 * const messages: OllamaMessage[] = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'assistant', content: 'Hi there' }
 * ];
 * const text = messagesToText(messages); // "Hello\nHi there"
 * ```
 */
export function messagesToText(messages: OllamaMessage[]): string {
  return messages
    .map(m => {
      // Handle messages without content
      if (!m.content) {
        return '';
      }

      // Handle string content (most common case)
      if (typeof m.content === 'string') {
        return m.content;
      }

      // Handle other types (convert to string)
      return String(m.content);
    })
    .filter(c => c.length > 0)
    .join('\n');
}

/**
 * Validates that a numeric option is a positive number.
 *
 * @internal
 * @throws {TypeError} If value is not a positive finite number
 */

/**
 * Creates a guarded Ollama wrapper that intercepts and validates all API calls.
 *
 * @param client - The Ollama client instance to wrap
 * @param options - Configuration options for the guarded wrapper
 * @returns An object with chat() and generate() methods that validate input/output
 *
 * @example
 * ```ts
 * import { Ollama } from 'ollama';
 * import { createGuardedOllama } from '@blackunicorn/bonklm-ollama';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const ollama = new Ollama({ host: 'http://localhost:11434' });
 * const guardedOllama = createGuardedOllama(ollama, {
 *   validators: [new PromptInjectionValidator()],
 *   validateStreaming: true,
 *   streamingMode: 'incremental',
 * });
 *
 * const response = await guardedOllama.chat({
 *   model: 'llama3.1',
 *   messages: [{ role: 'user', content: userInput }]
 * });
 * ```
 */
export function createGuardedOllama(
  client: Ollama,
  options: GuardedOllamaOptions = {}
): Omit<Ollama, 'chat' | 'generate'> & {
  chat: (opts: GuardedChatOptions) => Promise<any>;
  generate: (opts: GuardedGenerateOptions) => Promise<any>;
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
   * SEC-008: Validation timeout wrapper (Sprint 30: routes through canonical validateWithTimeoutSecure primitive).
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
    if ('results' in engineResult) {
      // Multiple results returned (from EngineResult.results array)
      const multiResult = engineResult as { results?: GuardrailResult[] };
      return multiResult.results || [engineResult as GuardrailResult];
    }

    // Single result returned
    return [engineResult];
  };

  /**
   * Validates input messages and throws if blocked.
   *
   * @internal
   */
  const validateInput = async (prompt: string): Promise<void> => {
    const inputResults = await validateWithTimeout(prompt, 'input');

    const blocked = inputResults.find(r => !r.allowed);
    if (blocked) {
      // Sprint 43 cross-connector CWE-117 sweep (security HIGH #1
      // closure): sanitize at log + dev-mode throw boundaries.
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
   * Creates a validated streaming response for chat.
   *
   * @internal
   */
  const createValidatedChatStream = (
    stream: AsyncIterable<ChatResponse> | AsyncIterable<unknown>
  ): AsyncIterable<ChatResponse> | AsyncIterable<unknown> => {
    if (validateStreaming && streamingMode === 'incremental') {
      // SEC-002: Incremental stream validation with early termination
      // SEC-003: Max buffer size enforcement
      return createIncrementalValidatedChatStream(
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

  /**
   * Creates a validated streaming response for generate.
   *
   * @internal
   */
  const createValidatedGenerateStream = (
    stream: AsyncIterable<GenerateResponse> | AsyncIterable<unknown>
  ): AsyncIterable<GenerateResponse> | AsyncIterable<unknown> => {
    if (validateStreaming && streamingMode === 'incremental') {
      // SEC-002: Incremental stream validation with early termination
      // SEC-003: Max buffer size enforcement
      return createIncrementalValidatedGenerateStream(
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

  // Create a wrapper that replaces chat and generate methods
  const guardedClient = Object.create(client);

  // Wrap chat method
  guardedClient.chat = async (opts: GuardedChatOptions): Promise<any> => {
    // Validate input first
    const prompt = messagesToText(opts.messages);
    await validateInput(prompt);

    // Determine if streaming
    const isStreaming = opts.stream === true;

    if (isStreaming) {
      // Create streaming request - cast to ChatRequest for SDK
      const chatRequest = {
        model: opts.model,
        messages: opts.messages as any,
        stream: true as const,
        format: opts.format,
        keep_alive: opts.keep_alive,
        tools: opts.tools,
        think: opts.think,
        logprobs: opts.logprobs,
        top_logprobs: opts.top_logprobs,
        options: opts.options
      };

      const stream = await client.chat(chatRequest);

      // Wrap stream with validation if enabled
      return createValidatedChatStream(stream);
    }

    // Non-streaming request
    const chatRequest = {
      model: opts.model,
      messages: opts.messages as any,
      format: opts.format,
      keep_alive: opts.keep_alive,
      tools: opts.tools,
      think: opts.think,
      logprobs: opts.logprobs,
      top_logprobs: opts.top_logprobs,
      options: opts.options
    };

    const response = await client.chat(chatRequest);

    // Validate output content
    const content = response.message?.content || '';
    if (content) {
      const outputResults = await validateWithTimeout(content, 'output');
      const outputBlocked = outputResults.find(r => !r.allowed);

      if (outputBlocked) {
        // Sprint 43 CWE-117 sweep: filteredContent lands in
        // `response.message.content` returned to caller. Sanitize.
        const safeReason = sanitizeMeta(outputBlocked.reason);
        logger.warn('[Guardrails] Output blocked', {
          reason: safeReason
        });
        if (onBlocked) onBlocked(outputBlocked);

        // Return filtered response with clear marker
        const filteredContent = productionMode
          ? '[Content filtered by guardrails]'
          : `[Content filtered by guardrails: ${safeReason}]`;

        return {
          message: {
            ...response.message,
            content: filteredContent
          },
          filtered: true,
          raw: response
        } as GuardedChatResult;
      }
    }

    return response;
  };

  // Wrap generate method
  guardedClient.generate = async (opts: GuardedGenerateOptions): Promise<any> => {
    // Validate input first
    await validateInput(opts.prompt);

    // Determine if streaming
    const isStreaming = opts.stream === true;

    if (isStreaming) {
      // Create streaming request - cast to GenerateRequest for SDK
      const generateRequest = {
        model: opts.model,
        prompt: opts.prompt,
        stream: true as const,
        suffix: opts.suffix,
        system: opts.system,
        template: opts.template,
        context: opts.context,
        raw: opts.raw,
        format: opts.format,
        images: opts.images,
        keep_alive: opts.keep_alive,
        think: opts.think,
        logprobs: opts.logprobs,
        top_logprobs: opts.top_logprobs,
        options: opts.options
      };

      const stream = await client.generate(generateRequest);

      // Wrap stream with validation if enabled
      return createValidatedGenerateStream(stream);
    }

    // Non-streaming request
    const generateRequest = {
      model: opts.model,
      prompt: opts.prompt,
      suffix: opts.suffix,
      system: opts.system,
      template: opts.template,
      context: opts.context,
      raw: opts.raw,
      format: opts.format,
      images: opts.images,
      keep_alive: opts.keep_alive,
      think: opts.think,
      logprobs: opts.logprobs,
      top_logprobs: opts.top_logprobs,
      options: opts.options
    };

    const response = await client.generate(generateRequest);

    // Validate output content
    const content = response.response || '';
    if (content) {
      const outputResults = await validateWithTimeout(content, 'output');
      const outputBlocked = outputResults.find(r => !r.allowed);

      if (outputBlocked) {
        // Sprint 43 CWE-117 sweep: generate-path sister of chat-path
        // output-blocked filteredContent.
        const safeReason = sanitizeMeta(outputBlocked.reason);
        logger.warn('[Guardrails] Output blocked', {
          reason: safeReason
        });
        if (onBlocked) onBlocked(outputBlocked);

        // Return filtered response with clear marker
        const filteredContent = productionMode
          ? '[Content filtered by guardrails]'
          : `[Content filtered by guardrails: ${safeReason}]`;

        return {
          ...response,
          response: filteredContent
        } as GenerateResponse;
      }
    }

    return response;
  };

  return guardedClient as typeof client & {
    chat: (opts: GuardedChatOptions) => Promise<any>;
    generate: (opts: GuardedGenerateOptions) => Promise<any>;
  };
}

/**
 * Creates an incrementally validated stream for chat.
 *
 * @internal
 *
 * @remarks
 * Implements SEC-002 (incremental validation) and SEC-003 (buffer size limit).
 */
async function* createIncrementalValidatedChatStream(
  stream: any,
  validateWithTimeout: (content: string, context?: string) => Promise<GuardrailResult[]>,
  maxStreamBufferSize: number,
  logger: Logger,
  onStreamBlocked: ((accumulated: string) => void) | undefined,
  productionMode: boolean
): AsyncGenerator<ChatResponse> {
  let accumulatedText = '';
  let validationCounter = 0;
  let model = '';
  let createdAt = new Date();

  try {
    for await (const response of stream) {
      // Store metadata from first response
      if (!model) model = response.model;
      if (!createdAt) createdAt = response.created_at;

      // Extract content from message
      const content = response.message?.content || '';

      // SEC-003: Check buffer size BEFORE accumulating
      if (accumulatedText.length + content.length > maxStreamBufferSize) {
        logger.warn('[Guardrails] Stream buffer exceeded', {
          size: accumulatedText.length + content.length,
          limit: maxStreamBufferSize
        });
        // Throw StreamValidationError for proper error handling
        throw new StreamValidationError('Stream buffer exceeded maximum size', 'buffer_exceeded', true);
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

          // Send final blocked response and terminate stream
          yield {
            model,
            created_at: createdAt,
            message: {
              role: 'assistant',
              content: productionMode ? '[Content filtered by guardrails]' : '[Stream blocked by guardrails]'
            },
            done: true,
            done_reason: 'guardrail_blocked'
          } as ChatResponse;
          return;
        }
      }

      // Yield the original response
      yield response;
    }

    // Final validation on stream completion
    if (accumulatedText.length > 0) {
      const results = await validateWithTimeout(accumulatedText, 'output');
      if (results.some(r => !r.allowed)) {
        logger.warn('[Guardrails] Stream blocked at final validation');
        if (onStreamBlocked) onStreamBlocked(accumulatedText);

        // Yield warning response to notify user of post-stream validation failure
        yield {
          model,
          created_at: createdAt,
          message: {
            role: 'assistant',
            content: productionMode
              ? '\n\n[Content filtered by guardrails - post-stream validation]'
              : `\n\n[Content filtered by guardrails: ${results.find(r => !r.allowed)?.reason || 'validation failed'}]`
          },
          done: true,
          done_reason: 'guardrail_blocked'
        } as ChatResponse;
      }
    }
  } catch (error) {
    // Re-throw StreamValidationError
    if (error instanceof StreamValidationError) {
      throw error;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Creates an incrementally validated stream for generate.
 *
 * @internal
 *
 * @remarks
 * Implements SEC-002 (incremental validation) and SEC-003 (buffer size limit).
 */
async function* createIncrementalValidatedGenerateStream(
  stream: any,
  validateWithTimeout: (content: string, context?: string) => Promise<GuardrailResult[]>,
  maxStreamBufferSize: number,
  logger: Logger,
  onStreamBlocked: ((accumulated: string) => void) | undefined,
  productionMode: boolean
): AsyncGenerator<GenerateResponse> {
  let accumulatedText = '';
  let validationCounter = 0;
  let model = '';
  let createdAt = new Date();

  try {
    for await (const response of stream) {
      // Store metadata from first response
      if (!model) model = response.model;
      if (!createdAt) createdAt = response.created_at;

      // Extract response content
      const content = response.response || '';

      // SEC-003: Check buffer size BEFORE accumulating
      if (accumulatedText.length + content.length > maxStreamBufferSize) {
        logger.warn('[Guardrails] Stream buffer exceeded', {
          size: accumulatedText.length + content.length,
          limit: maxStreamBufferSize
        });
        // Throw StreamValidationError for proper error handling
        throw new StreamValidationError('Stream buffer exceeded maximum size', 'buffer_exceeded', true);
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

          // Send final blocked response and terminate stream
          yield {
            model,
            created_at: createdAt,
            response: productionMode ? '[Content filtered by guardrails]' : '[Stream blocked by guardrails]',
            done: true,
            done_reason: 'guardrail_blocked'
          } as GenerateResponse;
          return;
        }
      }

      // Yield the original response
      yield response;
    }

    // Final validation on stream completion
    if (accumulatedText.length > 0) {
      const results = await validateWithTimeout(accumulatedText, 'output');
      if (results.some(r => !r.allowed)) {
        logger.warn('[Guardrails] Stream blocked at final validation');
        if (onStreamBlocked) onStreamBlocked(accumulatedText);

        // Yield warning response to notify user of post-stream validation failure
        yield {
          model,
          created_at: createdAt,
          response: productionMode
            ? '\n\n[Content filtered by guardrails - post-stream validation]'
            : `\n\n[Content filtered by guardrails: ${results.find(r => !r.allowed)?.reason || 'validation failed'}]`,
          done: true,
          done_reason: 'guardrail_blocked'
        } as GenerateResponse;
      }
    }
  } catch (error) {
    // Re-throw StreamValidationError
    if (error instanceof StreamValidationError) {
      throw error;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Re-exports types for convenience.
 */
export type {
  GuardedOllamaOptions,
  GuardedChatOptions,
  GuardedGenerateOptions,
  GuardedChatResult,
  GuardedGenerateResult
};
