---
'@blackunicorn/bonklm': patch
'@blackunicorn/bonklm-hono': patch
'@blackunicorn/bonklm-letta': patch
'@blackunicorn/bonklm-mem0': patch
'@blackunicorn/bonklm-memory-utils': patch
'@blackunicorn/bonklm-zep': patch
'@blackunicorn/bonklm-cloudflare-agents': patch
---

edge: stop declaring the `edge-light` export condition where the package is not strictly
edge-light-safe.

`@blackunicorn/bonklm` (`./edge`), `-hono`, `-letta`, `-mem0`, `-memory-utils`, `-zep`, and
`-cloudflare-agents` declared the `edge-light` export condition, but each transitively imports Node
built-ins through the BonkLM core it builds on — `node:fs`/`node:path` (and, where the
`GuardrailEngine` is reached, `node:crypto`/`Buffer`). The core `./edge` surface pulls them via
`GuardrailEngine` → the internal `override-token` module and `common/index`; the connector packages
pull them through the core `@blackunicorn/bonklm` and `@blackunicorn/bonklm/core/connector-utils`
exports they depend on. Those built-ins are provided by Cloudflare Workers (`workerd`) with
`nodejs_compat`, Deno, Bun, and Node, but NOT by the strict Vercel Edge Runtime (`edge-light`), so a
strict edge-light bundle of these packages would fail to load — the condition over-promised.

These packages now declare only the runtimes they actually support: `workerd` (with
`nodejs_compat`), `deno`, `bun`, and `import` (Node). The `edge-light` condition is retained on the
packages that are genuinely Web-API-only (`-elysia`, `-nextjs`, `-web-middleware-utils`). No
exported symbol or runtime behaviour changes on the supported runtimes — this corrects the declared
compatibility surface and the accompanying documentation. A genuinely Web-only (no Node built-ins)
edge surface remains planned for a future release.
