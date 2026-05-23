/**
 * @blackunicorn/bonklm-turbopuffer
 * ================================
 * Turbopuffer Namespace wrapper that runs `MemoryWriteValidator` on
 * writes (`write({ upsert_rows | patch_rows })`) and
 * `RetrievedDocValidator` on retrieval (`query()` response rows).
 *
 * **Edge-compatible.** Turbopuffer is a pure HTTP client; the
 * connector uses no Node-only globals. Runs on Workerd, Deno, Bun,
 * and Vercel Edge.
 *
 * ⚠️  **`turbopuffer` (npm) vs `@turbopuffer/turbopuffer`**: the bare
 * `turbopuffer@1.0.1` package on npm is a placeholder NOT published by
 * Turbopuffer Inc. The OFFICIAL SDK is `@turbopuffer/turbopuffer ^2.x`,
 * which is what this connector peer-depends on. Do NOT install
 * `turbopuffer` (no scope); it does not contain the SDK.
 *
 * Public surface:
 *   - `createGuardedNamespace(namespace, opts)` — factory returning a
 *     Proxy-wrapped Namespace with validation injected on the 3 ACced
 *     methods (write / query / deleteAll). All other Namespace
 *     methods pass through.
 *
 * Types:
 *   - `GuardedNamespace`
 *   - `GuardedNamespaceOptions`
 *   - `GuardedNamespaceWriteParams`
 *   - `GuardedNamespaceQueryResponse`
 *   - `GuardedTurbopufferRow`
 */
export { createGuardedNamespace } from './guarded-namespace.js';
export type {
  GuardedNamespace,
  GuardedNamespaceOptions,
  GuardedNamespaceQueryResponse,
  GuardedNamespaceWriteParams,
  GuardedTurbopufferRow,
} from './types.js';
