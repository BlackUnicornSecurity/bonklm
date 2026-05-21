/**
 * MCP SDK Connector Types
 *
 * This file contains all TypeScript type definitions for the MCP SDK connector.
 * Includes security-related options for tool call validation, argument size limits,
 * and production mode error handling.
 *
 * Security Features:
 * - SEC-005: Tool call injection via JSON.stringify - schema validation
 * - SEC-007: Production mode error messages
 * - SEC-008: Validation timeout
 * - DEV-001: Correct GuardrailEngine API
 * - DEV-002: Logger type
 */

import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';
import {
  ConnectorConfigurationError,
  ConnectorTimeoutError,
  ConnectorValidationError,
  StreamValidationError,
} from '@blackunicorn/bonklm';

/**
 * Configuration options for the guarded MCP wrapper.
 *
 * @remarks
 * All security options are included to address identified vulnerabilities.
 */
export interface GuardedMCPOptions {
  /**
   * Validators to apply to tool calls and results.
   */
  validators?: Validator[];

  /**
   * Guards to apply to tool calls and results.
   */
  guards?: Guard[];

  /**
   * Logger instance for validation events.
   *
   * @defaultValue createLogger('console')
   */
  logger?: Logger;

  /**
   * Whether to validate tool calls before execution.
   *
   * @defaultValue true
   */
  validateToolCalls?: boolean;

  /**
   * Whether to validate tool results after execution.
   *
   * @defaultValue true
   */
  validateToolResults?: boolean;

  /**
   * Allowed tool names (allowlist).
   *
   * @remarks
   * When specified, only tools in this list can be called.
   * This is a critical security control to prevent unauthorized tool access.
   *
   * Addresses SEC-005: Tool call injection.
   *
   * @defaultValue undefined (all tools allowed)
   */
  allowedTools?: string[];

  /**
   * Maximum size for tool arguments in bytes.
   *
   * @remarks
   * Prevents DoS attacks via excessively large argument payloads.
   * Tool calls exceeding this size will be rejected.
   *
   * Addresses SEC-005: Tool call injection via large payloads.
   *
   * @defaultValue 102400 (100KB)
   */
  maxArgumentSize?: number;

  /**
   * Production mode flag.
   *
   * @remarks
   * When true, error messages are generic to avoid leaking security information.
   * When false, detailed error messages include the reason for blocking.
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
   * Uses AbortController for timeout enforcement.
   *
   * Addresses SEC-008: Missing timeout enforcement.
   *
   * @defaultValue 5000 (5 seconds for tool calls)
   */
  validationTimeout?: number;

  /**
   * Callback invoked when a tool call is blocked.
   *
   * @param result - The validation result that caused blocking.
   * @param toolName - The name of the tool whose call was blocked.
   */
  onToolCallBlocked?: (result: GuardrailResult, toolName: string) => void;

  /**
   * Callback invoked when a tool result is blocked.
   *
   * @param result - The validation result that caused blocking.
   * @param toolName - The name of the tool whose result was blocked.
   */
  onToolResultBlocked?: (result: GuardrailResult, toolName: string) => void;

  /**
   * Story 0.1 (R2-7): bypass the core engine's empty-list fail-safe.
   * Test-only escape hatch; logs a CRITICAL warning when honored.
   *
   * @defaultValue false
   */
  allowEmptyForTesting?: boolean;
}

/**
 * Options for calling an MCP tool.
 *
 * @remarks
 * Matches the MCP SDK's CallToolRequestSchema structure.
 */
export interface ToolCallOptions {
  /**
   * The name of the tool to call.
   */
  name: string;

  /**
   * The arguments to pass to the tool.
   *
   * @remarks
   * These will be validated against the tool's schema and size limits.
   */
  arguments?: Record<string, unknown>;
}

/**
 * Result from a tool call that may be filtered.
 */
export interface ToolCallResult {
  /**
   * The tool result content, or a placeholder if filtered.
   */
  content: Array<{ type: string; text?: string; data?: string }>;

  /**
   * Whether the result was filtered by guardrails.
   */
  filtered?: boolean;

  /**
   * The original tool result if available.
   */
  raw?: unknown;
}

/**
 * Tool information from listTools response.
 */
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Default max argument size (100KB).
 *
 * @internal
 */
export const DEFAULT_MAX_ARGUMENT_SIZE = 1024 * 100;

/**
 * Default validation timeout (5 seconds).
 *
 * @internal
 */
export const DEFAULT_VALIDATION_TIMEOUT = 5000;

/**
 * Valid characters for tool names.
 *
 * @internal
 * @remarks
 * Tool names should only contain alphanumeric characters, underscores, and hyphens.
 */
export const VALID_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Maximum allowed tool name length.
 *
 * @internal
 */
export const MAX_TOOL_NAME_LENGTH = 128;

// Re-export error classes from core for connector use
export {
  StreamValidationError,
  ConnectorValidationError,
  ConnectorConfigurationError,
  ConnectorTimeoutError,
};
