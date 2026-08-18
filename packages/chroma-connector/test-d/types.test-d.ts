/**
 * Type-surface tests for `@blackunicorn/bonklm-chroma`.
 *
 * Locks the public type contract exported from the package barrel:
 *   - `createGuardedCollection(collection, options?)` factory (first arg
 *     duck-typed `any`; return type `GuardedChromaCollection` not exported
 *     — asserted via `ReturnType<>` + arity / misuse checks).
 *   - Option / DTO interfaces + the `BlockedDocumentHandling` union.
 *   - Literal numeric constants.
 *
 * Run via `pnpm --filter @blackunicorn/bonklm-chroma test:types` (tsd).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedCollection,
  DEFAULT_VALIDATION_TIMEOUT,
  DEFAULT_MAX_N_RESULTS,
  type GuardedChromaOptions,
  type GuardedChromaQueryResult,
  type ChromaQueryOptions,
  type BlockedDocumentHandling
} from '@blackunicorn/bonklm-chroma';

// --- Factory: createGuardedCollection(collection: any, options?) ---
declare const collection: unknown;
expectType<ReturnType<typeof createGuardedCollection>>(createGuardedCollection(collection));
expectType<ReturnType<typeof createGuardedCollection>>(createGuardedCollection(collection, {}));
expectError(createGuardedCollection()); // collection required
expectError(createGuardedCollection(collection, { validators: 'nope' })); // wrong option type
expectError(createGuardedCollection(collection, { notAnOption: true })); // excess property

// --- GuardedChromaOptions (every field optional) ---
expectAssignable<GuardedChromaOptions>({});
expectAssignable<GuardedChromaOptions>({
  validateRetrievedDocs: true,
  onBlockedDocument: 'filter',
  productionMode: false,
  validationTimeout: 1000,
  maxNResults: 10,
  sanitizeFilters: true,
  onQueryBlocked: _result => {},
  onDocumentBlocked: (_document, _result) => {}
});
expectNotAssignable<GuardedChromaOptions>({ onBlockedDocument: 'nuke' }); // not in union
expectNotAssignable<GuardedChromaOptions>({ maxNResults: '10' }); // number field
expectNotAssignable<GuardedChromaOptions>({ validateRetrievedDocs: 1 }); // boolean field

// --- BlockedDocumentHandling union ---
expectAssignable<BlockedDocumentHandling>('filter');
expectAssignable<BlockedDocumentHandling>('abort');
expectNotAssignable<BlockedDocumentHandling>('drop');
expectNotAssignable<BlockedDocumentHandling>('');

// --- ChromaQueryOptions (every field optional) ---
expectAssignable<ChromaQueryOptions>({});
expectAssignable<ChromaQueryOptions>({
  queryTexts: ['q'],
  queryEmbeddings: [[0.1]],
  nResults: 5,
  where: { tag: 'a' },
  include: ['documents', 'distances']
});
expectNotAssignable<ChromaQueryOptions>({ nResults: '5' }); // number field
expectNotAssignable<ChromaQueryOptions>({ queryTexts: 'q' }); // string[] field
expectNotAssignable<ChromaQueryOptions>({ include: ['bogus'] }); // include union member

// --- GuardedChromaQueryResult (every field optional) ---
expectAssignable<GuardedChromaQueryResult>({});
expectAssignable<GuardedChromaQueryResult>({
  documents: [['d']],
  ids: [['i']],
  documentsBlocked: 1,
  filtered: true
});
expectNotAssignable<GuardedChromaQueryResult>({ documentsBlocked: '1' }); // number field
expectNotAssignable<GuardedChromaQueryResult>({ filtered: 'yes' }); // boolean field

// --- Constants (literals) ---
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);
expectType<20>(DEFAULT_MAX_N_RESULTS);
