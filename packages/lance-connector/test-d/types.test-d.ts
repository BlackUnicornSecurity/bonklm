/**
 * Type-surface tests for `@blackunicorn/bonklm-lance`.
 *
 * Locks the public type contract exported from the package barrel:
 *   - `createGuardedLanceTable(table, options?)` factory — the return type
 *     `GuardedLanceTable` IS exported, so it is asserted exactly.
 *   - The `GuardedLanceTable` method surface (add / update / delete / search /
 *     query / mergeInsert + readonly `raw` + pass-through index signature) and
 *     the chainable handles `GuardedQueryHandle` / `GuardedMergeInsertBuilder`.
 *   - Option interface + the `GuardedLanceRecord` alias.
 *
 * Run via `pnpm --filter @blackunicorn/bonklm-lance test:types` (tsd).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedLanceTable,
  type GuardedLanceRecord,
  type GuardedLanceTable,
  type GuardedLanceTableOptions,
  type GuardedMergeInsertBuilder,
  type GuardedQueryHandle
} from '@blackunicorn/bonklm-lance';

// --- Factory: createGuardedLanceTable(table: object, options?) ---
declare const table: object;
expectType<GuardedLanceTable>(createGuardedLanceTable(table));
expectType<GuardedLanceTable>(createGuardedLanceTable(table, {}));
expectError(createGuardedLanceTable()); // table required
expectError(createGuardedLanceTable('nope')); // string not assignable to `object`
expectError(createGuardedLanceTable(table, { notAnOption: true })); // excess property

// --- GuardedLanceTableOptions (every field optional) ---
expectAssignable<GuardedLanceTableOptions>({});
expectAssignable<GuardedLanceTableOptions>({
  contentField: ['text', 'title'],
  userIdField: 'userId',
  sessionIdField: 'sessionId',
  updateSqlMode: 'block-sql',
  arrowWriteMode: 'reject',
  emptyRedactionMode: 'block',
  productionMode: true,
  maxPredicateLength: 10000,
  maxResultCount: 1000
});
expectNotAssignable<GuardedLanceTableOptions>({ updateSqlMode: 'yolo' }); // not in union
expectNotAssignable<GuardedLanceTableOptions>({ arrowWriteMode: 'nuke' }); // not in union
expectNotAssignable<GuardedLanceTableOptions>({ maxPredicateLength: '10' }); // number field
expectNotAssignable<GuardedLanceTableOptions>({ contentField: 42 }); // string | string[] field

// --- GuardedLanceTable method surface ---
declare const guarded: GuardedLanceTable;
expectType<Promise<unknown>>(guarded.add({ text: 'x' }));
expectType<Promise<unknown>>(guarded.update({ values: { a: 1 } }));
expectType<Promise<unknown>>(guarded.delete('id = 1'));
expectType<GuardedQueryHandle>(guarded.search('query'));
expectType<GuardedQueryHandle>(guarded.query());
expectType<GuardedMergeInsertBuilder>(guarded.mergeInsert('id'));
expectType<GuardedMergeInsertBuilder>(guarded.mergeInsert(['id', 'ns']));
expectType<unknown>(guarded.raw);
expectType<unknown>(guarded.countRows); // pass-through via index signature
expectError(guarded.add()); // data required
expectError(guarded.delete()); // predicate required
expectError(guarded.delete(123)); // predicate must be string
expectError(guarded.query('extra')); // query() takes no arguments
expectError(guarded.mergeInsert()); // `on` required
expectError(guarded.mergeInsert(123)); // `on` must be string | string[]

// --- GuardedQueryHandle ---
declare const qh: GuardedQueryHandle;
expectType<Promise<unknown[]>>(qh.toArray());

// --- GuardedMergeInsertBuilder ---
declare const mib: GuardedMergeInsertBuilder;
expectType<Promise<unknown>>(mib.execute([{ text: 'x' }]));
expectError(mib.execute()); // data required

// --- GuardedLanceRecord (permissive `Record<string, unknown>` alias) ---
expectAssignable<GuardedLanceRecord>({});
expectAssignable<GuardedLanceRecord>({ id: 1, text: 'x', vector: [0.1] });
expectNotAssignable<GuardedLanceRecord>(42); // primitive not assignable to Record
