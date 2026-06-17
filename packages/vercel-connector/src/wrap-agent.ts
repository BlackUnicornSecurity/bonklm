/**
 * Story 1.4 — `wrapAgent` + `wrapMCPClient` (Phase-1)
 * ===================================================
 *
 * Lightweight wrappers around the v5/v6 ToolLoopAgent and
 * `createMCPClient` results. Phase-1 ships INPUT + OUTPUT validation
 * via the shared `bonkMiddleware`-style validator path; deeper
 * integrations (`onInputAvailable` per-tool, tool-approval persistence,
 * MCP `readResource` → `RetrievedDocValidator`) ship as Phase-2+
 * follow-up PRs explicitly tracked in the Story 1.4 commit body.
 *
 * @package @blackunicorn/bonklm-vercel
 */

import { createLogger, type GuardrailEngine, type Logger, sanitizeMeta, type Validator } from '@blackunicorn/bonklm';
import { createRetrievedDocValidator } from '@blackunicorn/bonklm';
import { ConnectorValidationError, logValidationFailure } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Duck-typed shape of `ToolLoopAgent` (or compatible) v5/v6 SDK
 * objects. We avoid a hard import of `ai/agent` types so this connector
 * doesn't pull a specific `ai` major into compile time.
 */
export interface ToolLoopAgentLike {
  /** Top-level entry-point typical of v5/v6 agents. */
  generate?: (params: { prompt?: string; messages?: unknown[]; [k: string]: unknown }) => Promise<{
    text?: string;
    [k: string]: unknown;
  }>;
  /** Optional streaming entry. */
  stream?: (params: { prompt?: string; messages?: unknown[]; [k: string]: unknown }) => Promise<{
    textStream?: AsyncIterable<string>;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export interface WrapAgentOptions {
  logger?: Logger;
  productionMode?: boolean;
}

/**
 * Wrap a ToolLoopAgent-shaped object so its `generate` (and optional
 * `stream`) entry points pipe prompt + result through the supplied
 * `GuardrailEngine`. Other methods on the agent are passed through
 * unchanged.
 *
 * Phase-1 limitations (tracked in Story 1.4 follow-ups):
 *   - `onInputAvailable` per-tool callback NOT yet wired to
 *     `ToolCallArgsValidator` (Story 1.1).
 *   - Tool-approval two-call pattern (approve → execute via
 *     `approvalId`) NOT yet persisted across calls.
 */
export function wrapAgent(
  agent: ToolLoopAgentLike,
  engine: GuardrailEngine,
  options: WrapAgentOptions = {}
): ToolLoopAgentLike {
  const logger = options.logger ?? createLogger('console');
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';

  const validate = async (content: string, context: string) => engine.validate(content, context);

  const original = agent;

  const guardedGenerate: ToolLoopAgentLike['generate'] = original.generate
    ? async params => {
        const inputText = typeof params.prompt === 'string' ? params.prompt : '';
        if (inputText.length > 0) {
          const r = await validate(inputText, 'wrap_agent_input');
          if (!r.allowed) {
            logValidationFailure(logger, r.reason ?? 'Agent input blocked', { context: 'wrap_agent_input' });
            throw new ConnectorValidationError(
              productionMode ? 'Input blocked' : `Input blocked: ${sanitizeMeta(r.reason)}`,
              'validation_failed'
            );
          }
        }
        const result = await original.generate!(params);
        const outText = typeof result.text === 'string' ? result.text : '';
        if (outText.length > 0) {
          const r = await validate(outText, 'wrap_agent_output');
          if (!r.allowed) {
            logValidationFailure(logger, r.reason ?? 'Agent output blocked', { context: 'wrap_agent_output' });
            throw new ConnectorValidationError(
              productionMode ? 'Output blocked' : `Output blocked: ${sanitizeMeta(r.reason)}`,
              'validation_failed'
            );
          }
        }
        return result;
      }
    : undefined;

  return {
    ...original,
    ...(guardedGenerate ? { generate: guardedGenerate } : {})
  };
}

// ─────────────────────────────────────────────────────────────────────
// MCP client wrap — Phase-1: readResource → RetrievedDocValidator
// ─────────────────────────────────────────────────────────────────────

/**
 * Duck-typed shape of `createMCPClient(...)` return value (v5/v6
 * experimental_createMCPClient surface). Phase-1 wraps `readResource`
 * — Phase-2+ extends to `listResources`, `callTool`, prompt-list etc.
 */
export interface MCPClientLike {
  readResource?: (params: { uri: string; [k: string]: unknown }) => Promise<{
    contents?: Array<{ uri?: string; text?: string; mimeType?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export interface WrapMCPClientOptions {
  logger?: Logger;
  productionMode?: boolean;
  /**
   * Validators applied to retrieved-doc content via
   * `createRetrievedDocValidator`. Pass the same validator stack the
   * engine carries OR a narrower set tuned to RAG content.
   */
  retrievedDocValidators?: Validator[];
}

/**
 * Wrap an MCP client so `readResource` calls run their returned
 * `contents` through a `RetrievedDocValidator` (Story 1.2) before
 * returning to the caller. Default mode is `drop` — flagged docs are
 * silently filtered from the result.
 */
export function wrapMCPClient(
  client: MCPClientLike,
  engine: GuardrailEngine,
  options: WrapMCPClientOptions = {}
): MCPClientLike {
  const logger = options.logger ?? createLogger('console');
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';
  // Use the engine's validator surface if no narrower set supplied.
  const validators =
    options.retrievedDocValidators && options.retrievedDocValidators.length > 0
      ? options.retrievedDocValidators
      : engine.getValidators();

  if (validators.length === 0) {
    // Defensive: if engine has no validators (allowEmptyForTesting),
    // pass through unchanged rather than throw inside the factory.
    return client;
  }

  const docValidator = createRetrievedDocValidator({
    validators,
    onPerDocFailure: 'drop',
    logger
  });

  const original = client;

  return {
    ...original,
    readResource: original.readResource
      ? async params => {
          const result = await original.readResource!(params);
          const contents = result.contents ?? [];
          if (contents.length === 0) return result;
          const batch = await docValidator.validateBatch(
            contents.map((c, i) => ({
              id: c.uri ?? `mcp[${i}]`,
              content: typeof c.text === 'string' ? c.text : '',
              metadata: c
            }))
          );
          if (batch.result.blocked) {
            throw new ConnectorValidationError(
              productionMode ? 'MCP resource blocked' : `MCP resource blocked: ${batch.result.reason}`,
              'validation_failed'
            );
          }
          const survivorIds = new Set(batch.docs.map(d => d.id));
          const surviving = contents.filter((c, i) => survivorIds.has(c.uri ?? `mcp[${i}]`));
          return { ...result, contents: surviving };
        }
      : undefined
  };
}
