---
'@blackunicorn/bonklm-elizaos': patch
---

elizaos: add an optional `fetchImpl` transport to the startup probe.

`bonklmPlugin({ fetchImpl })` and `runStartupProbe({ fetchImpl })` now accept an optional HTTP
transport for the Class-4 startup probe's loopback request, defaulting to the global `fetch`. This
is a testing / refactor-safety seam: probe-incidental tests can inject a deterministic transport
through the typed public contract instead of monkey-patching `globalThis.fetch`, so moving the
probe's transport off the global `fetch` becomes a compile-time change rather than a silent runtime
no-op.

The probe continues to target only the hardcoded loopback literals (`127.0.0.1` / `[::1]`) —
`fetchImpl` cannot redirect it off-host — and the plugin options object remains frozen at
construction, so this is consumer-config trust (like `envBindings`), not an attacker surface.
Production deployments should leave it unset.

As a safe-by-default guard, `bonklmPlugin` now emits a HIGH warning at construction when `fetchImpl`
is set while running in production (`productionMode` / `NODE_ENV=production`), so an accidental
non-system transport in production cannot silently mask a real Class-4 detection.
