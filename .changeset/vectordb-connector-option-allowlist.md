---
'@blackunicorn/bonklm-qdrant': patch
'@blackunicorn/bonklm-pinecone': patch
---

qdrant/pinecone: harden caller-option forwarding so only known, validated native options reach the
underlying client (defense-in-depth, CWE-20).

- **qdrant `search`** now forwards only an allow-list of native `SearchRequest` options (`offset`,
  `params`, `shard_key`). Any other caller-supplied key — including one that could carry an
  unvalidated filter via the options index signature — is dropped instead of being passed through
  verbatim, and a negative, fractional, or non-numeric `offset` is now rejected. This supersedes the
  previous "unrecognized options are still forwarded verbatim" behavior.
- **pinecone `query`** now structurally validates `namespace` before it is used to target the index:
  it must be a string matching `^[a-zA-Z0-9_-]+$` within a length cap, so a non-string (`{}` /
  `123`) or malformed namespace is rejected rather than handed to the SDK. The outgoing query body
  is now built from an allow-list of real Pinecone query fields (`vector`, `includeValues`,
  `includeMetadata`, plus the connector's normalized `topK` and sanitized `filter`), so unrecognized
  caller keys are no longer forwarded.
