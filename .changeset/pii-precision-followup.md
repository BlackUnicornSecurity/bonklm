---
'@blackunicorn/bonklm': patch
---

PII detection precision, follow-up: recover labelled-SSN recall and harden BIC/SWIFT context.

- **SSN** is now also detected when an unformatted nine-digit run is preceded by an explicit SSN cue
  (`SSN`, `social security`, `tax id`) within a short window — so `SSN: <number>` and
  `SSN is <number>` are caught again, while a bare nine-digit run with no separators and no cue (a
  metric or identifier) is still not flagged.
- **BIC/SWIFT** now additionally requires banking-specific context (`SWIFT`, `IBAN`, `bank code`,
  `beneficiary bank`, …) instead of the broad sensitive-context scan, and a small common-word
  denylist rejects all-caps English words whose positions 5–6 coincidentally form a valid country
  code (e.g. `INSTRUCTION`). Genuine BICs in payment context are still detected.

Adds an optional `contextPatterns` field to `PiiPattern` so a format-ambiguous pattern can require a
domain-specific context scan.
