/**
 * MCP SDK Guarded Wrapper
 * =========================
 *
 * Provides security guardrails for MCP SDK operations.
 *
 * Security Features:
 * - SEC-005: Tool call injection via JSON.stringify - schema validation
 * - SEC-007: Production mode error messages
 * - SEC-008: Validation timeout via validateWithTimeoutSecure (Sprint 30)
 * - DEV-001: Correct GuardrailEngine.validate() API (string context)
 * - DEV-002: Proper logger integration
 *
 * @package @blackunicorn/bonklm-mcp
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  createLogger,
  createResult,
  GuardrailEngine,
  type GuardrailResult,
  IndirectInjectionValidator,
  type Logger,
  sanitizeLogString,
  sanitizeMeta,
  serializeError,
  Severity,
  validateWithTimeoutSecure
} from '@blackunicorn/bonklm';
import { ConnectorValidationError, logValidationFailure } from '@blackunicorn/bonklm/core/connector-utils';
import type { GuardedMCPOptions, ToolCallOptions, ToolCallResult, ToolInfo } from './types.js';
import {
  DEFAULT_MAX_ARGUMENT_SIZE,
  DEFAULT_MAX_DECODED_BLOB_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
  MAX_TOOL_NAME_LENGTH,
  VALID_TOOL_NAME_PATTERN
} from './types.js';
import { validatePositiveNumber } from '@blackunicorn/bonklm/core/connector-utils';
import {
  buildScanViews,
  extractResultContent,
  MAX_EXTRACTION_DEPTH,
  MAX_SEGMENTS,
  MAX_TOTAL_SCAN_BYTES
} from './result-extraction.js';

/**
 * Interface for the guarded MCP client wrapper.
 *
 * @internal
 */
interface GuardedMCPClient {
  callTool(opts: ToolCallOptions): Promise<ToolCallResult>;
  listTools(): Promise<{ tools: ToolInfo[] }>;
  close(): Promise<void>;
}

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
 * SEC-005: Validates and sanitizes a tool name.
 *
 * @internal
 * @remarks
 * - Checks against allowlist if provided
 * - Validates name format (alphanumeric, underscore, hyphen only)
 * - Enforces maximum length
 * - Returns sanitized name for validation
 *
 * @throws {ConnectorValidationError} If tool name is invalid or not in allowlist
 */
function validateToolName(name: string, allowedTools?: string[]): string {
  // CWE-117: `name` is attacker-influenceable (an agent populates it from a
  // remote `listTools()` response). The validation logic runs on the raw value,
  // but every error MESSAGE embeds the SANITIZED form — the allowlist + format
  // branches fire precisely when `name` may carry CR/LF / control chars, and a
  // caller logging `error.message` would otherwise forge log lines (whole-file
  // sink sweep on touch, per ADR-0001).
  // Check allowlist first
  if (allowedTools && allowedTools.length > 0) {
    if (!allowedTools.includes(name)) {
      throw new ConnectorValidationError(
        `Tool '${sanitizeMeta(name)}' is not in the allowed tools list`,
        'allowlist_violation'
      );
    }
  }

  // Validate name format
  if (!VALID_TOOL_NAME_PATTERN.test(name)) {
    throw new ConnectorValidationError(
      `Tool name '${sanitizeMeta(name)}' contains invalid characters. Only alphanumeric, underscore, and hyphen are allowed.`,
      'invalid_format'
    );
  }

  // Validate length
  if (name.length > MAX_TOOL_NAME_LENGTH) {
    throw new ConnectorValidationError(
      `Tool name '${sanitizeMeta(name)}' exceeds maximum length of ${MAX_TOOL_NAME_LENGTH}`,
      'size_limit_exceeded'
    );
  }

  return name;
}

/**
 * SEC-005: Sanitizes tool name for validation content.
 *
 * @internal
 * @remarks
 * Removes any path traversal patterns and ensures the name is safe.
 * This is used when creating the validation string, not for actual tool calls.
 */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * SEC-005: Validates tool arguments size.
 *
 * @internal
 * @remarks
 * Ensures the serialized arguments don't exceed the size limit.
 * This prevents DoS attacks via large argument payloads.
 *
 * @throws {ConnectorValidationError} If arguments exceed maximum size or contain circular references
 */
function validateArgumentSize(args: Record<string, unknown>, maxSize: number): string {
  let argsStr: string;
  try {
    argsStr = JSON.stringify(args);
  } catch (error) {
    // Handle circular references or unstringifiable content
    if (error instanceof Error && error.message.includes('circular')) {
      throw new ConnectorValidationError(
        'Tool arguments contain circular references or unstringifiable content',
        'serialization_error'
      );
    }
    throw error;
  }

  if (argsStr.length > maxSize) {
    throw new ConnectorValidationError(
      `Tool arguments exceed maximum size of ${maxSize} bytes (got ${argsStr.length} bytes)`,
      'size_limit_exceeded'
    );
  }
  return argsStr;
}

/**
 * Creates a guarded MCP wrapper that intercepts and validates all tool calls.
 *
 * @param client - The MCP client instance to wrap
 * @param options - Configuration options for the guarded wrapper
 * @returns An object with callTool and listTools methods that validate input/output
 *
 * @remarks
 * When `validateToolResults` is enabled (the default), inbound tool results are
 * scanned by an `IndirectInjectionValidator` scoped to the `tool_result` surface
 * — on top of any `validators` you supply, with no opt-in required (task-hijack /
 * objective-replacement directives, forged ReAct instruction tokens, forged
 * agent-instrumentation footers, exfil directives). The scan runs only on the
 * incoming result content, never on outgoing tool-call arguments; your own
 * `validators` run on both surfaces.
 *
 * The scanned content is **every scannable text leaf** of the result — top-level
 * `text` items, `resource.text` / `resource.uri`, and recursively-collected
 * string leaves of embedded structured content — across the newline-joined view,
 * a separator-free concatenation (so a contiguous attack token split across
 * content items is reconstructed), and each leaf independently. Boundaries:
 * - **Binary/base64 blobs** (`image` / `audio` `data`, `resource.blob`) are not
 *   decoded+scanned unless `decodeBinaryContent: true`; otherwise a `warn` is
 *   emitted for a binary-only result, and a `debug` signal when uninspectable
 *   blobs accompany text that was scanned — never a silent pass.
 * - The `tool_result` surface is **asserted by this connector**; the `Provenance`
 *   wire-envelope is not stamped or verified here — a separate increment.
 * - Result content beyond the depth / leaf-count / byte scan bounds has its tail
 *   left unscanned, flagged via telemetry. See `docs/user/known-limitations.md`.
 *
 * Set `validateToolResults: false` to disable the scan along with all other
 * result-path validation.
 *
 * @example
 * ```ts
 * import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 * import { createGuardedMCP } from '@blackunicorn/bonklm-mcp';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const mcpClient = new Client();
 * const guardedMCP = createGuardedMCP(mcpClient, {
 *   validators: [new PromptInjectionValidator()],
 *   allowedTools: ['calculator', 'weather'],
 *   validateToolCalls: true,
 *   validateToolResults: true,
 * });
 *
 * const result = await guardedMCP.callTool({
 *   name: 'calculator',
 *   arguments: { operation: 'add', a: 5, b: 10 }
 * });
 * ```
 */
export function createGuardedMCP(client: Client, options: GuardedMCPOptions = {}): GuardedMCPClient {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER, // DEV-002: Use proper logger
    validateToolCalls = true,
    validateToolResults = true,
    allowedTools, // SEC-005: Tool allowlist
    maxArgumentSize = DEFAULT_MAX_ARGUMENT_SIZE, // SEC-005: Default 100KB
    productionMode = process.env.NODE_ENV === 'production', // SEC-007
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT, // SEC-008: Default 5s
    decodeBinaryContent = false, // Tool-result ingress: opt-in base64 decode-and-scan
    maxDecodedBlobSize = DEFAULT_MAX_DECODED_BLOB_SIZE, // Decode-and-scan DoS bound
    onToolCallBlocked,
    onToolResultBlocked
  } = options;

  // Validate critical security options
  validatePositiveNumber(maxArgumentSize, 'maxArgumentSize');
  validatePositiveNumber(validationTimeout, 'validationTimeout');
  validatePositiveNumber(maxDecodedBlobSize, 'maxDecodedBlobSize');

  // Tool-CALL / input path: the caller-supplied chain, unchanged.
  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  // Tool-RESULT / ingress path: the caller's chain PLUS a provenance-gated
  // indirect-injection validator bound to the `tool_result` surface. The
  // connector — not the caller — knows that a tool result carries `tool_result`
  // provenance, so it establishes the surface itself. Without this, a caller's
  // bare `IndirectInjectionValidator()` (no `surface`) receives only a string on
  // the `engine.validate(content)` path and short-circuits to allow — i.e. the
  // ingress scan would be inert under the documented default config. Appending a
  // pre-surfaced instance makes tool-result indirect-injection coverage the
  // secure default whenever `validateToolResults` is on.
  const resultEngine = new GuardrailEngine({
    validators: [...validators, new IndirectInjectionValidator({ surface: 'tool_result' })],
    guards,
    logger
  });

  /**
   * SEC-008: Validation timeout wrapper (Sprint 30: routes through canonical validateWithTimeoutSecure primitive).
   *
   * @internal
   */
  const validateWithTimeout = async (
    engineToUse: GuardrailEngine,
    content: string,
    context?: string
  ): Promise<GuardrailResult[]> => {
    // DEV-001: Correct API signature - use string context, not object
    const engineResult = await validateWithTimeoutSecure({
      operation: () => engineToUse.validate(content, context),
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
   * Validates tool call and throws if blocked.
   *
   * @internal
   */
  const validateToolCall = async (toolName: string, args: string): Promise<void> => {
    // Create validation string with sanitized tool name
    const sanitizedName = sanitizeToolName(toolName);
    const validationContent = `Tool: ${sanitizedName}, Args: ${args}`;

    const results = await validateWithTimeout(engine, validationContent, 'input');

    const blocked = results.find(r => !r.allowed);
    if (blocked) {
      // S012-001: Use connector-utils validation failure logging
      logValidationFailure(logger, blocked.reason || 'Content blocked', { tool: toolName });

      if (onToolCallBlocked) {
        onToolCallBlocked(blocked, toolName);
      }

      // SEC-007: Production mode - generic error
      if (productionMode) {
        throw new Error('Tool call blocked');
      }
      // Sprint 42 CWE-117 sweep — surfaced by integration test:
      // `blocked.reason` is built from validator output and may carry
      // attacker-influenced text (matched-pattern slice with embedded
      // `\n`). Pre-Sprint-42, the dev-mode error message embedded the
      // raw value; if the caller logs `error.message` through a
      // downstream logger, the raw CR/LF forges phantom log lines.
      // Sanitize at the throw site per Sprint 41 defensive-by-default
      // policy.
      throw new Error(`Tool call blocked: ${sanitizeMeta(blocked.reason)}`);
    }
  };

  /**
   * Validates tool result and may replace content.
   *
   * @internal
   */
  const validateToolResult = async (toolName: string, resultContent: string): Promise<ToolCallResult | null> => {
    const results = await validateWithTimeout(resultEngine, resultContent, 'output');

    const blocked = results.find(r => !r.allowed);
    if (blocked) {
      // S012-001: Use connector-utils validation failure logging
      logValidationFailure(logger, blocked.reason || 'Content blocked', { tool: toolName });

      if (onToolResultBlocked) {
        onToolResultBlocked(blocked, toolName);
      }

      // Return filtered result.
      // Sprint 42 CWE-117 sweep — surfaced by integration test: this
      // is the SISTER site of the error-catch fallback filteredText
      // (~line 402) that Sprint 40 wrapped. The Sprint 40 sweep missed
      // this NON-error path. An adversarial remote MCP server's
      // tool-result text can drive validator output with
      // control-char-laden `blocked.reason`; the unsanitized
      // filteredText propagates into chat UI / agent transcript /
      // terminal output. Per Sprint 41 defensive-by-default policy:
      // sanitize at the connector boundary regardless of downstream
      // rendering context.
      const filteredText = productionMode
        ? 'Tool result filtered by guardrails'
        : `Tool result filtered by guardrails: ${sanitizeMeta(blocked.reason)}`;

      return {
        content: [
          {
            type: 'text',
            text: filteredText
          }
        ],
        filtered: true
      };
    }

    return null; // Not blocked
  };

  /**
   * Creates the guarded wrapper object.
   *
   * @internal
   */
  const createGuardedWrapper = (): GuardedMCPClient => {
    return {
      /**
       * Calls an MCP tool with validation.
       *
       * @param opts - Tool call options including name and arguments
       * @returns Tool call result, potentially filtered
       */
      async callTool(opts: ToolCallOptions): Promise<ToolCallResult> {
        const { name, arguments: args = {} } = opts;

        // SEC-005: Validate tool name against allowlist and format
        validateToolName(name, allowedTools);

        // SEC-005: Validate argument size before processing
        const argsStr = validateArgumentSize(args, maxArgumentSize);

        // Validate tool call if enabled
        if (validateToolCalls) {
          await validateToolCall(name, argsStr);
        }

        // Execute the tool call
        const result = await client.callTool({
          name,
          arguments: args
        });

        // Validate tool result if enabled
        if (validateToolResults) {
          // Tool-result ingress hardening: extract EVERY scannable text leaf —
          // not just top-level `type:'text'` items. A remote MCP server can hide
          // an indirect-injection payload in `resource.text`, a `resource.uri`,
          // an embedded structured-content string leaf, or a base64 blob; the
          // pre-hardening extractor saw only the text channel and skipped the
          // rest entirely (documented blind spot, known-limitations §30).
          const extracted = extractResultContent(result, {
            decodeBinaryContent,
            maxDecodedBlobSize
          });

          // Bounded extraction: if the result exceeded the leaf-count / byte
          // budget OR nested past the depth bound, its tail is NOT scanned.
          // Surface that as telemetry rather than silently under-scanning a
          // (possibly hostile) oversized / deeply-nested result.
          if (extracted.truncated) {
            logger.warn('[Guardrails] MCP tool result exceeded scan bounds (size/depth); tail left unscanned', {
              tool: sanitizeMeta(name),
              maxSegments: MAX_SEGMENTS,
              maxBytes: MAX_TOTAL_SCAN_BYTES,
              maxDepth: MAX_EXTRACTION_DEPTH
            });
          }

          // Build the set of strings to scan: the historical newline-joined view
          // PLUS a separator-free concatenation (reconstructs a contiguous attack
          // token an attacker split across two content items to dodge arms with
          // no inter-token whitespace allowance) PLUS each leaf independently
          // (defeats benign-padding / truncation-window evasion). Deduped, and
          // ordered so the two FULL-content views (joined, concat) are scanned
          // first — if the aggregate scan budget below cuts the per-leaf tail,
          // the entire content has still been inspected at least once.
          const views = buildScanViews(extracted.segments);

          if (views.length > 0) {
            try {
              // Aggregate wall-clock budget across ALL views, on top of each
              // view's own validationTimeout. Without it, a hostile result with
              // many leaves could force views.length sequential timeouts
              // (leaf-count cap × validationTimeout) on a single call. Total
              // result-scan time is bounded to ~2× validationTimeout.
              const scanStartedAt = Date.now();
              for (let i = 0; i < views.length; i++) {
                if (i > 0 && Date.now() - scanStartedAt > validationTimeout) {
                  logger.warn('[Guardrails] MCP tool-result scan budget exhausted; remaining views left unscanned', {
                    tool: sanitizeMeta(name),
                    scanned: i,
                    total: views.length
                  });
                  break;
                }

                const filteredResult = await validateToolResult(name, views[i]);

                if (filteredResult) {
                  return {
                    ...filteredResult,
                    raw: result
                  };
                }
              }
            } catch (error) {
              // Handle unexpected validation errors
              // Sprint 40 connector CWE-117 sweep: `name` is the MCP
              // tool name, which arrives from a remote server and is
              // attacker-controlled. Route through sanitizeLogString.
              // `error` now uses Sprint 33's canonical `serializeError`
              // instead of inline `instanceof Error` extraction.
              logger.error('[Guardrails] Tool result validation error', {
                tool: sanitizeMeta(name),
                error: serializeError(error)
              });
              // Fail-closed: return filtered result on validation error.
              // Sprint 40 code-reviewer MEDIUM closure: in non-production
              // mode the `error.message` interpolates directly into the
              // MCP tool-result text returned to the caller. An adversarial
              // remote MCP server could craft an error whose message
              // contains HTML / ANSI / control-char sequences that hijack
              // the developer's terminal or IDE output. Sanitize the
              // interpolated value at the boundary.
              const filteredText = productionMode
                ? 'Tool result validation error'
                : `Tool result validation error: ${sanitizeMeta(error instanceof Error ? error.message : error)}`;

              return {
                content: [
                  {
                    type: 'text',
                    text: filteredText
                  }
                ],
                filtered: true
              };
            }
          } else if (extracted.uninspectableCount > 0) {
            // Tool-result ingress hardening: the result carried ONLY non-text
            // binary/base64 content (no scannable text leaf, decode opt-out).
            // Do NOT silently pass it as if it had been inspected — surface a
            // telemetry signal so an operator can see that an uninspectable
            // channel rode through unscanned. Tool name + blob kinds originate
            // from the remote server, so both are CWE-117-sanitized.
            logger.warn(
              '[Guardrails] MCP tool result contained only uninspectable non-text content; channel passed unscanned',
              {
                tool: sanitizeMeta(name),
                blobCount: extracted.uninspectableCount,
                blobKinds: extracted.uninspectableKinds.map(k => sanitizeLogString(k))
              }
            );
          }

          // Observability: text WAS scanned, but binary blob(s) rode alongside
          // it uninspected (decode opt-out). Lower signal than the warn above;
          // emitted at debug so it does not flood logs on image-returning tools.
          if (views.length > 0 && extracted.uninspectableCount > 0) {
            logger.debug('[Guardrails] MCP tool result mixed scanned text with uninspectable non-text content', {
              tool: sanitizeMeta(name),
              blobCount: extracted.uninspectableCount,
              blobKinds: extracted.uninspectableKinds.map(k => sanitizeLogString(k))
            });
          }
        }

        // Validate result structure before returning
        return result as ToolCallResult;
      },

      /**
       * Lists available tools, filtered by allowlist if specified.
       *
       * @returns List of available tools
       */
      async listTools(): Promise<{ tools: ToolInfo[] }> {
        const toolsResult = await client.listTools();

        // SEC-005: Filter by allowlist if specified
        if (allowedTools && allowedTools.length > 0) {
          return {
            tools: toolsResult.tools.filter((tool: ToolInfo) => allowedTools.includes(tool.name))
          };
        }

        return toolsResult as { tools: ToolInfo[] };
      },

      /**
       * Closes the MCP client connection.
       */
      async close(): Promise<void> {
        return client.close();
      }
    };
  };

  return createGuardedWrapper();
}

/**
 * Re-exports types for convenience.
 */
export type { GuardedMCPOptions, ToolCallOptions, ToolCallResult, ToolInfo };
