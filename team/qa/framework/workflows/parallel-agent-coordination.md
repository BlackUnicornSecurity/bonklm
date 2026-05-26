# Parallel Agent Coordination Workflow

When 4+ Claude agents run in parallel on the same repo (typical during Sprint 53 — Gate 4 connector tier + Gate 5 sweep + Gate 6 CLI), they can race on shared files: `CHANGELOG.md`, root `package.json`, `pnpm-lock.yaml`, ADRs, `team/qa/<version>/02-master-checklist.md`. This workflow defines coordination to prevent merge conflicts, duplicate work, and silent overwrites.

## Conflict-prone shared files

Files multiple agents are likely to edit in the same sprint:

| File | Risk | Pattern |
|---|---|---|
| `CHANGELOG.md` | HIGH — every code change should append a `### Added/Changed/Fixed/Security` entry | Append-only — but section ordering matters |
| Root `package.json` | LOW — rarely edited mid-sprint | Workspace deps + scripts |
| `pnpm-lock.yaml` | MEDIUM — auto-regenerated, but multi-agent installs collide | Concurrent `pnpm install` corrupts |
| `team/qa/1.0.0/02-master-checklist.md` | HIGH — every agent ticks at least one box | Checkbox state + evidence link |
| `team/qa/1.0.0/03-defects.md` | MEDIUM — new defect rows from any agent | Append-only |
| `team/qa/1.0.0/standups/<date>.md` | HIGH — multiple agents log "Today" + "Blockers" | Append-only per agent |
| `docs/contributing/adr/0001-log-sanitization.md` | HIGH — security agents update Status line | Single-line edits race |
| `team/lessonslearned.md` | MEDIUM — security agents add Sprint-N entries | Append-only per Sprint |
| Per-package `package.json` (workspace) | LOW — usually one agent per package | Engines + exports + version |
| `team/qa/scripts/*.sh` | LOW — only edited when script needs change | Single-file each |

## Coordination protocol

### 1. Agent registration

Before dispatching parallel agents, the release engineer registers each in `team/qa/1.0.0/standups/<date>-dispatch.md`:

```markdown
# Sprint 51 Day 3 — Parallel Dispatch — 2026-05-28T10:00:00Z

| Agent slot | Story IDs | Scope (file paths) | Estimated duration | Owner alias |
|---|---|---|---|---|
| A | ST-01-001 | packages/{bonklm-server,browser-agents-core,...}/package.json (22 files) | 30 min | agent-A-engines |
| B | ST-01-005 | packages/{openai-connector,google-genai-connector,...}/LICENSE (26 files) | 45 min | agent-B-license |
| C | ST-01-006 | packages/{hono-middleware,elysia-plugin,...}/README.md (12 files) | 60 min | agent-C-readme |
| D | ST-05-101 | packages/core/src/validators/prompt-injection.ts + test | 90 min | agent-D-b1 |
```

The dispatch file ESTABLISHES file ownership for the wave. If an agent needs to touch a file outside its declared scope, it MUST pause + escalate before editing.

### 2. Lock-file convention (optional but recommended for shared files)

For HIGH-conflict files (CHANGELOG, master-checklist, ADRs), the agent prefixes its edit session with:

```bash
# Acquire write intent
echo "agent-A-engines: $(date -u +%Y-%m-%dT%H-%M-%SZ)" >> .qa-locks/CHANGELOG.md.lock
# Verify no other agent claims:
cat .qa-locks/CHANGELOG.md.lock
# Edit the file
# Release lock
sed -i.bak '/^agent-A-engines:/d' .qa-locks/CHANGELOG.md.lock
rm .qa-locks/CHANGELOG.md.lock.bak
```

The `.qa-locks/` directory is gitignored. Lock files are short-lived (< 5 min per edit). If two agents both write to the same lock file simultaneously, the LATER timestamp wins on re-merge.

Realistically, for a 1-engineer team with serial human review between agent batches, locks are over-engineering. Use the registration discipline instead.

### 3. Append-only convention for shared logs

For files where every agent appends:

- `CHANGELOG.md` `### Section` entries → APPEND with a sentinel comment so the section can be re-sorted later:
  ```markdown
  <!-- AGENT-A-2026-05-28T10:30 -->
  - Normalized engines.node to >=20.4.0 across 22 packages
  ```
- `standups/<date>.md` → each agent appends a `## Agent <id>` section
- `defects.md` → each agent appends a new row with an UUID-style ID

After all agents complete in the wave, the release engineer (or a senior-QA agent in cleanup mode) re-sorts + dedupes + removes sentinel comments.

### 4. Single-writer convention for critical files

The following files have AT MOST ONE writer per sprint:

- `00-meta-plan.md` — release engineer only
- `01-decisions.md` — release engineer or senior QA
- `05-senior-qa-signoff.md` — senior QA only
- ADRs — single author per ADR; concurrent edits to the SAME ADR are forbidden
- `02-master-checklist.md` summary headers (dashboard table) — release engineer only; individual checkbox rows can be edited by the owning agent

Agents that would modify a single-writer file MUST escalate to the writer instead.

### 5. `pnpm install` serialization

`pnpm install` writes `pnpm-lock.yaml` + populates `node_modules/`. Two concurrent `pnpm install` runs in the same workspace WILL corrupt the lockfile or `node_modules`.

Protocol:
- Only the release engineer runs workspace-level `pnpm install`
- Agents that edit `package.json` files SCHEDULE the install: append `INSTALL_PENDING` to `.qa-locks/install-queue.txt`
- After all agents in a wave complete, the release engineer runs `pnpm install` once + verifies clean

### 6. Per-package edits

When multiple agents edit different files within the SAME package (e.g. agent edits `src/`, agent edits `package.json`, agent edits `README.md`):
- Each agent's commits are isolated to their own files within the package
- `pnpm typecheck` + `pnpm test --filter <package>` after all agents complete
- Defer cross-cutting validation to wave-end

### 7. Conflict resolution

When git surfaces a merge conflict:

1. The agent that LATER wrote conflicts: pauses, escalates to release engineer
2. Release engineer reads both agent's intents (from standup + commit message)
3. Resolves manually, picking the correct merge (usually keep BOTH changes via a 3-way merge)
4. Commits the resolution with `Resolved: <agent-A> + <agent-B>` annotation
5. Re-runs `pnpm typecheck` + relevant tests
6. Re-dispatches affected agents if necessary

### 8. "Who edits X last wins" — explicit anti-pattern

NEVER rely on "last commit wins" semantics for shared files. Always use the registration + lock + append conventions above. Last-wins silently loses earlier agents' work.

## Recommended parallelism for v1.0.0

Per the senior QA review + parallel-agent coordination above:

| Sprint | Wave structure | Parallelism |
|---|---|---|
| 51 | 3 waves: file-disjoint Gate-1 work; then sequential hard blocks; then sequential code-review fixes | Wave 1: 4 agents (engines / LICENSE / README / B.1). Wave 2: 4 agents (exports / openclaw / CHANGELOG / HB-1). Wave 3: sequential single-agent for HB-2..HB-5 + B.x |
| 52 | 2 waves: install + dry-run (sequential, single agent), then runtime matrix (4 parallel runtime smokes) | Wave 1: 1 agent (ST-02-001..009 serially). Wave 2: 4 agents (Node 20.4 / 22 / 24 / edge) |
| 53 | 5 waves: connector tier-batches (4 agents per batch); then security sub-gates (parallel after HB done); then CLI (sequential) | Wave 1-4: 4 agents × 13 connectors per wave = 52 connectors total. Wave 5: 5 parallel sub-gates 5.6-5.10 + dojoLM replay |
| 54 | 2 waves: docs + perf in parallel; then supply chain + tag (sequential) | Wave 1: 4 parallel (doc compile sweep / public-API audit / quickstart / perf bench). Wave 2: sequential tag + publish |
| 55 | No parallelism — single engineer running monitoring + retro | n/a |

## Failure mode: agent silently overwrites another's work

If detected (via `git log` review at wave-end showing the same file edited by 2 agents with no merge commit):
1. Open a P1 defect immediately
2. Roll back to pre-wave commit
3. Re-dispatch with explicit scope boundaries
4. Document the root cause in `team/lessonslearned.md`

This has not yet been observed in 8 sprints of post-rc.3 work, but the pattern is documented as a known risk.

## Cross-references

- Sprint dispatch order: `../../1.0.0/RUNBOOK-DAY-1.md` § C.2
- Story dependencies: `../../1.0.0/06-epics-stories.md` § Critical path
- Cascade workflow (post-edit): `cascade-update-workflow.md`
- Doc-sync workflow (post-edit): `doc-sync-workflow.md`
- Retest workflow (post-fix): `retest-workflow.md`
