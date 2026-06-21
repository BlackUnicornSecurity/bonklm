---
id: bonklm-worktree-isolation
tier: tier-1-required
title: Worktree isolation (hardcoded per CLAUDE.md)
applies_to: [all]
priority: 5
---
All coding work on BonkLM happens in a dedicated git worktree — **one worktree per PR/branch, no exceptions**. This is not a best practice; it is hardcoded in the Definition of Done (CLAUDE.md, 2026-05-28).

**Workflow:**
1. Create the worktree **outside the repo** (e.g., sibling directory): `git worktree add ../bonklm-<slug> -b <type>/<slug>` where branch name follows commit-type convention (feat/, fix/, refactor/, docs/, etc.).
2. All work — edits, quality-gate runs, commits, push, PR — happens inside that worktree.
3. Clean up on merge: `git worktree remove ../bonklm-<slug>`, then `git branch -d <branch>` and prune stale metadata with `git worktree prune`.
4. Never leave orphaned worktrees. If a PR is abandoned, remove its worktree immediately.

The primary working tree stays on its base branch and clean — it is always a safe, known-good reference and parallel work never collides.
