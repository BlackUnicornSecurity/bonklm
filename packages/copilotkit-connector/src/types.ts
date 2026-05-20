/**
 * CopilotKit Integration Types
 * ============================
 *
 * This file contains all TypeScript type definitions for the CopilotKit connector.
 * Includes security-related options for hook integration, streaming validation,
 * and complex message content handling.
 *
 * Security Features:
 * - SEC-002: Incremental stream validation with early termination
 * - SEC-003: Max buffer size enforcement
 * - SEC-005: Action call injection protection
 * - SEC-006: Complex message content handling
 * - SEC-007: Production mode error messages
 * - SEC-008: Validation timeout
 * - SEC-010: Request size limits
 * - DEV-001: Correct GuardrailEngine API
 * - DEV-002: Logger type
 */

import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';

/**
 * CopilotKit message types (simplified for integration).
 *
 * @internal
 */
export interface CopilotKitMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | CopilotKitContentPart[];
  isText?: boolean;
}

/**
 * CopilotKit content part types for structured messages.
 *
 * @internal
 */
export interface CopilotKitContentPart {
  type: 'text' | 'image' | 'data';
  text?: string;
  image?: { url?: string };
  data?: string;
}

/**
 * CopilotKit context for validation.
 *
 * @internal
 */
export interface CopilotKitContext {
  userId?: string;
  conversationId?: string;
}

/**
 * CopilotKit action call structure.
 *
 * @internal
 * @remarks
 * Action calls need special validation per SEC-005.
 */
export interface CopilotKitAction {
  name: string;
  description?: string;
  args?: Record<string, unknown>;
}

/**
 * Configuration options for the CopilotKit guardrail integration.
 *
 * @remarks
 * All security options are included to address identified vulnerabilities.
 */
export interface GuardedCopilotKitOptions {
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
   * Whether to validate user messages before sending to LLM.
   *
   * @defaultValue true
   */
  validateUserMessages?: boolean;

  /**
   * Whether to validate assistant responses after LLM.
   *
   * @defaultValue true
   */
  validateAssistantMessages?: boolean;

  /**
   * Whether to validate action calls.
   *
   * @remarks
   * Addresses SEC-005: Action call injection protection.
   *
   * @defaultValue true
   */
  validateActionCalls?: boolean;

  /**
   * Whether to validate action results.
   *
   * @defaultValue true
   */
  validateActionResults?: boolean;

  /**
   * Whether to validate streaming responses incrementally.
   *
   * @defaultValue false
   */
  validateStreaming?: boolean;

  /**
   * Stream validation mode.
   *
   * @remarks
   * Addresses SEC-002: Post-hoc stream validation bypass.
   *
   * @defaultValue 'incremental'
   */
  streamingMode?: 'incremental' | 'buffer';

  /**
   * Maximum buffer size for stream accumulation.
   *
   * @remarks
   * Addresses SEC-003: Accumulator buffer overflow.
   *
   * @defaultValue 1048576 (1MB)
   */
  maxStreamBufferSize?: number;

  /**
   * Maximum content length for validation.
   *
   * @remarks
   * Addresses SEC-010: Request size limit.
   *
   * @defaultValue 100000 (100KB)
   */
  maxContentLength?: number;

  /**
   * Production mode flag.
   *
   * @remarks
   * Addresses SEC-007: Information leakage in error messages.
   *
   * @defaultValue process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Validation timeout in milliseconds.
   *
   * @remarks
   * Addresses SEC-008: Missing timeout enforcement.
   *
   * @defaultValue 30000 (30 seconds)
   */
  validationTimeout?: number;

  /**
   * Callback invoked when input is blocked.
   *
   * @param result - The validation result that caused blocking.
   * @param context - The CopilotKit context.
   */
  onBlocked?: (result: GuardrailResult, context?: CopilotKitContext) => void;

  /**
   * Callback invoked when stream is blocked during validation.
   *
   * @param accumulated - The accumulated text content before blocking.
   * @param context - The CopilotKit context.
   */
  onStreamBlocked?: (accumulated: string, context?: CopilotKitContext) => void;

  /**
   * Callback invoked when an action call is blocked.
   *
   * @param action - The blocked action call.
   * @param result - The validation result.
   * @param context - The CopilotKit context.
   */
  onActionCallBlocked?: (
    action: CopilotKitAction,
    result: GuardrailResult,
    context?: CopilotKitContext,
  ) => void;

  /**
   * Allowed action names (whitelist).
   *
   * @remarks
   * S012-008: Action name validation to prevent dangerous action calls.
   * Supports wildcard patterns (e.g., 'search*', 'get.*').
   * If empty or undefined, all actions are allowed (only content validation applies).
   *
   * @defaultValue undefined (no whitelist)
   */
  allowedActionNames?: string[];

  /**
   * Blocked action names (blacklist).
   *
   * @remarks
   * S012-008: Dangerous action names to block explicitly.
   * Defaults to dangerous names like 'eval', 'exec', 'deleteDatabase', etc.
   *
   * @defaultValue ['eval', 'exec', 'deleteDatabase', 'dropTable', 'system', 'cmd', 'shell']
   */
  blockedActionNames?: string[];

  /**
   * Maximum action name length.
   *
   * @remarks
   * S012-008: Prevents excessively long action names that could be used in injection attacks.
   *
   * @defaultValue 100
   */
  maxActionNameLength?: number;

  /**
   * Maximum action arguments size.
   *
   * @remarks
   * S012-008: Prevents oversized action arguments that could cause DoS.
   *
   * @defaultValue 100000 (100KB)
   */
  maxArgumentsSize?: number;
}

/**
 * Error thrown when stream validation fails.
 *
 * @remarks
 * This error class is provided for type-checking and catching stream validation errors.
 */
export class StreamValidationError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
    public readonly blocked: boolean = true,
  ) {
    super(message);
    this.name = 'StreamValidationError';
  }
}

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
 * Hook result type.
 *
 * @internal
 * @remarks
 * Returned by hooks to indicate whether execution should continue.
 */
export interface HookResult {
  allowed: boolean;
  blockedReason?: string;
  modifiedContent?: string;
}
