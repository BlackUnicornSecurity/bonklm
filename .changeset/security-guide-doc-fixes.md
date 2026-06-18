---
'@blackunicorn/bonklm': patch
---

Documentation: corrected broken examples and tables in the Security Guide. The Secret Detection and
PII Protection examples now guard on `result.findings.length > 0` (they previously ran the findings
loop only when `findings` was falsy — an always-empty `Finding[]` is truthy — so a detected
secret/PII match was never reported) and print the actual `Finding` fields `pattern_name` /
`line_number` instead of the non-existent `secret_type` / `pii_type` / `position`. The "Detected
Secret Types" table's Crypto entry is now a well-formed two-column row. The Overview protection
table marks `ReformulationDetector` as an opt-in extra rather than a first-class default protection,
and adds a status legend distinguishing the two.
