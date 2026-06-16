---
'@blackunicorn/bonklm-openai-agents': patch
'@blackunicorn/bonklm-genkit': patch
'@blackunicorn/bonklm-copilotkit': patch
'@blackunicorn/bonklm-langchain': patch
---

openai-agents, genkit, copilotkit, langchain: hex-escape control characters in
attacker-influenceable strings before they reach development-mode error messages, returned
block-reason fields, and log metadata (CWE-117 log-injection hardening), matching the canonical
`sanitizeMeta` boundary (ADR-0001) already applied across the rest of the library.

In development mode these connectors surfaced the raw validator-supplied block reason in their error
messages and returned block-reason fields, and the CopilotKit integration logged a raw,
caller-supplied action name in its action-name guard metadata. A newline or escape sequence embedded
in that text could forge or corrupt downstream log lines or transcript surfaces. Each such value is
now passed through the shared log-sanitization primitive at the sink. Production-mode messages were
already generic and are unchanged; this is a defensive hardening with no API change.
