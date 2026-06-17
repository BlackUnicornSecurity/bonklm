---
'@blackunicorn/bonklm-vercel': patch
---

vercel: hex-escape control characters in the validator-supplied block reason before it reaches the
development-mode error messages thrown by `bonkMiddleware` (input + non-streaming output blocks) and
`wrapAgent` (input + output blocks), matching the canonical `sanitizeMeta` boundary (ADR-0001)
already applied to this connector's streaming sinks and the rest of the library (CWE-117
log-injection hardening).

In development mode these non-streaming paths interpolated the raw validator-supplied block reason
into the thrown error message; a newline or escape sequence embedded in that text could forge or
corrupt downstream log lines or transcript surfaces. Each value now passes through the shared
log-sanitization primitive at the sink. Production-mode messages were already generic and are
unchanged; this is a defensive hardening with no API or behavioural change.
