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
import {
  ConnectorValidationError,
  extractContentFromResponse,
  logValidationFailure
} from '@blackunicorn/bonklm/core/connector-utils';
import type { GuardedMCPOptions, ToolCallOptions, ToolCallResult, ToolInfo } from './types.js';
import {
  DEFAULT_MAX_ARGUMENT_SIZE,
  DEFAULT_MAX_DECODED_BLOB_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
  MAX_TOOL_NAME_LENGTH,
  VALID_TOOL_NAME_PATTERN
} from './types.js';
import { validatePositiveNumber } from '@blackunicorn/bonklm/core/connector-utils';

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
 *   decoded+scanned unless `decodeBinaryContent: true`; otherwise an
 *   uninspectable-channel `warn` is emitted rather than silently passing.
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
 * Options controlling how an MCP tool result is reduced to scannable content.
 *
 * @internal
 */
interface ResultExtractOptions {
  /** Bounded-decode base64 binary blobs to UTF-8 and scan them. */
  decodeBinaryContent: boolean;
  /** Max decoded size, in bytes, for a single base64 blob. */
  maxDecodedBlobSize: number;
}

/**
 * Mutable accumulator threaded through the recursive extraction walk.
 *
 * @internal
 */
interface LeafAccumulator {
  /** Scannable text leaves collected so far. */
  segments: string[];
  /** Kind labels of binary/base64 blobs left uninspectable. */
  blobs: string[];
  /** Running total byte length of `segments` (cumulative DoS bound). */
  bytes: number;
  /** Set once a collection bound is hit; further leaves are dropped + flagged. */
  truncated: boolean;
}

/**
 * Scannable content extracted from an MCP tool result.
 *
 * @internal
 */
interface ExtractedResultContent {
  /**
   * Every independently-scannable text leaf: top-level `text` items,
   * `resource.text` / `resource.uri`, recursively-collected string leaves of
   * embedded structured content, and (when opted in) decoded base64 blobs.
   */
  segments: string[];
  /** Count of binary/base64 blobs that were NOT decoded + scanned. */
  uninspectableCount: number;
  /** Distinct kind labels of the uninspectable blobs (telemetry only). */
  uninspectableKinds: string[];
  /** True if a collection bound (count/bytes) was hit and the tail was dropped. */
  truncated: boolean;
}

/**
 * Maximum object-graph depth walked when collecting string leaves from embedded
 * structured content. Bounds work on a hostile, deeply-nested result. Content
 * nested deeper than this is a documented recall gap (known-limitations §30).
 *
 * @internal
 */
const MAX_EXTRACTION_DEPTH = 6;

/**
 * Object keys that are protocol structure, not attacker payload — skipped during
 * recursive leaf collection so discriminators / MIME types are not scanned as
 * content (they are pure noise and never carry an injection). Deliberately NARROW
 * (`annotations` is NOT skipped — an adversarial server is not bound by the MCP
 * schema and could smuggle a directive string under it).
 *
 * @internal
 */
const STRUCTURAL_KEYS = new Set(['type', 'mimeType']);

/**
 * Content-block `type` values whose `data` field is base64 binary per the MCP
 * spec. A `data` string is routed to blob handling ONLY when the enclosing block
 * is one of these — a `data` field on any other block (e.g. a forged `text`
 * block) is scanned as text, so an attacker cannot exclude a payload from the
 * scan by parking it in a field named `data`.
 *
 * @internal
 */
const BINARY_CONTENT_TYPES = new Set(['image', 'audio']);

/**
 * Upper bounds on extraction breadth. The number of collected leaves and their
 * cumulative byte length are capped so a hostile result (many tiny items / a
 * huge field) cannot drive unbounded memory or scan time. Hitting either bound
 * sets {@link LeafAccumulator.truncated}, which surfaces as telemetry. Because
 * the leaf count is capped here, every collected leaf is also scanned
 * independently in {@link buildScanViews} — there is no separate per-item cap.
 *
 * @internal
 */
const MAX_SEGMENTS = 64;
const MAX_TOTAL_SCAN_BYTES = 256 * 1024;

/**
 * Appends a scannable leaf, enforcing the count + cumulative-byte bounds.
 *
 * @internal
 */
function pushSegment(acc: LeafAccumulator, value: string): void {
  if (acc.truncated || value.length === 0) {
    return;
  }
  if (acc.segments.length >= MAX_SEGMENTS || acc.bytes + value.length > MAX_TOTAL_SCAN_BYTES) {
    acc.truncated = true;
    return;
  }
  acc.segments.push(value);
  acc.bytes += value.length;
}

/**
 * Bounded base64 → UTF-8 decode for an opt-in decode-and-scan of binary blobs.
 *
 * @internal
 * @remarks
 * Rejects (returns `null`) any blob whose encoded length could exceed the byte
 * bound before allocating, and any decoded buffer over the bound or empty. This
 * caps the amplification / DoS surface of decoding attacker-controlled base64.
 */
function tryDecodeBase64(b64: string, maxBytes: number): string | null {
  if (b64.length === 0) {
    return null;
  }
  // base64 encodes ~3 bytes per 4 chars; reject oversized input pre-allocation.
  if (b64.length > Math.ceil((maxBytes * 4) / 3) + 4) {
    return null;
  }
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0 || buf.length > maxBytes) {
      return null;
    }
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Routes a base64 binary blob to either a decoded scannable segment (opt-in) or
 * the uninspectable bucket.
 *
 * @internal
 */
function handleBlob(b64: string, kind: string, acc: LeafAccumulator, opts: ResultExtractOptions): void {
  if (opts.decodeBinaryContent) {
    // `tryDecodeBase64` returns null for an empty/over-bound decode, so a
    // non-null result is always a non-empty string.
    const decoded = tryDecodeBase64(b64, opts.maxDecodedBlobSize);
    if (decoded !== null) {
      pushSegment(acc, decoded);
      return;
    }
    // Decode failed or exceeded the bound — fall through to uninspectable.
  }
  acc.blobs.push(kind);
}

/**
 * Recursively collects string leaves from an MCP content item (or nested
 * structured value), routing base64 `data` / `blob` fields to {@link handleBlob}.
 *
 * @internal
 */
function collectStringLeaves(
  value: unknown,
  acc: LeafAccumulator,
  opts: ResultExtractOptions,
  depth: number,
  kindHint: string
): void {
  if (acc.truncated) {
    return;
  }
  if (depth > MAX_EXTRACTION_DEPTH) {
    // Depth-cut is a form of "tail left unscanned"; flag it like the size caps
    // so a deep-nesting evasion produces an operator signal, not silence.
    acc.truncated = true;
    return;
  }
  if (typeof value === 'string') {
    pushSegment(acc, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringLeaves(entry, acc, opts, depth + 1, kindHint);
    }
    return;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const hint = typeof obj.type === 'string' ? obj.type : kindHint;
    for (const [key, child] of Object.entries(obj)) {
      if (STRUCTURAL_KEYS.has(key)) {
        continue;
      }
      // Route base64 binary to blob handling ONLY for genuinely-binary fields:
      // a `resource.blob`, or a `data` field on an image/audio block. A `data`
      // field anywhere else is scanned as text (see BINARY_CONTENT_TYPES) so a
      // payload cannot be hidden from the scan by naming its field `data`.
      if (typeof child === 'string') {
        if (key === 'blob') {
          handleBlob(child, 'resource.blob', acc, opts);
          continue;
        }
        if (key === 'data' && BINARY_CONTENT_TYPES.has(hint)) {
          handleBlob(child, hint, acc, opts);
          continue;
        }
      }
      collectStringLeaves(child, acc, opts, depth + 1, hint);
    }
  }
}

/**
 * Reduces an MCP tool result to every scannable text leaf plus a tally of the
 * binary blobs that could not be inspected.
 *
 * @internal
 * @remarks
 * For an MCP `content[]` result this walks each item, collecting string leaves
 * (text items, `resource.text` / `resource.uri`, embedded structured-content
 * strings) and routing base64 `data` / `blob` fields per the decode policy. For
 * a non-MCP-shaped result it falls back to the generic multi-format extractor.
 */
function extractResultContent(result: unknown, opts: ResultExtractOptions): ExtractedResultContent {
  const acc: LeafAccumulator = { segments: [], blobs: [], bytes: 0, truncated: false };

  if (result && typeof result === 'object' && Array.isArray((result as { content?: unknown[] }).content)) {
    for (const item of (result as { content: unknown[] }).content) {
      collectStringLeaves(item, acc, opts, 0, 'binary');
    }
  } else {
    // Fallback to connector-utils for generic (non-MCP) response formats.
    pushSegment(acc, extractContentFromResponse(result, { defaultValue: '' }));
  }

  return {
    segments: acc.segments,
    uninspectableCount: acc.blobs.length,
    uninspectableKinds: [...new Set(acc.blobs)],
    truncated: acc.truncated
  };
}

/**
 * Builds the deduplicated set of strings to scan from the extracted leaves.
 *
 * @internal
 * @remarks
 * - The newline-joined view preserves the historical single-scan behaviour.
 * - The separator-free concatenation reconstructs a contiguous attack token an
 *   attacker split across two content items to slip past arms with no
 *   inter-token whitespace allowance (e.g. `AGENT_` + `FOOTER` → `AGENT_FOOTER`).
 * - Each leaf is also scanned independently to defeat benign-padding /
 *   truncation-window evasion. The leaf count is already capped upstream
 *   (MAX_SEGMENTS), so every collected leaf is scanned; the joined and
 *   concatenated views still carry the full collected content.
 */
function buildScanViews(segments: string[]): string[] {
  const views: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string): void => {
    if (candidate.length > 0 && !seen.has(candidate)) {
      seen.add(candidate);
      views.push(candidate);
    }
  };

  add(segments.join('\n'));

  if (segments.length > 1) {
    add(segments.join(''));
    for (const segment of segments) {
      add(segment);
    }
  }

  return views;
}

/**
 * Re-exports types for convenience.
 */
export type { GuardedMCPOptions, ToolCallOptions, ToolCallResult, ToolInfo };
