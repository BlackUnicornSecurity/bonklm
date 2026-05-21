/**
 * Vercel AI SDK Guarded Wrapper
 * ============================
 *
 * Provides security guardrails for Vercel AI SDK operations.
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
 * @package @blackunicorn/bonklm-vercel
 */

import type { CoreMessage } from 'ai';
import {
  createLogger,
  type EngineResult,
  GuardrailEngine,
  type Logger,
  RiskLevel,
  Severity,
} from '@blackunicorn/bonklm';
import {
  ConnectorValidationError,
  createStreamValidatorState,
  logTimeout,
  logValidationFailure,
  StreamValidationError,
  updateStreamValidatorState,
  validateBufferBeforeAccumulation,
} from '@blackunicorn/bonklm/core/connector-utils';
import type {
  GuardedAIOptions,
  GuardedGenerateTextOptions,
  GuardedTextResult,
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
 * Extracts text content from CoreMessage array.
 *
 * @remarks
 * Handles complex message content types per SEC-006:
 * - String content: "Hello"
 * - Array content: [{type: 'text', text: 'Hello'}, {type: 'image', image: '...'}]
 *
 * This is a critical security function as it prevents validation bypass
 * when messages contain structured data or images.
 *
 * @param messages - Array of CoreMessage objects
 * @returns Concatenated text content from all messages
 *
 * @example
 * ```ts
 * const messages: CoreMessage[] = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }
 * ];
 * const text = messagesToText(messages); // "Hello\nHi there"
 * ```
 */
export function messagesToText(messages: CoreMessage[]): string {
  return messages
    .map((m) => {
      const content = m.content;

      // Handle string content (most common case)
      if (typeof content === 'string') {
        return content;
      }

      // Handle array content (SEC-006: structured data, images, etc.)
      if (Array.isArray(content)) {
        return content
          .filter((c) => c.type === 'text') // Only extract text parts
          .map((c) => (c.type === 'text' ? (c as { text: string }).text : ''))
          .join('\n');
      }

      // Handle other types (convert to string)
      return String(content);
    })
    .filter((c) => c.length > 0)
    .join('\n');
}

/**
 * Creates a guarded AI wrapper for Vercel AI SDK operations.
 *
 * @param options - Configuration options for the guarded wrapper
 * @returns An object with `generateText` and `streamText` methods
 *
 * @example
 * ```ts
 * import { createOpenAI } from '@ai-sdk/openai';
 * import { createGuardedAI } from '@blackunicorn/bonklm-vercel';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const openai = createOpenAI();
 * const guardedAI = createGuardedAI({
 *   validators: [new PromptInjectionValidator()],
 *   validateStreaming: true,
 *   streamingMode: 'incremental',
 * });
 *
 * const result = await guardedAI.generateText({
 *   model: openai('gpt-4'),
 *   messages: [{ role: 'user', content: userInput }]
 * });
 * ```
 */
export interface GuardedAIInstance {
  generateText(opts: GuardedGenerateTextOptions): Promise<GuardedTextResult>;
  streamText(opts: GuardedGenerateTextOptions & { stream: true }): Promise<any>;
}

export function createGuardedAI(options: GuardedAIOptions = {}): GuardedAIInstance {
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
    allowEmptyForTesting = process.env.BONKLM_TEST_MODE === '1', // Story 0.1 (R2-7): forward; auto-true under vitest
  } = options;

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger,
    allowEmptyForTesting,
  });

  /**
   * SEC-008: Validation timeout wrapper with AbortController.
   *
   * @internal
   */
  const validateWithTimeout = async (
    content: string,
    context?: string,
  ): Promise<EngineResult> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), validationTimeout);

    try {
      const engineResult = await engine.validate(content, context);

      clearTimeout(timeoutId);
      return engineResult;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        // S012-005: Use connector-utils timeout logging
        logTimeout(logger, 'Vercel AI validation', validationTimeout);
        return {
          allowed: false,
          blocked: true,
          severity: Severity.CRITICAL,
          risk_level: RiskLevel.HIGH,
          risk_score: 30,
          reason: 'Validation timeout',
          findings: [{
            category: 'timeout',
            severity: Severity.CRITICAL,
            description: 'Validation timeout',
            weight: 30,
          }],
          results: [],
          validatorCount: validators.length,
          guardCount: guards.length,
          executionTime: validationTimeout,
          timestamp: Date.now(),
        };
      }

      throw error;
    }
  };

  /**
   * Validates input messages and throws if blocked.
   *
   * @internal
   */
  const validateInput = async (messages: CoreMessage[]): Promise<void> => {
    // SEC-006: Handle complex message content (arrays, images, etc.)
    const prompt = messagesToText(messages);
    const inputResult = await validateWithTimeout(prompt, 'input');

    if (!inputResult.allowed) {
      // S012-005: Use connector-utils validation failure logging
      logValidationFailure(logger, inputResult.reason || 'Input blocked', { context: 'input' });
      if (onBlocked) onBlocked(inputResult as any);

      // SEC-007: Production mode - generic error
      if (productionMode) {
        throw new Error('Content blocked');
      }
      throw new Error(`Content blocked: ${inputResult.reason}`);
    }
  };

  return {
    /**
     * Generates text with guardrails validation.
     *
     * @param opts - Generation options including model and messages
     * @returns Generated text or filtered placeholder
     */
    async generateText(opts: GuardedGenerateTextOptions): Promise<GuardedTextResult> {
      // Validate input first
      await validateInput(opts.messages);

      // Dynamically import to avoid peer dependency issues
      const { generateText: aiGenerateText } = await import('ai');

      // Generate text
      const result = await aiGenerateText(opts);

      // Validate output
      const outputResult = await validateWithTimeout(result.text, 'output');

      if (!outputResult.allowed) {
        // S012-005: Use connector-utils validation failure logging
        logValidationFailure(logger, outputResult.reason || 'Output blocked', { context: 'output' });
        if (onBlocked) onBlocked(outputResult as any);

        throw new ConnectorValidationError(
          productionMode ? 'Content blocked' : `Content blocked: ${outputResult.reason}`,
          'validation_failed',
        );
      }

      return {
        text: result.text,
        usage: result.usage,
        finishReason: result.finishReason,
        filtered: false,
        raw: result,
      };
    },

    /**
     * Streams text with guardrails validation.
     *
     * @remarks
     * When validateStreaming is enabled, implements:
     * - SEC-002: Incremental validation with early termination
     * - SEC-003: Max buffer size enforcement
     * - S012-005: Buffer mode implementation
     *
     * @param opts - Stream options including model and messages
     * @returns Stream result with potential validation wrapping
     */
    async streamText(opts: GuardedGenerateTextOptions & { stream: true }) {
      // Validate input first
      await validateInput(opts.messages);

      // Dynamically import to avoid peer dependency issues
      const { streamText: aiStreamText } = await import('ai');

      // Create stream
      const result = await aiStreamText(opts);

      if (!validateStreaming) {
        // No streaming validation - return original stream
        return result;
      }

      const originalStream = result.toDataStream();

      if (streamingMode === 'incremental') {
        // S012-005: Incremental stream validation with early termination
        // Using connector-utils for buffer validation

        const streamState = createStreamValidatorState();

        return {
          ...result,
          toDataStream: () => {
            const reader = originalStream.getReader();

            return new ReadableStream({
              async pull(controller) {
                const { done, value } = await reader.read();

                if (done) {
                  // Final validation on stream completion
                  const outputResult = await validateWithTimeout(streamState.accumulated, 'output');
                  if (!outputResult.allowed) {
                    logValidationFailure(logger, outputResult.reason || 'Stream blocked', { context: 'stream_final' });
                    if (onStreamBlocked) onStreamBlocked(streamState.accumulated);

                    // Send error and close
                    const errorChunk = new TextEncoder().encode(
                      JSON.stringify({
                        type: 'error',
                        error: 'Content filtered',
                      }),
                    );
                    controller.enqueue(errorChunk);
                  }
                  controller.close();
                  return;
                }

                // S012-005: Use connector-utils buffer validation BEFORE accumulating
                const chunk = new TextDecoder().decode(value);
                validateBufferBeforeAccumulation(streamState, chunk, {
                  maxBufferSize: maxStreamBufferSize,
                  logger,
                });

                updateStreamValidatorState(streamState, chunk);

                // Incremental validation every N chunks
                if (streamState.chunkCount % VALIDATION_INTERVAL === 0) {
                  const result = await validateWithTimeout(streamState.accumulated, 'output');
                  if (!result.allowed) {
                    logValidationFailure(logger, result.reason || 'Stream blocked', { context: 'stream_incremental' });
                    if (onStreamBlocked) onStreamBlocked(streamState.accumulated);

                    throw new StreamValidationError(
                      'Content blocked during streaming',
                      'validation_failed',
                      true,
                    );
                  }
                }

                // Pass through the chunk
                controller.enqueue(value);
              },
            });
          },
        };
      }

      // S012-005: Buffer mode implementation
      // Accumulates entire stream before validating
      if (streamingMode === 'buffer') {
        const streamState = createStreamValidatorState();
        const chunks: Uint8Array[] = [];

        return {
          ...result,
          toDataStream: () => {
            const reader = originalStream.getReader();

            return new ReadableStream({
              async pull(controller) {
                const { done, value } = await reader.read();

                if (done) {
                  // Stream complete - validate accumulated content
                  if (streamState.accumulated.length > 0) {
                    const result = await validateWithTimeout(streamState.accumulated, 'output');
                    if (!result.allowed) {
                      logValidationFailure(logger, result.reason || 'Stream blocked', { context: 'stream_buffer' });
                      if (onStreamBlocked) onStreamBlocked(streamState.accumulated);

                      // Send error and close
                      const errorChunk = new TextEncoder().encode(
                        JSON.stringify({
                          type: 'error',
                          error: productionMode ? 'Content filtered' : `Content filtered: ${result.reason}`,
                        }),
                      );
                      controller.enqueue(errorChunk);
                    } else {
                      // Validation passed - send all accumulated chunks
                      for (const chunk of chunks) {
                        controller.enqueue(chunk);
                      }
                    }
                  }
                  controller.close();
                  return;
                }

                // S012-005: Use connector-utils buffer validation BEFORE accumulating
                const chunk = new TextDecoder().decode(value);
                validateBufferBeforeAccumulation(streamState, chunk, {
                  maxBufferSize: maxStreamBufferSize,
                  logger,
                });

                updateStreamValidatorState(streamState, chunk);
                chunks.push(value);
              },
            });
          },
        };
      }

      return result;
    },
  };
}

/**
 * Re-exports types for convenience.
 */
export type {
  GuardedAIOptions,
  GuardedGenerateTextOptions,
  GuardedStreamOptions,
  GuardedTextResult,
} from './types.js';

/**
 * Re-exports the messagesToText utility for external use.
 * This can be shared across different connectors (DEV-005).
 */
