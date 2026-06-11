---
'@blackunicorn/bonklm': patch
---

connectors: sanitize the validator `reason` interpolated into the post-stream "content filtered"
marker on the **incremental** streaming path for the anthropic and ollama connectors (chat +
generate), matching the existing buffer-mode and non-streaming behaviour. Control characters in a
blocked-reason are now neutralized before reaching the consumer-facing stream marker. Adds
end-to-end regression coverage that drives the real guarded client and fails if the sanitization is
removed.
