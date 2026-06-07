---
'@blackunicorn/bonklm': patch
---

cli: harden the Windows `.env` permission step to fail closed. `EnvManager` now drops the
`attrib +R` fallback (a read-only flag gives no ACL confidentiality for a secrets file and left the
`.env` read-only, breaking the next write) and bounds the `icacls` spawn with a timeout. If `icacls`
cannot harden the file, the write throws `WINDOWS_PERMISSIONS_FAILED` before the atomic rename — so
no `.env` is written — instead of degrading silently. No change on macOS/Linux.
