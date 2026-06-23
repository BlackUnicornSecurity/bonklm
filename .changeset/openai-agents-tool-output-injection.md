---
'@blackunicorn/bonklm-openai-agents': minor
---

feat(openai-agents): scan tool outputs for indirect prompt-injection by default

`defineToolOutputGuardrail` now additionally scans the tool output against the provenance-gated
`tool_result` indirect-injection arm (`appendToolResultInjectionArm`), composed on top of the
caller's engine. A task-hijack / exfil directive embedded in a tool result trips the guardrail by
default, even when the caller supplied no validator that catches it. The arm runs only after the
caller's engine allows, so the caller's validator chain is unchanged and the arm is scoped to the
tool-output path — the general agent-output and realtime paths are untouched. As part of this,
`onToolBlocked` now receives the real blocking findings instead of an empty array.
