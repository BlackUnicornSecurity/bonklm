---
'@blackunicorn/bonklm': patch
---

Harden `bonklm doctor`: contain a relative `core.hooksPath` within the working tree.

`resolveHooksPath` previously resolved any relative `core.hooksPath` from `.git/config` directly
against the working directory, so a hostile config carrying `hooksPath = ../../../../etc` resolved
to a path OUTSIDE the working tree (path traversal). The doctor is a read-only diagnostic, but the
escaping path could surface in its output and never matched git's intent for a local hook check.

A relative `core.hooksPath` that escapes the working tree now falls back to the default `.git/hooks`
instead of following the escape. Absolute `core.hooksPath` (a legitimate shared-hooks pattern) is
unchanged, and path strings echoed in doctor output remain sanitized. Added path-traversal
regression coverage.
