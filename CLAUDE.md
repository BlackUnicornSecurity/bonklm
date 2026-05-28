# Claude AI Instructions

## Project Context

This is **BonkLM** — an LLM security guardrails library published as `@blackunicorn/bonklm`.
Framework-agnostic, provider-agnostic Node.js library for prompt-injection / jailbreak / secret /
PII / XSS / command-injection defense. Connector packages live under `packages/*`.

## General Principles

- Prefer deterministic over agentic; avoid uncontrolled loops.
- Back up the repo to `team/backups/` (timestamped) before starting a major change.
- Do not create folders without checking first if they exist.
- Dev / planning / QA / security artifacts → `team/` (gitignored).
- Public / user documentation → `docs/user/`.

## Mandatory Engineering Workflow (Definition of Done)

These rules are **binding on every contributor — human or agent — for all coding work.** They
override speed and convenience. "Done" means every clause below is satisfied with **evidence, not
assertion.** When a clause cannot be met, stop and surface it to the user; never silently skip.

The machine-checkable subset is bundled in `pnpm quality-gate` (`scripts/quality-gate.sh`), which
writes a timestamped evidence log under `team/qa/<version>/evidence/`. Running it is **necessary but
not sufficient** — the judgement clauses (context, audit-loop, docs, handover) are not automatable
and remain mandatory.

### Phase 0 — Context acquisition (before writing ANY code)

Never touch code before you understand the task and its blast radius:

1. **Study existing documentation first** — user docs (`docs/user/`), technical / architecture docs
   (`docs/`, `team/architecture/`), and `CONTRIBUTING.md`.
2. **Align to the implementation framework** — locate the current EPIC / story / steps in
   `team/implementation/` and the QA checklist in `team/qa/<version>/` (`02-master-checklist.md`,
   `06-epics-stories.md`). Confirm your task maps to a real, current item. **If no plan / checklist
   entry exists, create one and align it before coding.**
3. **Original source (port / upgrade work)** — if porting or updating from an upstream / original
   implementation, study the original code and behaviour before changing anything.
4. **The code you will touch** — read every file you intend to modify, plus its callers and
   dependents, end-to-end before editing. Goal: no spec deviation, no scope creep, no cascade bugs,
   no broken features.
5. **Read `team/lessonslearned.md`** (per Pre-Task Checklist) to avoid repeating known mistakes.

### Phase 1 — On doubt, check the knowledge base FIRST

When a question or uncertainty arises, before improvising: search `team/lessonslearned.md` and
`team/qa/<version>/` (defects `03-defects.md`, decisions `01-decisions.md`, risk register
`04-risk-register.md`) for whether the problem was already solved or a similar issue referenced.
Reuse the prior resolution; do not re-litigate settled decisions.

### Phase 2 — Implementation discipline

- Stick to the plan / spec. **No scope creep; no new features without user confirmation** (see
  Planning & Execution).
- Immutability — create new objects, never mutate.
- Factual integrity — never invent identifiers, IDs, names, or dates in code, comments, commits,
  docs, or handovers. No source → write `[unknown]` or ask.
- Leave no dead code, no half-finished implementations, no TODO-as-shipping.

### Phase 3 — Pre-PR gates (ALL required, LOCAL, evidence-based)

Gates are **proven locally before the PR — do not defer verification to CI** (CI mirrors these but
is not a substitute; no new CI/CD unless the user requests it). **Evidence-based only — unbacked
claims are not acceptable.** Run `pnpm quality-gate` (full) and keep the evidence log it emits.

1. **Documentation updated.** Update every doc class the change touches: user docs (`docs/user/`),
   project / technical / architecture docs, an ADR (`docs/contributing/adr/`) for load-bearing
   decisions, `team/lessonslearned.md`, and **mark the work done in the implementation framework**
   (master list + checklists). **Checklists are evidence-based: never tick a box before auditing the
   item for actual completeness.** All doc updates MUST obey the **Security disclosure policy**
   below — no incident specifics in public artifacts.
2. **Testing + coverage.** 100% coverage is the standard; less is not acceptable, **proven by the
   coverage report, not claimed.** The thresholds in `vitest.config.ts` are a ratchet floor — raise
   them toward 100%, never lower them. Tests MUST cover edge cases, behavioural regressions,
   flow-level failures, and auth / permission gaps. A test that still passes with the sanitizer
   removed is not a regression test (ADR-0001).
3. **Code quality.** Audit for efficiency and cleanliness; strict lint + format (`pnpm lint`,
   `pnpm format:check`); full type-check (`pnpm typecheck`) — no `any`, no runtime-type surprises.
4. **Security.** Run the R2-13 sandbox gate and dependency advisory review (`pnpm audit`); the
   internal `team/scripts/security-regression.sh` when present. Address every finding, **including
   low** — no postponing.
5. **Changeset + version.** Add a changeset for any user-visible change (`pnpm changeset:add`);
   follow the single-version monorepo + canonical-version rules in `CONTRIBUTING.md`.

### Phase 4 — Senior-persona audit-loop (MANDATORY before any PR)

After your own gates pass, run a review team of **senior personas** (dispatch in parallel;
**research / review only — reviewers never modify files**, per Planning & Execution). Every persona
**assumes the code was written by a junior and that all prior gates may have failed**:

- **Sr. developer** — code review: correctness, readability, idioms.
- **Sr. architect** — design / architecture review.
- **Adversarial auditor** — break it: abuse cases, hostile inputs.
- **Security auditor** — injection, secrets, PII, auth gaps, hook surface.
- **Documentation auditor** — docs / checklists accurate, complete, policy-compliant.
- **Adherence auditor** — was the spec respected? Partial or missed steps? Scope creep induced?
  Hallucinated behaviour? Dead code left?

Collect **all** findings (including low). The implementing agent fixes every one, then **re-runs the
gates AND the audit team. Loop until a clean pass with zero outstanding findings at any severity.**
Mandatory — no exceptions.

### Phase 5 — Closing & merge

**No closing / merge without full, complete closing gates** (Phases 3–4 green, all findings
resolved, checklist audited for completeness). A task closes only when everything passes, **or** a
hard breaker / loop is identified and documented in `team/lessonslearned.md` and the defect log.

### Phase 6 — Handover

- **After every PR, offer the user a handover** for the next agent: one self-contained prompt
  (context, what shipped, current state, next step, open risks). Template:
  `team/handoffs/_TEMPLATE.md`.
- **Every 5 PRs, create a handover automatically** and **surface to the user that they should start
  a fresh session** to maintain quality (fresh context window per major task).

### Subagent protocol

- When you spawn subagents, **stay in the foreground and report progress to the user at least every
  ~4 minutes** of wall-clock work (e.g. between agent batches). Never go silent for long stretches.
- Subagents are for **research / review only — they never modify files directly**; the orchestrating
  agent applies all changes.

## Pre-Task Checklist

- Read `team/lessonslearned.md` if it exists — avoid repeating past mistakes.
- Verify clean working directory before starting work.

## Planning & Execution

- Stick to the plan; do not improvise. No new features without user confirmation.
- For complex tasks, dispatch ≥3 agents in parallel for **research only** — agents never modify
  files directly.
- Fresh context windows for each major task / agent.
- Load only the necessary context for the current step.

## Quality & Security

- Always test what is built / fixed / changed before closing the task.
- Review dependencies after each change — imports, paths, package versions.
- 100% pass rate required: all tests green, all security issues addressed (including medium/low) —
  no postponing.
- Run security scan before committing.
- Close a task only when tests pass AND security issues are resolved, OR a breaker / loop is
  identified and documented.

### Security disclosure policy (HARDCODED — no exceptions)

**NEVER document security incidents in any public artifact.** This includes:

- `CHANGELOG.md` (ships to npm consumers + visible on GitHub)
- Per-package `README.md` (ships in npm tarball)
- `docs/` directory (ships on the public docs site)
- Public commit messages (visible on GitHub)
- Public-facing PR / Issue descriptions
- Any file outside the gitignored `team/` directory

Specifically, NEVER include in public artifacts:

- Specific scan-tool findings counts ("1 TRUE POSITIVE", "1,984 findings")
- Verbatim or partial leaked-secret values (`sk-ant-api03-...`, even after rotation)
- File paths to fixtures containing real secrets (`demo/<path>/.env.demo`)
- Defect IDs that map to security incidents (`D-008`, etc.)
- Rotation timelines or remediation specifics
- Tool versions used in the scan ("gitleaks v8.30.1")
- Commit SHAs of incident-related changes

Security-incident tracking belongs ONLY in the gitignored internal tree:

- `team/qa/<version>/03-defects.md` — full defect rows with verbatim finding evidence (gitignored —
  `team/` per project `.gitignore`)
- `team/qa/<version>/standups/` — coordinator standups (gitignored)
- `team/lessonslearned.md` — internal post-mortem (gitignored)
- `team/qa/<version>/evidence/` — full scan-output capture (gitignored)

Public `CHANGELOG.md` entries for security work MAY say things like: "Hardened sanitizer", "Added
regression coverage for known attack class", "Closed audit finding from internal review". They MUST
NOT identify specific fixtures, scan results, defect IDs, or remediation timelines.

If a security incident WAS publicly documented in past commits, history rewrite
(`git filter-repo --replace-text` or `--invert-paths`) is the appropriate remediation. Force-push to
`main` is the exception-pattern sanctioned for security incidents (otherwise forbidden per the
no-force- push rule).

Discovered + hardcoded 2026-05-27 by maintainer in response to a real incident.

## File Organization

- Place every file in its final folder on creation; do not clutter the root.
- `packages/core/` — main library
- `packages/*/` — connector packages (express, fastify, openai, anthropic, langchain, etc.)
- `packages/core/uat/` — UAT harness
- `packages/core/benchmarks/` — performance benchmarks
- `docs/user/` — user-facing docs
- `team/` — internal dev/QA/security artifacts (gitignored)
- Never commit secrets, PII, or `.env` files.

## Lessons Learned

- Always log mistakes to `team/lessonslearned.md` (cause, fix, takeaway).
- Always read it before starting a task.

## Next Steps

- When a task finishes, announce the next planned step.
