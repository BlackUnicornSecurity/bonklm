---
'@blackunicorn/bonklm': patch
---

cli: implement `bonklm connector test <id>` and `bonklm connector remove <id>` (previously exited
`NOT_IMPLEMENTED`).

`connector test` reads a connector's credentials from `process.env` overlaid on `.env` and runs its
two-tier connection + validation check with a 10s timeout (`--json` for machine-readable output); it
exits `0` on pass, `2` when the test ran but connection or validation failed, and `1` for an unknown
/ malformed or unconfigured connector. `connector remove` is the registry-gated inverse of
`connector add`: it reports the affected `.env` keys (names only), confirms unless `--yes`,
atomically rewrites `.env` without them via `EnvManager`, and audit-logs the change. Connector-ID
validation is now sourced from the registry through a shared guard reused by `connector add`.
