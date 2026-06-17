# ADR-0008: Supply-chain posture — shipped-closure scope, provenance, SBOM, dist-tags

> Status: Accepted (2026-06-17). Scope: how BonkLM measures and attests the integrity of what it
> publishes to npm. Authority: maintainer decision. Relates to ADR-0006 (dual-license model) and
> ADR-0007 (OSS↔EE boundary guard).

## Problem

BonkLM publishes ~50 connector packages plus the core. Connectors integrate third-party SDKs
(`chromadb`, `agents`, `@google/genai`, `llamaindex`, `@daytonaio/sdk`, …) and, by deliberate
design, declare those SDKs as **`peerDependencies`** — the consumer installs the SDK they already
use, and BonkLM never bundles it. That design has a measurement consequence:

> A workspace-wide `pnpm audit` / `pnpm licenses` over the whole monorepo surfaces dozens of
> upstream advisories and non-permissive licenses that originate **inside those peer SDKs**, not
> inside anything BonkLM ships.

Treating that workspace-wide number as the release bar is misleading in both directions. It reports
problems BonkLM cannot fix (a `pnpm.overrides` pin in this repo does not propagate to a consumer's
install of the peer SDK), and it can mask a problem in BonkLM's own dependencies behind the noise.
An honest supply-chain bar must measure **what BonkLM actually ships**, and the release must let a
consumer verify that what they downloaded is what this repo built. We also lacked a dependency
manifest (SBOM) and an explicit dist-tag policy for prereleases.

A concrete illustration of the misleading-number problem: a previous attempt to "fix" a transitive
`vite` advisory added a root `pnpm.overrides` entry for it. `vite` here is an **optional peer** of a
deep transitive of one connector's peer SDK; the override never moved the resolved version (it only
rewrote intermediate peer ranges, leaving an internally inconsistent lockfile) and protected no
consumer. The override was inert and has been removed in favour of the posture below.

## Decision

### 1. Supply-chain gates measure the shipped production closure, not the workspace

`scripts/lib-shipped-closure.mjs` computes BonkLM's **shipped closure**: the transitive set reached
by following only `dependencies` / `optionalDependencies` edges out of the publishable packages' own
`dependencies`. `peerDependencies` and `devDependencies` are excluded by construction — they are
never in a tarball's install closure. The walk reads each installed package's manifest through
Node's own resolver, so it follows pnpm's store correctly without re-implementing semver.

Two blocking gates run over that closure (wired into `scripts/quality-gate.sh` and exposed as
`pnpm audit:prod` / `pnpm license-check`):

- **Advisory gate** (`scripts/supply-chain-audit.mjs`) — runs `pnpm audit --prod --json`, classifies
  every HIGH/CRITICAL advisory by the first dependency edge out of a publishable package, and fails
  **only** when one enters through a shipped `dependencies` edge (or an unclassifiable path —
  fail-safe). Advisories that enter exclusively through `peerDependencies` are reported as
  consumer-supplied, never as a BonkLM ship-blocker.
- **License gate** (`scripts/license-audit.mjs`) — requires every package in the shipped closure to
  carry a permissive license (a dual `A OR B` passes if either disjunct is permissive; an `A AND B`
  passes only if every conjunct is). Non-permissive licenses in peer SDKs are reported as
  consumer-awareness.

The peer-SDK advisories and licenses are documented for consumers, with recommended pins, in
`docs/user/supply-chain.md`. The pre-existing workspace-wide `pnpm audit` remains as a
**non-blocking advisory** in CI and the quality gate — useful signal, wrong thing to gate on.

### 2. npm build provenance is emitted at publish time

The publish workflow holds `id-token: write`, but that permission was never consumed. The publish
step now sets `NPM_CONFIG_PROVENANCE: 'true'`, so `changeset publish` signs every tarball with a
Sigstore provenance attestation binding it to the workflow run, commit SHA, and source repo.
Provenance requires each published package to declare a `repository` (with the monorepo
`directory`); all publishable packages now do. Consumers verify with `npm audit signatures`.

### 3. A CycloneDX SBOM is generated for core

`scripts/gen-sbom.mjs` (`pnpm sbom`) emits a CycloneDX 1.5 BOM of core's shipped closure, derived
from the installed manifests — no third-party SBOM toolchain is added to a supply-chain change. The
BOM is deterministic (its serial number is a content hash; timestamps honour `SOURCE_DATE_EPOCH`)
and is a build/release artifact (`*.sbom.json`, gitignored); the generator is the committed source
of truth.

### 4. Published tarballs are secret-scanned

`scripts/scan-tarballs.sh` (`pnpm scan:tarballs`) packs every publishable package and runs gitleaks
over the extracted tarball bytes — the exact files a consumer downloads. `.gitleaks.toml` extends
the default ruleset and allowlists only documented, deliberately-fake placeholders (e.g. the core
README's secret-detection example key), narrowly enough that any other secret-shaped string in a
shipped file is still reported. The gate is presence-guarded on gitleaks (skipped, not failed, when
absent) so the quality gate still runs on a bare box.

### 5. Dist-tag policy

Prerelease versions (`1.0.0-rc.N`) publish under the **`next`** dist-tag; the first stable `1.0.0`
and later stable releases publish under **`latest`**. The publish workflow derives the tag from the
release version and passes it to `changeset publish --tag` (which otherwise defaults everything to
`latest`), so a prerelease can never move `latest`. This keeps `npm install @blackunicorn/bonklm` on
the newest stable while prerelease testers opt in with `@next`. See `docs/user/supply-chain.md`.

### Design choices

- **Dependencies-only walk, first-party recursion.** Seeding from `dependencies` and recursing
  through `dependencies`/`optionalDependencies` is exactly the consumer's install closure. Workspace
  (`@blackunicorn/*`) edges are followed so a connector's closure includes core's real dependencies,
  but a `peerDependencies` edge is never followed — that is the precise boundary between "BonkLM
  ships it" and "the consumer supplies it".
- **Classify, don't suppress.** The advisory gate classifies each advisory rather than muting rules,
  so a real shipped vulnerability is never hidden; the gate is fail-safe on any path it cannot
  classify.
- **No cosmetic overrides.** Forcing patched versions of peer-SDK transitives via `pnpm.overrides`
  would green the workspace audit without protecting any consumer (overrides do not propagate to a
  consumer's install) and risks breaking the SDKs' own dev/test resolution. The honest mechanism is
  a documented set of recommended consumer overrides, not a cosmetic pin in this repo.
- **Self-contained tooling.** The advisory, license, and SBOM tools are dependency-free Node/bash
  reading data pnpm already produced — a supply-chain change should not enlarge the supply chain.

## Consequences

- The release bar is now "zero HIGH/CRITICAL and zero non-permissive licenses in BonkLM's shipped
  production closure", verified by two blocking gates and reproducible with `pnpm audit:prod` /
  `pnpm license-check`. On the current tree both pass: the shipped closure is permissive-only with
  no HIGH/CRITICAL advisory.
- Peer-SDK upstream advisories and licenses are no longer release-blocking noise; they are tracked
  as consumer guidance with recommended pins.
- Every publishable package declares `repository`; published tarballs carry npm provenance,
  verifiable with `npm audit signatures`.
- A CycloneDX SBOM and a published-tarball secret-scan are reproducible on demand.

## Deferred

- Publishing the SBOM as a release asset (today it is an on-demand artifact).
- Per-connector SBOMs (today the BOM covers core).
- Automated propagation of the recommended consumer overrides into a published, machine-readable
  advisory feed.
