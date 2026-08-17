/**
 * Type-surface tests for `@blackunicorn/bonkviate`.
 *
 * Locks two contracts:
 *
 * 1. The public type surface exported from the package barrel —
 *    `createGuardedClient(client, options?)`, the option / DTO interfaces,
 *    the `BlockedObjectHandling` union, and the literal numeric constants.
 *
 * 2. REAL-CLIENT CONFORMANCE — the structural `Weaviate*` mirror types the
 *    connector executes against are assignability-checked against the
 *    INSTALLED `weaviate-client` typings (devDependency, same major as the
 *    peer range). If the client API drifts, or a mirror describes a surface
 *    the real client does not expose, this file fails to compile. This is
 *    the compile-time tripwire for the hallucinated-client-API defect class.
 *
 * Run via `pnpm --filter @blackunicorn/bonkviate test:types` (tsd).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type {
  BaseBm25Options,
  BaseHybridOptions,
  BaseNearTextOptions,
  Collection,
  FetchObjectsOptions,
  FilterValue,
  WeaviateClient,
  WeaviateNonGenericObject,
  WeaviateReturn
} from 'weaviate-client';
import {
  createGuardedClient,
  DEFAULT_VALIDATION_TIMEOUT,
  DEFAULT_MAX_LIMIT,
  DEFAULT_QUERY_LIMIT,
  type GuardedWeaviateClient,
  type GuardedWeaviateOptions,
  type GuardedWeaviateResult,
  type WeaviateQueryOptions,
  type BlockedObjectHandling,
  type WeaviateClientLike,
  type WeaviateCollectionLike,
  type WeaviateQueryNamespaceLike,
  type WeaviateFilterValue,
  type WeaviateFilterOperator,
  type WeaviateFilterTarget,
  type WeaviateQueryResult,
  type WeaviateRetrievedObject,
  type WeaviateSearchOptions
} from '@blackunicorn/bonkviate';

// --- REAL-CLIENT CONFORMANCE (weaviate-client ^3, verified at compile time) ---
declare const realClient: WeaviateClient;
declare const realCollection: Collection;
declare const realFilter: FilterValue;
declare const realReturn: WeaviateReturn<undefined, undefined>;
declare const realObject: WeaviateNonGenericObject;

// The full real client satisfies the structural surface the connector consumes.
expectAssignable<WeaviateClientLike>(realClient);
// A real collection handle satisfies the collection mirror, and its `query`
// PROPERTY exposes the four methods the connector dispatches to.
expectAssignable<WeaviateCollectionLike>(realCollection);
expectAssignable<WeaviateQueryNamespaceLike>(realCollection.query);
// Builder-produced FilterValue trees are accepted as `where`.
expectAssignable<WeaviateFilterValue>(realFilter);
// Real return / object shapes satisfy the extraction contract.
expectAssignable<WeaviateQueryResult>(realReturn);
expectAssignable<WeaviateRetrievedObject>(realObject);
// And the factory accepts a real client directly.
expectType<GuardedWeaviateClient>(createGuardedClient(realClient));

// MIRROR → REAL direction: what the connector forwards must be accepted by
// the real client's option types (catches a client-side option rename even
// though the runtime forwards plain objects). The connector sends
// `{ limit, returnProperties?, filters? }` to nearText/bm25/fetchObjects and
// additionally `alpha` to hybrid; `filters` carries the caller's mirror-typed
// tree.
declare const mirrorFilter: WeaviateFilterValue;
expectAssignable<FilterValue>(mirrorFilter);
declare const forwardedOptions: {
  limit: number;
  returnProperties?: string[];
  filters?: FilterValue;
};
expectAssignable<BaseNearTextOptions<undefined, undefined, undefined>>(forwardedOptions);
expectAssignable<BaseBm25Options<undefined, undefined>>(forwardedOptions);
expectAssignable<FetchObjectsOptions<undefined, undefined>>(forwardedOptions);
declare const forwardedHybridOptions: {
  limit: number;
  returnProperties?: string[];
  filters?: FilterValue;
  alpha?: number;
};
expectAssignable<BaseHybridOptions<undefined, undefined, undefined>>(forwardedHybridOptions);

// --- Factory: createGuardedClient(client: WeaviateClientLike, options?) ---
declare const unknownClient: unknown;
declare const likeClient: WeaviateClientLike;
expectType<GuardedWeaviateClient>(createGuardedClient(likeClient));
expectType<GuardedWeaviateClient>(createGuardedClient(likeClient, {}));
expectError(createGuardedClient()); // client required
expectError(createGuardedClient(unknownClient)); // unknown no longer accepted — must be client-shaped
expectError(createGuardedClient(likeClient, { validators: 'nope' })); // wrong option type
expectError(createGuardedClient(likeClient, { notAnOption: true })); // excess property

// --- GuardedWeaviateOptions (every field optional) ---
expectAssignable<GuardedWeaviateOptions>({});
expectAssignable<GuardedWeaviateOptions>({
  validateRetrievedObjects: true,
  onBlockedObject: 'filter',
  productionMode: false,
  validationTimeout: 1000,
  maxLimit: 25,
  allowedClasses: ['Document'],
  allowedFields: ['text'],
  validateFilters: true,
  onQueryBlocked: _result => {},
  onObjectBlocked: (_object, _result) => {},
  onClassNotAllowed: _className => {}
});
expectNotAssignable<GuardedWeaviateOptions>({ onBlockedObject: 'nuke' }); // not in union
expectNotAssignable<GuardedWeaviateOptions>({ maxLimit: '25' }); // number field
expectNotAssignable<GuardedWeaviateOptions>({ validateRetrievedObjects: 1 }); // boolean field

// onObjectBlocked receives the typed retrieved object.
expectAssignable<GuardedWeaviateOptions>({
  onObjectBlocked: (object: WeaviateRetrievedObject, _result) => {
    expectType<string>(object.uuid);
    expectType<Record<string, unknown>>(object.properties);
  }
});

// --- BlockedObjectHandling union ---
expectAssignable<BlockedObjectHandling>('filter');
expectAssignable<BlockedObjectHandling>('abort');
expectNotAssignable<BlockedObjectHandling>('drop');

// --- WeaviateQueryOptions: `className` required, strict keys ---
expectAssignable<WeaviateQueryOptions>({ className: 'Document' });
expectAssignable<WeaviateQueryOptions>({
  className: 'Document',
  fields: ['text'],
  limit: 5,
  nearText: { concepts: ['ai'] }
});
expectAssignable<WeaviateQueryOptions>({ className: 'Document', bm25: { query: 'q' } });
expectAssignable<WeaviateQueryOptions>({ className: 'Document', hybrid: { query: 'q', alpha: 0.5 } });
expectAssignable<WeaviateQueryOptions>({ className: 'Document', where: realFilter }); // real builder output accepted
expectNotAssignable<WeaviateQueryOptions>({}); // className required
expectNotAssignable<WeaviateQueryOptions>({ fields: ['text'] }); // className required
expectNotAssignable<WeaviateQueryOptions>({
  className: 'Document',
  extraPassthrough: 'no-longer-allowed' // index signature removed — options are strict
});
expectNotAssignable<WeaviateQueryOptions>({ className: 'Document', where: 'raw-string' }); // where must be a FilterValue

// --- WeaviateFilterValue / WeaviateFilterTarget structural shape ---
expectAssignable<WeaviateFilterValue>({ operator: 'Equal', target: { property: 'title' }, value: 'x' });
expectAssignable<WeaviateFilterValue>({
  operator: 'And',
  filters: [{ operator: 'Equal', target: { property: 'title' }, value: 'x' }],
  value: null
});
expectNotAssignable<WeaviateFilterValue>({ target: { property: 'title' }, value: 'x' }); // operator required
expectAssignable<WeaviateFilterTarget>({ property: 'title' });
expectAssignable<WeaviateFilterTarget>({});

// --- WeaviateFilterOperator union: every real operator member, nothing else ---
expectAssignable<WeaviateFilterOperator>('Equal');
expectAssignable<WeaviateFilterOperator>('NotEqual');
expectAssignable<WeaviateFilterOperator>('GreaterThan');
expectAssignable<WeaviateFilterOperator>('GreaterThanEqual');
expectAssignable<WeaviateFilterOperator>('LessThan');
expectAssignable<WeaviateFilterOperator>('LessThanEqual');
expectAssignable<WeaviateFilterOperator>('Like');
expectAssignable<WeaviateFilterOperator>('IsNull');
expectAssignable<WeaviateFilterOperator>('WithinGeoRange');
expectAssignable<WeaviateFilterOperator>('ContainsAny');
expectAssignable<WeaviateFilterOperator>('ContainsAll');
expectAssignable<WeaviateFilterOperator>('ContainsNone');
expectAssignable<WeaviateFilterOperator>('And');
expectAssignable<WeaviateFilterOperator>('Or');
expectAssignable<WeaviateFilterOperator>('Not');
expectNotAssignable<WeaviateFilterOperator>('Eval'); // not a real operator
expectNotAssignable<WeaviateFilterOperator>('equal'); // wrong case

// --- WeaviateSearchOptions (forwarded to the client) ---
expectAssignable<WeaviateSearchOptions>({});
expectAssignable<WeaviateSearchOptions>({ limit: 5, returnProperties: ['a'], alpha: 0.3 });
expectNotAssignable<WeaviateSearchOptions>({ returnProperties: 'a b' }); // array, not space-joined string

// --- GuardedWeaviateResult: all fields REQUIRED, real-shape objects ---
declare const retrievedObjects: WeaviateRetrievedObject[];
expectAssignable<GuardedWeaviateResult>({
  objects: retrievedObjects,
  objectsBlocked: 1,
  filtered: true,
  raw: { objects: retrievedObjects }
});
expectNotAssignable<GuardedWeaviateResult>({}); // no longer all-optional
expectNotAssignable<GuardedWeaviateResult>({
  objects: retrievedObjects,
  objectsBlocked: '1', // number field
  filtered: true,
  raw: { objects: retrievedObjects }
});
expectNotAssignable<GuardedWeaviateResult>({
  data: { Get: { Document: [] } }, // legacy GraphQL envelope removed
  objectsBlocked: 0,
  filtered: false
});

// The result type carries the real-client return as `raw`.
declare const guardedResult: GuardedWeaviateResult;
expectType<WeaviateQueryResult>(guardedResult.raw);
expectType<WeaviateRetrievedObject[]>(guardedResult.objects);
expectAssignable<GuardedWeaviateResult['raw']>(realReturn);

// --- Constants (literals) ---
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);
expectType<50>(DEFAULT_MAX_LIMIT);
expectType<10>(DEFAULT_QUERY_LIMIT);
