/**
 * @blackunicorn/bonklm-turbopuffer — `createGuardedNamespace`
 * ===========================================================
 *
 * Wraps a Turbopuffer `Namespace` with BonkLM security guardrails. The
 * wrapper is a Proxy that intercepts the 3 methods called out by the
 * Story 2.11 AC (`write` / `query` / `deleteAll`) and passes every other
 * Namespace method straight through.
 *
 *   - **write** — pre-write validation via `MemoryWriteValidator`:
 *       - `upsert_rows` / `patch_rows`: per-row, per-column inspection
 *         on the configured `contentField(s)`. BLOCK throws
 *         `ConnectorValidationError` before the underlying write fires.
 *       - `upsert_columns` / `patch_columns`: governed by
 *         `columnarWriteMode` (default `'reject'` when a validator is
 *         wired). The connector does NOT transpose columnar → rows
 *         automatically (column-name mismatches + missing IDs would
 *         silently corrupt the write).
 *       - `delete_by_filter` / `patch_by_filter` / `deletes`: pass
 *         through (filter ops don't carry user content).
 *
 *   - **query** — post-retrieval validation via `RetrievedDocValidator`
 *     on `response.rows`. Position-stable synthetic ids defeat sibling-
 *     id spoofing. `maxResultCount` cap throws before validator dispatch
 *     to protect against O(N)-regex DoS on unbounded queries.
 *
 *   - **deleteAll** — destructive op; passes through unchanged.
 *
 * Edge-compatible: Turbopuffer is a pure HTTP client (no native bindings).
 * The connector uses no Node-only globals (no env-var lookups, no CJS
 * require, no `node:fs` / `node:path` / `node:child_process`).
 * Verified by static grep + module-load smoke in tests.
 *
 * Connector-style-guide shape: shape #2b "Vector-database sub-client
 * wrap with validators-in-opts" — `createGuardedNamespace(ns, opts)`.
 * Matches the Lance / Qdrant / Pinecone / Weaviate convention added at
 * Story 2.10.
 *
 * @package @blackunicorn/bonklm-turbopuffer
 */
// arch X3 closure (Story 2.11 audit): value imports route through the
// /core/connector-utils subpath, not the root barrel. The root barrel
// re-exports Node-only modules (HookSandbox, OverrideToken HMAC); a
// Workerd bundler resolving '@blackunicorn/bonklm' pulls those into the
// edge bundle and breaks the build. The /core/connector-utils subpath
// is statically verified to be edge-safe (no node: imports, no Buffer,
// no env-var lookups, no CJS require).
//
// Sprint 14 cumulative sec cross-S1 closure: `sanitizeReasonText` added
// to the import set; previously the reason text was interpolated raw
// into ConnectorValidationError.message.
import {
  applyRetrievedDocValidatorToMatches,
  ConnectorValidationError,
  sanitizeReasonText
} from '@blackunicorn/bonklm/core/connector-utils';
// Type-only imports from the root barrel are erased at compile time
// + carry no runtime cost. Safe to keep on the root path.
import type {
  GuardrailEngine,
  Logger,
  MemoryWritePayload,
  MemoryWriteValidator,
  RetrievedDoc,
  RetrievedDocValidator,
  ValidatorResult
} from '@blackunicorn/bonklm';
// Severity/RiskLevel are value imports (used to construct the
// synthetic notifyCachedResult payload). Edge-safe — they're plain
// string-literal enums.
import { RiskLevel, Severity } from '@blackunicorn/bonklm';
import type {
  GuardedNamespace,
  GuardedNamespaceOptions,
  GuardedNamespaceQueryResponse,
  GuardedNamespaceWriteParams,
  GuardedTurbopufferRow
} from './types.js';

/**
 * Methods on the underlying Namespace that the connector wraps.
 *
 * arch X7 closure (Story 2.11 audit): `multiQuery` is added because
 * Turbopuffer SDK 2.1+ ships a batched-query endpoint that returns
 * `{ results: Array<{ rows?: Row[] }> }`. Without wrapping, a consumer
 * routing user queries through `multiQuery` for batching would silently
 * bypass `RetrievedDocValidator` on all returned rows.
 */
const WRAPPED_NAMESPACE_METHODS = new Set(['write', 'query', 'multiQuery', 'deleteAll']);

const DEFAULT_CONTENT_FIELD = 'text';
const DEFAULT_USER_ID_FIELD = 'userId';
const DEFAULT_SESSION_ID_FIELD = 'sessionId';
const DEFAULT_MAX_RESULT_COUNT = 1000;

/**
 * Build a guarded wrapper around a Turbopuffer Namespace.
 *
 * @param namespace - the underlying `Namespace` instance from
 *   `client.namespace('my-namespace')` (or equivalent constructor).
 * @param options - validator wiring + boundary configuration.
 *
 * @example
 * ```ts
 * import { Turbopuffer } from "@turbopuffer/turbopuffer";
 * import { createGuardedNamespace } from "@blackunicorn/bonklm-turbopuffer";
 * import {
 *   PromptInjectionValidator,
 *   SecretGuard,
 *   PIIGuard,
 *   createMemoryWriteValidator,
 *   createRetrievedDocValidator,
 * } from "@blackunicorn/bonklm";
 *
 * const tpuf = new Turbopuffer({ apiKey: env.TURBOPUFFER_API_KEY });
 * const ns = tpuf.namespace('my-docs');
 *
 * const guarded = createGuardedNamespace(ns, {
 *   memoryWriteValidator: createMemoryWriteValidator({
 *     validators: [new SecretGuard(), new PIIGuard()],
 *     onFailure: "block-write",
 *   }),
 *   retrievedDocValidator: createRetrievedDocValidator({
 *     validators: [new PromptInjectionValidator()],
 *     onFailure: "filter",
 *   }),
 *   contentField: ["text", "summary"],
 * });
 *
 * await guarded.write({
 *   upsert_rows: [{ id: "1", text: "hello", vector: [0.1, 0.2] }],
 * });
 *
 * const r = await guarded.query({
 *   rank_by: ["vector", "ANN", [0.1, 0.2]],
 *   top_k: 10,
 * });
 * ```
 */
export function createGuardedNamespace(namespace: object, options: GuardedNamespaceOptions = {}): GuardedNamespace {
  const config = resolveOptions(options);

  // Pre-build wrappers so the Proxy `get` trap returns stable refs.
  const wrapped = {
    write: makeWriteWrapper(namespace, config),
    query: makeQueryWrapper(namespace, config),
    multiQuery: makeMultiQueryWrapper(namespace, config),
    deleteAll: makeDeleteAllWrapper(namespace)
  };

  return new Proxy(namespace, {
    get(target: object, prop: string | symbol, receiver: unknown): unknown {
      if (prop === 'raw') return target;
      if (typeof prop === 'string' && WRAPPED_NAMESPACE_METHODS.has(prop)) {
        return wrapped[prop as keyof typeof wrapped];
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }
      return value;
    }
  }) as unknown as GuardedNamespace;
}

interface ResolvedConfig {
  memoryWriteValidator?: MemoryWriteValidator;
  retrievedDocValidator?: RetrievedDocValidator;
  /**
   * Sprint 14 deferred-closure arch X6: engine reference (when
   * supplied) used to dispatch `notifyCachedResult` after read paths.
   */
  engine?: GuardrailEngine;
  contentFields: readonly string[];
  primaryContentField: string;
  userIdField: string;
  sessionIdField: string;
  columnarWriteMode: 'pass-through' | 'reject';
  maxResultCount: number;
  emptyRedactionMode: 'block' | 'pass-through';
  productionMode: boolean;
  logger?: Logger;
}

function resolveOptions(options: GuardedNamespaceOptions): ResolvedConfig {
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
    columnarWriteMode: options.columnarWriteMode ?? (hasWriteValidator ? 'reject' : 'pass-through'),
    maxResultCount: options.maxResultCount ?? DEFAULT_MAX_RESULT_COUNT,
    emptyRedactionMode: options.emptyRedactionMode ?? 'block',
    productionMode: options.productionMode ?? false,
    logger: options.logger
  };
}

function normaliseContentFields(raw: string | readonly string[]): readonly string[] {
  if (typeof raw === 'string') {
    if (raw.length === 0) {
      throw new Error(
        'createGuardedNamespace: `contentField` must be a non-empty string ' + 'or a non-empty array of strings.'
      );
    }
    return [raw];
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      'createGuardedNamespace: `contentField` must be a non-empty string ' + 'or a non-empty array of strings.'
    );
  }
  for (const field of raw) {
    if (typeof field !== 'string' || field.length === 0) {
      throw new Error('createGuardedNamespace: every entry of `contentField` array ' + 'must be a non-empty string.');
    }
  }
  return [...raw];
}

// ─────────────────────────────────────────────────────────────────────
// Write wrapper — upsert_rows / patch_rows validation + columnar guard
// ─────────────────────────────────────────────────────────────────────

function extractWritePayloadFor(
  record: GuardedTurbopufferRow,
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
    sessionId: typeof sessionId === 'string' ? sessionId : undefined
  };
}

/**
 * Validate an array of rows against the configured MemoryWriteValidator.
 * Multi-column: each entry of `config.contentFields` is validated per
 * row. BLOCK on ANY column rejects the row. Redact-mode redactions are
 * slotted back into the column they came from.
 *
 * Empty-redaction handling matches the Lance connector pattern (rev R2
 * closure): when `config.emptyRedactionMode === 'block'`, an empty
 * post-redaction content string throws rather than persisting empty.
 */
async function validateRows(
  rows: readonly GuardedTurbopufferRow[],
  config: ResolvedConfig,
  pathLabel: string
): Promise<GuardedTurbopufferRow[]> {
  if (config.memoryWriteValidator === undefined) {
    return [...rows];
  }
  const out: GuardedTurbopufferRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let working: GuardedTurbopufferRow = r;
    let mutated = false;

    for (const field of config.contentFields) {
      const payload = extractWritePayloadFor(working, field, config);
      if (payload === null) continue;

      const decision = await config.memoryWriteValidator.validateWrite(payload);
      if (decision.blocked) {
        // Sprint 14 cumulative sec cross-S1 closure.
        const sanitizedReason = sanitizeReasonText(decision.result.reason) ?? 'no reason';
        throw new ConnectorValidationError(
          config.productionMode
            ? `turbopuffer: ${pathLabel} at row ${i} column "${field}" blocked by memoryWriteValidator`
            : `turbopuffer: ${pathLabel} at row ${i} column "${field}" blocked: ${sanitizedReason}`,
          'validation_failed'
        );
      }
      const newContent = decision.payload.content;
      if (newContent === payload.content) continue;

      if (newContent === '' && config.emptyRedactionMode === 'block') {
        throw new ConnectorValidationError(
          config.productionMode
            ? `turbopuffer: ${pathLabel} at row ${i} column "${field}" produced empty content after redaction`
            : `turbopuffer: ${pathLabel} at row ${i} column "${field}" produced empty content after redaction (emptyRedactionMode='block'). Pre-validate, set emptyRedactionMode='pass-through', or use block-write mode on the validator.`,
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

function makeWriteWrapper(
  namespace: object,
  config: ResolvedConfig
): (params?: GuardedNamespaceWriteParams | null, options?: unknown) => Promise<unknown> {
  return async function write(params?: GuardedNamespaceWriteParams | null, options?: unknown): Promise<unknown> {
    if (params === null || typeof params !== 'object') {
      // rev R0 closure (Story 2.11 audit): SDK signature is
      // `write(params?: NamespaceWriteParams | null | undefined, ...)`.
      // Pass through; Turbopuffer SDK will throw its own typed error
      // for empty / null calls.
      return (
        namespace as {
          write: (p: unknown, o?: unknown) => Promise<unknown>;
        }
      ).write(params, options);
    }

    // Columnar-write guard (sec S2 parity). Inspected BEFORE row paths
    // because the AC mandate is "no silent columnar bypass when a
    // validator is wired" — even when rows ARE present in the same
    // call (mixed schema-evolution writes). Error message is explicit
    // about the mixed-mode detection so consumers can disentangle
    // (sec S-TPUF-5 closure).
    const hasColumnar = params.upsert_columns !== undefined || params.patch_columns !== undefined;
    const hasRows = Array.isArray(params.upsert_rows) || Array.isArray(params.patch_rows);
    if (hasColumnar && config.memoryWriteValidator !== undefined) {
      if (config.columnarWriteMode === 'reject') {
        const mixedNote = hasRows
          ? " (call also contained upsert_rows / patch_rows; entire write rejected to keep validation coverage uniform — split into two calls or set columnarWriteMode='pass-through')"
          : '';
        throw new ConnectorValidationError(
          `turbopuffer: write() received columnar input ` +
            `(upsert_columns / patch_columns) while memoryWriteValidator is ` +
            `configured and columnarWriteMode='reject' (default). The connector ` +
            `does not transpose columnar→rows automatically. Either submit the ` +
            `data as upsert_rows/patch_rows, or set columnarWriteMode='pass-through' ` +
            `to opt into unvalidated columnar writes.${mixedNote}`,
          'validation_failed'
        );
      }
      config.logger?.warn(
        '[bonklm-turbopuffer] write() received columnar input; ' + 'memoryWriteValidator passthrough.'
      );
    }

    let workingParams: GuardedNamespaceWriteParams = params;

    if (Array.isArray(params.upsert_rows)) {
      const validated = await validateRows(params.upsert_rows, config, 'upsert_rows');
      workingParams = { ...workingParams, upsert_rows: validated };
    }
    if (Array.isArray(params.patch_rows)) {
      const validated = await validateRows(params.patch_rows, config, 'patch_rows');
      workingParams = { ...workingParams, patch_rows: validated };
    }

    return (
      namespace as {
        write: (p: unknown, o?: unknown) => Promise<unknown>;
      }
    ).write(workingParams, options);
  };
}

// ─────────────────────────────────────────────────────────────────────
// Query wrapper — RetrievedDocValidator + maxResultCount cap
// ─────────────────────────────────────────────────────────────────────

function makeQueryWrapper(
  namespace: object,
  config: ResolvedConfig
): (params?: unknown, options?: unknown) => Promise<GuardedNamespaceQueryResponse> {
  return async function query(params?: unknown, options?: unknown): Promise<GuardedNamespaceQueryResponse> {
    const response = await (
      namespace as {
        query: (p?: unknown, o?: unknown) => Promise<GuardedNamespaceQueryResponse>;
      }
    ).query(params, options);

    if (response === null || typeof response !== 'object') {
      return response;
    }

    const rows = response.rows;
    if (!Array.isArray(rows)) {
      // No rows in the response (aggregation-only or recall metadata).
      return response;
    }

    // sec S6 closure: result-count cap.
    if (rows.length > config.maxResultCount) {
      throw new ConnectorValidationError(
        config.productionMode
          ? `turbopuffer: query result count ${rows.length} exceeds maxResultCount ${config.maxResultCount}`
          : `turbopuffer: query result count ${rows.length} exceeds maxResultCount ${config.maxResultCount}. Add top_k to the query, increase maxResultCount, or set Infinity to opt out.`,
        'validation_failed'
      );
    }

    if (config.retrievedDocValidator === undefined) {
      return response;
    }

    const recordRows = rows.filter((r): r is GuardedTurbopufferRow => typeof r === 'object' && r !== null);
    const { valid } = await applyRetrievedDocValidatorToMatches(
      recordRows,
      config.retrievedDocValidator,
      (m): Omit<RetrievedDoc, 'id'> => {
        const content = m[config.primaryContentField];
        return {
          content: typeof content === 'string' ? content : '',
          metadata: m
        };
      },
      {
        productionMode: config.productionMode,
        itemNoun: 'document'
      }
    );

    // Sprint 14 deferred-closure arch X6: dispatch retrieved-doc
    // decision to engine.onIntercept(...) listeners when configured.
    notifyEngineForRetrievedBatch(config, recordRows, 'turbopuffer:query');

    return { ...response, rows: valid };
  };
}

/**
 * Internal: fire `engine.notifyCachedResult` with a synthetic
 * aggregated `ValidatorResult` representing the retrieved-doc batch
 * decision. Used by both `makeQueryWrapper` and `makeMultiQueryWrapper`.
 *
 * If `applyRetrievedDocValidatorToMatches` BLOCKED the batch, the
 * caller throws before reaching this helper — so the notification
 * always describes an ALLOW outcome. Per-doc filtering (some rows
 * dropped) is invisible at this aggregation layer; consumers wanting
 * row-level visibility should wire the validator's own logger.
 */
function notifyEngineForRetrievedBatch(
  config: ResolvedConfig,
  rows: readonly GuardedTurbopufferRow[],
  surface: string
): void {
  if (config.engine === undefined) return;
  const syntheticResult: ValidatorResult = {
    allowed: true,
    blocked: false,
    severity: Severity.INFO,
    risk_level: RiskLevel.LOW,
    risk_score: 0,
    findings: [],
    timestamp: Date.now(),
    validatorName: 'TurbopufferRetrievedDocBatch'
  };
  const contentForCallback = rows
    .map(r => {
      const c = r[config.primaryContentField];
      return typeof c === 'string' ? c : '';
    })
    .join('\n');
  void config.engine.notifyCachedResult([syntheticResult], contentForCallback, surface);
}

// ─────────────────────────────────────────────────────────────────────
// MultiQuery wrapper — batched-query response validation (arch X7)
// ─────────────────────────────────────────────────────────────────────

/**
 * arch X7 closure (Story 2.11 audit): `multiQuery` returns
 * `{ results: Array<{ rows?: Row[], aggregations?, aggregation_groups? }> }`.
 * Each result's `rows` array is independently validated + capped at
 * `maxResultCount`. A BLOCK in ANY sub-result throws and the entire
 * multi-query response is rejected (matches the per-row BLOCK semantics
 * of the write path).
 */
function makeMultiQueryWrapper(
  namespace: object,
  config: ResolvedConfig
): (
  params?: unknown,
  options?: unknown
) => Promise<{
  results?: Array<{ rows?: GuardedTurbopufferRow[]; [k: string]: unknown }>;
  [k: string]: unknown;
}> {
  return async function multiQuery(
    params?: unknown,
    options?: unknown
  ): Promise<{
    results?: Array<{ rows?: GuardedTurbopufferRow[]; [k: string]: unknown }>;
    [k: string]: unknown;
  }> {
    const response = (await (
      namespace as {
        multiQuery: (
          p?: unknown,
          o?: unknown
        ) => Promise<{
          results?: Array<{
            rows?: GuardedTurbopufferRow[];
            [k: string]: unknown;
          }>;
          [k: string]: unknown;
        }>;
      }
    ).multiQuery(params, options)) as {
      results?: Array<{
        rows?: GuardedTurbopufferRow[];
        [k: string]: unknown;
      }>;
      [k: string]: unknown;
    };

    if (response === null || typeof response !== 'object') return response;
    const results = response.results;
    if (!Array.isArray(results)) return response;

    const validatedResults: Array<{
      rows?: GuardedTurbopufferRow[];
      [k: string]: unknown;
    }> = [];
    for (let i = 0; i < results.length; i++) {
      const sub = results[i];
      if (sub === null || typeof sub !== 'object') {
        validatedResults.push(sub);
        continue;
      }
      const rows = sub.rows;
      if (!Array.isArray(rows)) {
        validatedResults.push(sub);
        continue;
      }
      if (rows.length > config.maxResultCount) {
        throw new ConnectorValidationError(
          config.productionMode
            ? `turbopuffer: multi_query[${i}] result count ${rows.length} exceeds maxResultCount ${config.maxResultCount}`
            : `turbopuffer: multi_query[${i}] result count ${rows.length} exceeds maxResultCount ${config.maxResultCount}. Add top_k to the per-query params, increase maxResultCount, or set Infinity to opt out.`,
          'validation_failed'
        );
      }
      if (config.retrievedDocValidator === undefined) {
        validatedResults.push(sub);
        continue;
      }
      const recordRows = rows.filter((r): r is GuardedTurbopufferRow => typeof r === 'object' && r !== null);
      const { valid } = await applyRetrievedDocValidatorToMatches(
        recordRows,
        config.retrievedDocValidator,
        (m): Omit<RetrievedDoc, 'id'> => {
          const content = m[config.primaryContentField];
          return {
            content: typeof content === 'string' ? content : '',
            metadata: m
          };
        },
        {
          productionMode: config.productionMode,
          itemNoun: 'document'
        }
      );
      validatedResults.push({ ...sub, rows: valid });
      notifyEngineForRetrievedBatch(config, recordRows, `turbopuffer:multiQuery[${i}]`);
    }

    return { ...response, results: validatedResults };
  };
}

// ─────────────────────────────────────────────────────────────────────
// DeleteAll wrapper — passthrough
// ─────────────────────────────────────────────────────────────────────

function makeDeleteAllWrapper(namespace: object): (...args: unknown[]) => Promise<unknown> {
  // Use rest-args so we forward EXACTLY the arity the caller used. This
  // matters for vitest's `toHaveBeenCalledWith` strict-arity check + for
  // any future Turbopuffer SDK that adds discriminator behaviour based
  // on `arguments.length`.
  return async function deleteAll(...args: unknown[]): Promise<unknown> {
    return (
      namespace as {
        deleteAll: (...a: unknown[]) => Promise<unknown>;
      }
    ).deleteAll(...args);
  };
}
