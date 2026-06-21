---
id: bonklm-ee-boundary-guard
tier: tier-1-required
title: OSS↔EE license boundary CI guard per ADR-0007
applies_to: [all]
priority: 35
---
BonkLM uses an open-core model: Apache-2.0 community core (`packages/*`) and future BSL-1.1 enterprise tier (`packages/bonklm-ee/*`). One invariant is load-bearing:

> `packages/core` and every Apache-tier package MUST build, type-check, and pass tests with the entire `packages/bonklm-ee/*` tree absent.

This is enforced by a dependency-free Node gate: `tools/check-ee-boundary.js`, wired into CI (`.github/workflows/ci.yml`, the `ee-boundary` job), root scripts (`pnpm run check:ee-boundary`), and the local quality gate (`scripts/quality-gate.sh`).

**License classification:** Every `packages/*` manifest must declare a recognized `license`:
- `Apache-2.0` (OSS)
- `BUSL-1.1` or `LicenseRef-BSL-1.1` (EE — stored as `BUSL-1.1` per SPDX)

Missing / unknown license, or missing `name` field, is an error. Classification is never skipped: a package that escapes classification could also escape the boundary check.

**Boundary guard (imports + declared deps):** For every OSS package:
1. Scan source tree and fail if any file imports an EE package — statically (`… from '…'`, including `import type` and `export * from`; side-effect `import '…'`) or dynamically (`import('…')`)
2. Fail if `package.json` names an EE package in `dependencies`, `peerDependencies`, or `optionalDependencies` — a declared dependency drags EE into `pnpm install` even with no source import
3. Non-literal dynamic `import()` in an OSS package is fail-closed only once at least one EE package exists; with zero EE packages a computed specifier cannot reach an EE target

**Scope:** Type-only `import type … from <EE>` is flagged on purpose — the open core must not even _name_ an EE package. CommonJS `require()` is out of scope (core is ESM-only). Example apps (`packages/<x>/examples/`) and `tools/*` are out of scope.

**Current state:** Today's all-Apache tree reports zero EE, zero violations, negligible CI time. The self-host gateway `@blackunicorn/bonklm-server` has zero EE edges.

**Enforced coverage:** `tools/check-ee-boundary.js` is pinned to 100% test coverage in `vitest.config.ts`, matching other release-surface structural gates (changeset-linked, workspace-policy).
