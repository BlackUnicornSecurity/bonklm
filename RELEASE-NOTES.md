# BonkLM Release Notes

> **Latest in-tree family version:** `1.0.15`

> **Registry reality — history, npm-verified 2026-08-17:** every publishable package reached npm,
> each carrying the most recent patch version cut before that date (`1.0.13`), but **no release had
> ever completed its public channel promotion.** Each package's `latest` dist-tag still pointed at
> the version npm assigned automatically on that package's own first publish — npm sets `latest` on
> a first publish regardless of `--tag` — so `latest` never advanced: `@blackunicorn/bonklm` (core)
> stayed at `0.2.0` (2026-02-23) and the rest sat on their own first-published version, several of
> them a prerelease. Published versions were reachable by exact version and under `staging-*`
> dist-tags, but a plain `npm install @blackunicorn/bonklm` did not resolve to a current 1.0.x
> release. The promotion defect behind that is fixed in the 1.0.14 line (see
> [CHANGELOG.md](./CHANGELOG.md) and ADR-0008). This paragraph is a dated record, not a live claim —
> for the current state, read the registry: `npm view @blackunicorn/bonklm dist-tags`.

> **Behavior changes in the `1.0.x` patch line** (details in the migration guide §14–§15): the
> `bonklm-server` CLI default validator stack now matches the documented default (6 validators +
> `SecretGuard`) — CLI/Docker consumers may see new (correct) blocks on code-heavy or encoded
> prompts; `@blackunicorn/bonklm-express-middleware` now fails closed on unparsable request bodies
> by default; the server's replay cache fails closed with HTTP 503 at capacity and rejects
> resubmitted signatures inside the window.

This file preserves the v0.3.0 release announcement as a historical archive. For all version cuts
after v0.3.0, see the CHANGELOG.

---

## v0.3.0 — 2026-05-20 (archived)

### Overview

BonkLM v0.3.0 aligns the entire package family (core, logger, wizard, 20+ connectors, openclaw
adapter) at version `0.3.0`, removes internal development scaffolding from the public repo, lands
several runtime and security correctness fixes, and switches the monorepo to changesets-driven
publishing.

This archive described the first intended cut where every package in the monorepo would ship from
one `pnpm exec changeset publish` invocation. Registry publication did not complete; only the older
`@blackunicorn/bonklm` core package had reached npm.

### What's New

#### Single-version monorepo policy

All packages now release together at the same version, governed by a `fixed` group in
`.changeset/config.json`. No more drift between `core@0.2.0`, `connector@1.1.0`, `openclaw@0.1.0`,
`wizard@0.2.0-deprecated`.

#### Security hardening

Hardened validator normalization, secret detection, connector request handling, and streaming
lifecycle behavior, with adversarial regression coverage for the affected attack classes.

#### Build, CI, publishing

- **Cross-platform build.** BSD-only `sed -i ''` in `packages/core/package.json` replaced with a
  Node one-liner so Ubuntu CI no longer silently writes garbage to `dist/bin/run.js`.
- **Node engine bumped to `>=20.0.0`.** Node 18 went EOL April 2025; dropped from every package's
  `engines` field and from CI matrices.
- **Coverage thresholds enforced** in `vitest.config.ts` (80/80/80 lines/functions/statements, 75%
  branches) on `packages/core/src/**`.
- **`@changesets/cli` installed and configured.** All 22 packages were placed in a `fixed` group.
  The archived cut intended to rewrite `workspace:*` ranges during publication, but registry
  publication did not complete. Current releases use the exact retained-tarball workflow instead.
- **Deprecated `actions/create-release@v1`** in `publish.yml` replaced with
  `softprops/action-gh-release@v2` (the original was archived in 2022).
- **CLI `--version`** now reads from `package.json` at runtime instead of carrying a hard-coded
  `0.1.0`.

#### Removed

- Entire internal development scaffolding (`.claude/validators-node/`, `tools/`, root-level
  `tests/`, `examples/`, `scripts/`, `.githooks/`, stale `dist/`, `package-lock.json`). Path aliases
  in `vitest.config.ts` (`@framework`, `@validators`) removed.
- 688 stale `.js` / `.d.ts` / `.js.map` / `.d.ts.map` files alongside `.ts` source under
  `packages/*/src/` — leftover build outputs that were masking real type errors.
- Broken `cli` entry from `packages/core/package.json`'s `bin` field (pointed at a non-existent
  `.ts` source).
- The wizard package's `-deprecated` tag.
- False `35+ pattern categories` claim — reconciled to `35+ patterns across 6 categories` in README,
  docs, and CHANGELOG.

#### Repo hygiene

- Internal development artefacts (`team/`) are gitignored. BonkLM-relevant artefacts (UAT harness,
  performance benchmarks) were moved to `packages/core/uat/` and `packages/core/benchmarks/`.
- `bonklm-intro.pptx` moved from repo root to `assets/presentations/`.
- Lint clean: `pnpm exec eslint .` exits 0 with zero errors, zero warnings.
- Type-check clean: `pnpm exec tsc --noEmit` exits 0.

### Known Follow-ups

- File-size cap violations (`jailbreak.ts` 1418, `engine/GuardrailEngine.ts` 926,
  `langchain-connector/guardrails-handler.ts` 852) — deferred to dedicated refactor PR.
- `hasUnvalidatedTail()` not yet wired into individual connectors. Each connector currently
  accumulates streams with its own logic. A future change will refactor to use the helper and add an
  enforced lifecycle wrapper class.
- Connector packages depend on third-party SDKs (`openclaw`, `mastra-related`, etc.) with their own
  upstream advisories. These surface to consumers at install time and are not gated by the BonkLM CI
  audit.

### Installation

```bash
npm install @blackunicorn/bonklm
# or with a specific connector
npm install @blackunicorn/bonklm-openai @blackunicorn/bonklm
```

### Migration from v0.2.0

This is a coordinated release; nothing in the public API of `@blackunicorn/bonklm` changed in a
breaking way. Connectors that previously held v1.x version numbers are now at 0.3.0 alongside core.
If you pinned `bonklm-openai@1.1.0` etc., update to `^0.3.0`.

The Slack / Stripe / OpenAI fixtures in `secret.test.ts` were corrected to match the documented
regex shapes; if you depend on the wizard's CLI version string in tests or telemetry, note that it
now reflects the actual package version instead of `0.1.0`.

### Links

- CHANGELOG: [CHANGELOG.md](./CHANGELOG.md)
- Development notes: maintained internally (gitignored)
- Issue tracker: https://github.com/BlackUnicornSecurity/bonklm/issues
