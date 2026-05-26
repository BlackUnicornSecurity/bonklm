# Defect Taxonomy

Severity, priority, and SLA for defects raised during release QA. Per `CLAUDE.md`, no severity ships open: 100 % resolution required including medium and low.

## Severity definitions

| Severity | Definition | Resolution SLA | Ships open? |
|---|---|---|---|
| **P0 — Critical** | Security exploit reachable; data loss; CLI crash on happy path; secret leaked to tarball; build broken; pnpm install fails | Same-day fix or stop ship | NO (hard stop) |
| **P1 — High** | Documented behavior broken; CWE class regression; any PASS criterion failed on any gate; consumer-facing breaking change without intent | Fix before ship | NO |
| **P2 — Medium** | Documented behavior degraded; perf regression > 20 %; doc example fails to compile; missing telemetry event; secondary path error | Fix before ship per CLAUDE.md | NO |
| **P3 — Low** | Cosmetic; typo; missing JSDoc; non-blocking warning; minor UI nit | Fix before ship per CLAUDE.md | NO |
| **Info** | Observation only, no action needed (recorded for posterity) | None | N/A |

## Priority (orthogonal to severity)

Priority sequences the fix order WITHIN a severity tier. P0/P1 fix order is dictated by ship-block urgency; P2/P3 fix order is dictated by dependency chains and effort.

| Priority | Meaning |
|---|---|
| **Urgent** | Fix next (top of P0/P1 queue) |
| **Normal** | Fix in current sprint |
| **Low** | Fix before ship, sprint flexible |

## Defect-to-gate mapping

Every defect carries `gate: <1..10 | hard-block>` so the master checklist regenerates "which gate blocks ship" automatically.

Examples:
- `gate: 1` — package coherence (engines, exports, LICENSE, README)
- `gate: 4` — connector smoke (per-connector test fails)
- `gate: 5` — security regression (CWE-117 residual, override-token bypass, etc.)
- `gate: 7` — documentation (doc-code mismatch, broken link)
- `gate: hard-block` — one of the 5 pre-publish hard blocks (escalation: stop all downstream work)

## Status workflow

```
open ─► triaged ─► in-progress ─► awaiting-retest ─► closed
                            │             │
                            ▼             ▼
                       blocked       reopened
```

- `open`: just filed, not yet triaged
- `triaged`: severity + priority + gate assigned; owner named
- `in-progress`: owner actively fixing
- `blocked`: owner is waiting on external input (decision, agent, deployment)
- `awaiting-retest`: fix merged, retest workflow not yet complete
- `closed`: retest passed AND cascade + doc-sync logged
- `reopened`: retest failed OR a related issue surfaced; defect re-enters in-progress

## Schema (markdown table in `03-defects.md`)

```markdown
| id | severity | priority | gate | symptom | root cause | owner | fix commit | retest evidence | status |
|----|----------|----------|------|---------|------------|-------|------------|------------------|--------|
| D-001 | P0 | Urgent | hard-block | OverrideToken replay-cache starvation | FIFO eviction admits replayed nonce | claude:security-reviewer | abc1234 | evidence/gate-5/retest-D-001/ | closed |
```

## Special handling

### Hard blocks

The 5 pre-publish hard blocks listed in `09-security-addendum.md` (or equivalent per release) are P0 with priority Urgent. They CANNOT enter `closed` without:
- Retest workflow complete
- Security code reviewer agent re-pass
- ADR-0001 (or relevant ADR) cross-reference updated
- `lessonslearned.md` entry

If a hard block surfaces mid-release, ALL downstream work halts. Senior QA + security code reviewer convene; no resumption without written PASS evidence.

### Conditional passes

A P2 or P3 defect can be moved to status `accepted` (NOT closed) only by explicit senior-QA + Black Unicorn maintainer sign-off in `04-risk-register.md`. Acceptance must include:
- Rationale
- Customer-impact assessment
- Follow-up story ID for the next release

P0 and P1 are never accepted. They are fixed.

### Escalation

| Trigger | Escalate to |
|---|---|
| P0 open > 8h | Senior QA |
| P1 open > 24h | Senior QA + scrum master |
| Hard block open > 4h | Senior QA + security code reviewer + halt downstream |
| Retest fails twice | Architect reviewer + senior QA |
| Defect cannot be reproduced | Reporter + senior QA — may downgrade to Info with explicit rationale |

## Metrics

Per-release tracked in `02-master-checklist.md` summary:
- Total defects filed
- Defects by severity (P0 / P1 / P2 / P3 / Info)
- Defects by gate
- Mean time to triage
- Mean time to fix (per severity)
- Mean retest count (1 = green first try)
- Accepted-defect count (must be 0 for P0/P1)

## Audit

Every defect has a git-traceable audit:
- Filed-at: commit that added the defect row
- Triaged-at: commit that filled severity / priority / gate / owner
- Fixed-at: commit referenced in `fix commit` column
- Retested-at: commit that added the retest-log entry
- Closed-at: commit that flipped status to `closed`

If any of these are missing, the defect is not fully tracked and surfaces in the senior-QA audit.
