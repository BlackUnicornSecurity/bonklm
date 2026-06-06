---
'@blackunicorn/bonklm': patch
---

cli: stop rejecting legitimate `.env` filenames that merely contain a `..` substring.

The env-path validation guard in `EnvManager` matched `..` as a substring (`path.includes('..')`),
so benign filenames such as `my..config.env`, `.env..bak`, or `app..env` were incorrectly rejected
with `INVALID_PATH`. The guard now matches `..` only as a complete path segment (splitting on both
`/` and `\` separators): those names are accepted, while real path traversal (`../x`, `a/../../x`,
`..\x`) is still rejected. The null-byte and maximum-path-length checks — and the `INVALID_PATH` /
`PATH_TOO_LONG` error codes — are unchanged.
