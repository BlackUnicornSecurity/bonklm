/**
 * tsd type-surface suite — @blackunicorn/bonklm-llamaindex (ST-04-208).
 *
 * Locks the published public type surface (imports by package name so it
 * resolves the package `types` entry exactly as a consumer would):
 *   - `createGuardedQueryEngine(queryEngine, options?)` and
 *     `createGuardedRetriever(retriever, options?)` factories (first arg
 *     duck-typed `any`; their `GuardedQueryEngine` / `GuardedRetriever`
 *     return types are NOT re-exported through the barrel — asserted via
 *     `ReturnType<>` + arity / misuse checks),
 *   - the `GuardedLlamaIndexOptions` option bag + the `'filter'|'abort'|
 *     'replace'` blocked-document union it carries,
 *   - the `GuardedQueryResult` + `DocumentValidationResult` DTOs.
 *
 * ESM package — see `package.json` `"tsd"` override (`composite: false`)
 * required because the package tsconfig is `composite: true` (project refs).
 *
 * Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedQueryEngine,
  createGuardedRetriever,
  type GuardedLlamaIndexOptions,
  type GuardedQueryResult,
  type DocumentValidationResult
} from '@blackunicorn/bonklm-llamaindex';

// --- Factories (first arg `any`; return types not exported → ReturnType) ----
declare const queryEngine: unknown;
declare const retriever: unknown;
expectType<ReturnType<typeof createGuardedQueryEngine>>(createGuardedQueryEngine(queryEngine));
expectType<ReturnType<typeof createGuardedQueryEngine>>(createGuardedQueryEngine(queryEngine, {}));
expectType<ReturnType<typeof createGuardedRetriever>>(createGuardedRetriever(retriever));
expectType<ReturnType<typeof createGuardedRetriever>>(createGuardedRetriever(retriever, {}));
expectError(createGuardedQueryEngine()); // queryEngine required
expectError(createGuardedRetriever()); // retriever required
expectError(createGuardedQueryEngine(queryEngine, { validators: 'nope' })); // wrong option type
expectError(createGuardedRetriever(retriever, { onBlockedDocument: 'nuke' })); // not in union

// `createGuardedRetriever` accepts `Omit<GuardedLlamaIndexOptions, 'onResponseBlocked'>`:
// the response callback is meaningless for a bare retriever and must be rejected.
expectError(createGuardedRetriever(retriever, { onResponseBlocked: () => {} }));

// --- drill the wrapped surfaces so a renamed/dropped method fails ------------
const guardedEngine = createGuardedQueryEngine(queryEngine);
expectType<Promise<GuardedQueryResult>>(guardedEngine.query('q'));
const guardedRetriever = createGuardedRetriever(retriever);
expectType<Promise<any[]>>(guardedRetriever.retrieve('q'));

// --- GuardedLlamaIndexOptions (every field optional) ------------------------
expectAssignable<GuardedLlamaIndexOptions>({});
expectAssignable<GuardedLlamaIndexOptions>({
  validators: [],
  guards: [],
  validateRetrievedDocs: true,
  onBlockedDocument: 'filter',
  productionMode: false,
  validationTimeout: 1000,
  maxRetrievedDocs: 5,
  onQueryBlocked: _result => {},
  onDocumentBlocked: (_document, _result) => {},
  onResponseBlocked: _result => {}
});
expectNotAssignable<GuardedLlamaIndexOptions>({ onBlockedDocument: 'nuke' }); // not in union
expectNotAssignable<GuardedLlamaIndexOptions>({ maxRetrievedDocs: '5' }); // number field
expectNotAssignable<GuardedLlamaIndexOptions>({ validateRetrievedDocs: 1 }); // boolean field

// --- onBlockedDocument union (via the option field) -------------------------
expectAssignable<GuardedLlamaIndexOptions['onBlockedDocument']>('filter');
expectAssignable<GuardedLlamaIndexOptions['onBlockedDocument']>('abort');
expectAssignable<GuardedLlamaIndexOptions['onBlockedDocument']>('replace');
expectNotAssignable<GuardedLlamaIndexOptions['onBlockedDocument']>('drop');

// --- GuardedQueryResult (response required, rest optional) ------------------
expectAssignable<GuardedQueryResult>({ response: 'answer' });
expectAssignable<GuardedQueryResult>({
  response: 'answer',
  sourceNodes: [],
  filtered: true,
  documentsBlocked: 2,
  raw: {}
});
expectNotAssignable<GuardedQueryResult>({}); // response required
expectNotAssignable<GuardedQueryResult>({ response: 123 }); // response is string
expectNotAssignable<GuardedQueryResult>({ response: 'a', documentsBlocked: '1' }); // number field

// --- DocumentValidationResult (content + allowed required) ------------------
expectAssignable<DocumentValidationResult>({ content: 'doc', allowed: true });
expectAssignable<DocumentValidationResult>({ content: 'doc', allowed: false, result: undefined });
expectNotAssignable<DocumentValidationResult>({ content: 'doc' }); // allowed required
expectNotAssignable<DocumentValidationResult>({ allowed: true }); // content required
expectNotAssignable<DocumentValidationResult>({ content: 'doc', allowed: 'yes' }); // boolean field
