---
'@blackunicorn/bonklm': patch
---

fix(core): stop PII redaction double-bracketing tokens (`[[REDACTED]]`).

`PIIGuard.redactContent` (and the shared `redactPIIInString` / `redactPIIInStringSync` helpers)
applied each PII pattern with a separate sequential `String.replace`, so a replacement inserted by
an earlier pattern was re-scanned by every later one. The default `[REDACTED]` token contains the
8-letter run `REDACTED`, which matches the loose BIC/SWIFT shape (`[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}`), so
any value redacted by a pattern ordered before `BIC_SWIFT` (SSN, IBAN, …) came out cascaded as
`[[REDACTED]]` — `value 412884019 here` → `value [[REDACTED]] here`.

Redaction now runs in a single cascade-proof pass: each match is replaced with a collision-proof
placeholder, and the real replacement strings are spliced back only after every pattern has run, so
inserted tokens are never re-matched. PII is masked exactly once. This is purely cosmetic — content
was always fully masked — and the fix never under-redacts: genuine PII in the source is still
scanned by every pattern, and the deliberately over-inclusive redaction behaviour (validators are
not run in the redact path) is unchanged.
