---
'@blackunicorn/bonklm': patch
---

`GuardrailEngine.validateInput(input)` now runs configured guards (`SecretGuard`, `BashSafetyGuard`,
and any other `Guard`) in addition to validators, closing a gap where guards only fired on the
string `validate(content)` path. The structured `ValidatorInput` (`text`, `tool_call`,
`retrieved_docs`, `memory_write`, `composed_context`, `audio_partial`) is reduced to a canonical
text surface that guards inspect, after validators and under the same short-circuit gate as
`validate()`. Consumers wiring a guard onto browser-agent / Inngest / Eko surfaces — which route
through `validateInput` — now get guard coverage there. As a robustness fix in the same path,
structured input serialization for intercept callbacks no longer throws on circular /
non-serializable `tool_call` args. See `docs/user/known-limitations.md` §10 for the narrow residual
on JSON-encoded structured fields (`tool_call` args, doc/memory metadata).
