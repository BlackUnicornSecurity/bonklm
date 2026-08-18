/**
 * OpenAI Agents SDK Connector — Type Definitions
 * ==============================================
 * Duck-typed shapes mirroring `@openai/agents ^0.11.0` so the connector
 * compiles without a hard compile-time dependency on the peer SDK.
 * Consumers pass their own `Agent` / `Handoff` / `RealtimeSession`
 * instances; the wrapper reads the documented surface area.
 *
 * The real `@openai/agents` v0.x SDK is pre-1.0 and shapes shift between
 * minors; if a breaking signature change lands, only this file needs
 * touching to re-align.
 */
import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';

/** Default validation timeout (ms). */
export const DEFAULT_VALIDATION_TIMEOUT = 30_000;

/**
 * Configuration shared by every wrap factory in this connector.
 */
export interface GuardedAgentsOptions {
  /** Validators applied to input text + agent output + tool args. */
  validators?: Validator[];
  /** Additional guards applied to retrieved / tool content. */
  guards?: Guard[];
  /** Logger. @default `createLogger('console')` */
  logger?: Logger;
  /**
   * Production mode generic error messages — no leakage of validator
   * internals into thrown errors when set.
   * @default `process.env.NODE_ENV === 'production'`
   */
  productionMode?: boolean;
  /** Per-validation timeout (ms). @default 30_000 */
  validationTimeout?: number;
  /** Callback fired when input is blocked. */
  onInputBlocked?: (reason: string) => void;
  /** Callback fired when an agent's output is blocked. */
  onOutputBlocked?: (reason: string) => void;
  /**
   * Callback fired when a tool call's args / output is blocked.
   *
   * @remarks CWE-117: of the fields on `result.findings[]`, only `match` is
   * attacker-influenced — a substring of the blocked tool payload, capped at
   * 100 chars. (For the indirect-injection arm, `match` has credential-shaped
   * material redacted at the source so a secret literal never egresses, but it
   * still carries attacker-controlled directive text.) `description` is a static
   * catalogue/validator constant across all current validators, not attacker-
   * influenced (a future validator that builds `description` from input would
   * need its own sanitization). Pass `match` (and the top-level `reason`, which
   * derives from `description`) through `sanitizeLogString` before logging the
   * `result` to avoid log injection.
   */
  onToolBlocked?: (toolName: string, reason: string, result: GuardrailResult) => void;
  /** Callback fired when a handoff input is blocked. */
  onHandoffBlocked?: (sourceAgentName: string | undefined, targetAgentName: string | undefined, reason: string) => void;
}

/**
 * Minimal duck-typed `Agent` shape. The real SDK's `Agent<TContext, TOutput>`
 * exposes many more properties; we only touch the surface relevant to
 * guardrail wiring.
 */
export interface AgentLike {
  name?: string;
  instructions?: string | (() => string | Promise<string>);
  tools?: AgentToolLike[];
  inputGuardrails?: AgentInputGuardrailLike[];
  outputGuardrails?: AgentOutputGuardrailLike[];
  handoffs?: HandoffLike[];
  // Real SDK uses an immutable `.clone({ ... })` pattern for mutation.
  clone?(overrides: Partial<AgentLike>): AgentLike;
}

/** Duck-typed tool. */
export interface AgentToolLike {
  name?: string;
  description?: string;
  parameters?: unknown;
  // `inputGuardrails` / `outputGuardrails` on a tool became
  // `defineToolInputGuardrail` / `defineToolOutputGuardrail` in 0.11.
  inputGuardrails?: ToolInputGuardrailLike[];
  outputGuardrails?: ToolOutputGuardrailLike[];
}

/** Agent input-guardrail definition (constructed via `defineInputGuardrail`). */
export interface AgentInputGuardrailLike {
  name: string;
  execute: (args: AgentInputGuardrailArgs) => Promise<AgentInputGuardrailResult>;
}

export interface AgentInputGuardrailArgs {
  /** The raw user input that triggered the agent. */
  input: string | { content?: string; messages?: unknown[] } | unknown;
  /** Agent context object (opaque to the connector). */
  context?: unknown;
  /** The agent instance the guardrail is wrapping. */
  agent?: AgentLike;
}

export interface AgentInputGuardrailResult {
  /** Opaque output payload preserved across guardrail invocations. */
  outputInfo?: unknown;
  /** When true, terminates the agent run with `InputGuardrailTripwireTriggered`. */
  tripwireTriggered: boolean;
}

/** Agent output-guardrail definition. */
export interface AgentOutputGuardrailLike {
  name: string;
  execute: (args: AgentOutputGuardrailArgs) => Promise<AgentOutputGuardrailResult>;
}

export interface AgentOutputGuardrailArgs {
  input: unknown;
  agentOutput: unknown;
  agent?: AgentLike;
}

export interface AgentOutputGuardrailResult {
  outputInfo?: unknown;
  tripwireTriggered: boolean;
}

/** Tool input-guardrail definition. */
export interface ToolInputGuardrailLike {
  name: string;
  execute: (args: ToolInputGuardrailArgs) => Promise<ToolInputGuardrailResult>;
}

export interface ToolInputGuardrailArgs {
  toolName?: string;
  toolArgs?: unknown;
  context?: unknown;
  agent?: AgentLike;
}

export interface ToolInputGuardrailResult {
  outputInfo?: unknown;
  tripwireTriggered: boolean;
}

/** Tool output-guardrail definition. */
export interface ToolOutputGuardrailLike {
  name: string;
  execute: (args: ToolOutputGuardrailArgs) => Promise<ToolOutputGuardrailResult>;
}

export interface ToolOutputGuardrailArgs {
  toolName?: string;
  toolOutput?: unknown;
  context?: unknown;
  agent?: AgentLike;
}

export interface ToolOutputGuardrailResult {
  outputInfo?: unknown;
  tripwireTriggered: boolean;
}

/**
 * Duck-typed `Handoff` — represents a tool that transfers control from
 * one agent to another. The connector wraps `inputFilter` so a transfer
 * carrying attacker-influenced content is validated BEFORE the receiving
 * agent sees it.
 */
export interface HandoffLike {
  name?: string;
  agent?: AgentLike;
  /**
   * Pre-handoff input transform. The real SDK passes a `HandoffInputData`
   * shape; we duck-type as `unknown` and accept that consumers pass a
   * function returning the same shape (possibly mutated). When BonkLM
   * blocks, the wrapper throws `ConnectorValidationError` BEFORE
   * `inputFilter` is invoked.
   */
  inputFilter?: (data: unknown) => unknown;
}

/**
 * Duck-typed `RealtimeSession`. The real SDK emits events like
 * `input_audio_transcription.completed` (caller mic input transcribed),
 * `response.text.delta` (model response text), etc.
 */
export interface RealtimeSessionLike {
  on?(event: string, handler: (payload: unknown) => void): void;
  off?(event: string, handler: (payload: unknown) => void): void;
  addEventListener?(event: string, handler: (payload: unknown) => void): void;
  // Real SDK exposes `outputGuardrails: RealtimeOutputGuardrail[]` for
  // per-delta scanning. We duck-type as a mutable array.
  outputGuardrails?: RealtimeOutputGuardrailLike[];
  close?(): void | Promise<void>;
}

export interface RealtimeOutputGuardrailLike {
  name: string;
  execute: (args: { delta?: string; transcript?: string }) => Promise<{ tripwireTriggered: boolean }>;
}

/**
 * Result shape returned by {@link wrapAgent} / {@link wrapHandoff} /
 * {@link wrapRealtime}. Each returns a mirror-shaped object the caller
 * passes to the SDK in place of the original.
 */
export interface GuardedAgentBundle {
  /** Number of input guardrails installed by the wrap. */
  inputGuardrailCount: number;
  /** Number of output guardrails installed by the wrap. */
  outputGuardrailCount: number;
}
