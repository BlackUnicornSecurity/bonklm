# ADR-0006: Dual-license model — Apache-2.0 community core + BSL-1.1 enterprise tier

> Status: Accepted (2026-06-16). Scope: the whole `@blackunicorn/bonklm` repository and its npm
> publication. Authority: maintainer decision (open-core licensing strategy). This ADR records the
> license model that the repository adopts when transitioning off MIT.

## Problem

BonkLM was authored under the MIT License and is not yet published to npm. The project is moving to
an **open-core** model: a permissive, broadly adoptable community core, plus a commercially-licensed
enterprise tier that a competitor cannot simply re-host for free. A single permissive license cannot
express that split, and relicensing is far cheaper to do **before** the first npm publish (there are
no downstream consumers to migrate). The model also needs to stay consistent with the rest of the
BlackUnicorn portfolio, which uses the same instruments.

## Decision

1. **Community core → Apache-2.0.** Every package currently in `packages/*` (the deterministic
   guardrail library — validators, guards, engine, hooks, fault-tolerance — and all framework /
   provider / platform connectors, including the `bonklm-server` self-host gateway) is licensed
   under the Apache License 2.0. This is set in the root `LICENSE`, a per-package `LICENSE` file in
   every published package, the `license` field of every package manifest, and an
   `SPDX-License-Identifier: Apache-2.0` header on each package entry point. Apache-2.0 is chosen
   over MIT for its explicit patent grant and `NOTICE` mechanism, which enterprise procurement
   prefers, and because it is the Business Source License "Change License" (below).

2. **Enterprise tier → Business Source License 1.1.** The future enterprise tier (curated rule
   content, signed threat-feed delivery, industry policy packs, control-mapping evidence export,
   advanced detectors, governance primitives) is **source-available** under BSL-1.1
   (`LICENSE-BUSL-1.1.txt`): Licensor BlackUnicorn, a **3-year change date** after which each
   version converts to Apache-2.0, and no additional production-use grant (production use requires a
   commercial license until conversion). BSL is **not** an OSI-approved open source license and is
   always described as "source-available," never "open source." No enterprise package exists in the
   tree yet; `LICENSE-BUSL-1.1.txt` is the ready template for when that tier is carved out.

3. **Contributions → DCO + a narrow relicensing clause.** Inbound contributions move from the prior
   "licensed under MIT" clause to the **Developer Certificate of Origin** (sign off with
   `git commit -s`) plus a narrow clause granting BlackUnicorn the right to include a contribution
   in both the Apache community core and the BSL enterprise tier. This preserves the dual-license
   model while keeping contributor friction low. See `CONTRIBUTING.md` and `LICENSING.md`.

## Consequences

- The community core is permissive and forkable; adoption, audit, and trust are maximized. The
  Apache patent grant is procurement-friendly.
- The paid line is drawn at **operational/hosted value and curated content**, not at the
  detection/scanning engine — the engine stays Apache. A forker can copy the engine but not the
  continuously-renewed curated content or hosted service.
- BSL's source-availability lets security buyers audit the enterprise tier, and its automatic
  Apache-2.0 conversion blunts the "non-OSI lock-in" objection.
- The enterprise tier is held back from npm until its entitlement service exists; publishing
  source-available paid code with no enforcement would make it freely runnable.
- A small set of repository **tooling** packages outside `packages/*` (e.g.
  `@blackunicorn/eslint-plugin-edge`) are governed separately by `tools/WORKSPACE-POLICY.md` and are
  not covered by this ADR.

### Deferred

- Carving the enterprise tier into `packages/bonklm-ee/*` and the CI guard that fails the build if
  an Apache package imports a BSL package.
- Drafting the BSL Additional Use Grant wording (currently "None"; the base BSL grant already
  permits non-production/evaluation use).
- Deciding whether the `tools/*` packages also adopt Apache-2.0.
