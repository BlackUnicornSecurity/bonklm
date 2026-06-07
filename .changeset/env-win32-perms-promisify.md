---
'@blackunicorn/bonklm': patch
---

cli: make the Windows `.env` permission step await its `icacls`/`attrib` calls.

`EnvManager`'s Windows hardening invoked the callback-style `execFile` (`icacls`, then `attrib` as a
fallback) without promisifying it, so each `await` resolved immediately to the child-process handle
instead of waiting for the command to finish. A non-zero exit or spawn failure was therefore never
observed by the surrounding `try/catch`: the `attrib` fallback and the `WINDOWS_PERMISSIONS_FAILED`
error were effectively unreachable on Windows. The calls are now promisified before being awaited,
so a failed `icacls` falls back to `attrib`, and failure of both surfaces as
`WINDOWS_PERMISSIONS_FAILED` with the original cause attached. The calls still use `execFile` (no
shell), and Unix/macOS behaviour is unchanged. Added regression coverage that fails if the calls are
awaited un-promisified.
