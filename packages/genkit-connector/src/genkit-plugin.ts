/**
 * Google Genkit Guardrail Plugin
 * ===============================
 *
 * Provides security guardrails for Genkit flow operations.
 *
 * Security Features:
 * - Incremental stream validation with early termination
 * - Max buffer size enforcement to prevent DoS
 * - Tool call injection protection via schema validation
 * - Complex message content handling (arrays, images, structured data)
 * - Production mode error messages
 * - Validation timeout via validateWithTimeoutSecure
 * - Request size limit
 * - regression: Correct GuardrailEngine.validate() API (string context)
 * - regression: Proper logger integration
 * - regression: Async/await on all validation calls
 *
 * @package @blackunicorn/bonklm-genkit
 */

import {
  createLogger,
  createResult,
  GuardrailEngine,
  type GuardrailResult,
  type Logger,
  sanitizeLogString,
  sanitizeMeta,
  Severity,
  validateWithTimeoutSecure
} from '@blackunicorn/bonklm';
import type {
  FlowHookResult,
  GenkitFlowContext,
  GenkitMessage,
  GenkitToolCall,
  GuardedGenkitOptions
} from './types.js';
import {
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_VALIDATION_TIMEOUT,
  StreamValidationError,
  VALIDATION_INTERVAL
} from './types.js';
import { messagesToTextWithTelemetry, type ReducedContentTally, toolCallsToText } from './messages-to-text.js';
import { validatePositiveNumber } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Validates that a numeric option is a positive number.
 *
 * @internal
 * @throws {TypeError} If value is not a positive finite number
 */

/**
 * Creates a Genkit plugin that wraps flows with guardrail validation.
 *
 * @param options - Configuration options for the guardrail plugin
 * @returns An object with flow wrapper functions for Genkit
 *
 * @example
 * ```ts
 * import { createGenkitGuardrailsPlugin } from '@blackunicorn/bonklm-genkit';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 * import { configureGenkit } from 'genkit';
 *
 * configureGenkit({
 *   plugins: [
 *     createGenkitGuardrailsPlugin({
 *       validators: [new PromptInjectionValidator()],
 *       validateFlowInput: true,
 *       validateFlowOutput: true,
 *     })
 *   ]
 * });
 * ```
 */
export function createGenkitGuardrailsPlugin(options: GuardedGenkitOptions = {}): {
  beforeFlow: (input: string | GenkitMessage[], context?: GenkitFlowContext) => Promise<FlowHookResult>;
  afterFlow: (response: string | GenkitMessage, context?: GenkitFlowContext) => Promise<FlowHookResult>;
  validateToolCall: (toolCall: GenkitToolCall, context?: GenkitFlowContext) => Promise<FlowHookResult>;
  validateToolResponse: (toolResponse: string | GenkitMessage, context?: GenkitFlowContext) => Promise<FlowHookResult>;
  createStreamValidator: (context?: GenkitFlowContext) => (chunk: string) => Promise<string | null>;
} {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER, // regression: Use proper logger
    validateFlowInput = true,
    validateFlowOutput = true,
    validateToolCalls = true,
    validateToolResponses = true,
    validateStreaming = false,
    streamingMode = 'incremental', // Default to incremental
    maxStreamBufferSize = DEFAULT_MAX_BUFFER_SIZE, // Default 1MB
    maxContentLength = DEFAULT_MAX_CONTENT_LENGTH, // Default 100KB
    productionMode = process.env.NODE_ENV === 'production',
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT, // Default 30s
    onBlocked,
    onStreamBlocked,
    onToolCallBlocked
  } = options;

  // Validate critical security options
  validatePositiveNumber(maxStreamBufferSize, 'maxStreamBufferSize');
  validatePositiveNumber(validationTimeout, 'validationTimeout');
  validatePositiveNumber(maxContentLength, 'maxContentLength');

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  /**
   * regression: Validation timeout wrapper (Sprint 30: routes through canonical validateWithTimeoutSecure primitive).
   *
   * @internal
   */
  const validateWithTimeout = async (content: string, context?: string): Promise<GuardrailResult[]> => {
    // regression: Correct API signature - use string context, not object
    // regression: AWAIT the validation
    // sentinel
    // now satisfies the top-level TimeoutSentinelShape contract
    // (allowed/blocked/severity) instead of returning the `results`-only
    // wrapper shape that diverged from the other 21 connectors.
    const sentinelGuardrail = (): GuardrailResult =>
      createResult(false, Severity.CRITICAL, [
        {
          category: 'timeout',
          severity: Severity.CRITICAL,
          description: 'Validation timeout'
        }
      ]);
    type GenkitWrappedResult = GuardrailResult & { results: GuardrailResult[] };
    const engineResult = await validateWithTimeoutSecure<GenkitWrappedResult>({
      operation: () => engine.validate(content, context),
      timeoutMs: validationTimeout,
      timeoutSentinel: () => {
        const top = sentinelGuardrail();
        return { ...top, results: [top] };
      },
      logger
    });
    return engineResult.results;
  };

  /**
   * Error handler that varies by production mode.
   *
   * @internal
   */
  const createErrorMessage = (result: GuardrailResult): string => {
    if (productionMode) {
      return 'Content blocked by security policy';
    }
    return `Content blocked: ${sanitizeMeta(result.reason)}`;
  };

  /**
   * Validates content before processing.
   *
   * @internal
   */
  const validateBefore = async (
    content: string,
    context: string,
    executionContext?: GenkitFlowContext
  ): Promise<FlowHookResult> => {
    // Check content length
    if (content.length > maxContentLength) {
      const errorResult = createResult(false, Severity.WARNING, [
        {
          category: 'size-limit',
          severity: Severity.WARNING,
          description: `Content exceeds maximum length of ${maxContentLength}`
        }
      ]);
      onBlocked?.(errorResult, executionContext);
      logger.warn('[Genkit Guardrails] Content too large');
      return {
        allowed: false,
        blockedReason: createErrorMessage(errorResult)
      };
    }

    // regression: AWAIT the validation
    const results = await validateWithTimeout(content, context);

    const blocked = results.find(r => !r.allowed);
    if (blocked) {
      onBlocked?.(blocked, executionContext);
      // cross-connector CWE-117 sweep.
      logger.warn('[Genkit Guardrails] Input blocked', { reason: sanitizeMeta(blocked.reason) });
      return {
        allowed: false,
        blockedReason: createErrorMessage(blocked)
      };
    }

    return { allowed: true };
  };

  /**
   * Validates content after processing.
   *
   * @internal
   */
  const validateAfter = async (content: string, executionContext?: GenkitFlowContext): Promise<FlowHookResult> => {
    // regression: AWAIT the validation
    const results = await validateWithTimeout(content, 'output');

    const blocked = results.find(r => !r.allowed);
    if (blocked) {
      onBlocked?.(blocked, executionContext);
      // CWE-117 sweep (sister to input-blocked above).
      logger.warn('[Genkit Guardrails] Output blocked', { reason: sanitizeMeta(blocked.reason) });
      return {
        allowed: false,
        blockedReason: createErrorMessage(blocked)
      };
    }

    return { allowed: true };
  };

  /**
   * Emits operator telemetry when the message reducer left a non-text channel
   * unscanned (an image/data placeholder or an unrecognized content-part `type`).
   *
   * @remarks
   * The indirect-injection arm only sees the text the reducer surfaces, so a
   * dropped/placeholder channel rides through unscanned. Rather than pass it
   * silently, surface a `warn` in the spirit of the MCP connector's
   * uninspectable-blob telemetry (PR #146). Unlike that connector's two-tier
   * split (`warn` for a binary-only result, `debug` when blobs accompany text
   * that WAS scanned), this emits a single `warn` on every reducer call that
   * drops a channel: the reducer substitutes a content-free placeholder, so —
   * unlike a decoded-but-skipped blob — there is no tier in which the non-text
   * channel received any inspection, and volume is bounded to one de-duplicated
   * line per call. Kind labels can be an attacker-chosen content-part `type`, so
   * each is routed through `sanitizeLogString` (CWE-117 / ADR-0001); `surface`
   * is a fixed internal literal (typed below) and needs no sanitization.
   *
   * @internal
   */
  const emitReducedContentTelemetry = (
    tally: ReducedContentTally,
    surface: 'input' | 'output' | 'tool_result'
  ): void => {
    if (tally.reducedCount === 0) {
      return;
    }
    logger.warn(
      '[Genkit Guardrails] Message content part(s) reduced to placeholder or dropped; channel passed unscanned',
      {
        surface,
        reducedCount: tally.reducedCount,
        reducedKinds: tally.reducedKinds.map(k => sanitizeLogString(k))
      }
    );
  };

  /**
   * Creates a streaming validator function.
   *
   * @remarks
   * Returns a function that can be called with each chunk.
   * Implements regression and regression for secure streaming validation.
   *
   * @internal
   */
  const createStreamValidator = (executionContext?: GenkitFlowContext): ((chunk: string) => Promise<string | null>) => {
    let accumulatedText = '';
    let chunkCount = 0;

    return async (chunk: string): Promise<string | null> => {
      // Check buffer size before adding
      if (accumulatedText.length + chunk.length > maxStreamBufferSize) {
        const error = `Stream buffer exceeded maximum size of ${maxStreamBufferSize}`;
        logger.warn('[Genkit Guardrails] Buffer overflow prevented');
        onStreamBlocked?.(accumulatedText, executionContext);
        throw new StreamValidationError(error, 'Buffer overflow', true);
      }

      accumulatedText += chunk;
      chunkCount++;

      // Incremental validation
      if (validateStreaming && streamingMode === 'incremental') {
        if (chunkCount % VALIDATION_INTERVAL === 0) {
          const result = await validateAfter(accumulatedText, executionContext);
          if (!result.allowed) {
            onStreamBlocked?.(accumulatedText, executionContext);
            throw new StreamValidationError(result.blockedReason || 'Stream blocked', 'Content policy violation', true);
          }
        }
      }

      return chunk;
    };
  };

  return {
    /**
     * Hook to call before flow execution.
     * Validates input messages for security violations.
     */
    beforeFlow: async (
      input: string | GenkitMessage[],
      executionContext?: GenkitFlowContext
    ): Promise<FlowHookResult> => {
      if (!validateFlowInput) {
        return { allowed: true };
      }

      const messages: GenkitMessage[] = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
      const { text, tally } = messagesToTextWithTelemetry(messages);
      emitReducedContentTelemetry(tally, 'input');
      return validateBefore(text, 'input', executionContext);
    },

    /**
     * Hook to call after flow execution.
     * Validates flow response for security violations.
     */
    afterFlow: async (
      response: string | GenkitMessage,
      executionContext?: GenkitFlowContext
    ): Promise<FlowHookResult> => {
      if (!validateFlowOutput) {
        return { allowed: true };
      }

      if (typeof response === 'string') {
        return validateAfter(response, executionContext);
      }
      const { text, tally } = messagesToTextWithTelemetry([response]);
      emitReducedContentTelemetry(tally, 'output');
      return validateAfter(text, executionContext);
    },

    /**
     * Validates a tool call before execution.
     * Addresses tool call injection protection.
     */
    validateToolCall: async (
      toolCall: GenkitToolCall,
      executionContext?: GenkitFlowContext
    ): Promise<FlowHookResult> => {
      if (!validateToolCalls) {
        return { allowed: true };
      }

      // Validate tool call inputs
      const text = toolCallsToText([toolCall]);
      const result = await validateBefore(text, 'tool_input', executionContext);

      if (!result.allowed) {
        onToolCallBlocked?.(
          toolCall,
          createResult(false, Severity.CRITICAL, [
            {
              category: 'tool-call-blocked',
              severity: Severity.CRITICAL,
              description: result.blockedReason || 'Tool call blocked'
            }
          ]),
          executionContext
        );
      }

      return result;
    },

    /**
     * Validates a tool response after execution.
     */
    validateToolResponse: async (
      toolResponse: string | GenkitMessage,
      executionContext?: GenkitFlowContext
    ): Promise<FlowHookResult> => {
      if (!validateToolResponses) {
        return { allowed: true };
      }

      if (typeof toolResponse === 'string') {
        return validateAfter(toolResponse, executionContext);
      }
      // A structured tool response can carry an image/data/unknown-type part the
      // reducer drops to a placeholder — that channel never reaches the validators,
      // so emit reduced-content telemetry before scanning the surfaced text.
      const { text, tally } = messagesToTextWithTelemetry([toolResponse]);
      emitReducedContentTelemetry(tally, 'tool_result');
      return validateAfter(text, executionContext);
    },

    /**
     * Creates a stream validator for streaming responses.
     */
    createStreamValidator: (executionContext?: GenkitFlowContext): ((chunk: string) => Promise<string | null>) => {
      return createStreamValidator(executionContext);
    },

    // Internal: Expose finalizeStream for complete validation
    _finalizeStream: async (accumulatedText: string, executionContext?: GenkitFlowContext): Promise<string> => {
      if (streamingMode === 'buffer' || !validateStreaming) {
        // Validate full buffer
        const result = await validateAfter(accumulatedText, executionContext);
        if (!result.allowed) {
          onStreamBlocked?.(accumulatedText, executionContext);
          throw new StreamValidationError(result.blockedReason || 'Stream blocked', 'Content policy violation', true);
        }
      }
      return accumulatedText;
    }
  } as any;
}

/**
 * Creates a flow wrapper with automatic guardrail hooks.
 *
 * @remarks
 * This is a convenience function that wraps a Genkit flow with
 * before/after hooks for automatic validation.
 *
 * @param flow - The Genkit flow function to wrap
 * @param options - Guardrail configuration options
 * @returns Wrapped flow with guardrail hooks applied
 *
 * @example
 * ```ts
 * import { wrapFlow } from '@blackunicorn/bonklm-genkit';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const guardedFlow = wrapFlow(myFlow, {
 *   validators: [new PromptInjectionValidator()],
 * });
 *
 * // Use the flow normally - guardrails are applied automatically
 * const result = await guardedFlow('Hello');
 * ```
 */
export function wrapFlow<TInput = string | GenkitMessage[], TOutput = string | GenkitMessage>(
  flow: (input: TInput) => Promise<TOutput>,
  options: GuardedGenkitOptions = {}
): (input: TInput) => Promise<TOutput> {
  const guardrails = createGenkitGuardrailsPlugin(options);

  return async (input: TInput): Promise<TOutput> => {
    // Validate input - cast to string | GenkitMessage[] for validation
    const inputForValidation: string | GenkitMessage[] = input as string | GenkitMessage[];
    const beforeResult = await guardrails.beforeFlow(inputForValidation);
    if (!beforeResult.allowed) {
      throw new Error(beforeResult.blockedReason || 'Input blocked');
    }

    // Execute flow
    const response = await flow(input);

    // Validate output - cast to string | GenkitMessage for validation
    const responseForValidation: string | GenkitMessage = response as string | GenkitMessage;
    const afterResult = await guardrails.afterFlow(responseForValidation);
    if (!afterResult.allowed) {
      // Return a safe fallback instead of throwing
      const fallback =
        typeof response === 'string'
          ? '[Content filtered by security policy]'
          : { role: 'model' as const, content: '[Content filtered by security policy]' };
      return fallback as TOutput;
    }

    return response;
  };
}

// Export types
export type {
  GuardedGenkitOptions,
  GenkitMessage,
  GenkitToolCall,
  GenkitFlowContext,
  FlowHookResult
} from './types.js';
