---
'@blackunicorn/bonklm': patch
'@blackunicorn/bonklm-elizaos': patch
'@blackunicorn/bonklm-langchain': patch
'@blackunicorn/bonklm-genkit': patch
'@blackunicorn/bonklm-mcp': patch
'@blackunicorn/bonklm-copilotkit': patch
---

elizaos: ship the `bonklm-doctor` CLI entry so the declared `bin` resolves.

The package declared a `bonklm-doctor` bin at `./dist/bin/doctor.js`, but no source emitted that
path, so `npm i -g @blackunicorn/bonklm-elizaos` (or `npx bonklm-doctor`) created a dangling symlink
that failed at runtime. This adds the executable entry (`src/bin/doctor.ts`) — a thin shebang shim
over the existing static-audit library — wiring it to argv:

```bash
bonklm-doctor <character.json> [plugins.json] [--json]
```

It reports plaintext-secret, weak-identity-anchor, and unverified/typo-squat-plugin findings, exits
`1` on any CRITICAL finding (the unsuppressable-CRITICAL contract), and `2` on bad usage or
unreadable/invalid input. Untrusted JSON is parsed with `secure-json-parse` and all rendered output
is run through `sanitizeLogString`.

langchain, genkit, mcp, copilotkit: add an explicit `publishConfig.access: "public"`, matching the
other scoped connector packages.

core: harden the shared `sanitizeLogString` output sanitizer to also hex-escape the C1 control range
(U+0080–U+009F) — closing a terminal-injection (CWE-117/CWE-1007) gap surfaced by internal review
while wiring the CLI that relies on it. C0 and DEL were already escaped.
