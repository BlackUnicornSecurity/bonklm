/**
 * CopilotKit Guardrail Integration
 * =================================
 *
 * Provides security guardrails for CopilotKit operations.
 *
 * Security Features:
 * - Incremental stream validation with early termination
 * - Max buffer size enforcement to prevent DoS
 * - Action call injection protection via schema validation
 * - Complex message content handling (arrays, images, structured data)
 * - Production mode error messages
 * - Validation timeout via validateWithTimeoutSecure
 * - Request size limit
 * - regression: Correct GuardrailEngine.validate() API (string context)
 * - regression: Proper logger integration
 * - regression: Async/await on all validation calls
 *
 * @package @blackunicorn/bonklm-copilotkit
 */

import {
  appendToolResultInjectionArm,
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
  CopilotKitAction,
  CopilotKitContext,
  CopilotKitMessage,
  GuardedCopilotKitOptions,
  HookResult
} from './types.js';
import {
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_VALIDATION_TIMEOUT,
  StreamValidationError,
  VALIDATION_INTERVAL
} from './types.js';
import { actionsToText, messagesToTextWithTelemetry, type ReducedContentTally } from './messages-to-text.js';
import { validatePositiveNumber } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Creates a CopilotKit guardrail integration that intercepts and validates messages.
 *
 * @param options - Configuration options for the guardrail integration
 * @returns An object with hook functions for CopilotKit
 *
 * @example
 * ```ts
 * import { createGuardedCopilotKit } from '@blackunicorn/bonklm-copilotkit';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const guardrails = createGuardedCopilotKit({
 *   validators: [new PromptInjectionValidator()],
 *   validateUserMessages: true,
 *   validateAssistantMessages: true,
 * });
 *
 * // Use with CopilotKit hooks
 * const messages = [
 *   { role: 'user', content: userInput }
 * ];
 * const result = await guardrails.beforeSendMessage(messages);
 * if (!result.allowed) throw new Error(result.blockedReason);
 * ```
 */
export function createGuardedCopilotKit(options: GuardedCopilotKitOptions = {}): {
  beforeSendMessage: (messages: CopilotKitMessage[], context?: CopilotKitContext) => Promise<HookResult>;
  afterReceiveMessage: (message: CopilotKitMessage, context?: CopilotKitContext) => Promise<HookResult>;
  validateActionCall: (action: CopilotKitAction, context?: CopilotKitContext) => Promise<HookResult>;
  validateActionResult: (actionResult: string, context?: CopilotKitContext) => Promise<HookResult>;
  createStreamValidator: (context?: CopilotKitContext) => (chunk: string) => Promise<string | null>;
} {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER, // regression: Use proper logger
    validateUserMessages = true,
    validateAssistantMessages = true,
    validateActionCalls = true,
    validateActionResults = true,
    validateStreaming = false,
    streamingMode = 'incremental', // Default to incremental
    maxStreamBufferSize = DEFAULT_MAX_BUFFER_SIZE, // Default 1MB
    maxContentLength = DEFAULT_MAX_CONTENT_LENGTH, // Default 100KB
    productionMode = process.env.NODE_ENV === 'production',
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT, // Default 30s
    onBlocked,
    onStreamBlocked,
    onActionCallBlocked,
    allowedActionNames, // S012-008: Action name whitelist
    blockedActionNames = ['eval', 'exec', 'deleteDatabase', 'dropTable', 'system', 'cmd', 'shell'], // S012-008: Default dangerous actions
    maxActionNameLength = 100, // S012-008: Prevent excessively long action names
    maxArgumentsSize = 100_000 // S012-008: Prevent oversized arguments
  } = options;

  // Validate critical security options
  validatePositiveNumber(maxStreamBufferSize, 'maxStreamBufferSize');
  validatePositiveNumber(validationTimeout, 'validationTimeout');
  validatePositiveNumber(maxContentLength, 'maxContentLength');
  validatePositiveNumber(maxActionNameLength, 'maxActionNameLength');
  validatePositiveNumber(maxArgumentsSize, 'maxArgumentsSize');

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  // security regression: the inbound action-result path validates against the user
  // validators PLUS the provenance-gated `tool_result` indirect-injection arm, so a
  // task-hijack / exfil directive embedded in an action result is blocked even when
  // the caller supplied no validator that catches it. Kept on a SEPARATE engine from
  // the general-output engine above so the tool_result-surface patterns never fire on
  // ordinary assistant output (which carries no connector provenance).
  const toolResultEngine = new GuardrailEngine({
    validators: appendToolResultInjectionArm(validators),
    guards,
    logger
  });

  /**
   * S012-008: Validates action name against whitelist/blacklist.
   *
   * @internal
   */
  const isActionNameAllowed = (actionName: string): boolean => {
    // Check name length
    if (actionName.length > maxActionNameLength) {
      logger.warn('[CopilotKit Guardrails] Action name exceeds maximum length', {
        actionName: sanitizeMeta(actionName),
        length: actionName.length
      });
      return false;
    }

    // Check against blacklist (dangerous action names)
    if (blockedActionNames && blockedActionNames.length > 0) {
      const isBlocked = blockedActionNames.some(blocked => {
        // Support simple wildcard patterns (* for any chars, ? for single char)
        // Limit pattern complexity to prevent ReDoS
        if (blocked.length > 200) {
          return false; // Skip overly complex patterns
        }
        // Escape special regex characters except * and ?
        const pattern = blocked
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        try {
          const regex = new RegExp(`^${pattern}$`, 'i');
          return regex.test(actionName);
        } catch {
          // If regex compilation fails, treat as non-matching
          return false;
        }
      });
      if (isBlocked) {
        logger.warn('[CopilotKit Guardrails] Action name is blocked', { actionName: sanitizeMeta(actionName) });
        return false;
      }
    }

    // Check against whitelist (if specified)
    if (allowedActionNames && allowedActionNames.length > 0) {
      const isAllowed = allowedActionNames.some(allowed => {
        // Support simple wildcard patterns (* for any chars, ? for single char)
        // Limit pattern complexity to prevent ReDoS
        if (allowed.length > 200) {
          return false; // Skip overly complex patterns
        }
        // Escape special regex characters except * and ?
        const pattern = allowed
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        try {
          const regex = new RegExp(`^${pattern}$`, 'i');
          return regex.test(actionName);
        } catch {
          // If regex compilation fails, treat as non-matching
          return false;
        }
      });
      if (!isAllowed) {
        logger.warn('[CopilotKit Guardrails] Action name not in allowed list', {
          actionName: sanitizeMeta(actionName)
        });
        return false;
      }
    }

    return true;
  };

  /**
   * S012-008: Validates action arguments for size and dangerous patterns.
   *
   * @internal
   */
  const validateActionArguments = (actionArgs: Record<string, unknown>): boolean => {
    if (!actionArgs) {
      return true;
    }

    // Check total size of arguments
    const argsSize = JSON.stringify(actionArgs).length;
    if (argsSize > maxArgumentsSize) {
      logger.warn('[CopilotKit Guardrails] Action arguments exceed maximum size', { size: argsSize });
      return false;
    }

    // Check for dangerous patterns in argument values
    const dangerousPatterns = [
      /\beval\b/i,
      /\bexec\b/i,
      /\bconstructor\b/i,
      /\b__proto__\b/i,
      /\$\$.*\$\(/, // Template string execution attempt
      /\\u0024/i // Unicode escape for $
    ];

    const argsStr = JSON.stringify(actionArgs);
    for (const pattern of dangerousPatterns) {
      if (pattern.test(argsStr)) {
        logger.warn('[CopilotKit Guardrails] Dangerous pattern in action arguments');
        return false;
      }
    }

    return true;
  };

  /**
   * regression: Validation timeout wrapper (Sprint 30: routes through canonical validateWithTimeoutSecure primitive).
   *
   * @internal
   */
  const validateWithTimeout = async (
    content: string,
    context?: string,
    targetEngine: GuardrailEngine = engine
  ): Promise<GuardrailResult[]> => {
    // regression: Correct API signature - use string context, not object
    // regression: AWAIT the validation
    // Sprint 31 cumulative audit fix (architect CRITICAL-1): canonical
    // sentinel carries the top-level GuardrailResult shape AS WELL AS
    // the connector-specific `results` array. The prior
    // `{ results: [...] }`-only shape diverged from the other
    // connectors' top-level BLOCKED contract — operators inspecting a
    // unified SIEM sink would see structurally different timeout events
    // depending on which connector fired. Now uniform.
    const sentinelGuardrail = (): GuardrailResult =>
      createResult(false, Severity.CRITICAL, [
        {
          category: 'timeout',
          severity: Severity.CRITICAL,
          description: 'Validation timeout'
        }
      ]);
    type CopilotkitWrappedResult = GuardrailResult & { results: GuardrailResult[] };
    const engineResult = await validateWithTimeoutSecure<CopilotkitWrappedResult>({
      operation: () => targetEngine.validate(content, context),
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
    executionContext?: CopilotKitContext
  ): Promise<HookResult> => {
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
      logger.warn('[CopilotKit Guardrails] Content too large');
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
      logger.warn('[CopilotKit Guardrails] Input blocked', { reason: sanitizeMeta(blocked.reason) });
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
  const validateAfter = async (
    content: string,
    executionContext?: CopilotKitContext,
    targetEngine: GuardrailEngine = engine,
    contextLabel = 'output'
  ): Promise<HookResult> => {
    // regression: AWAIT the validation
    const results = await validateWithTimeout(content, contextLabel, targetEngine);

    const blocked = results.find(r => !r.allowed);
    if (blocked) {
      onBlocked?.(blocked, executionContext);
      // CWE-117 sweep (sister to input-blocked above).
      logger.warn('[CopilotKit Guardrails] Output blocked', { reason: sanitizeMeta(blocked.reason) });
      return {
        allowed: false,
        blockedReason: createErrorMessage(blocked)
      };
    }

    return { allowed: true };
  };

  /**
   * Emits operator telemetry when the message reducer left a non-text channel
   * unscanned (an image / `data` placeholder or an unrecognized content-part
   * `type`).
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
      '[CopilotKit Guardrails] Message content part(s) reduced to placeholder or dropped; channel passed unscanned',
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
  const createStreamValidator = (executionContext?: CopilotKitContext): ((chunk: string) => Promise<string | null>) => {
    let accumulatedText = '';
    let chunkCount = 0;

    return async (chunk: string): Promise<string | null> => {
      // Check buffer size before adding
      if (accumulatedText.length + chunk.length > maxStreamBufferSize) {
        const error = `Stream buffer exceeded maximum size of ${maxStreamBufferSize}`;
        logger.warn('[CopilotKit Guardrails] Buffer overflow prevented');
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
     * Hook to call before sending user messages.
     * Validates input messages for security violations.
     */
    beforeSendMessage: async (
      messages: CopilotKitMessage[],
      executionContext?: CopilotKitContext
    ): Promise<HookResult> => {
      if (!validateUserMessages) {
        return { allowed: true };
      }

      const { text, tally } = messagesToTextWithTelemetry(messages);
      emitReducedContentTelemetry(tally, 'input');
      return validateBefore(text, 'input', executionContext);
    },

    /**
     * Hook to call after receiving assistant messages.
     * Validates assistant responses for security violations.
     */
    afterReceiveMessage: async (
      message: CopilotKitMessage,
      executionContext?: CopilotKitContext
    ): Promise<HookResult> => {
      if (!validateAssistantMessages) {
        return { allowed: true };
      }

      const { text, tally } = messagesToTextWithTelemetry([message]);
      emitReducedContentTelemetry(tally, 'output');
      return validateAfter(text, executionContext);
    },

    /**
     * Validates an action call before execution.
     * Addresses action call injection protection.
     * S012-008: Enhanced with action name and argument validation.
     */
    validateActionCall: async (action: CopilotKitAction, executionContext?: CopilotKitContext): Promise<HookResult> => {
      if (!validateActionCalls) {
        return { allowed: true };
      }

      // S012-008: Validate action name
      if (!isActionNameAllowed(action.name)) {
        const errorResult = createResult(false, Severity.CRITICAL, [
          {
            category: 'action-name-blocked',
            severity: Severity.CRITICAL,
            description: productionMode
              ? 'Action not allowed'
              : `Action '${action.name}' is not allowed or is blocked by security policy`
          }
        ]);
        onActionCallBlocked?.(action, errorResult, executionContext);
        return {
          allowed: false,
          blockedReason: createErrorMessage(errorResult)
        };
      }

      // S012-008: Validate action arguments
      if (action.args && !validateActionArguments(action.args)) {
        const errorResult = createResult(false, Severity.CRITICAL, [
          {
            category: 'action-arguments-blocked',
            severity: Severity.CRITICAL,
            description: productionMode
              ? 'Action arguments not allowed'
              : 'Action arguments contain dangerous patterns or exceed size limit'
          }
        ]);
        onActionCallBlocked?.(action, errorResult, executionContext);
        return {
          allowed: false,
          blockedReason: createErrorMessage(errorResult)
        };
      }

      // Validate action call inputs (content validation)
      const text = actionsToText([action]);
      const result = await validateBefore(text, 'action_input', executionContext);

      if (!result.allowed) {
        onActionCallBlocked?.(
          action,
          createResult(false, Severity.CRITICAL, [
            {
              category: 'action-call-blocked',
              severity: Severity.CRITICAL,
              description: result.blockedReason || 'Action call blocked'
            }
          ]),
          executionContext
        );
      }

      return result;
    },

    /**
     * Validates an action result after execution.
     */
    validateActionResult: async (actionResult: string, executionContext?: CopilotKitContext): Promise<HookResult> => {
      if (!validateActionResults) {
        return { allowed: true };
      }

      // security regression: route the inbound action result through the tool-result
      // engine so the provenance-gated `tool_result` indirect-injection arm scans it,
      // not only the user validators. Scoped to this path so tool_result patterns
      // never fire on ordinary assistant output.
      //
      // Note: `actionResult` arrives already reduced to a string, so there is no
      // structured content part to drop here — the reduced-channel telemetry
      // (image / `data` / unknown-type placeholders) lives on the message paths
      // (`beforeSendMessage` / `afterReceiveMessage`), where parts are reduced.
      return validateAfter(actionResult, executionContext, toolResultEngine, 'tool_result');
    },

    /**
     * Creates a stream validator for streaming responses.
     */
    createStreamValidator: (executionContext?: CopilotKitContext): ((chunk: string) => Promise<string | null>) => {
      return createStreamValidator(executionContext);
    },

    // Internal: Expose finalizeStream for complete validation
    _finalizeStream: async (accumulatedText: string, executionContext?: CopilotKitContext): Promise<string> => {
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

// Export types
export type {
  GuardedCopilotKitOptions,
  CopilotKitMessage,
  CopilotKitAction,
  CopilotKitContext,
  HookResult,
  CopilotKitContentPart
} from './types.js';
