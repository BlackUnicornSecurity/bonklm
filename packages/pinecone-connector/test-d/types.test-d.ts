/**
 * Type-surface tests for `@blackunicorn/bonklm-pinecone`.
 *
 * Locks the public type contract exported from the package barrel:
 *   - `createGuardedIndex(index, options?)` factory (first arg duck-typed
 *     `any`; return type `GuardedPineconeIndex` not exported — asserted via
 *     `ReturnType<>` + arity / misuse checks).
 *   - Option / DTO interfaces (`vector` is the only required field on
 *     `VectorQueryOptions`; `matches` on `GuardedQueryResult`).
 *   - Re-exported core error classes (4).
 *
 * Also locks REAL-CLIENT CONFORMANCE: as a vector-query wrapper, the keys the
 * guarded `query` forwards (the native-option allow-list
 * `PINECONE_NATIVE_QUERY_KEYS` plus the explicitly-set `topK` / `filter`) must
 * equal the set of real `@pinecone-database/pinecone` `QueryByVectorValues` BODY
 * keys (a devDependency whose range mirrors the peer range, so it resolves to the
 * newest in-range SDK). `namespace` is the index handle (NOT a body field);
 * record-id query mode (`id`) is intentionally unsupported. This is a KEY-SET lock
 * (not a value-type one): if the query schema drifts — a body field
 * renamed/removed, or a NEW one added the connector would silently drop — this
 * file fails to compile. Tracking the newest in-range SDK means a future in-range
 * minor that adds a body field trips this lock by design, prompting a conscious
 * allow-list review. Compile-time tripwire for the stale/hallucinated-client-API
 * defect class.
 *
 * NOTE: the barrel does NOT re-export `DEFAULT_VALIDATION_TIMEOUT` /
 * `DEFAULT_MAX_TOP_K` (they live in `types.ts` but are not on the public
 * surface) — so they are deliberately not imported / asserted here.
 *
 * Run via `pnpm --filter @blackunicorn/bonklm-pinecone test:types` (tsd).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedIndex,
  ConnectorValidationError,
  StreamValidationError,
  ConnectorConfigurationError,
  ConnectorTimeoutError,
  type GuardedPineconeOptions,
  type GuardedQueryResult,
  type VectorQueryOptions
} from '@blackunicorn/bonklm-pinecone';
import type { QueryByVectorValues, QueryByRecordId } from '@pinecone-database/pinecone';

// --- Factory: createGuardedIndex(index: any, options?) ---
declare const index: unknown;
expectType<ReturnType<typeof createGuardedIndex>>(createGuardedIndex(index));
expectType<ReturnType<typeof createGuardedIndex>>(createGuardedIndex(index, {}));
expectError(createGuardedIndex()); // index required
expectError(createGuardedIndex(index, { validators: 'nope' })); // wrong option type
expectError(createGuardedIndex(index, { notAnOption: true })); // excess property

// --- GuardedPineconeOptions (every field optional) ---
expectAssignable<GuardedPineconeOptions>({});
expectAssignable<GuardedPineconeOptions>({
  validateRetrievedVectors: true,
  onBlockedVector: 'filter',
  productionMode: false,
  validationTimeout: 1000,
  maxTopK: 50,
  sanitizeMetadataFilters: true,
  onQueryBlocked: _result => {},
  onVectorBlocked: (_id, _result) => {}
});
expectNotAssignable<GuardedPineconeOptions>({ onBlockedVector: 'nuke' }); // not in union
expectNotAssignable<GuardedPineconeOptions>({ maxTopK: '50' }); // number field
expectNotAssignable<GuardedPineconeOptions>({ validateRetrievedVectors: 1 }); // boolean field

// --- VectorQueryOptions: `vector` required ---
expectAssignable<VectorQueryOptions>({ vector: [0.1, 0.2] });
expectAssignable<VectorQueryOptions>({
  vector: [0.1],
  topK: 5,
  namespace: 'ns',
  includeValues: true,
  includeMetadata: false
});
expectNotAssignable<VectorQueryOptions>({}); // vector required
expectNotAssignable<VectorQueryOptions>({ topK: 5 }); // vector required
expectNotAssignable<VectorQueryOptions>({ vector: 'nope' }); // number[] field

// --- GuardedQueryResult: `matches` required ---
expectAssignable<GuardedQueryResult>({ matches: [] });
expectAssignable<GuardedQueryResult>({
  matches: [{ id: 'a' }],
  vectorsBlocked: 1,
  filtered: true
});
expectNotAssignable<GuardedQueryResult>({}); // matches required
expectNotAssignable<GuardedQueryResult>({ matches: 'nope' }); // any[] field
expectNotAssignable<GuardedQueryResult>({ vectorsBlocked: 1 }); // matches required

// --- Error classes (re-exported from core connector-utils) ---
const cve = new ConnectorValidationError('msg');
expectType<ConnectorValidationError>(cve);
expectType<string>(cve.category);
expectType<number | undefined>(cve.statusCode);
expectError(new ConnectorValidationError()); // message required

const sve = new StreamValidationError('msg');
expectType<StreamValidationError>(sve);
expectType<string>(sve.reason);
expectType<boolean>(sve.blocked);

const cce = new ConnectorConfigurationError('msg');
expectType<ConnectorConfigurationError>(cce);
expectType<string | undefined>(cce.field);

const cte = new ConnectorTimeoutError('msg', 5000);
expectType<ConnectorTimeoutError>(cte);
expectType<number>(cte.timeout);
expectError(new ConnectorTimeoutError('m')); // timeout required

// --- REAL-CLIENT CONFORMANCE (@pinecone-database/pinecone ^2) ---
// `query` forwards a body to `index.query(body)` (or
// `index.namespace(ns).query(body)`) assembled from the native-option allow-list
// (`PINECONE_NATIVE_QUERY_KEYS`) plus the explicitly-set `topK` / `filter`. As a
// VECTOR-query wrapper its forwarded key set must equal the real
// `QueryByVectorValues` BODY surface. `namespace` is the index handle (targeted
// via `index.namespace()`), NOT a body field; record-id query mode (`id`) is
// intentionally unsupported.
type RealVectorQueryKey = keyof QueryByVectorValues;
type ForwardedQueryKey =
  // allow-listed caller passthrough (PINECONE_NATIVE_QUERY_KEYS):
  | 'vector'
  | 'includeValues'
  | 'includeMetadata'
  // set explicitly by query():
  | 'topK'
  | 'filter';

declare const realVectorQueryKey: RealVectorQueryKey;
declare const forwardedQueryKey: ForwardedQueryKey;
// Every real vector-query body field is forwarded — a NEW shared/vector field the
// connector would silently drop fails here:
expectAssignable<ForwardedQueryKey>(realVectorQueryKey);
// Every forwarded key is a real vector-query body field — a renamed/removed SDK
// field fails here:
expectAssignable<RealVectorQueryKey>(forwardedQueryKey);

// `namespace` is the index handle, not a query-body field — assert it never
// appears on the body surface so the "route via index.namespace()" contract
// cannot silently regress to a forwarded body key.
expectNotAssignable<RealVectorQueryKey>('namespace');
// Record-id query mode (`id`) exists on the real union but is intentionally
// unsupported (the connector requires `vector`):
expectAssignable<keyof QueryByRecordId>('id');
expectNotAssignable<ForwardedQueryKey>('id');

// A minimal vector query body conforms to the real type (locks `vector` + the
// required `topK` with compatible value types).
expectAssignable<QueryByVectorValues>({ topK: 10, vector: [0.1] });
