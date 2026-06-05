---
'@blackunicorn/bonklm-chroma': patch
'@blackunicorn/bonklm-huggingface': patch
'@blackunicorn/bonklm-llamaindex': patch
'@blackunicorn/bonklm-pinecone': patch
'@blackunicorn/bonklm-qdrant': patch
'@blackunicorn/bonklm-vercel': patch
'@blackunicorn/bonklm-weaviate': patch
---

chroma, huggingface, llamaindex, pinecone, qdrant, vercel, weaviate: drop a redundant
`resolution-mode` import attribute from the connector type definitions.

These connectors publish as ESM (`type: module`), so their type-only import of the core package
already resolves in import mode. The explicit
`import type { ... } from '@blackunicorn/bonklm' with { 'resolution-mode': 'import' }` attribute —
only needed back when the connectors were CommonJS — is now redundant and has been removed. The
exported type surface and runtime behavior are unchanged.
