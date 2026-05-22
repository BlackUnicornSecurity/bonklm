/**
 * @blackunicorn/bonklm-eko — types
 * ===============================
 *
 * Structural surface for the Eko v4 SDK. We do NOT import the real
 * `@eko-ai/eko` types — this package builds without the peer dep
 * installed at our build time. Consumers MUST install
 * `@eko-ai/eko ^4.1.0` to use the wrapper at runtime.
 *
 * @package @blackunicorn/bonklm-eko
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import type { BrowserAgentLogger } from '@blackunicorn/bonklm-browser-agents-core';

/**
 * Polymorphic input to `eko.run(...)`. Accepts a raw task string or
 * a structured object with `task` plus arbitrary metadata.
 */
export type EkoRunTask = string | { task: string; [k: string]: unknown };

/**
 * Structural shape of the BrowserAgent surface inside Eko. Mirrors
 * Stagehand's `act`/`extract`/`observe` so the wrapper can reuse
 * the browser-agents-core event union.
 */
export interface EkoBrowserAgentLike {
  act?(
    action: string | { action: string; [k: string]: unknown }
  ): Promise<unknown>;
  extract?<T = unknown>(
    options: string | { instruction: string; schema?: unknown; [k: string]: unknown }
  ): Promise<T>;
  observe?(
    options: string | { instruction: string; [k: string]: unknown }
  ): Promise<unknown>;
}

/**
 * Structural shape of the FileAgent surface inside Eko. High-blast-
 * radius — write + delete operations are tool_call surface with
 * `toolName = 'file.{op}'` so validators can distinguish them from
 * other tool calls.
 */
export interface EkoFileAgentLike {
  read?(path: string): Promise<string>;
  write?(path: string, content: string): Promise<unknown>;
  delete?(path: string): Promise<unknown>;
}

/**
 * Structural shape of an MCP-tool-dispatch surface (Eko exposes one
 * via `eko.mcp.callTool(server, tool, args)` or similar). Server +
 * tool name combine into the validator's `toolName` so per-server
 * allow/deny rules can match.
 */
export interface EkoMcpClientLike {
  callTool?(
    server: string,
    tool: string,
    args?: Record<string, unknown>
  ): Promise<unknown>;
}

/**
 * Top-level Eko client shape. Optional fields cover the SDK's
 * variants — the wrapper only intercepts what's actually present.
 */
export interface EkoLike {
  /**
   * Multi-agent planner entry. Validated as `composed_context` at
   * task-creation boundary (AC 2.4).
   */
  run(task: EkoRunTask): Promise<unknown>;

  /**
   * Optional registry of named agents. If present, the wrapper
   * walks it for BrowserAgent / FileAgent / MCP-tool shapes and
   * wraps each in place.
   */
  agents?: Record<string, unknown>;

  /**
   * Optional MCP sub-client (if Eko exposes MCP at the top level
   * rather than via agents). Wrapper intercepts `callTool` calls.
   */
  mcp?: EkoMcpClientLike;
}

/**
 * Configuration for `wrapEko`.
 */
export interface WrapEkoOptions {
  /**
   * Permit CUA / screenshot-driven actions. Same risk acceptance as
   * `wrapStagehand`. Default `false`.
   */
  allowCuaMode?: boolean;

  /**
   * Optional logger.
   */
  logger?: BrowserAgentLogger;

  /**
   * Eko-level config introspection (mirrors `WrapStagehandOptions.stagehandConfig`).
   * If `mode === 'cua'` / `computer-use`, the wrapper refuses unless
   * `allowCuaMode: true`. Used as a fallback when the client itself
   * doesn't expose a readable mode field.
   */
  ekoConfig?: {
    mode?: string;
    [k: string]: unknown;
  };

  /**
   * Names (string keys) of agents on `client.agents` to skip
   * intercepting. Use for agents the consumer wants un-validated
   * (e.g. an internal logging agent). Empty by default → wrap all.
   */
  skipAgents?: string[];
}

/**
 * Convenience signature export.
 */
export type WrapEkoSignature = <T extends EkoLike>(
  client: T,
  engine: GuardrailEngine,
  options?: WrapEkoOptions
) => T;
