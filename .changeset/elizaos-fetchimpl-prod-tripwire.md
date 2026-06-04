---
'@blackunicorn/bonklm-elizaos': patch
---

elizaos: warn when the probe's `fetchImpl` transport is set in production.

`fetchImpl` (the optional Class-4 startup-probe transport) is a testing / refactor-safety seam. As a
safe-by-default guard, `bonklmPlugin` now emits a HIGH warning at construction when `fetchImpl` is
set while running in production (`productionMode` / `NODE_ENV=production`), so an accidental
non-system transport in production cannot silently mask a real Class-4 detection. The seam stays
usable for legitimately constrained runtimes that opt in deliberately; production should leave it
unset.
