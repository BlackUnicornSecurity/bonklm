---
'@blackunicorn/bonklm': minor
---

refactor(core): extract the indirect-injection arm composer to a single home

Add `appendIndirectInjectionArm(validators, surface)` and the
`appendToolResultInjectionArm(validators)` convenience wrapper. The four composite factories
(`createToolCallArgsValidator`, `createRetrievedDocValidator`, `createComposedContextValidator`,
`createMemoryWriteValidator`) now call the composer instead of each re-pasting
`[...validators, new IndirectInjectionValidator({ surface })]`, so the append-ordering and
per-surface tag live in exactly one place. The `appendToolResultInjectionArm` wrapper is the single
composition point that connector inbound tool-result paths call as that coverage rolls out in
follow-up PRs. No behavior change in this release — the factories compose the identical arm in the
identical order.
