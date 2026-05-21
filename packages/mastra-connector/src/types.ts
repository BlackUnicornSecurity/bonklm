/**
 * Mastra Framework Connector Types
 *
 * This file contains all TypeScript type definitions for the Mastra framework connector.
 * Includes security-related options for agent hook integration, streaming validation,
 * and complex message content handling.
 *
 * Security Features:
 * - SEC-002: Incremental stream validation with early termination
 * - SEC-003: Max buffer size enforcement
 * - SEC-005: Tool call injection protection
 * - SEC-006: Complex message content handling
 * - SEC-007: Production mode error messages
 * - SEC-008: Validation timeout
 * - SEC-010: Request size limits
 * - DEV-001: Correct GuardrailEngine API
 * - DEV-002: Logger type
 */

import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';

/**
 * Mastra message types (simplified for integration).
 *
 * @internal
 * @remarks
 * Mastra uses various message formats for agents, workflows, and tools.
 * These types represent the common structures we need to validate.
 */
export interface MastraMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | MastraContentPart[];
  toolCallId?: string;
  name?: string;
}

/**
 * Mastra content part types for structured messages.
 *
 * @internal
 * @remarks
 * Similar to OpenAI's content parts, Mastra can have complex content
 * including text, images, and tool call results.
 */
export interface MastraContentPart {
  type: 'text' | 'image_url' | 'tool_use' | 'tool_result';
  text?: string;
  image_url?: { url: string };
  toolUse?: {
    id: string;
    name: string;
    input?: Record<string, unknown>;
  };
  toolResult?: {
    toolUseId: string;
    content?: string | Array<MastraContentPart>;
    isError?: boolean;
  };
}

/**
 * Mastra agent execution context.
 *
 * @internal
 * @remarks
 * Passed to agent hooks for validation.
 */
export interface MastraAgentContext {
  agentId: string;
  sessionId?: string;
  userId?: string;
  workflowId?: string;
}

/**
 * Mastra tool call structure.
 *
 * @internal
 * @remarks
 * Tool calls need special validation per SEC-005 to prevent injection attacks.
 */
export interface MastraToolCall {
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

/**
 * Configuration options for the Mastra guardrail integration.
 *
 * @remarks
 * All security options are included to address identified vulnerabilities.
 */
export interface GuardedMastraOptions {
  /**
   * Validators to apply to inputs and outputs.
   */
  validators?: Validator[];

  /**
   * Guards to apply to inputs and outputs.
   */
  guards?: Guard[];

  /**
   * Logger instance for validation events.
   *
   * @defaultValue createLogger('console')
   */
  logger?: Logger;

  /**
   * Whether to validate agent inputs before execution.
   *
   * @defaultValue true
   */
  validateAgentInput?: boolean;

  /**
   * Whether to validate agent outputs after execution.
   *
   * @defaultValue true
   */
  validateAgentOutput?: boolean;

  /**
   * Whether to validate tool call inputs.
   *
   * @remarks
   * Addresses SEC-005: Tool call injection protection.
   *
   * @defaultValue true
   */
  validateToolCalls?: boolean;

  /**
   * Whether to validate tool result outputs.
   *
   * @defaultValue true
   */
  validateToolResults?: boolean;

  /**
   * Whether to validate streaming responses incrementally.
   *
   * @remarks
   * When enabled, the stream is validated in chunks rather than only after completion.
   *
   * @defaultValue false
   */
  validateStreaming?: boolean;

  /**
   * Stream validation mode.
   *
   * @remarks
   * - 'incremental': Validates every N chunks during streaming, early terminates on violation
   * - 'buffer': Accumulates entire stream before validating (less secure, faster)
   *
   * Addresses SEC-002: Post-hoc stream validation bypass.
   *
   * @defaultValue 'incremental'
   */
  streamingMode?: 'incremental' | 'buffer';

  /**
   * Maximum buffer size for stream accumulation.
   *
   * @remarks
   * Prevents memory exhaustion attacks via large streaming responses.
   *
   * Addresses SEC-003: Accumulator buffer overflow.
   *
   * @defaultValue 1048576 (1MB)
   */
  maxStreamBufferSize?: number;

  /**
   * Maximum content length for validation.
   *
   * @remarks
   * Prevents DoS via extremely long inputs.
   *
   * Addresses SEC-010: Request size limit.
   *
   * @defaultValue 100000 (100KB)
   */
  maxContentLength?: number;

  /**
   * Production mode flag.
   *
   * @remarks
   * When true, error messages are generic to avoid leaking security information.
   *
   * Addresses SEC-007: Information leakage in error messages.
   *
   * @defaultValue process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Validation timeout in milliseconds.
   *
   * @remarks
   * Prevents hanging on slow or malicious inputs.
   *
   * Addresses SEC-008: Missing timeout enforcement.
   *
   * @defaultValue 30000 (30 seconds)
   */
  validationTimeout?: number;

  /**
   * Callback invoked when input is blocked.
   *
   * @param result - The validation result that caused blocking.
   * @param context - The Mastra execution context.
   */
  onBlocked?: (result: GuardrailResult, context?: MastraAgentContext) => void;

  /**
   * Callback invoked when stream is blocked during validation.
   *
   * @param accumulated - The accumulated text content before blocking.
   * @param context - The Mastra execution context.
   */
  onStreamBlocked?: (accumulated: string, context?: MastraAgentContext) => void;

  /**
   * Callback invoked when a tool call is blocked.
   *
   * @param toolCall - The blocked tool call.
   * @param result - The validation result.
   * @param context - The Mastra execution context.
   */
  onToolCallBlocked?: (
    toolCall: MastraToolCall,
    result: GuardrailResult,
    context?: MastraAgentContext,
  ) => void;

  /**
   * S012-004: Circuit breaker and retry configuration.
   *
   * @remarks
   * Provides circuit breaker pattern for handling repeated validation failures
   * and exponential backoff for retries.
   */
  retryConfig?: {
    /** Number of consecutive failures before opening circuit breaker */
    threshold?: number;
    /** Time in milliseconds before attempting recovery (default: 60000) */
    timeoutMs?: number;
    /** Number of calls allowed in half-open state (default: 3) */
    halfOpenMaxCalls?: number;
  };
}

/**
 * Error thrown when stream validation fails.
 *
 * @remarks
 * This error class is provided for type-checking and catching stream validation errors.
 */
export { StreamValidationError } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Validation interval for incremental stream validation.
 *
 * @internal
 */
export const VALIDATION_INTERVAL = 10;

/**
 * Default max buffer size (1MB).
 *
 * @internal
 */
export const DEFAULT_MAX_BUFFER_SIZE = 1024 * 1024;

/**
 * Default max content length (100KB).
 *
 * @internal
 */
export const DEFAULT_MAX_CONTENT_LENGTH = 100_000;

/**
 * Default validation timeout (30 seconds).
 *
 * @internal
 */
export const DEFAULT_VALIDATION_TIMEOUT = 30000;

/**
 * Agent hook result type.
 *
 * @internal
 * @remarks
 * Returned by agent hooks to indicate whether execution should continue.
 */
export interface AgentHookResult {
  allowed: boolean;
  blockedReason?: string;
  modifiedContent?: string;
}
