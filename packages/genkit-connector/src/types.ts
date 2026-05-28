/**
 * Google Genkit Plugin Types
 * ===========================
 *
 * This file contains all TypeScript type definitions for the Genkit plugin connector.
 * Includes security-related options for flow wrapper integration, streaming validation,
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
 * Genkit message types (simplified for integration).
 *
 * @internal
 * @remarks
 * Genkit uses various message formats for flows and tools.
 * These types represent the common structures we need to validate.
 */
export interface GenkitMessage {
  role: 'user' | 'model' | 'system' | 'tool';
  content: string | GenkitContentPart[];
  metadata?: Record<string, unknown>;
}

/**
 * Genkit content part types for structured messages.
 *
 * @internal
 */
export interface GenkitContentPart {
  type: 'text' | 'image' | 'data' | 'toolRequest' | 'toolResponse';
  text?: string;
  image?: { url?: string; mediaType?: string };
  data?: string;
  toolRequest?: {
    name: string;
    input?: Record<string, unknown>;
  };
  toolResponse?: {
    name: string;
    output?: Record<string, unknown>;
  };
}

/**
 * Genkit flow execution context.
 *
 * @internal
 */
export interface GenkitFlowContext {
  flowName?: string;
  sessionId?: string;
  userId?: string;
}

/**
 * Genkit tool call structure.
 *
 * @internal
 * @remarks
 * Tool calls need special validation per SEC-005.
 */
export interface GenkitToolCall {
  name: string;
  input?: Record<string, unknown>;
}

/**
 * Configuration options for the Genkit guardrail plugin.
 *
 * @remarks
 * All security options are included to address identified vulnerabilities.
 */
export interface GuardedGenkitOptions {
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
   * Whether to validate flow inputs.
   *
   * @defaultValue true
   */
  validateFlowInput?: boolean;

  /**
   * Whether to validate flow outputs.
   *
   * @defaultValue true
   */
  validateFlowOutput?: boolean;

  /**
   * Whether to validate tool calls.
   *
   * @remarks
   * Addresses SEC-005: Tool call injection protection.
   *
   * @defaultValue true
   */
  validateToolCalls?: boolean;

  /**
   * Whether to validate tool responses.
   *
   * @defaultValue true
   */
  validateToolResponses?: boolean;

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
   * @param context - The Genkit execution context.
   */
  onBlocked?: (result: GuardrailResult, context?: GenkitFlowContext) => void;

  /**
   * Callback invoked when stream is blocked during validation.
   *
   * @param accumulated - The accumulated text content before blocking.
   * @param context - The Genkit execution context.
   */
  onStreamBlocked?: (accumulated: string, context?: GenkitFlowContext) => void;

  /**
   * Callback invoked when a tool call is blocked.
   *
   * @param toolCall - The blocked tool call.
   * @param result - The validation result.
   * @param context - The Genkit execution context.
   */
  onToolCallBlocked?: (toolCall: GenkitToolCall, result: GuardrailResult, context?: GenkitFlowContext) => void;
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
 * Flow wrapper result type.
 *
 * @internal
 * @remarks
 * Returned by flow wrappers to indicate whether execution should continue.
 */
export interface FlowHookResult {
  allowed: boolean;
  blockedReason?: string;
  modifiedContent?: string;
}
