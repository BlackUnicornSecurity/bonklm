---
id: bonklm-tools-workspace-policy
tier: tier-1-required
title: tools/* workspace policy — Tier A (private) default, Tier B (publishable) explicit
applies_to: [all]
priority: 30
---
`tools/` houses BonkLM's internal tooling packages (ESLint plugins, CI scripts, audit baselines). These are NOT consumer-facing. This policy is enforced, not documented.

**Tier A (default — INTERNAL-ONLY):**
- `package.json` MUST contain `"private": true`
- Consumed only via monorepo workspace `devDependencies` (e.g., `"@blackunicorn/eslint-plugin-edge": "workspace:*"`)
- MUST NOT appear in any `packages/*/package.json`'s `dependencies`, `peerDependencies`, or `optionalDependencies` — only `devDependencies`
- Right for: CI scripts (`tools/check-workspace-policy.js`), audit baselines, internal codegen, internal lint-rule sets

**Tier B (explicit opt-in — PUBLISHABLE):**
- `package.json` MUST NOT contain `"private": true` (omit or set `"private": false`)
- MUST contain `"workspacePolicy": "tier-b-publishable"`
- MUST contain `"publishJustification": "<reason>"` explaining why (e.g., "ESLint plugin for downstream connector authors")
- MUST contain `"files": [...]` explicitly enumerating the npm tarball contents (exclude internal allowlists, fixtures, baselines)
- MUST contain scoped `"name"` starting with `@blackunicorn/`

**Programmatic enforcement:** `tools/check-workspace-policy.js` enumerates every `tools/*/package.json` and asserts:
1. EITHER `"private": true` (Tier A) OR complete Tier B declaration
2. NO `packages/*/package.json` lists a Tier A tool in runtime dependencies

The gate runs in CI (the `workspace-policy` job in `.github/workflows/ci.yml`), the local quality gate (`scripts/quality-gate.sh`), and via `pnpm run check:workspace-policy`. Violations exit non-zero and fail the build. The gate's own branches are covered to 100% per `vitest.config.ts`.

**Reviewer checklist for new `tools/<name>/` additions:**
- [ ] Tier declaration (A or B) stated in PR description
- [ ] Tier A: `private: true` in `package.json`
- [ ] Tier B: `workspacePolicy`, `publishJustification`, `files`, scoped `name` all present
- [ ] No consumer packages list the new tool as `dependencies` / `peerDependencies`
- [ ] Tools-vs-packages placement justified in PR description
- [ ] `tools/check-workspace-policy.js` CI step PASSES
