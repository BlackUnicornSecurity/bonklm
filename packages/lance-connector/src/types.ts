/**
 * @blackunicorn/bonklm-lance — types
 * =================================
 *
 * Type surface for the LanceDB Table wrapper. Kept narrow so the
 * connector compiles without importing the full `@lancedb/lancedb`
 * type tree at boundary positions (peer-dep optionality).
 *
 * @package @blackunicorn/bonklm-lance
 */
import type { Logger, MemoryWriteValidator, RetrievedDocValidator } from '@blackunicorn/bonklm';

/**
 * Configuration for `createGuardedLanceTable`.
 *
 * Story 2.10 AC mandates `createGuardedLanceTable(table, opts)` —
 * both validators live inside `opts` (not separate positional args).
 * This is shape #1-with-options-bag per `connector-style-guide.md`
 * (mirrors `wrapMemoryClient(client, { engine, adapter, ... })`).
 *
 * Both validators are OPTIONAL. If both are undefined, the wrapper
 * is a passthrough — useful when the consumer only wants the
 * connector for telemetry / future-proofing.
 */
export interface GuardedLanceTableOptions {
  /**
   * MemoryWriteValidator applied to writes (`add`, `update`,
   * `mergeInsert(...).execute`). Per-row validation; on BLOCK the
   * connector throws `ConnectorValidationError` BEFORE the underlying
   * Table write executes — no partial state.
   *
   * @security A consumer who supplies a write-mode validator with
   *   `onFailure: 'redact'` will have records persisted with redacted
   *   content. If the connector pipeline includes a subsequent search
   *   that returns the redacted records, the redaction sentinel is
   *   visible to the LLM. Use redact mode intentionally.
   */
  memoryWriteValidator?: MemoryWriteValidator;

  /**
   * Optional `GuardrailEngine` for audit-telemetry wiring. When
   * supplied, the connector calls `engine.notifyCachedResult(...)`
   * after every read-path validator dispatch so consumers wiring
   * `engine.onIntercept(...)` see Lance retrieved-doc decisions.
   * Without this, validator outcomes from Lance are invisible to
   * engine-wide observability.
   *
   * Sprint 14 deferred-closure arch X6 (engine wiring across vector
   * connectors): closes the divergence with Inngest/Trigger which
   * already wire notifyCachedResult.
   *
   * @example
   * ```ts
   * const engine = new GuardrailEngine({ validators: [...] });
   * engine.onIntercept((result, ctx) => attackLogger.log(result, ctx));
   *
   * const guarded = createGuardedLanceTable(table, {
   *   engine,
   *   retrievedDocValidator: createRetrievedDocValidator({...}),
   * });
   * ```
   */
  engine?: import('@blackunicorn/bonklm').GuardrailEngine;

  /**
   * RetrievedDocValidator applied to `.toArray()` results from
   * `search(...)` and `query()`. Filters out poisoned rows; on
   * batch-level BLOCK the connector throws `ConnectorValidationError`.
   *
   * @security Position-stable synthetic ids (`__pos_${i}`) are used
   *   internally so attacker-influenced metadata cannot spoof sibling
   *   ids; see `applyRetrievedDocValidatorToMatches` in core.
   */
  retrievedDocValidator?: RetrievedDocValidator;

  /**
   * Field name(s) on each input record holding textual content passed
   * to `memoryWriteValidator.validateWrite`. Pass a single string for
   * the common single-column case, or a `readonly string[]` for tables
   * with multiple text columns (e.g. `text` + `metadata_json` +
   * `original_url`).
   *
   * When an array is supplied, EACH column is validated independently
   * per row. BLOCK on any column rejects the whole row. Redact-mode
   * redactions are slotted back into the column they came from.
   *
   * @default 'text'
   *
   * @security sec S1 closure (Story 2.10 audit): consumers MUST list
   *   every user-influenceable text column. A column not listed in
   *   `contentField` is NOT validated and an attacker who controls
   *   row insertion can stuff prompt-injection payload into it. The
   *   connector cannot infer the schema; this is a consumer-supplied
   *   trust boundary.
   *
   * @example
   * ```ts
   * // Single column:
   * createGuardedLanceTable(table, {
   *   memoryWriteValidator,
   *   contentField: 'document',
   * });
   *
   * // Multiple columns — validate ALL user-influenceable text:
   * createGuardedLanceTable(table, {
   *   memoryWriteValidator,
   *   contentField: ['document', 'title', 'metadata_json'],
   * });
   * ```
   */
  contentField?: string | readonly string[];

  /**
   * Optional field name carrying user id metadata into
   * `MemoryWritePayload.userId`. Field MUST be a string when present
   * on the record; non-string values are ignored.
   * @default 'userId'
   */
  userIdField?: string;

  /**
   * Optional field name carrying session id metadata into
   * `MemoryWritePayload.sessionId`. Field MUST be a string when
   * present on the record; non-string values are ignored.
   * @default 'sessionId'
   */
  sessionIdField?: string;

  /**
   * How `update({ valuesSql })` calls AND the variant-3 overload
   * `update(updates: Record<string, string>, options?)` (which is
   * SQL-string-typed per LanceDB's SDK declaration) are handled.
   *
   * `valuesSql` and the variant-3 top-level Record are raw SQL
   * expressions — by LanceDB's contract they are author-controlled,
   * but a consumer who concatenates user input into either path
   * leaks SQL injection into LanceDB.
   *
   * **Default behaviour depends on `memoryWriteValidator` presence:**
   *   - If `memoryWriteValidator` IS configured, default is `'block-sql'`
   *     (safer-by-default — consumer must explicitly opt into SQL
   *     passthrough by setting `updateSqlMode: 'pass-through-sql'`).
   *   - If `memoryWriteValidator` is NOT configured, default is
   *     `'pass-through-sql'` (the connector has no opinion on
   *     unvalidated writes).
   *
   * @security sec S3 closure (Story 2.10 audit): a consumer writing
   *   `guarded.update({ text: req.body.content })` (variant 3,
   *   SQL-string Record) believing they pass a literal exposes SQL
   *   injection. The default flip closes the footgun by default.
   */
  updateSqlMode?: 'pass-through-sql' | 'block-sql';

  /**
   * Production-mode flag (forwarded to
   * `applyRetrievedDocValidatorToMatches`). When true, BLOCKed-batch
   * `ConnectorValidationError` carries a generic message; when false,
   * the validator's `reason` is included. @default false
   */
  productionMode?: boolean;

  /**
   * Maximum length of the `predicate` string passed to
   * `delete(predicate)`. Defends against a consumer accidentally
   * concatenating attacker-controlled input into the SQL filter; the
   * cap forces the consumer to inspect and bound the predicate at the
   * boundary.
   *
   * Real-world IN-clauses with hundreds of UUIDs commonly exceed
   * the default 10k cap — UUID is 36 chars, plus 3 chars punctuation
   * ≈ 250 UUIDs fits in 10k. Consumers running batch-delete patterns
   * SHOULD pass a larger cap explicitly OR use LanceDB's batch APIs
   * (`mergeInsert` with `whenNotMatchedBySourceDelete`).
   *
   * @default 10000
   *
   * @security sec S4 / rev R6 (Story 2.10 audit): the cap is a
   *   boundary guard, NOT a SQL-injection mitigation. `'1=1'` is 3
   *   chars and deletes the whole table; length alone provides no
   *   structural safety. The connector does NOT SQL-parse predicates.
   */
  maxPredicateLength?: number;

  /**
   * How `add()` / `mergeInsert(...).execute()` handle data that is
   * NOT a plain-record-array (Arrow Table, ReadableStream, etc.) when
   * a `memoryWriteValidator` IS configured.
   *
   *   - `'reject'` (default when validator is configured) — throws
   *     `ConnectorValidationError` rather than silently writing
   *     unvalidated data. Consumer must serialise the input to a
   *     plain-record array OR explicitly opt into passthrough.
   *   - `'pass-through'` (default when no validator is configured)
   *     — writes through unvalidated with a logger warning.
   *
   * @default 'reject' when memoryWriteValidator is configured;
   *   'pass-through' otherwise
   *
   * @security sec S2 closure (Story 2.10 audit): the original silent
   *   passthrough was a hard validation bypass — a consumer routing
   *   user JSON through an Arrow deserialiser shipped unvalidated
   *   data to disk. Default-reject when a validator is wired makes
   *   the bypass impossible by default.
   */
  arrowWriteMode?: 'pass-through' | 'reject';

  /**
   * Maximum number of rows the connector reads from `.toArray()`
   * before throwing `ConnectorValidationError`. Bounds the
   * `RetrievedDocValidator.validateBatch` work — without a cap, a
   * malicious user issuing an unbounded `query()` triggers an O(N)
   * regex scan across the entire table.
   *
   * Set to `Infinity` to opt out (NOT recommended for production
   * search endpoints exposing arbitrary user queries).
   *
   * @default 1000
   *
   * @security sec S6 closure (Story 2.10 audit): a consumer who
   *   neglects `.limit()` on their query chain creates an unbounded
   *   scan surface. The default cap protects validators that
   *   weren't designed for million-row inputs.
   */
  maxResultCount?: number;

  /**
   * How redact-mode writes that produce an empty `content` string
   * (full-content redaction) are handled.
   *
   *   - `'block'` (default) — throws `ConnectorValidationError`
   *     rather than persisting empty content (LanceDB schemas with
   *     NOT-NULL / min-length constraints produce opaque native
   *     errors otherwise).
   *   - `'pass-through'` — writes the empty content as-is.
   *
   * @default 'block'
   *
   * @security rev R2 closure (Story 2.10 audit): silently shipping
   *   empty redacted content masks the validator's intent + can
   *   produce confusing downstream NOT-NULL errors from LanceDB's
   *   native bindings.
   */
  emptyRedactionMode?: 'block' | 'pass-through';

  logger?: Logger;
}

/**
 * Structural alias for the textual record shape the connector expects
 * from `add()`. LanceDB accepts a wider `Data` type (Arrow Table,
 * stream, etc.) but the write validator only inspects array-of-object
 * inputs. Arrow-formatted inputs pass through with a logger warning.
 */
export type GuardedLanceRecord = Record<string, unknown>;

/**
 * Wrapped Query / VectorQuery handle. Exposes the LanceDB
 * Query-builder chain through a Proxy so consumers can chain
 * `where()`, `select()`, `limit()`, `nearestTo()`, etc. as usual.
 * Terminal `.toArray()` runs the configured RetrievedDocValidator
 * on the results.
 *
 * The structural type is intentionally permissive (`any`-returning
 * chain methods) because LanceDB's Query/VectorQuery split exposes
 * different chainables per type and the connector's wrapper applies
 * uniformly to both.
 */
export interface GuardedQueryHandle {
  /**
   * Run the query + validate retrieved rows. RetrievedDocValidator
   * is applied; blocked rows are filtered (or batch-blocks throw
   * `ConnectorValidationError`).
   */
  toArray(options?: unknown): Promise<unknown[]>;

  /**
   * Chainable Query-builder methods (where, select, limit,
   * nearestTo, ...). Each returns a fresh GuardedQueryHandle so the
   * wrapping survives the chain.
   *
   * The chained method is invoked on the underlying Query/VectorQuery;
   * if it returns a Query/VectorQuery (the common case), the result is
   * re-wrapped. If it returns anything else (e.g. a Promise from
   * `toArrow`), the unwrapped value passes through.
   */
  [chained: string]: unknown;
}

/**
 * Wrapped MergeInsertBuilder. Same Proxy-chaining pattern as
 * GuardedQueryHandle; terminal `.execute(data)` runs the
 * MemoryWriteValidator on the data before the underlying execute.
 */
export interface GuardedMergeInsertBuilder {
  /**
   * Execute the merge-insert. MemoryWriteValidator (if configured) is
   * applied to each row in `data` before the underlying execute fires.
   * On BLOCK, throws `ConnectorValidationError` and the merge does NOT
   * execute (no partial state).
   */
  execute(data: unknown, execOptions?: unknown): Promise<unknown>;

  /** Chainable builder methods. See {@link GuardedQueryHandle}. */
  [chained: string]: unknown;
}

/**
 * Public structural surface returned by `createGuardedLanceTable`.
 *
 * The wrapper exposes the SIX methods called out by the Story 2.10 AC
 * (add / update / delete / search / query / mergeInsert) with
 * validation injected. All other Table methods pass through via the
 * Proxy `get` trap (countRows, schema, version, listIndices, etc. are
 * available on `guarded.raw.<method>(...)` OR directly on
 * `guarded.<method>(...)` thanks to the trap).
 *
 * `raw` returns the underlying Table for consumers who explicitly
 * want to bypass the wrapper for advanced operations.
 */
export interface GuardedLanceTable {
  /**
   * Validate then add records. Per-row content validation via
   * `memoryWriteValidator.validateWrite`; BLOCKs throw
   * `ConnectorValidationError`. Non-array `Data` (Arrow Table,
   * stream) passes through unvalidated with a logger warning — the
   * write validator cannot inspect Arrow-formatted writes without
   * decoding the columnar buffer.
   */
  add(data: unknown, options?: unknown): Promise<unknown>;

  /**
   * Validate then update. ONLY the `{ values: <plain-object> }`
   * overload (variant 1) is inspected by the memoryWriteValidator;
   * both `{ valuesSql: ... }` (variant 2) and the top-level
   * `Record<string, string>` overload (variant 3 — SQL-string-typed
   * per LanceDB's SDK) are governed by `updateSqlMode`.
   */
  update(...args: unknown[]): Promise<unknown>;

  /**
   * Delete by SQL predicate. Predicate length capped by
   * `maxPredicateLength`. The connector does NOT SQL-parse the
   * predicate — that's LanceDB's job.
   */
  delete(predicate: string): Promise<unknown>;

  /** Wrapped search builder. See {@link GuardedQueryHandle}. */
  search(...args: unknown[]): GuardedQueryHandle;

  /** Wrapped query builder. See {@link GuardedQueryHandle}. */
  query(): GuardedQueryHandle;

  /**
   * Wrapped merge-insert builder. See {@link GuardedMergeInsertBuilder}.
   */
  mergeInsert(on: string | string[]): GuardedMergeInsertBuilder;

  /**
   * Escape hatch — underlying Table reference for advanced operations
   * that bypass the wrapper (countRows, schema, version, listIndices,
   * createIndex, optimize, etc.). Use sparingly; writes through `raw`
   * are NOT validated.
   */
  readonly raw: unknown;

  /** Pass-through Table methods (countRows, schema, ...) accessed via Proxy. */
  [passthrough: string]: unknown;
}
