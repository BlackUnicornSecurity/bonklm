/**
 * Mastra Framework Guardrail Integration
 * =====================================
 *
 * Provides security guardrails for Mastra agent and workflow operations.
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
 * @package @blackunicorn/bonklm-mastra
 */

import {
  appendToolResultInjectionArm,
  createLogger,
  createResult,
  type EngineResult,
  GuardrailEngine,
  type Logger,
  RiskLevel,
  sanitizeLogString,
  Severity,
  validateWithTimeoutSecure
} from '@blackunicorn/bonklm';
import {
  ConnectorValidationError,
  createStreamValidatorState,
  logValidationFailure,
  StreamValidationError,
  updateStreamValidatorState,
  validateBufferBeforeAccumulation
} from '@blackunicorn/bonklm/core/connector-utils';
import type {
  AgentHookResult,
  GuardedMastraOptions,
  MastraAgentContext,
  MastraMessage,
  MastraToolCall
} from './types.js';
import {
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_VALIDATION_TIMEOUT,
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
 * Circuit breaker states for retry logic.
 *
 * @internal
 */
enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open'
}

/**
 * Circuit breaker configuration.
 *
 * @internal
 */
interface CircuitBreakerConfig {
  threshold: number;
  timeoutMs: number;
  halfOpenMaxCalls: number;
}

/**
 * Circuit breaker state tracker.
 *
 * @internal
 */
interface CircuitBreakerStateTracker {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime: number;
  halfOpenCallCount: number;
}

/**
 * Creates a Mastra guardrail integration that intercepts and validates agent operations.
 *
 * @param options - Configuration options for the guardrail integration
 * @returns An object with hook functions for Mastra agents
 *
 * @example
 * ```ts
 * import { createGuardedMastra } from '@blackunicorn/bonklm-mastra';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const guardrails = createGuardedMastra({
 *   validators: [new PromptInjectionValidator()],
 *   validateAgentInput: true,
 *   validateAgentOutput: true,
 * });
 *
 * // Use with Mastra agent
 * agent.beforeExecution(async (context) => {
 *   const result = await guardrails.beforeAgentExecution(context.messages, context);
 *   if (!result.allowed) throw new Error(result.blockedReason);
 * });
 * ```
 */
export function createGuardedMastra(options: GuardedMastraOptions = {}): {
  beforeAgentExecution: (messages: MastraMessage[], context?: MastraAgentContext) => Promise<AgentHookResult>;
  afterAgentExecution: (response: string | MastraMessage, context?: MastraAgentContext) => Promise<AgentHookResult>;
  validateToolCall: (toolCall: MastraToolCall, context?: MastraAgentContext) => Promise<AgentHookResult>;
  validateToolResult: (
    toolResult: string | MastraMessage,
    toolCall: MastraToolCall,
    context?: MastraAgentContext
  ) => Promise<AgentHookResult>;
  createStreamValidator: (context?: MastraAgentContext) => (chunk: string) => Promise<string | null>;
} {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER, // regression: Use proper logger
    validateAgentInput = true,
    validateAgentOutput = true,
    validateToolCalls = true,
    validateToolResults = true,
    validateStreaming = false,
    streamingMode = 'incremental', // Default to incremental
    maxStreamBufferSize = DEFAULT_MAX_BUFFER_SIZE, // Default 1MB
    maxContentLength = DEFAULT_MAX_CONTENT_LENGTH, // Default 100KB
    productionMode = process.env.NODE_ENV === 'production',
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT, // Default 30s
    onBlocked,
    onStreamBlocked,
    onToolCallBlocked,
    retryConfig // S012-004: Retry configuration
  } = options;

  // Validate critical security options
  validatePositiveNumber(maxStreamBufferSize, 'maxStreamBufferSize');
  validatePositiveNumber(validationTimeout, 'validationTimeout');
  validatePositiveNumber(maxContentLength, 'maxContentLength');

  // S012-004: Circuit breaker setup
  const circuitBreaker: CircuitBreakerStateTracker = {
    state: CircuitBreakerState.CLOSED,
    failureCount: 0,
    lastFailureTime: 0,
    halfOpenCallCount: 0
  };

  const cbConfig: CircuitBreakerConfig =
    retryConfig?.threshold && retryConfig?.timeoutMs && retryConfig?.halfOpenMaxCalls
      ? (retryConfig as CircuitBreakerConfig)
      : {
          threshold: 5, // Open after 5 consecutive failures
          timeoutMs: 60000, // Reset after 60 seconds
          halfOpenMaxCalls: 3 // Allow 3 calls in half-open state
        };

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  // security regression: the inbound tool-result path validates against the user
  // validators PLUS the provenance-gated `tool_result` indirect-injection arm, so
  // a task-hijack / exfil directive embedded in a tool result is blocked even when
  // the caller supplied no validator that catches it. Kept on a SEPARATE engine
  // from the general-output engine above so the tool_result-surface patterns never
  // fire on ordinary LLM output (which carries no connector provenance).
  const toolResultEngine = new GuardrailEngine({
    validators: appendToolResultInjectionArm(validators),
    guards,
    logger
  });

  /**
   * S012-004: Checks if circuit breaker is open.
   * Returns true if requests should be blocked.
   *
   * @internal
   */
  const isCircuitBreakerOpen = (): boolean => {
    const now = Date.now();

    // Check if we should reset from OPEN to HALF_OPEN
    if (
      circuitBreaker.state === CircuitBreakerState.OPEN &&
      now - circuitBreaker.lastFailureTime > cbConfig.timeoutMs
    ) {
      circuitBreaker.state = CircuitBreakerState.HALF_OPEN;
      circuitBreaker.halfOpenCallCount = 0;
      logger.info('[Mastra Guardrails] Circuit breaker entering half-open state');
      return false;
    }

    return circuitBreaker.state === CircuitBreakerState.OPEN;
  };

  /**
   * S012-004: Records a validation failure for circuit breaker.
   *
   * @internal
   */
  const recordFailure = (): void => {
    circuitBreaker.failureCount++;
    circuitBreaker.lastFailureTime = Date.now();

    if (circuitBreaker.failureCount >= cbConfig.threshold) {
      circuitBreaker.state = CircuitBreakerState.OPEN;
      logger.error('[Mastra Guardrails] Circuit breaker opened due to repeated failures', {
        failureCount: circuitBreaker.failureCount
      });
    }
  };

  /**
   * S012-004: Records a successful validation for circuit breaker.
   *
   * @internal
   */
  const recordSuccess = (): void => {
    if (circuitBreaker.state === CircuitBreakerState.HALF_OPEN) {
      circuitBreaker.halfOpenCallCount++;
      if (circuitBreaker.halfOpenCallCount >= cbConfig.halfOpenMaxCalls) {
        circuitBreaker.state = CircuitBreakerState.CLOSED;
        circuitBreaker.failureCount = 0;
        logger.info('[Mastra Guardrails] Circuit breaker closed after successful recovery');
      }
    } else if (circuitBreaker.state === CircuitBreakerState.CLOSED) {
      circuitBreaker.failureCount = Math.max(0, circuitBreaker.failureCount - 1);
    }
  };

  /**
   * S012-004: Validation timeout wrapper (routes through canonical validateWithTimeoutSecure primitive).
   * Returns EngineResult and uses connector-utils for logging.
   *
   * @internal
   */
  const validateWithTimeout = async (
    content: string,
    context?: string,
    targetEngine: GuardrailEngine = engine
  ): Promise<EngineResult> => {
    const engineResult = await validateWithTimeoutSecure<EngineResult>({
      operation: () => targetEngine.validate(content, context),
      timeoutMs: validationTimeout,
      timeoutSentinel: () => ({
        allowed: false,
        blocked: true,
        severity: Severity.CRITICAL,
        risk_level: RiskLevel.HIGH,
        risk_score: 30,
        reason: 'Validation timeout',
        findings: [
          {
            category: 'timeout',
            severity: Severity.CRITICAL,
            description: 'Validation timeout',
            weight: 30
          }
        ],
        results: [],
        // Diagnostic-only fallback count: reflects the user-supplied validator
        // list. The tool-result engine additionally composes the indirect-injection
        // arm, so this can under-report by one on a tool-result-path timeout. Does
        // not affect the block decision (sentinel is always allowed:false).
        validatorCount: validators.length,
        guardCount: guards.length,
        executionTime: validationTimeout,
        timestamp: Date.now()
      }),
      logger
    });
    return engineResult;
  };

  /**
   * Validates content before processing.
   *
   * @internal
   */
  const validateBefore = async (
    content: string,
    context: string,
    executionContext?: MastraAgentContext
  ): Promise<AgentHookResult> => {
    // S012-004: Check circuit breaker first
    if (isCircuitBreakerOpen()) {
      logger.warn('[Mastra Guardrails] Circuit breaker is open - blocking request');
      return {
        allowed: false,
        blockedReason: 'Circuit breaker is open due to repeated validation failures'
      };
    }

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
      logger.warn('[Mastra Guardrails] Content too large');
      return {
        allowed: false,
        blockedReason: productionMode
          ? 'Content blocked by security policy'
          : `Content blocked: Content exceeds maximum length`
      };
    }

    // S012-004: Use EngineResult from validateWithTimeout
    const result = await validateWithTimeout(content, context);

    if (!result.allowed) {
      onBlocked?.(result, executionContext);
      // S012-004: Use connector-utils validation failure logging
      logValidationFailure(logger, result.reason || 'Input blocked', { context });
      // S012-004: Record failure for circuit breaker
      recordFailure();
      return {
        allowed: false,
        blockedReason: productionMode ? 'Content blocked by security policy' : `Content blocked: ${result.reason}`
      };
    }

    // S012-004: Record success for circuit breaker
    recordSuccess();
    return { allowed: true };
  };

  /**
   * Validates content after processing.
   *
   * @internal
   */
  const validateAfter = async (
    content: string,
    executionContext?: MastraAgentContext,
    targetEngine: GuardrailEngine = engine,
    contextLabel = 'output'
  ): Promise<AgentHookResult> => {
    // S012-004: Use EngineResult from validateWithTimeout
    const result = await validateWithTimeout(content, contextLabel, targetEngine);

    if (!result.allowed) {
      onBlocked?.(result, executionContext);
      // S012-004: Use connector-utils validation failure logging
      logValidationFailure(logger, result.reason || 'Output blocked', { context: contextLabel });
      return {
        allowed: false,
        blockedReason: productionMode ? 'Content blocked by security policy' : `Content blocked: ${result.reason}`
      };
    }

    return { allowed: true };
  };

  /**
   * Emits operator telemetry when the message reducer left a non-text channel
   * unscanned (an image placeholder or an unrecognized content-part `type`).
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
      '[Mastra Guardrails] Message content part(s) reduced to placeholder or dropped; channel passed unscanned',
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
  const createStreamValidator = (
    executionContext?: MastraAgentContext
  ): ((chunk: string) => Promise<string | null>) => {
    // S012-004: Use connector-utils stream state for consistent behavior
    const streamState = createStreamValidatorState();

    return async (chunk: string): Promise<string | null> => {
      // S012-004: Use connector-utils buffer validation (proper UTF-8 byte size calculation)
      validateBufferBeforeAccumulation(streamState, chunk, {
        maxBufferSize: maxStreamBufferSize,
        logger
      });

      updateStreamValidatorState(streamState, chunk);

      // Incremental validation
      if (validateStreaming && streamingMode === 'incremental') {
        if (streamState.chunkCount % VALIDATION_INTERVAL === 0) {
          const result = await validateAfter(streamState.accumulated, executionContext);
          if (!result.allowed) {
            onStreamBlocked?.(streamState.accumulated, executionContext);
            throw new StreamValidationError(result.blockedReason || 'Stream blocked', 'Content policy violation', true);
          }
        }
      }

      return chunk;
    };
  };

  /**
   * Validates stream completion.
   *
   * @internal
   */
  const finalizeStream = async (accumulatedText: string, executionContext?: MastraAgentContext): Promise<string> => {
    if (streamingMode === 'buffer' || !validateStreaming) {
      // Validate full buffer
      const result = await validateAfter(accumulatedText, executionContext);
      if (!result.allowed) {
        onStreamBlocked?.(accumulatedText, executionContext);
        throw new StreamValidationError(result.blockedReason || 'Stream blocked', 'Content policy violation', true);
      }
    }
    return accumulatedText;
  };

  return {
    /**
     * Hook to call before agent execution.
     * Validates input messages for security violations.
     */
    beforeAgentExecution: async (
      messages: MastraMessage[],
      executionContext?: MastraAgentContext
    ): Promise<AgentHookResult> => {
      if (!validateAgentInput) {
        return { allowed: true };
      }

      const { text, tally } = messagesToTextWithTelemetry(messages);
      emitReducedContentTelemetry(tally, 'input');
      return validateBefore(text, 'input', executionContext);
    },

    /**
     * Hook to call after agent execution.
     * Validates agent response for security violations.
     */
    afterAgentExecution: async (
      response: string | MastraMessage,
      executionContext?: MastraAgentContext
    ): Promise<AgentHookResult> => {
      if (!validateAgentOutput) {
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
      toolCall: MastraToolCall,
      executionContext?: MastraAgentContext
    ): Promise<AgentHookResult> => {
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
     * Validates a tool result after execution.
     */
    validateToolResult: async (
      toolResult: string | MastraMessage,
      _toolCall: MastraToolCall,
      executionContext?: MastraAgentContext
    ): Promise<AgentHookResult> => {
      if (!validateToolResults) {
        return { allowed: true };
      }

      // security regression: route through the tool-result engine so the
      // provenance-gated `tool_result` indirect-injection arm scans the inbound
      // result, not only the user-supplied validators (which the general-output
      // engine carries). Label matches the `tool_result` provenance surface so
      // logs correlate to the surface taxonomy.
      if (typeof toolResult === 'string') {
        return validateAfter(toolResult, executionContext, toolResultEngine, 'tool_result');
      }
      // A structured tool result can carry an image/unknown-type part the
      // reducer drops to a placeholder — that channel never reaches the arm, so
      // emit reduced-content telemetry before scanning the surfaced text.
      const { text, tally } = messagesToTextWithTelemetry([toolResult]);
      emitReducedContentTelemetry(tally, 'tool_result');
      return validateAfter(text, executionContext, toolResultEngine, 'tool_result');
    },

    /**
     * Creates a stream validator for streaming responses.
     *
     * @example
     * ```ts
     * const validator = guardrails.createStreamValidator();
     * for await (const chunk of stream) {
     *   const validated = await validator(chunk);
     *   if (validated) process.stdout.write(validated);
     * }
     * ```
     */
    createStreamValidator: (executionContext?: MastraAgentContext): ((chunk: string) => Promise<string | null>) => {
      return createStreamValidator(executionContext);
    },

    // Internal: Expose finalizeStream for complete validation
    _finalizeStream: finalizeStream
  } as any;
}

/**
 * Creates a Mastra agent wrapper with automatic guardrail hooks.
 *
 * @remarks
 * This is a convenience function that wraps a Mastra agent with
 * before/after hooks for automatic validation.
 *
 * @param agent - The Mastra agent to wrap
 * @param options - Guardrail configuration options
 * @returns Wrapped agent with guardrail hooks applied
 *
 * @example
 * ```ts
 * import { wrapAgent } from '@blackunicorn/bonklm-mastra';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const guardedAgent = wrapAgent(myAgent, {
 *   validators: [new PromptInjectionValidator()],
 * });
 *
 * // Use the agent normally - guardrails are applied automatically
 * const result = await guardedAgent.execute('Hello');
 * ```
 */
export function wrapAgent<
  TAgent extends {
    execute: (input: string | MastraMessage[]) => Promise<string | MastraMessage>;
  }
>(agent: TAgent, options: GuardedMastraOptions = {}): TAgent {
  const guardrails = createGuardedMastra(options);

  const wrappedExecute = async (input: string | MastraMessage[]): Promise<string | MastraMessage> => {
    // Normalize input to messages array
    const messages: MastraMessage[] = typeof input === 'string' ? [{ role: 'user', content: input }] : input;

    // Validate input
    const beforeResult = await guardrails.beforeAgentExecution(messages);
    if (!beforeResult.allowed) {
      // use
      // ConnectorValidationError to match the output-blocked path below
      // (same throw type). Callers catching `ConnectorValidationError`
      // to distinguish guardrail blocks from network errors will now
      // see input-blocked events too.
      throw new ConnectorValidationError(beforeResult.blockedReason || 'Input blocked', 'validation_failed');
    }

    // Execute agent
    const response = await agent.execute(input);

    // Validate output
    const afterResult = await guardrails.afterAgentExecution(response);
    if (!afterResult.allowed) {
      // S012-004: Throw error instead of returning filtered content
      throw new ConnectorValidationError(
        afterResult.blockedReason || 'Output blocked by security policy',
        'validation_failed'
      );
    }

    return response;
  };

  return {
    ...agent,
    execute: wrappedExecute
  };
}

// Export types
export type {
  GuardedMastraOptions,
  MastraMessage,
  MastraToolCall,
  MastraAgentContext,
  AgentHookResult
} from './types.js';
