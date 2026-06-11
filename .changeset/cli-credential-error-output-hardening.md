---
'@blackunicorn/bonklm': patch
---

cli: unify and harden connector credential / error output handling.

`bonklm connector test --json` now redacts credential-shaped substrings in the connector-supplied
`error` field (it previously only hex-escaped control characters), matching the `wizard --json`
output. Credential redaction also collapses a JWT to a single redaction marker consistently across
both error messages and stack traces — the message path could previously fragment a long token.

Connector definitions gain an optional `credentialFormats` hint (with the exported
`CredentialFormat` type) so the interactive `wizard` and `connector add` prompts source
per-connector input-format validation (e.g. API-key prefixes) from the connector registry instead of
duplicating hardcoded checks. The validation messages are unchanged.
