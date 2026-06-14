---
'@blackunicorn/bonklm': patch
'@blackunicorn/bonklm-chroma': patch
---

Harden the retrieved-document batch validator against control-character (CWE-117) log/error
injection. When a flagged document blocks or is dropped/redacted from a batch, the validator's
`reason` and the document id — both derived from attacker-influenceable retrieved content — are now
escaped via the shared log-sanitizer before they reach the thrown error message and the structured
log entries. Previously these could carry raw newlines, ANSI escapes, or other control bytes into a
consumer's logs. The chroma connector's inline batch path — which does not route through the shared
helper — received the same sanitization.
