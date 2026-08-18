/**
 * Type-surface tests for `@blackunicorn/bonkdrant`.
 *
 * Locks the public type contract exported from the package barrel:
 *   - `createGuardedClient(client, options?)` factory (first arg duck-typed
 *     `any`; return type `GuardedQdrantClient` not exported — asserted via
 *     `ReturnType<>` + arity / misuse checks).
 *   - Option / DTO interfaces + the `BlockedPointHandling` union. Note
 *     `QdrantSearchOptions` carries an index signature (`[key: string]: any`),
 *     so only missing-required-field rejection is meaningful there.
 *   - Literal numeric constants (only the 2 re-exported on the barrel;
 *     `DEFAULT_MAX_FILTER_LENGTH` / `_PAYLOAD_SIZE` / `_REGEX_TIMEOUT` are
 *     NOT on the public surface and are not asserted).
 *
 * Also locks REAL-CLIENT CONFORMANCE: the native-option allow-list
 * (`QDRANT_NATIVE_SEARCH_KEYS`) and the snake_case keys the guarded `search`
 * forwards explicitly must TOGETHER equal the set of real `Schemas['SearchRequest']`
 * BODY keys of the installed `@qdrant/js-client-rest` (a devDependency whose range
 * mirrors the peer range, so it resolves to the newest in-range SDK). This is a
 * KEY-SET lock (not a value-type one): if the schema drifts — a body field
 * renamed/removed, or a NEW one added the connector would silently drop — this
 * file fails to compile. Tracking the newest in-range SDK means a future in-range
 * minor that adds a body field trips this lock by design, prompting a conscious
 * allow-list review. Compile-time tripwire for the stale/hallucinated-client-API
 * defect class.
 *
 * ESM package. Its tsconfig is NOT `composite` (it inherits NodeNext from
 * the root tsconfig), so no `package.json` `"tsd"` override is required.
 *
 * Run via `pnpm --filter @blackunicorn/bonkdrant test:types` (tsd).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedClient,
  DEFAULT_VALIDATION_TIMEOUT,
  DEFAULT_MAX_LIMIT,
  type GuardedQdrantOptions,
  type GuardedQdrantResult,
  type QdrantSearchOptions,
  type QdrantPoint,
  type BlockedPointHandling
} from '@blackunicorn/bonkdrant';
import type { Schemas } from '@qdrant/js-client-rest';
// The native-option allow-list is an internal (non-barrel) export, imported via a
// relative source path so the conformance union below is derived from the SAME
// runtime value the guarded `search` screens passthrough against — not a
// hand-maintained copy that could silently diverge from it (security regression).
import { QDRANT_NATIVE_SEARCH_KEYS } from '../src/guarded-qdrant.js';

// --- Factory: createGuardedClient(client: any, options?) ---
declare const qdrantClient: unknown;
expectType<ReturnType<typeof createGuardedClient>>(createGuardedClient(qdrantClient));
expectType<ReturnType<typeof createGuardedClient>>(createGuardedClient(qdrantClient, {}));
expectError(createGuardedClient()); // client required
expectError(createGuardedClient(qdrantClient, { validators: 'nope' })); // wrong option type
expectError(createGuardedClient(qdrantClient, { notAnOption: true })); // excess property

// --- GuardedQdrantOptions (every field optional) ---
expectAssignable<GuardedQdrantOptions>({});
expectAssignable<GuardedQdrantOptions>({
  validateRetrievedPoints: true,
  onBlockedPoint: 'abort',
  productionMode: false,
  validationTimeout: 1000,
  maxLimit: 25,
  validateFilters: true,
  allowedPayloadFields: ['a'],
  maxFilterLength: 5000,
  maxPayloadSize: 1024,
  regexTimeout: 1000,
  onQueryBlocked: _result => {},
  onPointBlocked: (_id, _result) => {}
});
expectNotAssignable<GuardedQdrantOptions>({ onBlockedPoint: 'nuke' }); // not in union
expectNotAssignable<GuardedQdrantOptions>({ maxLimit: '25' }); // number field
expectNotAssignable<GuardedQdrantOptions>({ validateFilters: 1 }); // boolean field

// --- BlockedPointHandling union ---
expectAssignable<BlockedPointHandling>('filter');
expectAssignable<BlockedPointHandling>('abort');
expectNotAssignable<BlockedPointHandling>('drop');

// --- QdrantSearchOptions: `collectionName` + `vector` required ---
// (has an `[key: string]: any` index signature → arbitrary extra keys are
// allowed; only missing-required-field rejection is asserted.)
expectAssignable<QdrantSearchOptions>({ collectionName: 'c', vector: [0.1] });
expectAssignable<QdrantSearchOptions>({
  collectionName: 'c',
  vector: [0.1],
  limit: 5,
  withPayload: ['field'],
  extraPassthrough: 'allowed-by-index-signature'
});
expectNotAssignable<QdrantSearchOptions>({ collectionName: 'c' }); // vector required
expectNotAssignable<QdrantSearchOptions>({ vector: [0.1] }); // collectionName required
expectNotAssignable<QdrantSearchOptions>({}); // both required

// --- QdrantPoint: `id` + `score` required ---
expectAssignable<QdrantPoint>({ id: 'a', score: 0.9 });
expectAssignable<QdrantPoint>({ id: 42, score: 0.9, payload: { k: 1 }, vector: [0.1] });
expectNotAssignable<QdrantPoint>({ id: 'a' }); // score required
expectNotAssignable<QdrantPoint>({ score: 0.9 }); // id required
expectNotAssignable<QdrantPoint>({ id: true, score: 1 }); // id must be string | number
expectNotAssignable<QdrantPoint>({ id: 'a', score: 'hi' }); // score must be number

// --- GuardedQdrantResult: `points` required ---
expectAssignable<GuardedQdrantResult>({ points: [] });
expectAssignable<GuardedQdrantResult>({
  points: [{ id: 1, score: 0.5 }],
  pointsBlocked: 1,
  filtered: true
});
expectNotAssignable<GuardedQdrantResult>({}); // points required
expectNotAssignable<GuardedQdrantResult>({ points: 'nope' }); // QdrantPoint[] field

// --- Constants (literals) ---
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);
expectType<50>(DEFAULT_MAX_LIMIT);

// --- REAL-CLIENT CONFORMANCE (@qdrant/js-client-rest ^1) ---
// The guarded `search` forwards a body to `client.search(collectionName, body)`
// assembled from two key sets that must TOGETHER equal the real `SearchRequest`
// BODY surface:
//   • allow-listed caller passthrough — `QDRANT_NATIVE_SEARCH_KEYS`
//   • keys `search` sets itself, translating camelCase options to the client's
//     snake_case body fields
// `consistency` / `timeout` are client METHOD query-params (NOT body fields), so
// they are deliberately absent from both sets and from `Schemas['SearchRequest']`.
type RealSearchBodyKey = keyof Schemas['SearchRequest'];
type AccountedSearchBodyKey =
  // allow-listed caller passthrough — derived from the runtime allow-list tuple
  // (QDRANT_NATIVE_SEARCH_KEYS) so a key removed from the Set the guarded `search`
  // screens against shrinks this union and trips the conformance assertions below,
  // instead of the type lock silently diverging from a hand-copied key list (security regression):
  | (typeof QDRANT_NATIVE_SEARCH_KEYS)[number]
  // set explicitly by search() (camelCase option → snake_case body field):
  | 'vector'
  | 'limit'
  | 'filter'
  | 'score_threshold'
  | 'with_payload'
  | 'with_vector';

declare const realSearchBodyKey: RealSearchBodyKey;
declare const accountedSearchBodyKey: AccountedSearchBodyKey;
// Every real body field is accounted for — a NEW in-range SDK field fails here
// (otherwise the allow-list would silently drop it):
expectAssignable<AccountedSearchBodyKey>(realSearchBodyKey);
// Every accounted key is a real body field — a renamed/removed SDK field fails here:
expectAssignable<RealSearchBodyKey>(accountedSearchBodyKey);

// The always-set required fields conform to the real request shape (locks
// `vector` + `limit` as required, with compatible value types).
expectAssignable<Schemas['SearchRequest']>({ vector: [0.1], limit: 10 });
