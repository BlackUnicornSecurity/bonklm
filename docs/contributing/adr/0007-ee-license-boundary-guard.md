# ADR-0007: OSS↔EE license-boundary CI guard

> Status: Accepted (2026-06-16). Scope: the BonkLM monorepo's open-core split — an Apache-2.0
> community core versus a source-available BSL-1.1 enterprise tier. Authority: maintainer decision.
> Builds on ADR-0006 (the dual-license model); this ADR records the CI guard that ADR-0006 deferred.

## Problem

ADR-0006 adopts an open-core model: every current package is Apache-2.0 (community core), and a
future enterprise tier will be carved, source-available, into `packages/bonklm-ee/*` under BSL-1.1.
For that split to mean anything in code, one invariant is load-bearing:

> `packages/core` and every Apache-tier package MUST build, type-check, and pass tests with the
> entire `packages/bonklm-ee/*` tree absent.

If an Apache package ever imported a BSL package, the community core would no longer stand alone: a
fork could not build it without the paid tier, and the license boundary would be violated in code
rather than only on paper. ADR-0006 deferred the CI guard for this. No enterprise package exists
yet, so the guard is built **ahead of** the first one — it must pass trivially on today's all-Apache
tree while arming automatically the moment a BSL package lands.

## Decision

Add one dependency-free Node gate, `tools/check-ee-boundary.js`, wired into CI
(`.github/workflows/ci.yml`, the `ee-boundary` job), the root scripts
(`pnpm run check:ee-boundary`), and the local quality gate (`scripts/quality-gate.sh`). It runs two
facets over one shared package index:

1. **License classification.** Every `packages/*` manifest must declare a recognized `license`:
   `Apache-2.0` (OSS) or `BUSL-1.1` / `LicenseRef-BSL-1.1` (EE). An unknown/missing license — or a
   manifest with no `name` — is an error. Classification is never silently skipped: a package that
   escapes classification could also escape the boundary check below.

2. **Boundary guard (imports + declared deps).** For every OSS package the gate (a) scans its source
   tree and fails the build if any file imports an EE package — statically (`… from '…'`, including
   `import type` and `export * from`; side-effect `import '…'`) or dynamically (`import('…')`); and
   (b) fails if the package's `package.json` names an EE package in `dependencies`,
   `peerDependencies`, or `optionalDependencies` — a declared dependency drags EE into
   `pnpm install` even with no source import, breaking the "builds with EE absent" invariant. A
   non-literal dynamic `import()` in an OSS package is fail-closed **only once at least one EE
   package exists**; with zero EE packages a computed specifier cannot reach an EE target, so
   flagging it would be a false positive.

### Design choices

- **Package-specifier granularity, direct edges.** The enterprise tier is carved physically (whole
  capabilities relocate into separate `packages/bonklm-ee/*` packages), so the leak unit is a
  cross-package import edge, not an intra-package symbol. Every package is scanned, so a transitive
  chain `OSS-A → OSS-B → EE` is caught at B's own direct `B → EE` edge — which is also the precise
  place to fix it. This is simpler than a transitive file graph and sufficient under a physical
  carve.
- **Package discovery handles the nested EE layout.** A package is any directory with a
  `package.json` either directly under `packages/` or one level under a manifest-less grouping
  directory — so the documented `packages/bonklm-ee/<capability>/` tree is discovered and classified
  rather than silently missed (which would disarm the tripwire). A directory that already is a
  package is never descended into, so a package's own `examples/` sub-apps are not treated as
  packages.
- **The resolver reads the real `name`→dir map.** A package's directory name is not its package name
  (e.g. `@blackunicorn/bonklm-fastify` lives in `packages/fastify-plugin/`), so the resolver reads
  every `package.json` rather than inferring from directory names (which would fail open).
- **Separate from `tools/check-workspace-policy.js`.** That gate governs a different axis (`tools/*`
  publishability) with the opposite tier polarity, so it is not overloaded. License tiers here are
  always called "OSS/EE" (or "Apache/BSL"), never "Tier A/B", to avoid a vocabulary collision.
- **One source of truth.** Both facets share a single package index, so the license classifier and
  the import guard can never disagree on what is EE.
- **Not fail-closed on "zero EE packages".** Asserting that a fresh export excludes a non-empty
  `packages/bonklm-ee/**` set is a separate, later export-gate control; this guard is a tripwire and
  is correct to pass on an all-Apache tree.

The lexical-mask + import-extraction algorithm (`maskSource`, `extract*Imports`) is adapted from
prior BlackUnicorn Apache-2.0 community-export tooling; the resolver, license classifier, and
boundary profile are net-new and BonkLM-specific.

### Scope and limitations

- A type-only `import type … from <EE>` is flagged on purpose: the open core must not even _name_ a
  Pro package, and a type import of an absent EE package fails `tsc`.
- CommonJS `require('<EE>')` is not parsed — the core is ESM-only (`"type": "module"`), and a
  required package must anyway be a declared dependency, which the manifest facet catches.
- Example apps (`packages/<x>/examples/`, `packages/examples/`) are out of scope: private, never
  published, and not part of the load-bearing "core builds/tests with EE absent" surface.
- `tools/*` packages are governed separately by `tools/WORKSPACE-POLICY.md` and are outside this
  gate's scan root.
- The EE marker is the SPDX token `BUSL-1.1` (or `LicenseRef-BSL-1.1`); the prose name "BSL-1.1" is
  not a valid SPDX value and is rejected as unclassifiable.

## Consequences

- The open-core boundary is enforced in CI from before the first enterprise package exists — the
  first `packages/bonklm-ee/*` package is born guarded.
- On today's all-Apache tree the gate reports every package OSS, zero EE, zero violations, and adds
  negligible CI time (dependency-free; no install or build).
- The self-host gateway `@blackunicorn/bonklm-server` is confirmed to have zero EE edges (no EE
  import and no EE declared dependency), consistent with shipping it under Apache-2.0.
- Every `packages/*` package must now carry a recognized SPDX `license`. The previously unlabeled
  private, deprecated `@blackunicorn/bonklm-wizard` was given its `Apache-2.0` field to satisfy the
  classifier.
- `tools/check-ee-boundary.js` is pinned to 100% test coverage in `vitest.config.ts`, matching the
  other release-surface structural gates.

### Deferred

- Creating the `packages/bonklm-ee/*` packages and the open core's extension points, so Pro
  capabilities register into the core rather than the core importing them (the core never names a
  Pro package).
- The fresh-export exclude-gate that fail-closes on a non-empty `bonklm-ee/**` candidate set — a
  different control from this tripwire.
