# `tools/*` Workspace Policy

> **Status**: Authoritative for additions under `tools/*/`. Adopted at Story
> 2.1b-connector-style-ADR (Sprint 11, v0.5.0). **Audience**: contributors adding new tooling
> packages under `tools/`.

This document is the longform reference for the per-`tools/*` allowlist policy sketched in
`team/plans/2026-05-21-v0.4-v0.7-roadmap-FINAL.md` (Story 2.1b section, "Per-`tools/*`
publish-policy split"). PR reviewers consult this when approving any new `tools/<name>/` directory;
the in-PR checklist embedded in Story 2.1b's AC text remains the authoritative gate.

---

## Why `tools/` exists

`tools/` houses BonkLM's internal tooling packages: ESLint plugins, CI scripts, audit baselines,
workspace-policy enforcement. These are NOT consumer-facing packages and most of them MUST NOT
publish to npm.

`tools/` is registered as a pnpm workspace via `pnpm-workspace.yaml`'s `tools/*` entry (added at
Sprint 12 day 1). It is NOT covered by the repo-root `.gitignore` exclusion of `team/`; everything
under `tools/` is committed.

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

> **Interim Sprint-11 status (2026-05-22)**: the programmatic enforcement script
> `tools/check-workspace-policy.js` ships at Sprint 12 day 1 (per the Story 2.1b roadmap section
> "Programmatic tier-enforcement script"). During Sprint 11 the reviewer checklist below is the ONLY
> enforcement gate; new `tools/<name>/` additions during this window require explicit reviewer
> sign-off acknowledging the missing CI check. Block new `tools/<name>/` additions during Sprint 11
> unless they are part of Story 2.1b itself (`tools/audit-baselines/`, future ESLint plugin
> scaffold).

Sprint 12 ships `tools/check-workspace-policy.js`, a CI script that enumerates every
`tools/*/package.json` and asserts:

1. EITHER `"private": true` (Tier A) OR `"workspacePolicy": "tier-b-publishable"` with non-empty
   `"publishJustification"` AND non-empty `"files"` AND `"name"` starting with `@blackunicorn/`.
2. NO `packages/*/package.json` lists a Tier A `tools/*` package in `dependencies` or
   `peerDependencies` (only `devDependencies` permitted).

CI fails the build on any violation. The reviewer checklist below is a SECONDARY gate; the script is
the primary enforcement.

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

Some Tier A packages commit allowlist files enumerating internal violations (e.g.
`tools/eslint-plugin-bonklm-edge/grandfather-allowlist.json`). These files are necessary for CI to
consume the allowlist but they are also publicly visible in the repository.

Triage discipline: do NOT cross-reference specific file paths from the allowlist in public GitHub
issues, community Discord, or PR descriptions visible to external contributors. Internal PR
comments + private Slack threads are acceptable. The Sprint 12-13 ERROR-escalation window is
bounded; Sprint 13 day 1 the allowlist file is deleted as part of the rotation.

---

## Cross-references

- `team/plans/2026-05-21-v0.4-v0.7-roadmap-FINAL.md` — Story 2.1b section, "Per-`tools/*`
  publish-policy split" + "Programmatic tier-enforcement script".
- `docs/user/connector-style-guide.md` — the canonical connector ADR; references this file under
  "Cross-references".

## Amendment history

| Date       | Story                          | Change                                                                                                           |
| ---------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 2026-05-22 | Story 2.1b-connector-style-ADR | Initial authoring. Tier A / Tier B classification, programmatic enforcement, reviewer checklist, triage hygiene. |
