/**
 * ElizaOS Connector — Type Definitions
 * ====================================
 * Duck-typed shapes mirroring `@elizaos/core >=1.7 <3` so the connector
 * compiles without a hard compile-time dependency on the peer SDK.
 * The real SDK is a peer dep; consumers pass their own
 * `IAgentRuntime` / `Action` / `Provider` instances.
 *
 * ElizaOS APIs shift between minors in the v1/v2 line; we re-align
 * this file when bumping the peer.
 */
import type { Guard, Logger, Validator } from '@blackunicorn/bonklm';

/**
 * Plugin priorities are documented as numeric; higher runs FIRST per
 * ElizaOS load-order semantics. `1000` is the documented maximum a
 * non-core plugin should claim.
 */
export const BONKLM_PLUGIN_PRIORITY = 1000;

/**
 * Verified-publisher allowlist for ElizaOS plugins. SHA-pinned at
 * engine startup (frozen). Provider-source `createMemory` calls with
 * `type='messages'` are refused unless the plugin's package name
 * passes exact-match AND Levenshtein-distance ≤ 2 (typo-squat
 * defence per audit-loop BC6).
 *
 * Story 1.8 Phase-1 ships the exact-match check only; the Levenshtein
 * pass + frozen-by-SHA loading defers to Phase-2 to keep this PR's
 * surface bounded.
 */
export const VERIFIED_PUBLISHER_ALLOWLIST: ReadonlyArray<string> = Object.freeze([
  '@elizaos/plugin-solana',
  '@elizaos/plugin-evm',
  '@elizaos/plugin-hyperliquid',
  '@elizaos/plugin-aave',
  '@elizaos/plugin-tee',
  '@elizaos/plugin-mcp',
]);

/**
 * Source-trust taxonomy carried on every memory entry the connector
 * sees. Used by Construct C's ToolCallArgsValidator integration to
 * exclude unauthenticated-source entries from the "address appears
 * in a user-authored message" lookup.
 */
export type SourceTrust = 'authenticated' | 'unauthenticated_http' | 'agent_internal';

/**
 * Configuration accepted by {@link bonklmPlugin}.
 */
export interface BonklmPluginOptions {
  /** Validators applied to the agent's input + action surfaces. */
  validators?: Validator[];
  /** Additional guards applied to Provider outputs. */
  guards?: Guard[];
  /** Logger. @default `createLogger('console')` */
  logger?: Logger;
  /**
   * Production-mode flag — when true, error messages flip to generic
   * strings (no leakage of validator internals).
   * @default `process.env.NODE_ENV === 'production'`
   */
  productionMode?: boolean;
  /**
   * Action-name regex matching every web3-signing action the
   * connector wraps. Default covers `TRANSFER_*`, `SEND_*`, `SWAP_*`,
   * `PAY_*`, `BORROW_*`, `MINT_*`, `APPROVE_*` paired with
   * `_SOL`, `_EVM`, `_SOLANA`, `_TOKEN`, `_ETHEREUM`, `_HYPERLIQUID`,
   * `_AAVE` per the AC.
   */
  signingActionRegex?: RegExp;
  /**
   * Phase-2 explicit Class-4 acknowledgement. When the startup HTTP
   * probe detects an unauthenticated `/memories` route AND this flag
   * is `true`, the plugin emits a CRITICAL log + continues. When the
   * probe detects unauth AND this flag is `false` (or absent), the
   * plugin throws `ConnectorValidationError('invalid_runtime')` and
   * `init()` fails.
   *
   * Phase-1 (v0.4.0) threw on this flag because the probe was not
   * implemented; Phase-2 (this commit) honours it.
   */
  acknowledgeClass4Risk?: boolean;
  /**
   * Phase-2 startup-probe configuration: the local TCP port the
   * ElizaOS HTTP API listens on. When set (and `runtime.agentId` is
   * available), `init()` probes `http://127.0.0.1:{port}/api/agents/{agentId}/memories`
   * (then `[::1]` on IPv4-refused) for unauth exposure.
   *
   * When omitted, the probe is skipped with an INFO log and the
   * Class-4 check does not run.
   */
  runtimePort?: number;
  /**
   * Phase-2 env-var injection for the probe's `BONKLM_SKIP_RUNTIME_PROBE`
   * + `NODE_ENV` lookups. Edge consumers (Workerd / Deno) pass an
   * explicit record; Node consumers can omit and the probe falls back
   * to `process.env`. Locked 6-key contract per Story 2.1b plan.
   */
  envBindings?: Record<string, string | undefined>;
  /** Callback when an action is blocked at validation. */
  onActionBlocked?: (actionName: string, reason: string) => void;
  /** Callback when a memory write is refused. */
  onMemoryWriteRefused?: (reason: string) => void;
}

/** Plugin load-call context (subset). */
export interface PluginLoadContext {
  runtime: IAgentRuntimeLike;
}

/**
 * Duck-typed `IAgentRuntime`. Real SDK shape is much larger; we touch
 * only the fields the connector needs: `createMemory`, `getMemories`,
 * `actions`, plugin / runtime metadata.
 */
export interface IAgentRuntimeLike {
  agentId?: string;
  character?: { name?: string };
  createMemory?: (memory: MemoryLike, ...rest: unknown[]) => Promise<unknown> | unknown;
  getMemories?: (params: { roomId?: string; entityId?: string; tableName?: string }) =>
    Promise<MemoryLike[]> | MemoryLike[];
  actions?: ActionLike[];
  plugins?: PluginLike[];
  bonklm?: BonklmRuntimeNamespace;
}

/**
 * Runtime-side namespace the connector installs on `runtime.bonklm`.
 *
 * Phase-2 (Story 2.1b-connectors): the namespace is sealed via
 * `Object.defineProperty({ writable: false, configurable: false })`
 * but is intentionally EMPTY — call-context propagation moved from a
 * mutable `currentCallContext` property to `AsyncLocalStorage`
 * (closes the iter-2 architect BLOCK-1 + adversarial #11
 * hostile-direct-assignment vector). The sealed slot remains so
 * downstream code can still `runtime.bonklm.something` if a future
 * legitimate field is added; today nothing is stored here.
 */
export interface BonklmRuntimeNamespace {
  // Intentionally empty (Phase-2). Call-context lives in AsyncLocalStorage
  // managed by `als-context.ts` — hostile plugin assignments to
  // `runtime.bonklm.currentCallContext` are no-ops because no
  // BonkLM code consults that path.
}

/** Duck-typed `Memory`. */
export interface MemoryLike {
  id?: string;
  entityId?: string;
  roomId?: string;
  agentId?: string;
  /** Memory body — text + optional structured fields. */
  content?: { text?: string; [k: string]: unknown };
  /** Memory record type — 'messages', 'facts', etc. */
  tableName?: string;
  /**
   * Source field — computed by the connector's wrapper from
   * `runtime.bonklm.currentCallContext`. Providers writing this
   * field are ignored (the wrapper recomputes from closure context).
   */
  source?: SourceTrust;
  /** Arbitrary metadata bag. */
  metadata?: Record<string, unknown>;
}

/** Duck-typed `Action`. Wrapping touches `validate` + `handler`. */
export interface ActionLike {
  name: string;
  description?: string;
  validate?: (runtime: IAgentRuntimeLike, message: MemoryLike) => Promise<boolean> | boolean;
  handler?: (
    runtime: IAgentRuntimeLike,
    message: MemoryLike,
    state?: unknown,
    options?: unknown,
    callback?: unknown
  ) => Promise<unknown> | unknown;
}

/** Duck-typed `Provider`. */
export interface ProviderLike {
  name?: string;
  get?: (
    runtime: IAgentRuntimeLike,
    message: MemoryLike,
    state?: unknown
  ) => Promise<ProviderResultLike> | ProviderResultLike;
}

export interface ProviderResultLike {
  text?: string;
  values?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

/** Duck-typed `Plugin`. */
export interface PluginLike {
  name: string;
  description?: string;
  priority?: number;
  init?: (context: PluginLoadContext) => Promise<void> | void;
  actions?: ActionLike[];
  providers?: ProviderLike[];
  events?: Record<string, Array<(payload: unknown) => unknown>>;
}

/** Doctor CLI result row. */
export interface DoctorFinding {
  severity: 'INFO' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: string;
  description: string;
  file?: string;
  pluginName?: string;
}

export interface DoctorReport {
  findings: DoctorFinding[];
  /** True if any CRITICAL finding is present. */
  criticalCount: number;
  /** True if doctor should exit with non-zero status. */
  exitCode: number;
}
