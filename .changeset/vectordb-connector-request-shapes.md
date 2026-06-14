---
'@blackunicorn/bonklm': patch
'@blackunicorn/bonklm-qdrant': patch
'@blackunicorn/bonklm-pinecone': patch
---

qdrant/pinecone: fix the vector-DB connector request shapes so guarded operations reach the real
client correctly.

- **qdrant `upsert`** now sends the points wrapped in a `{ points }` object (a `PointsList`), as
  `@qdrant/js-client-rest` requires — previously it passed a bare array, producing a schema-invalid
  request body with no `points`/`batch` key.
- **qdrant `search`** now translates its camelCase options to the client's snake_case
  `SearchRequest` fields (`scoreThreshold` → `score_threshold`, `withPayload` → `with_payload`,
  `withVector` → `with_vector`), which were silently ignored before. The positional collection name
  no longer leaks into the request body, and unrecognized options are still forwarded verbatim.
- **pinecone `query`** now targets a namespace via `index.namespace(ns).query(...)` when `namespace`
  is set — previously `namespace` was placed inside the query body, which the SDK ignores, so
  queries silently ran against the default namespace. The dead `result.vectors` response fallback
  was removed.
- A shared `normalizeLimit` helper (exported from `@blackunicorn/bonklm/core/connector-utils`) now
  clamps result limits to `[1, max]` — flooring fractional values and defaulting non-finite ones —
  across the qdrant and pinecone connectors, so a zero, negative, or over-large limit can no longer
  reach the client. Pinecone previously rejected an out-of-range `topK` with an error; it now clamps
  consistently with the qdrant and weaviate connectors.
