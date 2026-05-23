/**
 * @blackunicorn/bonklm-turbopuffer — types
 * =======================================
 *
 * Type surface for the Turbopuffer Namespace wrapper. Kept narrow so the
 * connector compiles without importing the full `@turbopuffer/turbopuffer`
 * type tree at boundary positions (peer-dep optionality).
 *
 * Edge-compatible (Workerd / Deno / Bun / Vercel Edge): Turbopuffer is
 * a pure HTTP client; no native bindings. The connector inherits the
 * edge-runtime story from `@blackunicorn/bonklm/edge`.
 *
 * @package @blackunicorn/bonklm-turbopuffer
 */
import type {
  Logger,
  MemoryWriteValidator,
  RetrievedDocValidator,
} from '@blackunicorn/bonklm';

/**
 * Configuration for `createGuardedNamespace`.
 *
 * Story 2.11 AC mandates `createGuardedNamespace(ns, opts)` —
 * shape #2b (Vector-database sub-client wrap with validators-in-opts)
 * per the connector-style-guide (added at Story 2.10). Mirrors the
 * Lance connector's option bag almost line-for-line; differences are
 * called out inline with @diff comments.
 */
export interface GuardedNamespaceOptions {
  /**
   * MemoryWriteValidator applied to writes (`write({ upsert_rows })` /
   * `write({ patch_rows })`). Per-row, per-column validation; on BLOCK
   * throws `ConnectorValidationError` BEFORE the underlying write
   * executes — no partial state.
   *
   * Columnar writes (`upsert_columns` / `patch_columns`) are governed
   * by `columnarWriteMode` (default: reject when a validator is
   * configured, to avoid silent bypass via columnar serialisation).
   *
   * @security The connector cannot meaningfully validate
   *   `delete_by_filter` / `patch_by_filter` / `deletes` paths
   *   (filter-based ops don't carry user content); those pass through
   *   unchanged. Consumers who construct filters from user input must
   *   sanitize at the caller boundary.
   *
   * @security sec S-TPUF-7 (Story 2.11 audit): the connector holds a
   *   REFERENCE to the supplied validator. If a consumer mutates the
   *   validator's internal stack after `createGuardedNamespace` returns
   *   (e.g., by pushing additional validators onto the engine driving
   *   it), subsequent middleware invocations see the MUTATED behavior.
   *   The connector cannot deep-freeze validator internals; consumers
   *   should treat the supplied validator as effectively immutable
   *   after wiring.
   */
  memoryWriteValidator?: MemoryWriteValidator;

  /**
   * RetrievedDocValidator applied to `query()` response rows.
   * Filters out poisoned rows; on batch-level BLOCK the connector
   * throws `ConnectorValidationError`.
   *
   * Position-stable synthetic ids defeat sibling-id spoofing (via the
   * core `applyRetrievedDocValidatorToMatches` helper).
   */
  retrievedDocValidator?: RetrievedDocValidator;

  /**
   * Field name(s) on each Row holding textual content passed to
   * `memoryWriteValidator.validateWrite`. Pass a single string for
   * the common case, or a `readonly string[]` for documents with
   * multiple text columns (e.g. `text` + `summary` + `metadata_json`).
   *
   * @default 'text'
   *
   * @security sec S1 closure (Story 2.10 audit, inherited): consumers
   *   MUST list every user-influenceable text column. A column not
   *   listed in `contentField` is NOT validated; an attacker who
   *   controls row insertion can stuff prompt-injection payload into
   *   it.
   */
  contentField?: string | readonly string[];

  /**
   * Optional field carrying user id metadata into
   * `MemoryWritePayload.userId`. @default 'userId'
   */
  userIdField?: string;

  /**
   * Optional field carrying session id metadata into
   * `MemoryWritePayload.sessionId`. @default 'sessionId'
   */
  sessionIdField?: string;

  /**
   * How `write({ upsert_columns })` / `write({ patch_columns })` are
   * handled when a `memoryWriteValidator` is configured.
   *
   *   - `'reject'` (default when validator is configured) — throws
   *     `ConnectorValidationError`. Columnar inputs would require
   *     transposing into rows to inspect each document; the connector
   *     does not do this automatically to avoid silent re-serialisation
   *     errors (column-name mismatches, missing IDs).
   *   - `'pass-through'` (default when no validator is configured)
   *     — writes through unvalidated with a logger warning.
   *
   * @default 'reject' when memoryWriteValidator is configured;
   *   'pass-through' otherwise
   *
   * @security sec S2 closure (Story 2.10 audit, adapted): silent
   *   columnar passthrough was a hard validation bypass on the Lance
   *   connector; the Turbopuffer columnar path applies the same
   *   default-reject when a validator is wired.
   */
  columnarWriteMode?: 'pass-through' | 'reject';

  /**
   * Maximum number of rows the connector reads from a `query()`
   * response before throwing `ConnectorValidationError`. Bounds
   * `RetrievedDocValidator.validateBatch` work — without a cap,
   * a malicious user issuing an unbounded query triggers O(N)
   * regex scan across the response.
   *
   * Set to `Infinity` to opt out.
   *
   * @default 1000
   *
   * @security sec S6 closure (Story 2.10 audit, inherited).
   */
  maxResultCount?: number;

  /**
   * How redact-mode writes that produce an empty `content` string
   * (full-content redaction) are handled.
   *
   *   - `'block'` (default) — throws `ConnectorValidationError`.
   *   - `'pass-through'` — writes the empty content as-is.
   *
   * @default 'block'
   *
   * @security rev R2 closure (Story 2.10 audit, inherited).
   */
  emptyRedactionMode?: 'block' | 'pass-through';

  /**
   * Production-mode flag (forwarded to
   * `applyRetrievedDocValidatorToMatches`). When true,
   * `ConnectorValidationError` carries a generic message; when false,
   * the validator's `reason` is included. @default false
   */
  productionMode?: boolean;

  logger?: Logger;
}

/**
 * Structural alias for a Turbopuffer `Row`. The official type is
 * `{ id: ID, vector?: Vector, $dist?: number, [k: string]: unknown }`;
 * we widen `id` to `unknown` because the connector doesn't inspect it
 * (validation is content-driven, not id-driven).
 */
export type GuardedTurbopufferRow = Record<string, unknown>;

/**
 * Subset of Turbopuffer's `NamespaceWriteParams` consumed by the
 * connector. Kept narrow so a consumer importing the structural type
 * doesn't pull the full Turbopuffer schema tree.
 *
 * @diff vs Lance: Turbopuffer uses a single `write(params)` endpoint
 *   that multiplexes upsert / patch / delete via discriminator fields.
 *   The connector inspects `upsert_rows` + `patch_rows`; columnar
 *   writes hit `columnarWriteMode`.
 */
export interface GuardedNamespaceWriteParams {
  upsert_rows?: GuardedTurbopufferRow[];
  patch_rows?: GuardedTurbopufferRow[];
  upsert_columns?: Record<string, unknown>;
  patch_columns?: Record<string, unknown>;
  /**
   * Pass-through fields the connector does not inspect (filter-based
   * deletes / patches, schema updates, namespace metadata).
   */
  [passthrough: string]: unknown;
}

/**
 * Subset of Turbopuffer's `NamespaceQueryResponse`. The shape carries
 * a `rows?: Row[]` array which is the connector's validation target.
 */
export interface GuardedNamespaceQueryResponse {
  rows?: GuardedTurbopufferRow[];
  [passthrough: string]: unknown;
}

/**
 * Public structural surface returned by `createGuardedNamespace`.
 *
 * The wrapper exposes FOUR methods with validation injected (the 3
 * Story 2.11 AC methods + `multiQuery` added at audit-closure per
 * arch X7). All other Namespace methods pass through via the Proxy
 * `get` trap (branchFrom, copyFrom, recall, schema, metadata, etc.
 * are available transparently).
 *
 * `raw` returns the underlying Namespace for consumers who explicitly
 * want to bypass the wrapper.
 *
 * @param options - The `options` parameter on `write` / `query` /
 *   `multiQuery` / `deleteAll` corresponds to Turbopuffer's
 *   `RequestOptions` (timeouts, custom headers, signal). Typed as
 *   `unknown` here to avoid pulling the SDK's `RequestOptions` type
 *   into the structural surface; consumers needing typed
 *   RequestOptions can cast at the call site.
 */
export interface GuardedNamespace {
  /**
   * Validate then write. Per-row content validation on `upsert_rows`
   * and `patch_rows`; columnar inputs governed by `columnarWriteMode`;
   * delete forms (`deletes`, `delete_by_filter`) pass through.
   *
   * Signature matches the SDK: `params` is `?: ... | null` to align
   * with `NamespaceWriteParams | null | undefined` (rev R0 closure).
   */
  write(
    params?: GuardedNamespaceWriteParams | null,
    options?: unknown
  ): Promise<unknown>;

  /**
   * Run a query + validate retrieved rows. `RetrievedDocValidator`
   * filters poisoned rows; `maxResultCount` cap throws on
   * over-large responses.
   */
  query(params?: unknown, options?: unknown): Promise<GuardedNamespaceQueryResponse>;

  /**
   * Run a batched query + validate each sub-result's rows independently.
   * arch X7 closure (Story 2.11 audit): the connector wraps
   * `multiQuery` because Turbopuffer 2.1+ exposes it as a primary
   * batched-query endpoint; an unwrapped passthrough would silently
   * bypass `RetrievedDocValidator` on the returned rows.
   *
   * Each sub-result's `rows[]` is independently capped at
   * `maxResultCount` and run through the validator pipeline.
   */
  multiQuery(params?: unknown, options?: unknown): Promise<unknown>;

  /**
   * Drop the namespace. No validator surface (destructive op the
   * consumer explicitly invoked). Passes through to the underlying
   * Namespace.
   */
  deleteAll(params?: unknown, options?: unknown): Promise<unknown>;

  /**
   * Escape hatch — underlying Namespace reference for advanced ops
   * (branchFrom, copyFrom, exists, schema, etc.). Writes through `raw`
   * are NOT validated.
   */
  readonly raw: unknown;

  /** Pass-through Namespace methods accessed via Proxy. */
  [passthrough: string]: unknown;
}
