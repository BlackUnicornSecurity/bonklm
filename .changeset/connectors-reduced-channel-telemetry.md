---
'@blackunicorn/bonklm-mastra': patch
'@blackunicorn/bonklm-copilotkit': patch
---

mastra, copilotkit: emit telemetry when a message reducer drops a non-text channel

The inbound `tool_result` indirect-injection arm scans only the text these connectors' message
reducers surface. A non-text content part the reducer collapses to a placeholder (mastra `image_url`
→ `[Image]`; copilotkit `image` → `[Image]` and `data` → `[Data]`) or drops because its part `type`
is unrecognized rode through **unscanned with no operator signal**. The reducer now tallies every
such part and the connector emits a `warn` carrying a sanitized reduced-kind count + list — the same
"never a silent pass" posture already applied to the MCP connector's uninspectable binary blobs. The
kind label of an unrecognized `type` is attacker-influenceable, so it is hex-escaped at the sink
(CWE-117 / ADR-0001).

This is observability only: the text-only scan scope is unchanged (and documented in
known-limitations §30), no public API changes, and no new block decisions — an operator simply gains
a signal that a structured channel bypassed the scan. `messagesToText` output is byte-identical.
