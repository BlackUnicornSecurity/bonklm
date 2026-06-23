---
'@blackunicorn/bonklm-mastra': minor
---

feat(mastra): scan inbound tool results for indirect prompt-injection by default

`validateToolResult` now routes through a dedicated tool-result engine that appends the
provenance-gated `tool_result` indirect-injection arm (`appendToolResultInjectionArm`) onto the
caller's validators. A task-hijack / exfil directive embedded in a tool result is now blocked even
when the caller supplied no validator that catches it. The arm is scoped to the tool-result path —
the general agent-output and streaming paths are unchanged, so `tool_result`-surface patterns never
fire on ordinary LLM output. Gated by the existing `validateToolResults` option (default `true`).
