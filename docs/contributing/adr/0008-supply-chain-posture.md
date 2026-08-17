# ADR-0008: Supply-chain posture — shipped-closure scope, provenance, SBOM, dist-tags

> Status: Accepted (2026-06-17). Amended (2026-08-16) — see "Amendment: governed dev/test-closure
> floors" below. Scope: how BonkLM measures and attests the integrity of what it publishes to npm.
> Authority: maintainer decision. Relates to ADR-0006 (dual-license model) and ADR-0007 (OSS↔EE
> boundary guard).

## Problem

BonkLM publishes ~50 connector packages plus the core. Connectors integrate third-party SDKs
(`chromadb`, `agents`, `@google/genai`, `llamaindex`, `@daytonaio/sdk`, …) and, by deliberate
design, declare those SDKs as **optional `peerDependencies`** — the consumer installs the SDK they
already use, and a clean BonkLM install does not auto-install it. That design has a measurement
consequence:

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

### 1. Supply-chain gates measure the default npm install closure, not the workspace

`scripts/lib-shipped-closure.mjs` computes BonkLM's **default install closure**: the transitive set
reached through `dependencies`, `optionalDependencies`, and non-optional `peerDependencies`, which
npm 7+ auto-installs. Optional peers and dev dependencies are excluded. Connector host SDKs are
required to be optional peers; first-party runtime links and deliberately required peers such as the
Tier-B ESLint host remain inside the blocking closure. The walk reads installed manifests through
Node's resolver so it follows pnpm's store without re-implementing semver.

Two blocking source-tree gates run over that closure (wired into `scripts/quality-gate.sh` and
exposed as `pnpm audit:prod` / `pnpm license-check`):

- **Advisory gate** (`scripts/supply-chain-audit.mjs`) — runs `pnpm audit --prod --json`, classifies
  every HIGH/CRITICAL advisory by the first dependency edge out of a publishable package, and fails
  when one enters through a runtime dependency or non-optional peer edge (or an unclassifiable path
  — fail-safe). Advisories that enter exclusively through optional peers are consumer-supplied.
- **License gate** (`scripts/license-audit.mjs`) — requires every package in the same closure to
  carry a permissive license (a dual `A OR B` passes if either disjunct is permissive; an `A AND B`
  passes only if every conjunct is). Non-permissive licenses in peer SDKs are reported as
  consumer-awareness.

The peer-SDK advisories and licenses are documented for consumers, with recommended pins, in
`docs/user/supply-chain.md`. The pre-existing workspace-wide `pnpm audit` remains as a
**non-blocking advisory** in CI and the quality gate — useful signal, wrong thing to gate on.

Publish preflight adds a third, artifact-specific gate. It installs every retained tarball together
in a clean npm consumer with lifecycle scripts disabled, validates every declared entrypoint and its
relative module graph, runs a blocking production audit, and checks licenses against that
npm-resolved tree. This detects resolver drift that a frozen pnpm workspace alone cannot
demonstrate, including dependency ranges whose newest registry resolution differs from the workspace
lock. The resolved inventory and its transitive SHA-512 identities are retained as release evidence.

### 2. npm build provenance is emitted at publish time

The publish workflow holds `id-token: write` only in the npm mutation job. It publishes the
retained, preflight-scanned tarballs with `NPM_CONFIG_PROVENANCE: 'true'`, producing a Sigstore
provenance attestation bound to the workflow run, commit SHA, and source repository. Provenance
requires each published package to declare a `repository` (with the monorepo `directory`); all
publishable packages now do. Consumers verify with `npm audit signatures`.

### 3. A CycloneDX SBOM is generated for every release package

`scripts/gen-sbom.mjs` emits a deterministic CycloneDX 1.5 BOM for each exact release package from
the clean npm consumer tree and its default install closure. The release retains those BOMs
alongside the scanned tarballs; timestamps honour `SOURCE_DATE_EPOCH`, serials bind the root package
plus component and release identities, root and dependency hashes use CycloneDX SHA-512 entries, and
metadata binds the source SHA and exact tarball integrity.

### 4. Published tarballs are secret-scanned

`scripts/scan-tarballs.sh` (`pnpm scan:tarballs`) packs every publishable package and runs gitleaks
over the extracted tarball bytes — the exact files a consumer downloads. `.gitleaks.toml` extends
the default ruleset and allowlists only documented, deliberately-fake placeholders (e.g. the core
README's secret-detection example key), narrowly enough that any other secret-shaped string in a
shipped file is still reported. Both the local quality gate and publish preflight fail closed when
gitleaks is missing, finds a secret, or cannot pack the exact candidate tarballs.

### 5. Dist-tag policy

Prerelease versions (`1.0.0-rc.N`) promote to **`next`**; stable releases promote to **`latest`**.
The workflow first publishes every exact scanned tarball under an opaque staging tag, verifies the
complete version/provenance bundle, then moves the public channel as a recoverable transaction.
Prereleases never move `latest`. See `docs/user/supply-chain.md`.

### Design choices

- **Default-install walk, first-party recursion.** Runtime, optional, and required-peer edges match
  a clean npm 7+ install. Optional peers remain consumer-selected. Workspace edges are followed so
  each connector inventory includes core's actual runtime closure.
- **Classify, don't suppress.** The advisory gate classifies each advisory rather than muting rules,
  so a real shipped vulnerability is never hidden; the gate is fail-safe on any path it cannot
  classify.
- **No cosmetic overrides.** Forcing patched versions of peer-SDK transitives via `pnpm.overrides`
  would green the workspace audit without protecting any consumer (overrides do not propagate to a
  consumer's install) and risks breaking the SDKs' own dev/test resolution. The honest mechanism is
  a documented set of recommended consumer overrides, not a cosmetic pin in this repo.
- **Locked parsing dependencies.** The advisory range parser and retained-package spec parser use
  the root lockfile's reviewed `semver` and `npm-package-arg` versions. Release and recovery jobs
  install that frozen tooling set with lifecycle scripts disabled before loading either parser.

## Consequences

- The release bar is now "zero HIGH/CRITICAL and zero non-permissive licenses in BonkLM's default
  install closure", verified first against the frozen workspace and again against the clean exact-
  tarball npm installation. The source-tree checks are reproducible with `pnpm audit:prod` /
  `pnpm license-check`.
- Peer-SDK upstream advisories and licenses are no longer release-blocking noise; they are tracked
  as consumer guidance with recommended pins.
- Every publishable package declares `repository`; published tarballs carry npm provenance,
  verifiable with `npm audit signatures`.
- Per-package CycloneDX SBOMs and a published-tarball secret-scan are reproducible on demand; the
  tarball secret-scan also runs fail-closed inside the publish workflow before credentials are
  created.

## Deferred

- Automated propagation of the recommended consumer overrides into a published, machine-readable
  advisory feed.

## Amendment: governed dev/test-closure floors (2026-08-16)

The "No cosmetic overrides" design choice above rejected a specific, observed failure mode: an
override that never moved the resolved version, left an internally inconsistent lockfile, and
protected no consumer. That rejection stands for **cosmetic** overrides. It does not extend to
**governed dev/test-closure floors**, which this amendment admits as a legitimate, separate class:

- **Purpose.** BonkLM's own CI, UAT, benchmarks, and connector test suites _execute_ the workspace
  dependency tree. Vulnerable transitives inside that tree are a first-party surface (CI DoS,
  compromised dev tooling), not merely cosmetic audit noise. Floors mitigate that surface.
- **No consumer claim.** These overrides still do not propagate to consumer installs; consumer
  guidance remains `docs/user/supply-chain.md`. The shipped-closure gates remain the release bar.
- **Governance (binding).** Every override must satisfy the policy in
  `docs/contributing/dependency-overrides.md`: per-major scoped selectors with upper ceilings, no
  unbounded floors, no undocumented exact pins, cross-major forces justified with CI evidence, and
  each change verified by a from-scratch lockfile regeneration (stale pnpm peer-group resolutions
  are the exact mechanism that made the historical `vite` override inert — delete `pnpm-lock.yaml`
  and the virtual store when touching overrides).
- **Workspace audit posture.** The workspace-wide `pnpm audit` stays non-blocking in CI, but the
  maintained target for it is now "zero HIGH/CRITICAL/MODERATE; LOW only where no patched release
  exists or the fix requires a major jump incompatible with a supported peer surface." Each accepted
  LOW is recorded in the policy doc.
