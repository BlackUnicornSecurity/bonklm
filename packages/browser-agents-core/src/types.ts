/**
 * @blackunicorn/bonklm-browser-agents-core — normalised event union
 * =================================================================
 *
 * Shared event shape consumed by every browser-agent connector
 * (stagehand, eko, future entrants). Each event maps to a BonkLM
 * validator surface so the same security pipeline gates every
 * vendor's act/extract/observe/multi-step semantics.
 *
 * Surface mapping (locked):
 *   - `act` → `tool_call` — action + structured args validated
 *     before dispatch to the page.
 *   - `extract` → `retrieved_doc` — extracted page content validated
 *     POST-call (the page is the source of untrusted retrieval).
 *   - `observe` → `text_input` — observation prompt validated as
 *     user-style input (it can carry prompt-injection from page text).
 *   - `agent.execute` → `composed_context` — multi-step task
 *     decomposition validated as composed context (planner output).
 *
 * @package @blackunicorn/bonklm-browser-agents-core
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';

/**
 * Normalised browser-agent event union. Connector packages emit
 * these as they intercept their vendor's native calls.
 *
 * Story 2.3 architect BLOCK-5: extended at story-2.3 time to cover
 * Story 2.4 Eko's `FileAgent` (file.{read,write,delete}) + MCP-tool
 * dispatch semantics. Adding these now (vs in 2.4) avoids a
 * breaking-change to downstream consumers typed against the v0.5
 * union shape.
 */
export type BrowserAgentEvent =
  | { kind: 'act'; action: string; args?: Record<string, unknown> }
  | { kind: 'extract'; schema: unknown; result: unknown }
  | { kind: 'observe'; prompt: string; result?: string }
  | { kind: 'agent.execute'; task: string; result?: unknown }
  | {
      kind: 'file';
      op: 'read' | 'write' | 'delete';
      path: string;
      content?: string;
    }
  | {
      kind: 'mcp.tool';
      server: string;
      tool: string;
      args?: Record<string, unknown>;
    };

/**
 * Logger surface for warnings (CUA opt-in, validator decisions).
 * Subset of the core `Logger` to avoid cyclic re-exports.
 */
export interface BrowserAgentLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
  error?(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Configuration for `withBrowserAgentGuardrails`.
 */
export interface BrowserAgentGuardOptions {
  /**
   * BonkLM engine. Required. Drives all validator decisions.
   */
  engine: GuardrailEngine;

  /**
   * Permit `mode: 'cua'` (computer-use / screenshot-based actions).
   *
   * @security CUA mode passes raw screenshots to the LLM; BonkLM
   *   validators do NOT inspect screenshot bytes (only text + tool
   *   args). Setting this to `true` accepts the risk that
   *   prompt-injection embedded in page pixels can bypass the
   *   guardrail pipeline entirely. Default `false`; opt-in is
   *   explicit + emits a one-time warning at construction.
   *
   * @default false
   */
  allowCuaMode?: boolean;

  /**
   * Optional logger. Used for the CUA opt-in warning and for
   * surface-level validator decision logging.
   */
  logger?: BrowserAgentLogger;
}

/**
 * Aggregate result returned by validator-firing methods. Same
 * short-circuit shape as the Inngest middleware result — `blocked`
 * is the consumer-facing decision flag; `reason` carries the first
 * blocking validator's message.
 */
export interface BrowserAgentValidateResult {
  blocked: boolean;
  allowed: boolean;
  reason?: string;
  /** Validator surface that fired (for telemetry). */
  surface: 'tool_call' | 'retrieved_doc' | 'text_input' | 'composed_context';
}

/**
 * Base class for all browser-agent BLOCKED-by-validator errors.
 * Hoisted to browser-agents-core (Story 2.3 architect BLOCK-4) so
 * every browser-agent connector (Stagehand, Eko, future entrants)
 * raises a common type. Consumers can `instanceof BrowserAgentGuardrailBlockedError`
 * once for any connector.
 *
 * Sub-classes (per-connector) attach connector-specific metadata
 * via the `connector` field + readable name.
 */
export class BrowserAgentGuardrailBlockedError extends Error {
  /**
   * Per-connector identifier (`'stagehand'`, `'eko'`, etc).
   * Distinguishes errors from different browser-agent SDKs in
   * shared catch-blocks.
   */
  readonly connector: string;
  /** Action kind that was blocked. */
  readonly action: string;
  /** Validator surface that fired the block. */
  readonly surface: BrowserAgentValidateResult['surface'];

  constructor(
    connector: string,
    action: string,
    surface: BrowserAgentValidateResult['surface'],
    reason: string | undefined
  ) {
    // Sanitize reason: strip non-printable / control chars + cap at
    // 200 chars (sec-audit T6 closure — `reason` may echo
    // attacker-controlled content into logs / error-tracking).
    const safeReason =
      typeof reason === 'string'
        ? reason.replace(/[^\x20-\x7E]/g, '').slice(0, 200)
        : undefined;
    super(
      `bonklm-${connector}: ${action} blocked by ${surface} validator${
        safeReason !== undefined && safeReason.length > 0 ? ` — ${safeReason}` : ''
      }`
    );
    this.name = 'BrowserAgentGuardrailBlockedError';
    this.connector = connector;
    this.action = action;
    this.surface = surface;
    // Defensive: `extends Error` chain can break under some bundler
    // configurations (downlevel ES5 / CJS). Explicit setPrototypeOf
    // restores the chain so `instanceof` works in all targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
