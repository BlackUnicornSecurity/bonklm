---
'@blackunicorn/bonklm-weaviate': patch
---

weaviate: execute queries through the real `weaviate-client ^3` API. The connector previously called
a fabricated query-builder chain the client does not expose, so it could not run against a live
Weaviate instance; it was marked EXPERIMENTAL for that reason.

`query()` now dispatches to `collection.query.nearText` / `bm25` / `hybrid` and falls back to
`fetchObjects` when no search mode is given, with `fields` forwarded as `returnProperties`. The
output contract is the real client shape — `{ objects, objectsBlocked, filtered, raw }`, each object
`{ uuid, properties, metadata, ... }` — replacing the fabricated `data.Get[className]` envelope.
`where` takes a builder-produced v3 `FilterValue` and is validated structurally (operator allowlist,
node/target key allowlists with own-property reads, per-operator value typing, depth and node-count
caps) instead of the old JSON-stringify pattern scan; when `allowedFields` is configured, filter
targets must satisfy the allowlist and cross-reference targets are rejected. `className` is now
validated structurally even without an allowlist, `limit` is clamped to `[1, maxLimit]`, at most one
search mode may be specified, and blank (whitespace-only) query inputs are rejected rather than
silently skipping content validation. Filter operand values are DoS-bounded (string operands ≤ 10000
chars, Contains arrays ≤ 1000 elements). `createGuardedClient` now takes a typed
`WeaviateClientLike` instead of `any`; conformance of the connector's structural client types
against the installed `weaviate-client` typings is locked at compile time by the package's type
tests, and the peer dependency floor is raised to `weaviate-client ^3.11.0` — the version that
conformance is verified against. The EXPERIMENTAL / preview-API marking is removed across the
package and docs.
