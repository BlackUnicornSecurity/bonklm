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
 * NOTE: the barrel does NOT re-export `DEFAULT_VALIDATION_TIMEOUT` /
 * `DEFAULT_MAX_TOP_K` (they live in `types.ts` but are not on the public
 * surface) — so they are deliberately not imported / asserted here.
 *
 * CommonJS package — see `package.json` `"tsd"` override (`composite: false`).
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
