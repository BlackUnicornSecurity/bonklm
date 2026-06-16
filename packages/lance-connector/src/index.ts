// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonklm-lance
 * ==========================
 * LanceDB Table wrapper that runs `MemoryWriteValidator` on writes
 * (`add`, `update`, `mergeInsert(...).execute`) and `RetrievedDocValidator`
 * on retrieval (`.toArray()` of `search()` + `query()`).
 *
 * **Node-only.** LanceDB ships native bindings; the connector inherits
 * that constraint. For edge / Workerd / Vercel Edge consumers, use
 * `@blackunicorn/bonklm-turbopuffer` (Story 2.11).
 *
 * Public surface:
 *   - `createGuardedLanceTable(table, opts)` — factory returning a
 *     Proxy-wrapped Table with validation injected on the 6 ACced
 *     methods. All other Table methods pass through.
 *
 * Types:
 *   - `GuardedLanceTable`
 *   - `GuardedLanceTableOptions`
 *   - `GuardedLanceRecord`
 *   - `GuardedQueryHandle`
 *   - `GuardedMergeInsertBuilder`
 */
export { createGuardedLanceTable } from './guarded-lance.js';
export type {
  GuardedLanceRecord,
  GuardedLanceTable,
  GuardedLanceTableOptions,
  GuardedMergeInsertBuilder,
  GuardedQueryHandle
} from './types.js';
