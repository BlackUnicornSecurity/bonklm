---
'@blackunicorn/bonklm-copilotkit': minor
---

feat(copilotkit): scan inbound action results for indirect prompt-injection by default

`validateActionResult` now routes through a dedicated tool-result engine that appends the
provenance-gated `tool_result` indirect-injection arm (`appendToolResultInjectionArm`) onto the
caller's validators. A task-hijack / exfil directive embedded in an action result is now blocked
even when the caller supplied no validator that catches it. The arm is scoped to the action-result
path — the general assistant-output and streaming paths are unchanged, so `tool_result`-surface
patterns never fire on ordinary output. Gated by the existing `validateActionResults` option
(default `true`).
