/**
 * @blackunicorn/bonklm-memory-utils — Type Definitions
 * ====================================================
 *
 * Shapes the generic `wrapMemoryClient` factory consumes when wrapping
 * a vendor memory client (Mem0 / Zep / Letta / future). The
 * `MemoryAdapter` interface is the contract each per-vendor connector
 * implements to expose vendor-specific method routing to BonkLM's
 * surface hooks (`memory_write` / `composed_context`).
 */
import type { GuardrailEngine, Logger, Validator } from '@blackunicorn/bonklm';

/**
 * Per-call session context the consumer threads through every memory
 * operation. The connector reads `getTenantId(ctx)` on every call —
 * NOT at construction time — so a multi-tenant deployment maps each
 * caller's session to the correct vendor scope (Mem0 `user_id`, Zep
 * `graph_id`, etc.).
 *
 * The `ctx` shape is intentionally `unknown` — the consumer's
 * `getTenantId` callback knows how to extract the tenant identifier
 * from THEIR session shape (Express `req`, Hono `Context.var`,
 * `auth.userId` etc.).
 */
export type MemorySessionContext = unknown;

/**
 * Mandatory callback that returns the vendor-scope identifier (tenant
 * id) for a given session context.
 *
 * **Adversarial #4 — caller-controlled tenantId leak**: passing a
 * literal string here would let a hostile caller scope ALL writes to
 * a single tenant (e.g. impersonate another user). The connector
 * REFUSES construction when this field is not a function — see
 * `wrapMemoryClient`.
 */
export type GetTenantId = (ctx: MemorySessionContext) => string;

/**
 * Validator hook surface — mirrors `HookSurface` from the core, but
 * narrowed to the two surfaces memory wrappers route through.
 */
export type MemorySurface = 'memory_write' | 'composed_context';

/**
 * A single per-call invocation arriving at the adapter. Identifies
 * the underlying vendor method (the proxy intercept) AND the args
 * the consumer passed.
 */
export interface AdapterInvocation {
  /** Vendor method name as the consumer called it (`'add'`, `'search'`, etc.). */
  method: string;
  /** Args the consumer passed; vendor-specific shape. */
  args: ReadonlyArray<unknown>;
  /** Session context for `getTenantId` resolution. */
  ctx: MemorySessionContext;
}

/**
 * Result of an adapter's `route` call — tells `wrapMemoryClient`
 * which surface to fire AND what content to validate. The adapter
 * also rewrites args if the vendor requires tenant-scoping (e.g. Zep
 * overwriting `graph_id` with `getTenantId(ctx)`).
 */
export interface AdapterRoute {
  /** The surface this invocation maps to, or `null` to skip validation. */
  surface: MemorySurface | null;
  /** For `memory_write`: the content text to scan. */
  writeContent?: string;
  /** For `composed_context`: the recall entries to scan. */
  composedEntries?: string[];
  /**
   * Optional rewritten args. When set, `wrapMemoryClient` invokes the
   * underlying method with these args INSTEAD of the consumer's.
   * Zep uses this to inject `graph_id` from `getTenantId(ctx)`.
   */
  rewriteArgs?: ReadonlyArray<unknown>;
}

/**
 * Per-vendor adapter contract. Each connector (mem0 / zep / letta)
 * implements this and passes it to `wrapMemoryClient`.
 *
 * The adapter is STATELESS — `wrapMemoryClient` calls `route(...)`
 * for every proxy-intercepted method call.
 */
export interface MemoryAdapter {
  /** Vendor name for logging + telemetry (`'mem0'`, `'zep'`, etc.). */
  readonly vendor: string;

  /**
   * Set of method names the adapter wraps. `wrapMemoryClient` only
   * routes through `route(...)` when the called method is in this
   * set; other methods pass through to the underlying client
   * unchanged.
   */
  readonly methods: ReadonlySet<string>;

  /**
   * Route a single per-call invocation to a surface hook. Returns
   * `{ surface: null }` to skip validation (used for vendor methods
   * that wrap admin / configuration calls — `reset`, `getMemories`
   * by id, etc.).
   *
   * Per iter-4 security A&D: memory_write hook fires on add / update
   * / history / reset; composed_context fires on search / get / getAll
   * recall paths. The adapter is the source of truth for these
   * mappings (Mem0 vs Zep have different method names).
   */
  route(invocation: AdapterInvocation): AdapterRoute;

  /**
   * POST-call hook fired with the underlying method's return value.
   * Adapters can validate recall results here (e.g. Mem0's
   * `search` returns memories; the adapter walks them to fire
   * composed_context validation on the recalled text).
   *
   * Returns `void` on pass; throws to block.
   */
  validateResult?(
    invocation: AdapterInvocation,
    result: unknown,
    helpers: {
      runComposedContextValidator: (entries: string[]) => Promise<void>;
    }
  ): Promise<void>;
}

/**
 * Options shared by `wrapMemoryClient` and every per-vendor
 * `wrap<Vendor>Client` factory.
 */
export interface WrapMemoryClientOptions {
  /**
   * REQUIRED. Callback returning the vendor-scope identifier from a
   * session context. MUST be a function — a literal string is
   * rejected at construction (adversarial #4).
   */
  getTenantId: GetTenantId;

  /**
   * The session context for the wrapped client lifetime. Consumers
   * typically provide a closure that returns a request-scoped value
   * (Express `req`, Hono context). When omitted, the adapter receives
   * `undefined` — usable for single-tenant deployments only.
   */
  getSessionContext?: () => MemorySessionContext;

  /**
   * Optional override of the engine's default validator chain. When
   * omitted, the engine's `config.validators` is used implicitly via
   * the composite validator factories.
   */
  validators?: Validator[];

  /** Logger. */
  logger?: Logger;
}

/**
 * Full options for the generic `wrapMemoryClient` (adapter included).
 * Per-vendor wrappers expose the simpler `WrapMemoryClientOptions`
 * shape; the adapter is injected internally.
 */
export interface WrapMemoryClientFullOptions<TClient extends object> extends WrapMemoryClientOptions {
  /** The vendor adapter. */
  adapter: MemoryAdapter;
  /** The underlying engine. */
  engine: GuardrailEngine;
  /**
   * Optional override of the wrapped client's prototype — when the
   * underlying SDK uses class instances rather than plain objects,
   * the proxy needs to preserve the prototype chain so `instanceof`
   * still works. Default: `Object.getPrototypeOf(client)`.
   */
  prototype?: object | null;
  // TClient phantom — referenced via wrapMemoryClient signature.
  _phantom?: TClient;
}
