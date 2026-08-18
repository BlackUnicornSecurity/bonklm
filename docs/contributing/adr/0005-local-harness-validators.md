# ADR-0005: Local-harness security validators (self-contained, fail-open, kill-switch)

> Status: Accepted (2026-06-10). Scope: this repository's Claude Code agent harness
> (`.claude/validators-node/`) — NOT the published `@blackunicorn/bonklm` library. Authority:
> maintainer decision ("implement real validators, long-term, full coverage"). The repository's
> internal security-regression control requires a set of hook validators that were not present; this
> ADR records how they were built.

## Problem

`.claude/settings.json` wires Claude Code hooks (`PreToolUse` / `UserPromptSubmit`) to validator
scripts under `.claude/validators-node/bin/`, and the repo's security-regression gate asserts those
scripts exist and pass. The scripts were absent, so the gate could not pass and the declared hooks
were inert. The harness needs real validators that guard a developer's agent sessions (catastrophic
commands, secret/credential writes, PII, sensitive-file tampering, prompt manipulation) without
becoming a liability themselves: the hooks fire on nearly every tool call, so a buggy or heavyweight
guard could brick a session.

An earlier standalone validator package existed in history but was deliberately removed;
resurrecting it (heavy dependencies, a build step, dozens of entrypoints) would re-introduce what
was dropped.

## Decision

1. **Self-contained, zero-dependency, no build step.** Each validator is plain ESM JavaScript run
   directly by `node`, with logic in `lib/**` and 3-ish-line `bin/*.js` shims. No cross-package
   import of the built library, no compile step. Rationale: the guard must run correctly in any
   checkout — including before `pnpm install` / `pnpm build` — so it can never be silently disabled
   by a missing or stale build artifact. The subtree is excluded from the pnpm workspace and the
   root lint/format/typecheck/test, and is validated by its own `vitest.config.js` (the
   `tools/eslint-plugin-bonklm-edge` precedent), held at 100% coverage on `lib/**` with the I/O
   boundary integration-tested.

2. **Fail open, block only on confidence, with a kill-switch.** A validator that throws or cannot
   parse its input returns ALLOW (exit 0) with a diagnostic on stderr — a validator bug must never
   block the agent. It blocks (exit 2) only on a confident, specific match. Heuristic content guards
   that this repo legitimately triggers (it authors attack fixtures) are advisory (warn, exit 0). A
   global kill-switch — env var `BONKLM_VALIDATORS_DISABLED` or a gitignored sentinel file
   `state/DISABLED` — disables every validator at once, as the documented lockout escape hatch. No
   single-use override-token system is ported; the kill-switch is the one escape mechanism.

3. **Validators are co-located; the authorization hook is relocated.** All ten validators live under
   `.claude/validators-node/bin/`. The Skill-authorization hook previously pointed at a path this
   monorepo has no tree for; it is relocated to `.claude/validators-node/bin/authorization.js`, with
   `.claude/settings.json` and the security-regression script updated in lockstep.

## Consequences

- The guard layer is robust and cheap to reason about, but **fail-open is a conscious trade-off**: a
  payload that reliably makes a blocking validator _throw_ becomes an ALLOW. This is acceptable for
  a local, single-developer harness where the guards are defense-in-depth and operational resilience
  outranks paranoid fail-closed — bricking every tool call is the worse failure.
- `bash-safety` is a best-effort guard, not a shell sandbox (regex/tokenization cannot model every
  shell construct); determined obfuscation can evade it.
- The kill-switch is intentionally easy to trip, so it cannot defend against an already-compromised
  agent that writes the sentinel itself — out of scope for a local fail-open design.
- The standalone `settings-integrity` check fails closed (exit 1) and is **not** subject to the
  kill-switch, because it is a gate control, not a per-tool hook.
- `settings.json` still references additional harness hooks that are not yet implemented; those fail
  open (unchanged) and are tracked separately.

### Deferred

- Implementing the remaining referenced harness hooks; an on-disk existence check for every wired
  hook command; wiring `supply-chain` on `Bash` (where installs run) and broadening its denylist
  beyond the current illustrative set.
