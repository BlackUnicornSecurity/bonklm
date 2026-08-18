/**
 * Cloudflare Agents connector types
 * ================================================
 *
 * Structural typing for `agents ^0.13.0` Agent + DurableObjectState +
 * SqlStorage surfaces. Peer-optional SDK install.
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';

/**
 * Subset of `agents` SDK `Agent<Env, S>` surface the connector
 * extends. Real type: `agents` `Agent` class.
 *
 * Sprint 22 audit-pattern application (Sprint 20+21 closures):
 * structural typing only — full Agent class import would force
 * Worker bundle bloat + drag worker-types into edge bundles.
 */
export interface AgentLike<S = unknown> {
  state?: S;
  setState?: (next: S) => void | Promise<void>;
  sql?: SqlStorageLike;
  ctx?: AgentExecutionContextLike;
  onRequest?: (request: Request) => Promise<Response>;
  onMessage?: (message: string, connection?: unknown) => Promise<void> | void;
}

/**
 * Subset of Durable Object `ctx` (`DurableObjectState`) we proxy:
 *   - `ctx.storage.get(key)` / `list(opts?)` / `getAlarm()`
 * Closes adversarial #5 (DO storage read-gap) per Story 3.8 AC.
 */
export interface AgentExecutionContextLike {
  storage: DurableObjectStorageLike;
}

export interface DurableObjectStorageLike {
  get: <T = unknown>(key: string | string[], opts?: unknown) => Promise<T | Map<string, T> | undefined>;
  list: <T = unknown>(opts?: unknown) => Promise<Map<string, T>>;
  getAlarm: () => Promise<number | null>;
}

/**
 * Subset of `this.sql` tagged-template SQL surface. The real Agents
 * SDK exposes `this.sql\`SELECT ...\`` returning rows.
 */
/**
 * Raw Agents SDK sql tagged-template — synchronous return.
 */
export interface SqlStorageLike {
  /**
   * Tagged-template form: `this.sql\`SELECT * FROM users\``. Returns
   * an array of row records.
   */
  (strings: TemplateStringsArray, ...values: unknown[]): Array<Record<string, unknown>>;
}

/**
 * BonkLM-wrapped sql tagged-template — ASYNCHRONOUS return.
 *
 * Sprint 22 hardening (architect convergent + necessary
 * tradeoff): the underlying core RetrievedDocValidator is async, but
 * the Agents SDK's raw `this.sql\`...\`` is sync. To preserve
 * fail-CLOSED validation without a microtask-race kludge, the
 * wrapped surface returns `Promise<rows[]>`. Consumers replace
 * `const rows = this.sql\`SELECT ...\`` with
 * `const rows = await this.sql\`SELECT ...\``. This is a documented
 * breaking change vs the raw Agents SDK contract — opt-out by
 * leaving `retrievedDocValidators` empty (then `sql` retains the
 * sync surface).
 */
export interface WrappedSqlStorageLike {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Array<Record<string, unknown>>>;
}

/**
 * Hook-context metadata for downstream validators.
 * `metadata.broadcast: boolean` distinguishes `setState` (broadcasts
 * to WS clients) from `this.sql INSERT` (does not). Validators key
 * risk-tuning on this flag.
 */
export interface BonklmAgentHookContext {
  broadcast: boolean;
  surface: 'setState' | 'sql_select' | 'storage_get' | 'storage_list' | 'storage_getAlarm';
}

export interface BonklmAgentConfig {
  /**
   * GuardrailEngine instance. Must be constructed with validators
   * that work in Workerd (with `nodejs_compat`); the connector builds
   * on BonkLM core APIs that use Node built-ins.
   */
  engine: GuardrailEngine;
  /**
   * Validators run on every `setState(next)` call. The connector
   * passes `next` to the validator stack BEFORE the underlying
   * Agent.setState fires. BLOCK throws CloudflareAgentBlockedError.
   *
   * Default: empty array (no setState validation). Recommended:
   * `[createMemoryWriteValidator({ ... })]`.
   */
  memoryWriteValidators?: Array<import('@blackunicorn/bonklm').Validator>;
  /**
   * Validators run on every SQL SELECT row + storage.get / list /
   * getAlarm result. BLOCK rejects the read (returns empty) to
   * prevent the LLM from ingesting tainted data.
   */
  retrievedDocValidators?: Array<import('@blackunicorn/bonklm').Validator>;
  /** Fires on BLOCK with telemetry payload. */
  onBlock?: (event: CloudflareAgentBlockEvent) => void;
  /** Error sink for handler exceptions. */
  onError?: (err: unknown) => void;
}

export interface CloudflareAgentBlockEvent {
  /** cross-package kind discriminator. */
  kind: 'voice' | 'sandbox' | 'inference' | 'durable-exec' | 'document' | 'cf-agent';
  surface: BonklmAgentHookContext['surface'];
  reason: string;
  broadcast: boolean;
  category?: string;
  severity?: string;
}

export class CloudflareAgentBlockedError extends Error {
  override readonly name = 'CloudflareAgentBlockedError';
  readonly surface: BonklmAgentHookContext['surface'];
  readonly broadcast: boolean;
  readonly category?: string;
  readonly severity?: string;

  constructor(
    message: string,
    surface: BonklmAgentHookContext['surface'],
    broadcast: boolean,
    extra?: { category?: string; severity?: string }
  ) {
    super(message);
    this.surface = surface;
    this.broadcast = broadcast;
    this.category = extra?.category;
    this.severity = extra?.severity;
  }
}
