---
id: bonklm-single-version-monorepo
tier: tier-1-required
title: Single-version monorepo (52 publishable packages version-locked)
applies_to: [all]
priority: 15
---
BonkLM is a single-version monorepo: **all 52 publishable packages share the same version** in their `package.json` manifests. The current release line is `1.0.0-rc.4`. This invariant is enforced, not documented.

**Canonical version source:** `packages/core/package.json` (the main library, `@blackunicorn/bonklm`). When the release line moves, update in this order:
1. `packages/core/package.json`
2. Root `package.json` (private, repo metadata)
3. `CHANGELOG.md` (add new `[x.y.z] — YYYY-MM-DD` section)
4. `RELEASE-NOTES.md` (top-of-file "Latest release" line + CHANGELOG anchor)
5. `docs/user/package-matrix.md` (header + footer version stamps)
6. `docs/architecture.md` (header `Project version:` line)
7. `docs/user/public-api-surface.md`, `docs/user/known-limitations.md`, `docs/user/threat-surfaces.md` (any "current release" labels only)

**Linked changesets enforcement:** The `.changeset/config.json` `linked` array enumerates all 52 publishable package names. This invariant is **enforced by CI** (`pnpm run check:changeset-linked`, `tools/check-changeset-linked.js`) — a newly added connector that is not linked breaks the build until `linked` is regenerated. The two private packages (`@blackunicorn/bonklm-openclaw`, `@blackunicorn/bonklm-wizard`) are excluded; `@blackunicorn/bonklm-wizard` is additionally listed under `ignore` in changeset config and **not** published.

**For any user-visible change,** add a changeset: `pnpm changeset:add`. Pick affected package(s) and bump type (`patch` / `minor` / `major`). Changesets land in `.changeset/<name>.md` and are committed alongside your code.
