---
'@blackunicorn/bonklm': patch
---

cli: harden and de-duplicate the working-directory containment check shared by `bonklm doctor`, the
env-file writer, and framework detection.

The three checks are now a single tested helper. Framework detection's previous check used a path
prefix without a trailing-separator boundary, so a sibling directory whose name merely extended the
project directory's (e.g. `app` vs `app-evil`) could pass containment via a symlinked
`package.json`; the shared helper applies the `root + sep` boundary and refuses it. `bonklm doctor`
and the env-file writer retain their existing behaviour.
