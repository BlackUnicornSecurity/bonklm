---
'@blackunicorn/bonklm-vercel': patch
---

vercel: hex-escape the validator-supplied block reason in the `wrapMCPClient` `readResource`
development-mode error throw (`sanitizeMeta`), completing this connector's CWE-117 dev-mode
throw-sink coverage alongside the middleware, agent, and streaming paths.

This sink is defense-in-depth: `wrapMCPClient` runs its retrieved-document validator in drop mode,
which filters flagged documents per-doc rather than reaching the blocked-batch throw, and the one
mode that would reach it already escapes the reason in core — so the wrap is redundant for every
currently reachable path and changes no behaviour. It keeps every dev-mode reason interpolation in
the connector on the shared sanitization boundary regardless of future per-document-failure-mode
changes. Production-mode messages were already generic and are unchanged.
