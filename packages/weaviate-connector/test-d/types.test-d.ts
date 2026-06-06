/**
 * Type-surface tests for `@blackunicorn/bonklm-weaviate`.
 *
 * Locks the public type contract exported from the package barrel:
 *   - `createGuardedClient(client, options?)` factory (first arg duck-typed
 *     `any`; return type `GuardedWeaviateClient` not exported — asserted via
 *     `ReturnType<>` + arity / misuse checks).
 *   - Option / DTO interfaces + the `BlockedObjectHandling` union. Note
 *     `WeaviateQueryOptions` carries an index signature (`[key: string]: any`),
 *     so only missing-required-field rejection is meaningful there.
 *   - Literal numeric constants.
 *
 * Run via `pnpm --filter @blackunicorn/bonklm-weaviate test:types` (tsd).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedClient,
  DEFAULT_VALIDATION_TIMEOUT,
  DEFAULT_MAX_LIMIT,
  type GuardedWeaviateOptions,
  type GuardedWeaviateResult,
  type WeaviateQueryOptions,
  type BlockedObjectHandling
} from '@blackunicorn/bonklm-weaviate';

// --- Factory: createGuardedClient(client: any, options?) ---
declare const weaviateClient: unknown;
expectType<ReturnType<typeof createGuardedClient>>(createGuardedClient(weaviateClient));
expectType<ReturnType<typeof createGuardedClient>>(createGuardedClient(weaviateClient, {}));
expectError(createGuardedClient()); // client required
expectError(createGuardedClient(weaviateClient, { validators: 'nope' })); // wrong option type
expectError(createGuardedClient(weaviateClient, { notAnOption: true })); // excess property

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

// --- BlockedObjectHandling union ---
expectAssignable<BlockedObjectHandling>('filter');
expectAssignable<BlockedObjectHandling>('abort');
expectNotAssignable<BlockedObjectHandling>('drop');

// --- WeaviateQueryOptions: `className` required ---
// (has an `[key: string]: any` index signature → arbitrary extra keys are
// allowed; only missing-required-field rejection is asserted.)
expectAssignable<WeaviateQueryOptions>({ className: 'Document' });
expectAssignable<WeaviateQueryOptions>({
  className: 'Document',
  fields: ['text'],
  limit: 5,
  nearText: { concepts: ['ai'] },
  bm25: { query: 'q' },
  hybrid: { query: 'q', alpha: 0.5 },
  extraPassthrough: 'allowed-by-index-signature'
});
expectNotAssignable<WeaviateQueryOptions>({}); // className required
expectNotAssignable<WeaviateQueryOptions>({ fields: ['text'] }); // className required

// --- GuardedWeaviateResult (every field optional) ---
expectAssignable<GuardedWeaviateResult>({});
expectAssignable<GuardedWeaviateResult>({ data: { x: 1 }, objectsBlocked: 1, filtered: true });
expectNotAssignable<GuardedWeaviateResult>({ objectsBlocked: '1' }); // number field
expectNotAssignable<GuardedWeaviateResult>({ filtered: 'yes' }); // boolean field

// --- Constants (literals) ---
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);
expectType<50>(DEFAULT_MAX_LIMIT);
