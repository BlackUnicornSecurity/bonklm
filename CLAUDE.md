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
