# Gate Template

Single-gate skeleton. Each gate in `00-meta-plan.md` uses this exact shape so future Claude agents parse them uniformly.

## Gate `{{ID}}` — `{{NAME}}`

### Purpose
One sentence: what this gate proves and why it ship-blocks if it fails.

### Test surface
- File paths (cite line numbers where the surface lives)
- Commands the gate executes
- Scenarios / fixtures consumed

### PASS criteria (binary)
Numbered list. Each criterion:
- Is measurable from evidence
- Has a single PASS / FAIL determination
- References the file or command that produces the determination

Example shape:
1. `pnpm --filter @blackunicorn/bonklm test:unit` exits 0 and reports ≥ {{COUNT}} passing
2. `tar tf packages/core/*.tgz` contains `package/dist/bin/run.js` with mode `0755`
3. `grep -r 'process.env' packages/core/dist/` returns 0 matches

### Owner
- Execution owner: `{{Claude agent type | human role}}`
- Failure-mode escalation owner: `{{Senior QA | Security reviewer | Release engineer}}`

### Effort
- `S` (< 1 sprint) | `M` (1 sprint) | `L` (multi-sprint)
- Story-point estimate: `{{N}}`

### Blockers
- Decisions required (link to `01-decisions.md` D-IDs)
- External prerequisites (Battlefield reachable, dojoLM corpus mounted, etc.)
- Predecessor gates / stories

### Failure-mode triage
For each PASS criterion, state what to do if it fails:
- Criterion 1 fail → fix path (story ID) + retest scope (which regression-set rerun)
- Criterion 2 fail → escalation chain
- General-mode: if the gate fails in a way not anticipated, file a defect under `03-defects.md` with severity per `policies/defect-taxonomy.md`

### Evidence location
- `team/qa/{{VERSION}}/evidence/gate-{{ID}}/`
- Required artifacts:
  - `{{timestamp}}_{{command}}.{{ext}}` (raw command output)
  - `{{timestamp}}_summary.json` (structured PASS / FAIL per criterion)
  - `{{timestamp}}_notes.md` (human commentary, deviations, surprises)
- Evidence retention: see `templates/evidence-conventions.md`

### Sprint + story assignments
- Sprint: `{{N}}`
- Stories: `ST-{{ID}}-001 … ST-{{ID}}-NNN`
- Critical path? `yes | no`

### Cascade-update scope
After any fix in this gate's surface, run `workflows/cascade-update-workflow.md` against:
- `{{list of dependent code paths}}`
- `{{list of dependent docs}}`
- `{{list of dependent ADRs}}`

### Doc-sync scope
At gate close, run `workflows/doc-sync-workflow.md` against:
- `docs/user/{{relevant subpath}}`
- `CHANGELOG.md` (relevant section)
- `team/lessonslearned.md` (if a lesson emerged)
- ADRs touched

---

## Worked example — Gate 1 / ST-01-001 (engines.node normalization)

The skeleton above with every field filled. Use this as a sanity check when authoring your own gate.

### Purpose
Normalize `engines.node` declarations across the workspace so consumers cannot install on runtimes the `StreamValidator` rejects at boot. Without this, an `npm install` on Node 20.3 silently succeeds; first runtime call crashes with `StreamValidator: Node 20.4+ required`.

### Test surface
- `packages/anthropic-connector/package.json` line 39 — `"node": ">=20.4.0"` (already correct)
- `packages/bonklm-server/package.json` line 27 — `"node": ">=20.0.0"` ← stale
- `packages/browser-agents-core/package.json` line 32 — `"node": ">=20.0.0"` ← stale
- `packages/cloudflare-agents-connector/package.json` line 35 — stale
- … 22-25 packages total flagged by `team/qa/scripts/check-version-pin.sh --field engines.node`
- Command: `grep '"node"' packages/*/package.json | awk -F'"' '{print $4, $2}' | sort -u`

### PASS criteria (binary)
1. `grep -hE '"node"\s*:' packages/*/package.json | sort -u` returns exactly one line: `"node": ">=20.4.0"` (or, with surrounding context, only one distinct value).
2. `pnpm install` from clean `node_modules/` on Node 20.3 fails with `EBADENGINE` for every flagged package.
3. `pnpm install` succeeds on Node 20.4.
4. `pnpm typecheck` exit 0 (no consumer broke).
5. `pnpm test` exit 0 with count ≥ rc.3 baseline (4892/4908).

### Owner
- Execution: Claude `general-purpose` agent — single batch, 22 file edits
- Failure-mode escalation: Senior QA (if a package CANNOT move to 20.4 — e.g., it has a peer that mandates 20.0 — escalate for sign-off on a deliberate exception)

### Effort
- S (< 1 day with agent + human review)
- Story-point estimate: 3

### Blockers
- D-1 resolved (`>=20.4.0` per release engineer 2026-05-25)
- None other

### Failure-mode triage
- Criterion 1 fail → re-run agent edit on the missed package; check if the file has `engines.node` declared in a non-standard location (e.g. inside a sub-block)
- Criterion 2 fail → the engines field is being ignored by pnpm; check `.npmrc` for `engine-strict=false`; if so, set `engine-strict=true` for this check
- Criterion 3 fail → a package incorrectly declares `>=20.5` or higher; bisect
- Criterion 4 fail → a consumer of a moved package broke; revert that specific package OR fix consumer + cascade per `workflows/cascade-update-workflow.md`
- Criterion 5 fail → a test relies on engines.node; bisect; most likely a test that reads the field directly

### Evidence location
- `team/qa/1.0.0/evidence/gate-1/ST-01-001/`
- Required artifacts:
  - `2026-05-26T10-00-00Z_engines-before.json` (grep snapshot before edits)
  - `2026-05-26T10-15-00Z_engines-after.json` (grep snapshot after edits — proves criterion 1)
  - `2026-05-26T10-20-00Z_ebadengine-node-20.3.log` (criterion 2 evidence)
  - `2026-05-26T10-25-00Z_install-node-20.4.log` (criterion 3 evidence)
  - `2026-05-26T10-30-00Z_typecheck.log` (criterion 4 evidence)
  - `2026-05-26T10-45-00Z_test.json` (Vitest JSON output — criterion 5 evidence)
  - `2026-05-26T11-00-00Z_summary.md` (PASS verdict + reviewer)

### Sprint + story assignments
- Sprint: 51
- Stories: ST-01-001 (this gate's only story)
- Critical path? **YES** — blocks Gate 2 install harness on Node 20.4 (ST-02-005)

### Cascade-update scope
After the engines edit, run `workflows/cascade-update-workflow.md` against:
- Code: `packages/**/src/` — grep for `node:` minimum-version checks at runtime
- Docs: `docs/user/installation.md` (Node-floor note); per-package READMEs that quote a Node version; root README badges
- CHANGELOG: `### Changed` entry — "Engine floor normalized to Node 20.4 across workspace"
- Lessons: `team/lessonslearned.md` — add Sprint-51 entry "engines.node sweep — affected 22 packages, no consumer fallout"
- ADRs: none touched

### Doc-sync scope
At gate close, run `workflows/doc-sync-workflow.md` against:
- `docs/user/installation.md` (verify Node-floor note matches new value)
- `packages/*/README.md` (12 packages with explicit Node mention — update version string)
- `CHANGELOG.md` `### Changed` entry verified
- `team/lessonslearned.md` Sprint-51 anchor verified

### Filled sign-off (after close)

```markdown
### Sign-off — Senior QA
- **Signer:** Claude `general-purpose` subagent — persona: Senior QA engineer
- **Agent session ID:** a7a7ac6f8dee8ef37
- **Claude model:** claude-opus-4.7
- **Date:** 2026-05-26T11:05:00Z
- **HEAD at dispatch:** 14c31f6
- **Transcript:** `evidence/agent-transcripts/2026-05-26T11-05-00Z_senior-qa_gate-1.json`
- **Transcript SHA-256:** a3f4...d927
- **Verdict:** PASS
- **Notes:** All 5 criteria green; 22 packages edited; one false-positive on `wizard` (which is private) flagged + ignored.
```
