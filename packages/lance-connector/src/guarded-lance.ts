/**
 * @blackunicorn/bonklm-lance — `createGuardedLanceTable`
 * ======================================================
 *
 * Wraps a LanceDB `Table` with BonkLM security guardrails. The wrapper
 * is a Proxy that intercepts the 6 methods called out by the Story 2.10
 * AC (add / update / delete / search / query / mergeInsert) and passes
 * every other Table method straight through to the underlying instance.
 *
 *   - **add / update / mergeInsert(...).execute** — pre-write validation
 *     via `MemoryWriteValidator.validateWrite`. On BLOCK the connector
 *     throws `ConnectorValidationError` BEFORE the underlying write
 *     fires — no partial state. Per-row content extracted from the
 *     configurable `contentField` (default `'text'`).
 *
 *   - **search().toArray() / query().toArray()** — post-retrieval
 *     validation via `RetrievedDocValidator` (through the shared
 *     `applyRetrievedDocValidatorToMatches` helper from core's
 *     connector-utils). Position-stable synthetic ids (`__pos_${i}`)
 *     defeat attacker-spoofed sibling-id substitutions.
 *
 *   - **delete(predicate)** — predicate length capped at
 *     `maxPredicateLength` (default 10k). The connector does NOT
 *     SQL-parse the predicate; that's LanceDB's responsibility. The
 *     cap is a boundary guard against concatenated attacker input.
 *
 *   - **update({ valuesSql })** — by default passes through unvalidated
 *     (valuesSql is author-controlled per LanceDB's contract). Switch
 *     to `updateSqlMode: 'block-sql'` to harden against accidental
 *     user-input concatenation into `valuesSql`.
 *
 * Node-only: LanceDB ships native bindings; the connector inherits
 * the Node-only constraint. Edge/Workerd consumers should use the
 * Turbopuffer connector (Story 2.11) instead.
 *
 * Connector-style-guide shape: per Story 2.10 AC the factory is
 * `createGuardedLanceTable(table, opts)` — shape #1 with the engine /
 * validators carried inside `opts`. This mirrors the `wrapMemoryClient
 * (client, { engine, adapter, getTenantId })` pattern locked in
 * `connector-style-guide.md` §Multi-surface connectors §Pattern A.
 *
 * @package @blackunicorn/bonklm-lance
 */
import { RiskLevel, Severity } from '@blackunicorn/bonklm';
import type {
  GuardrailEngine,
  Logger,
  MemoryWritePayload,
  MemoryWriteValidator,
  RetrievedDoc,
  RetrievedDocValidator,
  ValidatorResult,
} from '@blackunicorn/bonklm';
// Sprint 14 cumulative sec cross-S1 closure + arch X3-bundle-safety:
// value imports route through the connector-utils subpath. The root
// barrel re-exports Node-only modules (HookSandbox, OverrideToken
// HMAC); the subpath is statically verified edge-safe. Inherited from
// Story 2.11 arch X3 closure.
import {
  ConnectorValidationError,
  applyRetrievedDocValidatorToMatches,
  sanitizeReasonText,
} from '@blackunicorn/bonklm/core/connector-utils';
import type {
  GuardedLanceRecord,
  GuardedLanceTable,
  GuardedLanceTableOptions,
  GuardedMergeInsertBuilder,
  GuardedQueryHandle,
} from './types.js';

/** Methods on the underlying Table that the connector wraps. */
const WRAPPED_TABLE_METHODS = new Set([
  'add',
  'update',
  'delete',
  'search',
  'query',
  'mergeInsert',
]);

/** Default `contentField` per Story 2.10. */
const DEFAULT_CONTENT_FIELD = 'text';
const DEFAULT_USER_ID_FIELD = 'userId';
const DEFAULT_SESSION_ID_FIELD = 'sessionId';

/** Default predicate cap on `delete(predicate)`. */
const DEFAULT_MAX_PREDICATE_LENGTH = 10000;

/** Default cap on `.toArray()` row count (sec S6 closure). */
const DEFAULT_MAX_RESULT_COUNT = 1000;

/**
 * Build a guarded wrapper around a LanceDB Table.
 *
 * @param table - the underlying `Table` instance from `db.openTable(...)`
 *   or `db.createTable(...)`.
 * @param options - validator wiring + boundary configuration.
 *
 * @example
 * ```ts
 * import { connect } from "@lancedb/lancedb";
 * import {
 *   createGuardedLanceTable,
 * } from "@blackunicorn/bonklm-lance";
 * import {
 *   PromptInjectionValidator,
 *   SecretGuard,
 *   PIIGuard,
 *   createMemoryWriteValidator,
 *   createRetrievedDocValidator,
 * } from "@blackunicorn/bonklm";
 *
 * const db = await connect("./.lancedb");
 * const rawTable = await db.openTable("docs");
 *
 * const guarded = createGuardedLanceTable(rawTable, {
 *   memoryWriteValidator: createMemoryWriteValidator({
 *     validators: [new SecretGuard(), new PIIGuard()],
 *     onFailure: "block-write",
 *   }),
 *   retrievedDocValidator: createRetrievedDocValidator({
 *     validators: [new PromptInjectionValidator()],
 *     onFailure: "filter",
 *   }),
 *   contentField: "document",
 * });
 *
 * // Writes are validated:
 * await guarded.add([{ id: "1", document: "hello world", embedding: [...] }]);
 *
 * // Searches are validated post-retrieval:
 * const results = await guarded.search([0.1, 0.2, 0.3]).limit(10).toArray();
 * ```
 */
export function createGuardedLanceTable(
  table: object,
  options: GuardedLanceTableOptions = {}
): GuardedLanceTable {
  const config = resolveOptions(options);

  // Pre-build the wrapper functions so the Proxy `get` trap returns a
  // STABLE reference (matters for consumers who compare function
  // identity, e.g. for memoization).
  const wrapped = {
    add: makeAddWrapper(table, config),
    update: makeUpdateWrapper(table, config),
    delete: makeDeleteWrapper(table, config),
    search: makeSearchWrapper(table, config),
    query: makeQueryWrapper(table, config),
    mergeInsert: makeMergeInsertWrapper(table, config),
  };

  return new Proxy(table, {
    get(target: object, prop: string | symbol, receiver: unknown): unknown {
      if (prop === 'raw') return target;
      if (typeof prop === 'string' && WRAPPED_TABLE_METHODS.has(prop)) {
        return wrapped[prop as keyof typeof wrapped];
      }
      // Passthrough — bind to the underlying table so `this` is
      // correct for methods that depend on it (Table is an abstract
      // class with internal native bindings).
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }
      return value;
    },
  }) as unknown as GuardedLanceTable;
}

/**
 * Internal: resolve + defaults the options bag.
 *
 * `contentField` is normalised to a `readonly string[]` regardless of
 * whether the consumer supplied a single string or an array; downstream
 * write/redact paths iterate uniformly.
 */
interface ResolvedConfig {
  memoryWriteValidator?: MemoryWriteValidator;
  retrievedDocValidator?: RetrievedDocValidator;
  /**
   * Sprint 14 deferred-closure arch X6: engine reference (when
   * supplied) used to dispatch `notifyCachedResult` after read paths.
   */
  engine?: GuardrailEngine;
  /** Always at least one entry. */
  contentFields: readonly string[];
  /**
   * First entry of `contentFields` — used as the primary projection
   * column for `RetrievedDocValidator` (the validator only consumes a
   * single `content` string per doc). Multi-column rows still validate
   * every listed column on writes; on retrieval, validators inspect
   * the primary column's content.
   */
  primaryContentField: string;
  userIdField: string;
  sessionIdField: string;
  updateSqlMode: 'pass-through-sql' | 'block-sql';
  maxPredicateLength: number;
  maxResultCount: number;
  arrowWriteMode: 'pass-through' | 'reject';
  emptyRedactionMode: 'block' | 'pass-through';
  productionMode: boolean;
  logger?: Logger;
}

function resolveOptions(options: GuardedLanceTableOptions): ResolvedConfig {
  const rawContent = options.contentField ?? DEFAULT_CONTENT_FIELD;
  const contentFields = normaliseContentFields(rawContent);
  const hasWriteValidator = options.memoryWriteValidator !== undefined;

  return {
    memoryWriteValidator: options.memoryWriteValidator,
    retrievedDocValidator: options.retrievedDocValidator,
    engine: options.engine,
    contentFields,
    primaryContentField: contentFields[0],
    userIdField: options.userIdField ?? DEFAULT_USER_ID_FIELD,
    sessionIdField: options.sessionIdField ?? DEFAULT_SESSION_ID_FIELD,
    // sec S3 closure: default depends on validator presence. Safer-
    // by-default when a validator is wired (block SQL paths so the
    // consumer can't accidentally route user input through an
    // unvalidated SQL string).
    updateSqlMode:
      options.updateSqlMode ?? (hasWriteValidator ? 'block-sql' : 'pass-through-sql'),
    maxPredicateLength:
      options.maxPredicateLength ?? DEFAULT_MAX_PREDICATE_LENGTH,
    maxResultCount: options.maxResultCount ?? DEFAULT_MAX_RESULT_COUNT,
    // sec S2 closure: when a write validator is configured, reject
    // non-array Data by default so Arrow-Table inputs can't silently
    // bypass validation.
    arrowWriteMode:
      options.arrowWriteMode ?? (hasWriteValidator ? 'reject' : 'pass-through'),
    emptyRedactionMode: options.emptyRedactionMode ?? 'block',
    productionMode: options.productionMode ?? false,
    logger: options.logger,
  };
}

/**
 * Normalise `contentField` config (string | readonly string[]) into a
 * non-empty `readonly string[]`. Throws on invalid input rather than
 * silently falling back to defaults — misconfiguration here is a
 * security concern (sec S1: skipped columns = unvalidated payloads).
 */
function normaliseContentFields(
  raw: string | readonly string[]
): readonly string[] {
  if (typeof raw === 'string') {
    if (raw.length === 0) {
      throw new Error(
        'createGuardedLanceTable: `contentField` must be a non-empty string ' +
          'or a non-empty array of strings.'
      );
    }
    return [raw];
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      'createGuardedLanceTable: `contentField` must be a non-empty string ' +
        'or a non-empty array of strings.'
    );
  }
  for (const field of raw) {
    if (typeof field !== 'string' || field.length === 0) {
      throw new Error(
        'createGuardedLanceTable: every entry of `contentField` array must ' +
          'be a non-empty string.'
      );
    }
  }
  return [...raw];
}

// ─────────────────────────────────────────────────────────────────────
// Write wrappers — add / update / mergeInsert.execute
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a single-column `MemoryWritePayload`. Returns `null` when the
 * record does NOT carry the named field as a string — in that case
 * the validator has nothing to inspect for this column.
 *
 * Multi-column validation: `validateWriteRecords` iterates
 * `config.contentFields` and calls this per (record, field) pair so
 * each text column is independently validated.
 */
function extractWritePayloadFor(
  record: GuardedLanceRecord,
  field: string,
  config: ResolvedConfig
): MemoryWritePayload | null {
  const raw = record[field];
  if (typeof raw !== 'string') return null;
  const userId = record[config.userIdField];
  const sessionId = record[config.sessionIdField];
  return {
    content: raw,
    userId: typeof userId === 'string' ? userId : undefined,
    sessionId: typeof sessionId === 'string' ? sessionId : undefined,
  };
}

/**
 * Validate an array of records against the configured
 * MemoryWriteValidator. Throws ConnectorValidationError on the first
 * BLOCK (or empty-redaction in `emptyRedactionMode: 'block'`).
 * Returns the (possibly redacted) records.
 *
 * Multi-column (sec S1 closure): each entry of `config.contentFields`
 * is validated independently per row. A BLOCK on ANY column rejects
 * the whole row. Redact-mode redactions are slotted back into the
 * column they came from.
 *
 * Empty-redaction handling (rev R2 closure): when the validator
 * returns an empty string after redaction AND
 * `config.emptyRedactionMode === 'block'`, the write is rejected
 * rather than persisting empty content (LanceDB native-binding
 * NOT-NULL errors are opaque to the consumer).
 */
async function validateWriteRecords(
  records: readonly GuardedLanceRecord[],
  config: ResolvedConfig
): Promise<GuardedLanceRecord[]> {
  if (config.memoryWriteValidator === undefined) {
    return [...records];
  }
  const out: GuardedLanceRecord[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    let working: GuardedLanceRecord = r;
    let mutated = false;

    for (const field of config.contentFields) {
      const payload = extractWritePayloadFor(working, field, config);
      if (payload === null) {
        // Column absent or non-string on this row → nothing to inspect.
        continue;
      }
      const decision = await config.memoryWriteValidator.validateWrite(payload);
      if (decision.blocked) {
        // Sprint 14 cumulative sec cross-S1 closure: sanitize the
        // attacker-controlled validator reason before it lands in
        // ConnectorValidationError.message (which downstream consumers
        // route to Sentry / Datadog / OTel spans).
        const sanitizedReason =
          sanitizeReasonText(decision.result.reason) ?? 'no reason';
        throw new ConnectorValidationError(
          config.productionMode
            ? `lance: write at row ${i} column "${field}" blocked by memoryWriteValidator`
            : `lance: write at row ${i} column "${field}" blocked: ${sanitizedReason}`,
          'validation_failed'
        );
      }
      const newContent = decision.payload.content;
      if (newContent === payload.content) {
        // No change — leave the row alone.
        continue;
      }
      // rev R2 closure: empty-string redaction handling.
      if (newContent === '' && config.emptyRedactionMode === 'block') {
        throw new ConnectorValidationError(
          config.productionMode
            ? `lance: write at row ${i} column "${field}" produced empty content after redaction`
            : `lance: write at row ${i} column "${field}" produced empty content after redaction (emptyRedactionMode='block'). Pre-validate, set emptyRedactionMode='pass-through', or use block-write mode on the validator.`,
          'validation_failed'
        );
      }
      working = { ...working, [field]: newContent };
      mutated = true;
    }

    out.push(mutated ? working : r);
  }
  return out;
}

/**
 * Detect whether `data` is the array-of-records shape the write
 * validator can inspect. LanceDB accepts a much wider `Data` type
 * (Arrow Table, ReadableStream, etc.); those shapes pass through
 * unvalidated with a logger warning so consumers know.
 */
function isPlainRecordArray(data: unknown): data is GuardedLanceRecord[] {
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return true;
  // Spot-check the first element; LanceDB doesn't mix shapes in a
  // single add() call.
  const first = data[0];
  return (
    typeof first === 'object' &&
    first !== null &&
    Object.getPrototypeOf(first) === Object.prototype
  );
}

function makeAddWrapper(
  table: object,
  config: ResolvedConfig
): (data: unknown, options?: unknown) => Promise<unknown> {
  return async function add(data: unknown, options?: unknown): Promise<unknown> {
    if (!isPlainRecordArray(data)) {
      // sec S2 closure: reject by default when a validator is wired;
      // otherwise pass through with a warning.
      if (
        config.arrowWriteMode === 'reject' &&
        config.memoryWriteValidator !== undefined
      ) {
        throw new ConnectorValidationError(
          'lance: add() received non-plain-record-array data (Arrow Table / ' +
            'stream / class instance) while memoryWriteValidator is configured ' +
            "and arrowWriteMode='reject' (default). The connector cannot " +
            'inspect Arrow-encoded buffers without decoding. Either serialise ' +
            "the input to a plain-record array, or set arrowWriteMode='pass-through' " +
            'to opt into unvalidated Arrow writes.',
          'validation_failed'
        );
      }
      config.logger?.warn(
        '[bonklm-lance] add() called with non-plain-record-array data ' +
          '(Arrow Table / stream / etc.); memoryWriteValidator passthrough.'
      );
      return (table as { add: (d: unknown, o?: unknown) => Promise<unknown> }).add(data, options);
    }
    const validated = await validateWriteRecords(data, config);
    return (table as { add: (d: unknown, o?: unknown) => Promise<unknown> }).add(
      validated,
      options
    );
  };
}

/**
 * Detect the update-overload variant. LanceDB exposes three:
 *   1. `update({ values: Record<string, IntoSql> } & Partial<UpdateOptions>)`
 *   2. `update({ valuesSql: Record<string, string> } & Partial<UpdateOptions>)`
 *   3. `update(updates: Record<string, string>, options?)`
 * Variant 2 is the only one carrying SQL expressions; variant 3's
 * top-level Record is also SQL-string-typed per the SDK.
 */
function classifyUpdateArgs(
  args: readonly unknown[]
): 'values' | 'valuesSql' | 'recordSql' | 'unknown' {
  if (args.length === 0) return 'unknown';
  const first = args[0];
  if (typeof first !== 'object' || first === null) return 'unknown';
  const r = first as Record<string, unknown>;
  // rev R1 closure: `values` must be a plain object to qualify as
  // variant 1. A variant-3 SQL Record that happens to contain a
  // string-valued key literally named `values` would otherwise be
  // misrouted to the validation path AND its SQL-string-typed value
  // would slip through as a "record" to the memoryWriteValidator.
  if ('values' in r && isPlainObject(r.values)) return 'values';
  if ('valuesSql' in r && isPlainObject(r.valuesSql)) return 'valuesSql';
  // Variant 3: top-level Record<string, string>; no `values` or
  // `valuesSql` keys carrying plain objects. Treat as SQL-string
  // update (matches LanceDB's declared type for variant 3).
  return 'recordSql';
}

/**
 * Plain-object check. Used by `classifyUpdateArgs` to verify that a
 * `values` / `valuesSql` field is a true `Record<string, *>` rather
 * than a string / Map / array / class instance that happens to coexist
 * with the key. Matches `Object.prototype` precisely (rejects
 * `Object.create(null)` deliberately — LanceDB rejects those upstream
 * anyway).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function makeUpdateWrapper(
  table: object,
  config: ResolvedConfig
): (...args: unknown[]) => Promise<unknown> {
  return async function update(...args: unknown[]): Promise<unknown> {
    const variant = classifyUpdateArgs(args);
    if (variant === 'valuesSql' || variant === 'recordSql') {
      if (config.updateSqlMode === 'block-sql') {
        throw new ConnectorValidationError(
          'lance: update() with valuesSql / SQL-string Record is blocked ' +
            '(updateSqlMode="block-sql"). Use the { values: {...} } overload ' +
            'and route through the memoryWriteValidator.',
          'validation_failed'
        );
      }
      // Pass-through: SQL strings are author-controlled per the
      // LanceDB contract. The connector does NOT inspect SQL.
      return (table as { update: (...a: unknown[]) => Promise<unknown> }).update(
        ...args
      );
    }
    if (variant === 'values') {
      const first = args[0] as { values: Record<string, unknown> };
      // Treat the `values` object as a one-row record for validation
      // purposes — the consumer is updating column values for matching
      // rows, so the content field semantics apply.
      const asRecord: GuardedLanceRecord = { ...first.values };
      const [validated] = await validateWriteRecords([asRecord], config);
      const newFirst = { ...first, values: validated };
      return (table as { update: (...a: unknown[]) => Promise<unknown> }).update(
        newFirst,
        ...args.slice(1)
      );
    }
    // Unknown shape — pass through; LanceDB will throw a typed error.
    return (table as { update: (...a: unknown[]) => Promise<unknown> }).update(
      ...args
    );
  };
}

function makeMergeInsertWrapper(
  table: object,
  config: ResolvedConfig
): (on: string | string[]) => GuardedMergeInsertBuilder {
  return function mergeInsert(on: string | string[]): GuardedMergeInsertBuilder {
    const builder = (table as {
      mergeInsert: (k: string | string[]) => object;
    }).mergeInsert(on);
    return wrapMergeInsertBuilder(builder, config);
  };
}

/**
 * Wrap a MergeInsertBuilder so chained methods preserve the wrapper
 * and `.execute(data)` runs the write validator before invoking the
 * underlying execute.
 */
function wrapMergeInsertBuilder(
  builder: object,
  config: ResolvedConfig
): GuardedMergeInsertBuilder {
  return new Proxy(builder, {
    get(target: object, prop: string | symbol, receiver: unknown): unknown {
      if (prop === 'raw') return target;
      if (prop === 'execute') {
        return async function execute(
          data: unknown,
          execOptions?: unknown
        ): Promise<unknown> {
          if (!isPlainRecordArray(data)) {
            // sec S2 parity: reject non-plain Data by default when
            // a validator is wired; otherwise warn + passthrough.
            if (
              config.arrowWriteMode === 'reject' &&
              config.memoryWriteValidator !== undefined
            ) {
              throw new ConnectorValidationError(
                'lance: mergeInsert(...).execute() received non-plain-record-array ' +
                  'data while memoryWriteValidator is configured and ' +
                  "arrowWriteMode='reject' (default). Either serialise the " +
                  "input to a plain-record array, or set arrowWriteMode='pass-through' " +
                  'to opt into unvalidated writes.',
                'validation_failed'
              );
            }
            config.logger?.warn(
              '[bonklm-lance] mergeInsert(...).execute() called with ' +
                'non-plain-record-array data; memoryWriteValidator passthrough.'
            );
            return (target as {
              execute: (d: unknown, o?: unknown) => Promise<unknown>;
            }).execute(data, execOptions);
          }
          const validated = await validateWriteRecords(data, config);
          return (target as {
            execute: (d: unknown, o?: unknown) => Promise<unknown>;
          }).execute(validated, execOptions);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        // Chainable methods on MergeInsertBuilder return `this` — we
        // re-wrap so the chain stays guarded. rev R3 closure: if the
        // chain ever returns `undefined` (fire-and-forget setter on a
        // future LanceDB version), log a warning + return undefined
        // so the consumer sees the SDK's actual return rather than
        // silently getting a wrapper they cannot chain off.
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(
            target,
            args
          );
          if (result === target || isMergeBuilderLike(result)) {
            return wrapMergeInsertBuilder(result as object, config);
          }
          if (result === undefined) {
            config.logger?.warn(
              '[bonklm-lance] mergeInsert builder method returned `undefined`; ' +
                'chain wrapping cannot continue. Consumer call site likely ' +
                'expected a chainable return.',
              { method: String(prop) }
            );
          }
          return result;
        };
      }
      return value;
    },
  }) as unknown as GuardedMergeInsertBuilder;
}

function isMergeBuilderLike(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { execute?: unknown }).execute === 'function'
  );
}

// ─────────────────────────────────────────────────────────────────────
// Delete wrapper — boundary validation on predicate length
// ─────────────────────────────────────────────────────────────────────

function makeDeleteWrapper(
  table: object,
  config: ResolvedConfig
): (predicate: string) => Promise<unknown> {
  return async function deleteFn(predicate: string): Promise<unknown> {
    if (typeof predicate !== 'string') {
      throw new ConnectorValidationError(
        'lance: delete() predicate must be a string',
        'validation_failed'
      );
    }
    if (predicate.length > config.maxPredicateLength) {
      throw new ConnectorValidationError(
        `lance: delete() predicate length ${predicate.length} exceeds ` +
          `maxPredicateLength ${config.maxPredicateLength}. Pre-validate ` +
          'or split the predicate at the caller boundary.',
        'validation_failed'
      );
    }
    return (table as { delete: (p: string) => Promise<unknown> }).delete(predicate);
  };
}

// ─────────────────────────────────────────────────────────────────────
// Read wrappers — search() + query()
// ─────────────────────────────────────────────────────────────────────

function makeSearchWrapper(
  table: object,
  config: ResolvedConfig
): (...args: unknown[]) => GuardedQueryHandle {
  return function search(...args: unknown[]): GuardedQueryHandle {
    const queryBuilder = (table as {
      search: (...a: unknown[]) => object;
    }).search(...args);
    return wrapQueryBuilder(queryBuilder, config);
  };
}

function makeQueryWrapper(
  table: object,
  config: ResolvedConfig
): () => GuardedQueryHandle {
  return function query(): GuardedQueryHandle {
    const queryBuilder = (table as { query: () => object }).query();
    return wrapQueryBuilder(queryBuilder, config);
  };
}

/**
 * Wrap a Query / VectorQuery builder so chained methods preserve the
 * wrapper and `.toArray()` runs the RetrievedDocValidator on the
 * returned rows.
 *
 * sec S6 closure: `.toArray()` enforces `config.maxResultCount` and
 * throws ConnectorValidationError when the result set exceeds the cap.
 * This protects validators from O(N) regex-scan DoS on unbounded
 * `query()` calls.
 */
function wrapQueryBuilder(
  builder: object,
  config: ResolvedConfig
): GuardedQueryHandle {
  return new Proxy(builder, {
    get(target: object, prop: string | symbol, receiver: unknown): unknown {
      if (prop === 'raw') return target;
      if (prop === 'toArray') {
        return async function toArray(toArrayOptions?: unknown): Promise<unknown[]> {
          const rows: unknown[] = await (target as {
            toArray: (o?: unknown) => Promise<unknown[]>;
          }).toArray(toArrayOptions);
          // sec S6 closure: result-count cap. Applied BEFORE validator
          // dispatch so unbounded queries don't even reach the
          // O(N)-regex path.
          if (rows.length > config.maxResultCount) {
            throw new ConnectorValidationError(
              config.productionMode
                ? `lance: query result count ${rows.length} exceeds maxResultCount ${config.maxResultCount}`
                : `lance: query result count ${rows.length} exceeds maxResultCount ${config.maxResultCount}. Add .limit() to the query chain, increase maxResultCount, or set Infinity to opt out.`,
              'validation_failed'
            );
          }
          if (config.retrievedDocValidator === undefined) {
            return rows;
          }
          const recordRows = rows.filter(
            (r): r is GuardedLanceRecord =>
              typeof r === 'object' && r !== null
          );
          const { valid } = await applyRetrievedDocValidatorToMatches(
            recordRows,
            config.retrievedDocValidator,
            (m): Omit<RetrievedDoc, 'id'> => {
              // Validator inspects the PRIMARY content field. Multi-
              // column write validation is per-write only; retrieval
              // validation projects through the first listed column
              // (the convention is the primary user-text column).
              const content = m[config.primaryContentField];
              return {
                content: typeof content === 'string' ? content : '',
                metadata: m,
              };
            },
            {
              productionMode: config.productionMode,
              itemNoun: 'document',
            }
          );
          // Sprint 14 deferred-closure arch X6: when an engine is
          // supplied, dispatch the aggregated retrieved-doc result to
          // `engine.notifyCachedResult` so `engine.onIntercept(...)`
          // listeners observe Lance read-path decisions. The
          // `validateBatch` API returns a single aggregated result —
          // we wrap it in a synthetic ValidatorResult[] for the
          // notification call.
          if (config.engine !== undefined) {
            // applyRetrievedDocValidatorToMatches uses validateBatch
            // internally + throws on batch-block; if we got here the
            // batch was ALLOW (possibly with per-doc filtering).
            // Synthesize an ALLOW ValidatorResult so the engine sees
            // ONE result aggregated from this batch.
            const syntheticResult: ValidatorResult = {
              allowed: true,
              blocked: false,
              severity: Severity.INFO,
              risk_level: RiskLevel.LOW,
              risk_score: 0,
              findings: [],
              timestamp: Date.now(),
              validatorName: 'LanceRetrievedDocBatch',
            };
            const contentForCallback = recordRows
              .map((r) => {
                const c = r[config.primaryContentField];
                return typeof c === 'string' ? c : '';
              })
              .join('\n');
            void config.engine.notifyCachedResult(
              [syntheticResult],
              contentForCallback,
              'lance:query.toArray'
            );
          }
          return valid;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(
            target,
            args
          );
          // Chainable Query/VectorQuery methods return `this` (or a
          // related builder); re-wrap so the chain stays guarded.
          // rev R3 closure: undefined returns from future SDK versions
          // emit a warning so the silent-chain-break is observable.
          if (result === target || isQueryBuilderLike(result)) {
            return wrapQueryBuilder(result as object, config);
          }
          if (result === undefined) {
            config.logger?.warn(
              '[bonklm-lance] query builder method returned `undefined`; ' +
                'chain wrapping cannot continue.',
              { method: String(prop) }
            );
          }
          return result;
        };
      }
      return value;
    },
  }) as unknown as GuardedQueryHandle;
}

function isQueryBuilderLike(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toArray?: unknown }).toArray === 'function'
  );
}
