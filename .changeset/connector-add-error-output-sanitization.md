---
'@blackunicorn/bonklm': patch
---

The `bonklm connector add` command now hex-escapes ANSI / control / line-separator characters in
connector-supplied error text shown in its human-readable failure messages (both the connection-test
failure and the catch-all error path), matching the sanitization already applied by the setup
wizard's human output. This prevents a hostile or buggy provider endpoint from emitting raw terminal
escape sequences through the command's error output.
