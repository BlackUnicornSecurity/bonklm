---
'@blackunicorn/bonklm': minor
---

feat(core): add provenance-gated indirect prompt-injection detection at connector boundaries

New `IndirectInjectionValidator` + `INDIRECT_INJECTION_PATTERNS` detect indirect prompt-injection
payloads that arrive through connector boundaries — retrieved documents, composed memory context,
tool-call arguments, and memory writes — without changing the calibrated user-text false-positive
floor. Each pattern is provenance-gated via a `requiresProvenance` surface tag and fires only on its
connector surface, never on raw user text.

The validator is composed into the `createRetrievedDocValidator`, `createComposedContextValidator`,
`createToolCallArgsValidator`, and `createMemoryWriteValidator` factories, so connectors that use
them gain the coverage by default. Also adds the `Provenance` contract types,
`hasToolResultProvenance()`, an AsyncLocalStorage-scoped raw-upstream cache primitive, and additive
`MemoryWriteMetadata.provenance` typing.
