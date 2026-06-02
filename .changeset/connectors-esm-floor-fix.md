---
'@blackunicorn/bonklm-chroma': patch
'@blackunicorn/bonklm-huggingface': patch
'@blackunicorn/bonklm-llamaindex': patch
'@blackunicorn/bonklm-pinecone': patch
'@blackunicorn/bonklm-qdrant': patch
'@blackunicorn/bonklm-vercel': patch
'@blackunicorn/bonklm-weaviate': patch
---

chroma, huggingface, llamaindex, pinecone, qdrant, vercel, weaviate: publish as ESM-only
(`type: module`), matching the other connectors.

These seven connectors were CommonJS (or typeless), and their built CommonJS output `require()`d the
ESM-only core. As a result, on Node 20.4–22.11 — squarely inside the declared `engines.node`
`>=20.4.0` range — both `import()` and `require()` of the connector failed (`ERR_REQUIRE_ESM`;
`vercel` threw a `SyntaxError`). They worked only on Node 22.12+ where `require(esm)` is unflagged.

Switching them to `type: module` (and the `.` export condition from `require` to `import`) makes
them load across the entire supported Node range, identical to the other connectors. CommonJS
consumers on Node `<22.12` now hit the same intentional ESM boundary as the rest of the library.
