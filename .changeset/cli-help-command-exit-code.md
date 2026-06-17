---
'@blackunicorn/bonklm': patch
---

fix(cli): `bonklm help` now exits 0 instead of 1.

The explicit `help` command surfaces in Commander as `commander.help`, which the CLI's exit-code
mapping treated as a user error (exit 1) — inconsistent with `bonklm --help`,
`bonklm help <command>`, and `bonklm <command> --help`, which all already exit 0. The exit-code
mapping now treats an explicit help/version display as success (exit 0), while the bare `bonklm`
invocation (no command given) and malformed invocations (unknown command/option, missing or invalid
argument) still exit 1. The command surface and exit-code mapping were also extracted into a small
module so the contract is covered by an in-process regression test.
