/**
 * Anthropic SDK Guarded Wrapper
 * =============================
 *
 * Provides security guardrails for Anthropic SDK operations.
 *
 * Security Features:
 * - SEC-002: Incremental stream validation with early termination
 * - SEC-003: Max buffer size enforcement to prevent DoS
 * - SEC-006: Complex message content handling (arrays, images, structured data)
 * - SEC-007: Production mode error messages
 * - SEC-008: Validation timeout via `validateWithTimeoutSecure` (Sprint 30)
 * - DEV-001: Correct GuardrailEngine.validate() API (string context)
 * - DEV-002: Proper logger integration
 *
 * @package @blackunicorn/bonklm-anthropic
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  Message,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
  MessageParam,
  MessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages.js';
import {
  createLogger,
  createResult,
  createRetryPolicy,
  GuardrailEngine,
  type GuardrailResult,
  type Logger,
  sanitizeMeta,
  Severity,
  validateWithTimeoutSecure,
} from '@blackunicorn/bonklm';
import type {
  GuardedAnthropicOptions,
  GuardedMessage,
  GuardedMessageOptions,
} from './types.js';
import {
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
  VALIDATION_INTERVAL,
} from './types.js';
import { validatePositiveNumber } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Extracts text content from Anthropic messages.
 *
 * @remarks
 * Handles complex message content types per SEC-006:
 * - String content: "Hello"
 * - Array content: [{type: 'text', text: 'Hello'}, {type: 'image', source: {type: 'base64', ...}}]
 *
 * This is a critical security function as it prevents validation bypass
 * when messages contain structured data or images.
 *
 * @param messages - Array of MessageParam objects
 * @returns Concatenated text content from all messages
 *
 * @example
 * ```ts
 * const messages: MessageParam[] = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'user', content: [{ type: 'text', text: 'Hi there' }] }
 * ];
 * const text = messagesToText(messages); // "Hello\nHi there"
 * ```
 */
export function messagesToText(messages: MessageParam[]): string {
  return messages
    .map((m) => {
      const content = m.content;

      // Handle messages without content (should not happen with Anthropic API)
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
          .filter((c) => {
            // Extract text and tool_use blocks for validation (tool_use can contain malicious prompts)
            return c.type === 'text' || c.type === 'tool_use';
          })
          .map((c) => {
            if (c.type === 'text') {
              return (c as { text: string }).text || '';
            }
            // For tool_use blocks, extract the name and input for validation
            if (c.type === 'tool_use') {
              const toolUse = c as { name?: string; input?: any };
              const parts = [];
              if (toolUse.name) parts.push(`Tool: ${toolUse.name}`);
              if (toolUse.input) {
                // Extract string values from input object
                const inputStr = typeof toolUse.input === 'string'
                  ? toolUse.input
                  : JSON.stringify(toolUse.input);
                parts.push(inputStr);
              }
              return parts.join(' ');
            }
            return '';
          })
          .join('\n');
      }

      // Handle other types (convert to string)
      return String(content);
    })
    .filter((c) => c.length > 0)
    .join('\n');
}

/**
 * Validates that a numeric option is a positive number.
 *
 * @internal
 * @throws {TypeError} If value is not a positive finite number
 */


/**
 * Extracts text content from a Message object.
 *
 * @internal
 */
function extractMessageText(message: Message): string {
  return (message.content || [])
    .filter((block: ContentBlock) => {
      // Extract text and tool_use blocks for validation
      return block.type === 'text' || block.type === 'tool_use';
    })
    .map((block: ContentBlock) => {
      if (block.type === 'text') {
        return (block as { text: string }).text || '';
      }
      // For tool_use blocks, extract the name and input for validation
      if (block.type === 'tool_use') {
        const toolUse = block as { name?: string; input?: any };
        const parts = [];
        if (toolUse.name) parts.push(`Tool: ${toolUse.name}`);
        if (toolUse.input) {
          // Extract string values from input object
          const inputStr = typeof toolUse.input === 'string'
            ? toolUse.input
            : JSON.stringify(toolUse.input);
          parts.push(inputStr);
        }
        return parts.join(' ');
      }
      return '';
    })
    .join('\n');
}

/**
 * Creates a guarded Anthropic wrapper that intercepts and validates all API calls.
 *
 * @param client - The Anthropic client instance to wrap
 * @param options - Configuration options for the guarded wrapper
 * @returns An object with messages.create method that validates input/output
 *
 * @example
 * ```ts
 * import Anthropic from '@anthropic-ai/sdk';
 * import { createGuardedAnthropic } from '@blackunicorn/bonklm-anthropic';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const anthropic = new Anthropic();
 * const guardedAnthropic = createGuardedAnthropic(anthropic, {
 *   validators: [new PromptInjectionValidator()],
 *   validateStreaming: true,
 *   streamingMode: 'incremental',
 * });
 *
 * const response = await guardedAnthropic.messages.create({
 *   model: 'claude-3-opus-20240229',
 *   messages: [{ role: 'user', content: userInput }]
 * });
 * ```
 */
export function createGuardedAnthropic(
  client: Anthropic,
  options: GuardedAnthropicOptions = {},
): Omit<Anthropic, 'messages'> & {
  messages: {
    create: (
      opts: GuardedMessageOptions,
    ) => Promise<Message | AsyncIterable<MessageStreamEvent>>;
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
    telemetry,
    circuitBreaker,
    enableRetry = true,
    maxRetries = 3,
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
   * Generate unique run ID for telemetry
   *
   * @internal
   */
  const generateRunId = (): string => {
    return `anthropic-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  };

  /**
   * SEC-008: Validation timeout wrapper.
   *
   * Sprint 30: routes through the shared `validateWithTimeoutSecure`
   * primitive from core/connector-utils — single canonical SEC-008
   * implementation across all connectors. The helper handles
   * Promise.race + post-timeout-rejection absorption internally.
   *
   * @internal
   */
  const validateWithTimeout = async (
    content: string,
    context?: string,
    runId?: string,
  ): Promise<GuardrailResult[]> => {
    const currentRunId = runId || generateRunId();
    const startTime = Date.now();

    // Record telemetry start
    if (telemetry) {
      telemetry.recordValidationStart({
        runId: currentRunId,
        connector: 'anthropic',
        content,
        direction: context === 'input' ? 'input' : 'output',
      });
    }

    try {
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
            },
          ]),
        logger,
      });

      const duration = Date.now() - startTime;

      // Convert EngineResult to GuardrailResult[]
      const er = engineResult as unknown as { results?: GuardrailResult[] };
      if (er.results !== undefined) {
        // Multiple results returned (from EngineResult.results array)
        return er.results.length > 0 ? er.results : [engineResult as GuardrailResult];
      }

      // Single result returned
      const result = [engineResult as GuardrailResult];

      // Record telemetry complete
      if (telemetry) {
        const findingsCount = result.reduce((sum, r) => sum + (r.findings?.length || 0), 0);
        telemetry.recordValidationComplete({
          runId: currentRunId,
          connector: 'anthropic',
          duration,
          validatorCount: validators.length,
          findingCount: findingsCount,
          riskScore: result[0]?.risk_score || 0,
          allowed: result[0]?.allowed !== false,
        });
      }

      return result;
    } catch (error) {
      // Record telemetry error
      if (telemetry && error instanceof Error) {
        telemetry.recordValidationError({
          runId: currentRunId,
          connector: 'anthropic',
          error,
        });
      }
      throw error;
    }
  };

  /**
   * Validates input messages and throws if blocked.
   *
   * @internal
   */
  const validateInput = async (messages: MessageParam[]): Promise<void> => {
    // SEC-006: Handle complex message content (arrays, images, etc.)
    const prompt = messagesToText(messages);
    const inputResults = await validateWithTimeout(prompt, 'input');

    const blocked = inputResults.find((r) => !r.allowed);
    if (blocked) {
      // Sprint 40 security audit S40-1 closure: `blocked.reason` is
      // validator-extracted text and may carry attacker-influenced
      // matched-pattern content. Sanitize at the meta boundary.
      logger.warn('[Guardrails] Input blocked', { reason: sanitizeMeta(blocked.reason) });
      if (onBlocked) onBlocked(blocked);

      // SEC-007: Production mode - generic error
      if (productionMode) {
        throw new Error('Content blocked');
      }
      // Sprint 43 cross-connector CWE-117 sweep: sanitize at dev-mode
      // throw boundary (sister to log-meta wrap at line ~346 from
      // Sprint 40). Caller may log error.message via downstream logger.
      throw new Error(`Content blocked: ${sanitizeMeta(blocked.reason)}`);
    }
  };

  /**
   * Creates a validated streaming response.
   *
   * @internal
   */
  const createValidatedStream = (
    stream: AsyncIterable<MessageStreamEvent>,
    runId: string,
  ): AsyncIterable<MessageStreamEvent> => {
    if (validateStreaming && streamingMode === 'buffer') {
      logger.warn(
        '[Guardrails] streamingMode:"buffer" not implemented for anthropic connector — falling back to no stream validation. ' +
        'Use streamingMode:"incremental" (default) for live validation.'
      );
    }
    if (validateStreaming && streamingMode === 'incremental') {
      // SEC-002: Incremental stream validation with early termination
      // SEC-003: Max buffer size enforcement
      return createIncrementalValidatedStream(
        stream,
        validateWithTimeout,
        maxStreamBufferSize,
        logger,
        onStreamBlocked,
        productionMode,
        telemetry,
        runId,
      );
    }

    // No streaming validation - return original stream
    return stream;
  };

  // Create a wrapper that replaces only the messages.create method
  const guardedClient = Object.create(client);
  guardedClient.messages = {
    ...client.messages,
    create: async (
      opts: GuardedMessageOptions,
    ): Promise<Message | AsyncIterable<MessageStreamEvent>> => {
      const runId = generateRunId();
      const isStreaming = 'stream' in opts && opts.stream === true;

      // Validate input first
      await validateInput(opts.messages);

      // Define the API call function
      const apiCall = async (): Promise<Message | AsyncIterable<MessageStreamEvent>> => {
        const startTime = Date.now();

        // Record API call start
        if (telemetry) {
          telemetry.recordApiCallStart({
            runId,
            connector: 'anthropic',
            method: 'messages.create',
          });
        }

        try {
          let result: Message | AsyncIterable<MessageStreamEvent>;

          if (isStreaming) {
            // Create streaming request
            const stream = await client.messages.create(
              opts as MessageCreateParamsStreaming,
            );

            // Record stream start
            if (telemetry) {
              telemetry.recordStreamStart({ runId, connector: 'anthropic' });
            }

            // Wrap stream with validation if enabled
            result = createValidatedStream(
              stream as unknown as AsyncIterable<MessageStreamEvent>,
              runId,
            );
          } else {
            // Non-streaming request
            const response = await client.messages.create(
              opts as MessageCreateParamsNonStreaming,
            );

            // Validate output content
            const content = extractMessageText(response);
            if (content) {
              const outputResults = await validateWithTimeout(content, 'output', runId);
              const outputBlocked = outputResults.find((r) => !r.allowed);

              if (outputBlocked) {
                // Sprint 40 security audit S40-1 closure — see input-blocked rationale.
                logger.warn('[Guardrails] Output blocked', {
                  reason: sanitizeMeta(outputBlocked.reason),
                });
                if (onBlocked) onBlocked(outputBlocked);

                // Return filtered response with clear marker.
                // Sprint 43 CWE-117 sweep: filteredContent lands in
                // `response.content[0].text` which the application
                // returns to the LLM caller (frontend / agent
                // transcript). Sanitize at the boundary per Sprint 41
                // defensive-by-default policy.
                const filteredContent = productionMode
                  ? '[Content filtered by guardrails]'
                  : `[Content filtered by guardrails: ${sanitizeMeta(outputBlocked.reason)}]`;

                result = {
                  ...response,
                  content: [
                    {
                      type: 'text',
                      text: filteredContent,
                    },
                  ],
                } as Message;
              } else {
                result = response;
              }
            } else {
              result = response;
            }
          }

          const duration = Date.now() - startTime;

          // Record API call complete
          if (telemetry) {
            telemetry.recordApiCallComplete({
              runId,
              connector: 'anthropic',
              method: 'messages.create',
              duration,
              success: true,
            });
          }

          return result;
        } catch (error) {
          const duration = Date.now() - startTime;

          // Record API call error
          if (telemetry) {
            telemetry.recordApiCallComplete({
              runId,
              connector: 'anthropic',
              method: 'messages.create',
              duration,
              success: false,
            });
          }

          throw error;
        }
      };

      // Execute with circuit breaker if provided
      let finalCall = apiCall;
      if (circuitBreaker) {
        finalCall = () => circuitBreaker.execute(apiCall);
      }

      // Execute with retry if enabled
      if (enableRetry) {
        const retryPolicy = createRetryPolicy({
          maxAttempts: maxRetries,
          logger,
        });

        const retryResult = await retryPolicy.execute(finalCall);

        if (!retryResult.success) {
          throw retryResult.error instanceof Error
            ? retryResult.error
            : new Error(String(retryResult.error));
        }

        return retryResult.value ?? finalCall();
      }

      return finalCall();
    },
  };

  return guardedClient as typeof client & {
    messages: {
      create: (
        opts: GuardedMessageOptions,
      ) => Promise<Message | AsyncIterable<MessageStreamEvent>>;
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
  stream: AsyncIterable<MessageStreamEvent>,
  validateWithTimeout: (content: string, context?: string, runId?: string) => Promise<GuardrailResult[]>,
  maxStreamBufferSize: number,
  logger: Logger,
  onStreamBlocked: ((accumulated: string) => void) | undefined,
  productionMode: boolean,
  telemetry: import('@blackunicorn/bonklm').TelemetryService | undefined,
  runId: string,
): AsyncIterable<MessageStreamEvent> {
  let accumulatedText = '';
  let validationCounter = 0;

  try {
    for await (const event of stream) {
      // Only process content_block_delta events for text content
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const content = event.delta.text;

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

        // Record stream chunk telemetry
        if (telemetry) {
          telemetry.recordStreamChunk({
            runId,
            connector: 'anthropic',
            tokenCount: 1,
            charCount: content.length,
          });
        }

        // SEC-002: Incremental validation every N chunks
        if (validationCounter % VALIDATION_INTERVAL === 0) {
          const results = await validateWithTimeout(accumulatedText, 'output', runId);
          if (results.some((r) => !r.allowed)) {
            logger.warn('[Guardrails] Stream blocked during incremental validation', {
              chunkCount: validationCounter,
            });
            if (onStreamBlocked) onStreamBlocked(accumulatedText);

            // Record stream blocked telemetry
            if (telemetry) {
              telemetry.recordStreamBlocked({
                runId,
                connector: 'anthropic',
                accumulatedLength: accumulatedText.length,
              });
            }

            // Send a stop event and terminate stream
            yield {
              type: 'message_stop',
              message: {
                id: 'blocked',
                type: 'message',
                role: 'assistant',
                content: [
                  {
                    type: 'text',
                    text: productionMode
                      ? '[Content filtered by guardrails]'
                      : '[Stream blocked by guardrails]',
                  },
                ],
                model: '',
                stop_reason: 'guardrail_blocked',
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            } as MessageStreamEvent;
            return;
          }
        }
      }

      // Yield the original event
      yield event;
    }

    // Final validation on stream completion
    if (accumulatedText.length > 0) {
      const results = await validateWithTimeout(accumulatedText, 'output', runId);
      if (results.some((r) => !r.allowed)) {
        logger.warn('[Guardrails] Stream blocked at final validation');
        if (onStreamBlocked) onStreamBlocked(accumulatedText);

        // Record stream blocked telemetry
        if (telemetry) {
          telemetry.recordStreamBlocked({
            runId,
            connector: 'anthropic',
            accumulatedLength: accumulatedText.length,
          });
        }
        // Yield warning content block to notify user of post-stream validation failure
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        } as MessageStreamEvent;
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'text_delta',
            text: productionMode
              ? '\n\n[Content filtered by guardrails - post-stream validation]'
              : `\n\n[Content filtered by guardrails: ${results.find((r) => !r.allowed)?.reason || 'validation failed'}]`,
          },
        } as MessageStreamEvent;
        yield {
          type: 'content_block_stop',
          index: 0,
        } as MessageStreamEvent;
      }
    }
  } catch (error) {
    // Re-throw non-validation errors (including StreamValidationError)
    if (error instanceof Error && (error as any).isStreamValidation !== true) {
      throw error;
    }
    // StreamValidationError: yield a final warning event before ending stream
    yield {
      type: 'content_block_stop',
      index: 0,
    } as MessageStreamEvent;
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'max_tokens' as const, stop_sequence: null },
      usage: { output_tokens: 0 },
    } as MessageStreamEvent;
    yield {
      type: 'message_stop',
    } as MessageStreamEvent;
  }
}

/**
 * Re-exports types for convenience.
 */
export type {
  GuardedAnthropicOptions,
  GuardedMessageOptions,
  GuardedMessage,
};
