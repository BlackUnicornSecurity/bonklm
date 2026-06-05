/**
 * Type-surface tests for `@blackunicorn/bonklm-qdrant`.
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
 * ESM package, but NOT `composite` — inherits NodeNext from the root
 * tsconfig, so no `package.json` `"tsd"` override is required.
 *
 * Run via `pnpm --filter @blackunicorn/bonklm-qdrant test:types` (tsd).
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
} from '@blackunicorn/bonklm-qdrant';

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
