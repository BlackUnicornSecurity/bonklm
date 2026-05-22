/**
 * @blackunicorn/bonklm-stagehand — types
 * =====================================
 *
 * Stagehand client structural surface used by the wrapper. Kept as a
 * structural-typed interface (NOT a `@browserbasehq/stagehand` import)
 * so this package compiles without the peer-dep installed at our
 * build time. Consumers MUST install the peer dep at v3.4+ to use
 * the wrapper at runtime.
 *
 * @package @blackunicorn/bonklm-stagehand
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import type { BrowserAgentLogger } from '@blackunicorn/bonklm-browser-agents-core';

/**
 * Structural shape of the Stagehand client methods we wrap.
 *
 * The real `@browserbasehq/stagehand` Stagehand class has many more
 * methods (init, page, context, close, etc) — those are pass-through.
 * We only intercept the AI-driven ones below.
 */
export interface StagehandLike {
  /**
   * Act on the page via natural-language action. Maps to BonkLM
   * `tool_call` surface.
   */
  act(action: string | { action: string; [k: string]: unknown }): Promise<unknown>;

  /**
   * Extract structured data from the page. Maps to `retrieved_doc`
   * surface POST-call.
   */
  extract<T = unknown>(
    options:
      | string
      | { instruction: string; schema?: unknown; [k: string]: unknown }
  ): Promise<T>;

  /**
   * Observe the page state. Maps to `text_input` surface (the
   * observation prompt is user-style input).
   */
  observe(
    options: string | { instruction: string; [k: string]: unknown }
  ): Promise<unknown>;

  /**
   * Multi-step agent execution. Maps to `composed_context` surface
   * on the task description.
   */
  agent?: {
    execute(
      task: string | { task: string; [k: string]: unknown }
    ): Promise<unknown>;
  };
}

/**
 * Configuration for `wrapStagehand`.
 */
export interface WrapStagehandOptions {
  /**
   * Permit `mode: 'cua'` (computer-use, screenshot-based actions).
   * Default `false` — refused at construction unless explicitly
   * opted in. See `BrowserAgentGuardOptions.allowCuaMode` for
   * the security rationale.
   */
  allowCuaMode?: boolean;

  /**
   * Optional logger. Used for the CUA opt-in warning and for
   * per-call decision logging at WARN+.
   */
  logger?: BrowserAgentLogger;

  /**
   * Stagehand configuration introspection. If supplied (e.g.
   * `{ mode: 'cua' }`), the wrapper enforces `allowCuaMode` against
   * the declared mode at construction.
   */
  stagehandConfig?: {
    mode?: string;
    [k: string]: unknown;
  };
}

/**
 * Convenience: the engine argument is positional (matches the
 * canonical connector-style ADR shape).
 */
export type WrapStagehandSignature = <T extends StagehandLike>(
  client: T,
  engine: GuardrailEngine,
  options?: WrapStagehandOptions
) => T;
