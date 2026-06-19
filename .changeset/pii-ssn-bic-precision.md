---
'@blackunicorn/bonklm': patch
---

PII detection precision: SSN and BIC/SWIFT no longer false-match on look-alike tokens.

The SSN pattern now requires its standard separators (`AAA-GG-SSSS` or `AAA GG SSSS`) instead of
treating them as optional, so a bare nine-digit run — a request counter, a token total, a byte size
— is no longer reported as a Social Security Number. Canonically separated SSNs continue to be
detected.

The BIC/SWIFT pattern now validates the ISO 9362 invariant that positions 5–6 are a real ISO 3166-1
country code. An ordinary 8- or 11-character uppercase token (for example the word `INFORMATION`)
matches the loose shape but is not a bank identifier, and is no longer reported. Genuine BICs, whose
country code is valid by construction, continue to be detected.

Both changes reduce false positives on benign numeric and uppercase-prose content without weakening
detection of real PII.
