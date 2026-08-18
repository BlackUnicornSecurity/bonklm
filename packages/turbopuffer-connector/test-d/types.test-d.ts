/**
 * Type-surface tests for `@blackunicorn/bonklm-turbopuffer`.
 *
 * Locks the public type contract exported from the package barrel:
 *   - `createGuardedNamespace(namespace, options?)` factory — the return type
 *     `GuardedNamespace` IS exported, so it is asserted exactly.
 *   - The `GuardedNamespace` method surface (write / query / multiQuery /
 *     deleteAll + readonly `raw` + pass-through index signature).
 *   - Option / DTO interfaces + the `GuardedTurbopufferRow` alias.
 *
 * Run via `pnpm --filter @blackunicorn/bonklm-turbopuffer test:types` (tsd).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedNamespace,
  type GuardedNamespace,
  type GuardedNamespaceOptions,
  type GuardedNamespaceQueryResponse,
  type GuardedNamespaceWriteParams,
  type GuardedTurbopufferRow
} from '@blackunicorn/bonklm-turbopuffer';

// --- Factory: createGuardedNamespace(namespace: object, options?) ---
declare const namespace: object;
expectType<GuardedNamespace>(createGuardedNamespace(namespace));
expectType<GuardedNamespace>(createGuardedNamespace(namespace, {}));
expectError(createGuardedNamespace()); // namespace required
expectError(createGuardedNamespace('nope')); // string not assignable to `object`
expectError(createGuardedNamespace(namespace, { notAnOption: true })); // excess property

// --- GuardedNamespaceOptions (every field optional) ---
expectAssignable<GuardedNamespaceOptions>({});
expectAssignable<GuardedNamespaceOptions>({
  contentField: 'text',
  userIdField: 'userId',
  sessionIdField: 'sessionId',
  columnarWriteMode: 'reject',
  maxResultCount: 1000,
  emptyRedactionMode: 'block',
  productionMode: false
});
expectAssignable<GuardedNamespaceOptions>({ contentField: ['text', 'summary'] }); // string | readonly string[]
expectNotAssignable<GuardedNamespaceOptions>({ columnarWriteMode: 'nuke' }); // not in union
expectNotAssignable<GuardedNamespaceOptions>({ emptyRedactionMode: 'drop' }); // not in union
expectNotAssignable<GuardedNamespaceOptions>({ maxResultCount: '1000' }); // number field
expectNotAssignable<GuardedNamespaceOptions>({ contentField: 42 }); // string | string[] field

// --- GuardedNamespace method surface ---
declare const guarded: GuardedNamespace;
expectType<Promise<unknown>>(guarded.write());
expectType<Promise<unknown>>(guarded.write({ upsert_rows: [{ id: 1 }] }));
expectType<Promise<unknown>>(guarded.write(null));
expectType<Promise<GuardedNamespaceQueryResponse>>(guarded.query());
expectType<Promise<unknown>>(guarded.multiQuery());
expectType<Promise<unknown>>(guarded.deleteAll());
expectType<unknown>(guarded.raw);
expectType<unknown>(guarded.branchFrom); // pass-through via index signature

// --- GuardedNamespaceWriteParams (has pass-through index signature) ---
expectAssignable<GuardedNamespaceWriteParams>({});
expectAssignable<GuardedNamespaceWriteParams>({ upsert_rows: [{ id: 1, text: 'x' }] });
expectAssignable<GuardedNamespaceWriteParams>({ patch_rows: [{ id: 1 }] });
expectAssignable<GuardedNamespaceWriteParams>({ upsert_columns: { id: [1] } });
expectAssignable<GuardedNamespaceWriteParams>({ anyPassthrough: 'ok' }); // index signature
expectNotAssignable<GuardedNamespaceWriteParams>({ upsert_rows: 'nope' }); // must be Row[]

// --- GuardedNamespaceQueryResponse (has pass-through index signature) ---
expectAssignable<GuardedNamespaceQueryResponse>({});
expectAssignable<GuardedNamespaceQueryResponse>({ rows: [{ id: 1 }] });
expectAssignable<GuardedNamespaceQueryResponse>({ anyPassthrough: 1 }); // index signature
expectNotAssignable<GuardedNamespaceQueryResponse>({ rows: 'nope' }); // must be Row[]

// --- GuardedTurbopufferRow (permissive `Record<string, unknown>` alias) ---
expectAssignable<GuardedTurbopufferRow>({});
expectAssignable<GuardedTurbopufferRow>({ id: 1, text: 'x', vector: [0.1] });
expectNotAssignable<GuardedTurbopufferRow>(42); // primitive not assignable to Record
