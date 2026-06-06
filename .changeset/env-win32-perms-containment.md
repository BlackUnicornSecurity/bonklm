---
'@blackunicorn/bonklm': patch
---

cli: fix `EnvManager.write()` failing on Windows with `PATH_OUTSIDE_DIRECTORY`.

The Windows permission step (`icacls`/`attrib`) checked working-directory containment against the
internal temporary file — which lives in the OS temp directory, outside the project by design — so
every Windows `.env` write was rejected before its permissions could be applied. The containment
check now validates the final destination path (the `.env` location being written) instead: writes
inside the project succeed on Windows, while writes whose destination escapes the project directory
are still refused. Unix and macOS behaviour is unchanged.
