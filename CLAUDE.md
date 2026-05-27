# Claude AI Instructions

## Project Context

This is **BonkLM** — an LLM security guardrails library published as `@blackunicorn/bonklm`. Framework-agnostic, provider-agnostic Node.js library for prompt-injection / jailbreak / secret / PII / XSS / command-injection defense. Connector packages live under `packages/*`.

## General Principles

- Prefer deterministic over agentic; avoid uncontrolled loops.
- Back up the repo to `team/backups/` (timestamped) before starting a major change.
- Do not create folders without checking first if they exist.
- Dev / planning / QA / security artifacts → `team/` (gitignored).
- Public / user documentation → `docs/user/`.

## Pre-Task Checklist

- Read `team/lessonslearned.md` if it exists — avoid repeating past mistakes.
- Verify clean working directory before starting work.

## Planning & Execution

- Stick to the plan; do not improvise. No new features without user confirmation.
- For complex tasks, dispatch ≥3 agents in parallel for **research only** — agents never modify files directly.
- Fresh context windows for each major task / agent.
- Load only the necessary context for the current step.

## Quality & Security

- Always test what is built / fixed / changed before closing the task.
- Review dependencies after each change — imports, paths, package versions.
- 100% pass rate required: all tests green, all security issues addressed (including medium/low) — no postponing.
- Run security scan before committing.
- Close a task only when tests pass AND security issues are resolved, OR a breaker / loop is identified and documented.

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

- `team/qa/<version>/03-defects.md` — full defect rows with verbatim
  finding evidence (gitignored — `team/` per project `.gitignore`)
- `team/qa/<version>/standups/` — coordinator standups (gitignored)
- `team/lessonslearned.md` — internal post-mortem (gitignored)
- `team/qa/<version>/evidence/` — full scan-output capture (gitignored)

Public `CHANGELOG.md` entries for security work MAY say things like:
"Hardened sanitizer", "Added regression coverage for known attack class",
"Closed audit finding from internal review". They MUST NOT identify
specific fixtures, scan results, defect IDs, or remediation timelines.

If a security incident WAS publicly documented in past commits, history
rewrite (`git filter-repo --replace-text` or `--invert-paths`) is the
appropriate remediation. Force-push to `main` is the exception-pattern
sanctioned for security incidents (otherwise forbidden per the no-force-
push rule).

Discovered + hardcoded 2026-05-27 by maintainer in response to a real
incident.

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
