---
'@blackunicorn/bonklm': patch
---

The setup wizard now validates connector ids against the connector registry through the same shared
format guard used by `connector add` / `connector test` / `connector remove`, instead of a private
hardcoded id list that could drift from the registry; a well-formed id that is not in the registry
is now skipped with an explicit warning instead of silently. Wizard `--json` output hardens
connector-supplied error strings with the credential redaction used by the library's error sanitizer
(consolidated into a single shared helper) plus control-character hex-escaping, and the
human-readable summary hex-escapes ANSI/control characters in connector-supplied error strings. The
API-key validation cache is keyed by a SHA-256 digest of the key, so plaintext key material is never
retained in the cache.
