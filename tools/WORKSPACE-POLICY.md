# `tools/*` Workspace Policy

> **Status**: Authoritative for additions under `tools/*/`. Adopted at Story
> 2.1b-connector-style-ADR (Sprint 11, v0.5.0). **Audience**: contributors adding new tooling
> packages under `tools/`.

This document is the longform reference for the per-`tools/*` allowlist policy. PR reviewers consult
this when approving any new `tools/<name>/` directory; the `tools/check-workspace-policy.js` gate
(see "Programmatic enforcement") is the authoritative _mechanical_ gate, and the in-PR reviewer
checklist is the secondary human gate.

---

## Why `tools/` exists

`tools/` houses BonkLM's internal tooling packages: ESLint plugins, CI scripts, audit baselines,
workspace-policy enforcement. These are NOT consumer-facing packages and most of them MUST NOT
publish to npm.

`tools/` is registered as a pnpm workspace via `pnpm-workspace.yaml`'s `tools/*` entry (added under
Story 2.1b). It is NOT covered by the repo-root `.gitignore` exclusion of `team/`; everything under
`tools/` is committed.

---

## Tier A — INTERNAL-ONLY (default)

A new `tools/<name>/` package defaults to Tier A. Tier A requires:

- `package.json` MUST contain `"private": true`. The pnpm publish workflow refuses to publish
  private packages, blocking accidental npm publication.
- The package is consumed only via monorepo workspace `devDependencies` references (e.g.
  `"@blackunicorn/eslint-plugin-edge": "workspace:*"`).
- The package MUST NOT be listed in any `packages/*/package.json`'s `dependencies` or
  `peerDependencies` — only `devDependencies`. This prevents accidental shipping to consumers via
  transitive runtime resolution.

Tier A is the right choice for: CI scripts (`tools/check-workspace-policy.js`), audit baselines
(`tools/audit-baselines/*.md`), internal codegen tools, lint-rule sets that BonkLM applies to its
own code but does not expose to consumers.

## Tier B — PUBLISHABLE (explicit opt-in)

A new `tools/<name>/` package may opt into Tier B by EXPLICIT declaration. Tier B requires:

- `package.json` MUST NOT contain `"private": true` (omit the field, or set `"private": false`).
- `package.json` MUST contain a top-level `"workspacePolicy": "tier-b-publishable"` declaration.
- `package.json` MUST contain a top-level `"publishJustification": "<reason>"` string explaining why
  this package is consumer-facing (e.g. "ESLint plugin consumed by downstream connector authors to
  enforce the same edge-runtime policy BonkLM applies internally").
- `package.json` MUST contain a `"files": [...]` field explicitly enumerating what gets shipped in
  the npm tarball. Internal-only assets (allowlists, test fixtures, internal baselines) MUST be
  EXCLUDED from this list.
- `package.json` MUST contain a `"name"` starting with `@blackunicorn/`.

Tier B is the right choice for: `tools/eslint-plugin-bonklm-edge/` (consumed by downstream connector
authors to lint their own edge-reachable code), future publishable codegen tools.

## Programmatic enforcement

`tools/check-workspace-policy.js` is the primary enforcement gate. It enumerates every
`tools/*/package.json` and asserts:

1. EITHER `"private": true` (Tier A) OR `"workspacePolicy": "tier-b-publishable"` with non-empty
   `"publishJustification"` AND non-empty `"files"` AND `"name"` starting with `@blackunicorn/`.
2. NO `packages/*/package.json` lists a Tier A `tools/*` package in `dependencies`,
   `peerDependencies`, or `optionalDependencies` (only `devDependencies` permitted).

A violation exits the script non-zero and fails the build. The check is wired in three places, so it
runs on every PR and on every local pre-PR gate:

- the dependency-free `workspace-policy` job in `.github/workflows/ci.yml` (no `pnpm install` or
  build needed — it only reads `package.json` files);
- the local quality gate (`scripts/quality-gate.sh`);
- the root `pnpm run check:workspace-policy` script — run it locally to reproduce a CI failure.

The gate's own Tier A / Tier B branches are covered to 100% by
`tools/check-workspace-policy.test.ts`. The reviewer checklist below is a SECONDARY gate; the script
is the primary enforcement.

## Reviewer checklist for new `tools/<name>/` additions

The PR adding any new `tools/<name>/` directory MUST satisfy:

- [ ] Tier declaration (A or B) stated in the PR description.
- [ ] Tier A: `private: true` in `package.json`.
- [ ] Tier B: `workspacePolicy`, `publishJustification`, `files`, scoped `name` all present.
- [ ] No consumer packages list the new tool as `dependencies` / `peerDependencies` (unless Tier B
      and intentional).
- [ ] Tools-vs-packages placement justified in PR description.
- [ ] `tools/check-workspace-policy.js` CI step PASSES (catches mechanical violations).

## Triage hygiene for committed allowlists

A Tier A package may commit an allowlist file enumerating internal violations. Such files are
necessary for CI to consume the allowlist but they are also publicly visible in the repository.

Triage discipline: do NOT cross-reference specific file paths from a committed allowlist in public
GitHub issues, community Discord, or PR descriptions visible to external contributors. Internal PR
comments + private Slack threads are acceptable.

`tools/eslint-plugin-bonklm-edge/` previously carried a `grandfather-allowlist.json` under this
policy; its ERROR-escalation window closed and the allowlist file was deleted as part of the
rotation.

---

## Cross-references

- `docs/user/connector-style-guide.md` — the canonical connector ADR; references this file under
  "Cross-references".

## Amendment history

| Date       | Story                           | Change                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-22 | Story 2.1b-connector-style-ADR  | Initial authoring. Tier A / Tier B classification, programmatic enforcement, reviewer checklist, triage hygiene.                                                                                                                                                    |
| 2026-06-11 | chore/ci-guard-workspace-policy | Wired `check-workspace-policy.js` into CI (the `workspace-policy` job), the local quality gate, and `pnpm run check:workspace-policy`; added 100%-covered tests. "Programmatic enforcement" section updated from aspirational (Sprint 12) to present-tense reality. |
| 2026-06-11 | Documentation accuracy audit    | Replaced unverifiable "Sprint 12 day 1" provenance for the `tools/*` workspace entry with a Story 2.1b reference; rewrote the committed-allowlist triage subsection to past tense after the `grandfather-allowlist.json` rotation completed.                        |
