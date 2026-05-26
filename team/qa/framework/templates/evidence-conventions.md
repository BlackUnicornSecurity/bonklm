# Evidence Conventions

Every QA task produces evidence. Evidence must be reproducible by a third-party auditor from a clean checkout in ≤ 30 minutes.

## Storage layout

```
team/qa/<version>/evidence/
├── gate-1/
│   ├── ST-01-001/
│   │   ├── 2026-MM-DDTHH-MM-SSZ_grep-stale-engines.txt
│   │   ├── 2026-MM-DDTHH-MM-SSZ_engines-after.json
│   │   ├── 2026-MM-DDTHH-MM-SSZ_pnpm-typecheck.log
│   │   └── 2026-MM-DDTHH-MM-SSZ_summary.md
│   ├── ST-01-002/
│   └── ...
├── gate-2/
└── ...
```

One directory per story (`ST-{GATE}-{NNN}`). Story IDs match `06-epics-stories.md`.

## Naming convention

`<UTC-ISO-timestamp>_<short-description>.<ext>`

Examples:
- `2026-05-26T14-32-00Z_npm-pack-core.json`
- `2026-05-26T14-33-12Z_strict-ts-resolve.log`
- `2026-05-26T14-35-00Z_summary.md`

Retest evidence: `<UTC-ISO-timestamp>_retest-<defect-id>_<short-description>.<ext>`

Example: `2026-05-27T09-15-00Z_retest-D-042_override-token-replay.log`

## Required formats by evidence type

| Evidence type | Preferred format | Fallback |
|---|---|---|
| Test results | Vitest JSON reporter (`--reporter=json`) | console log |
| Coverage | `vitest --coverage --reporter=json-summary` + HTML | text summary |
| `npm pack` content | `tar tf <file>.tgz` text + `npm pack --json` | text log |
| `npm publish --dry-run` | `--json` output | text log |
| `pnpm audit` | `pnpm audit --json` | text log |
| CLI end-to-end | JSON where supported + stdout log + screenshot | text log + screenshot |
| Battlefield smoke | docker-compose log + smoke JSON output | console log |
| UAT scenario | asciicast recording (preferred) + screenshot per step + final summary.md | text log + screenshots |
| Performance bench | JSON output of bench harness + flame-graph SVG (where available) | text summary |
| Tarball reproducibility | SHA-256 hashes of consecutive `npm pack` runs | text comparison |
| Grep / static checks | redirected stdout + exit code | n/a |

## Metadata header (required on every JSON artifact)

```json
{
  "_meta": {
    "release": "1.0.0",
    "gate": "5",
    "story": "ST-05-011",
    "head_sha": "14c31f6",
    "node_version": "v22.13.0",
    "pnpm_version": "9.15.0",
    "generated_at": "2026-05-26T14:35:00Z",
    "command": "pnpm --filter @blackunicorn/bonklm test --reporter=json",
    "host": "battlefield"
  },
  ...actual data...
}
```

Without `_meta`, evidence is not auditor-reproducible and the task does not close.

## Retention

| Window | Retention | Storage |
|---|---|---|
| Live release window (RC cut → 30 d post-publish) | Full evidence | `team/qa/<version>/evidence/` (gitignored under `team/`) |
| Post-30d → 1 year | Compress raw evidence to archive; keep on dev machine | `team/backups/qa/<version>-evidence.tar.zst` |
| 1 year → 5 years | Move archive to long-term storage (external SSD, cloud cold tier). Keep signed-off summaries, defect log, risk register, sign-off doc in repo | `team/backups/qa/<version>/` + offsite |
| 5+ years | See "Long-horizon retention" below | varies |

`team/qa/<version>/05-senior-qa-signoff.md`, `06-epics-stories.md`, `03-defects.md`, and `00-meta-plan.md` are **never pruned**. Their git history is the immutable audit trail.

## Long-horizon retention (5+ years)

### Default policy

After 5 years post-publish:
- Raw evidence files MAY be pruned from offsite cold tier
- The following are RETAINED INDEFINITELY (or until repo abandonment / archival):
  - `00-meta-plan.md` (gate definitions used)
  - `01-decisions.md` (decisions made + rationale)
  - `03-defects.md` (defects raised + resolved)
  - `04-risk-register.md` (risks identified + outcomes)
  - `05-senior-qa-signoff.md` (sign-off record)
  - `06-epics-stories.md` (work breakdown)
  - `evidence/agent-transcripts/` (agent verdict transcripts + hashes — required for sign-off verification)
  - Summary JSONs (one per gate) with hash references to pruned raw evidence

### Legal-hold trigger

If a v1.0.x release is implicated in:
- A security advisory or CVE filing
- A consumer lawsuit or claim
- A regulatory inquiry
- A discovery request

ALL evidence for the affected release moves to legal hold immediately:
- Retention policy frozen at current state (no further pruning until legal hold lifts)
- Senior QA + maintainer notified within 24 hours of trigger
- Hold documented in `team/qa/<version>/legal-hold.md` with: trigger description, hold start date, holder identity, expected duration
- Hold release requires same maintainer's sign-off + dated entry in the same file

### Repo abandonment / project sunset

If BonkLM project is sunset (e.g. Black Unicorn pivots away from the library):
- The final maintainer authors a sunset ADR at `docs/contributing/adr/<NNNN>-bonklm-sunset.md`
- The sunset ADR specifies whether QA evidence is:
  - Donated to an open-source archive (Software Heritage, Internet Archive)
  - Transferred to the acquiring entity (if M&A)
  - Permanently deleted (only if no legal-hold + no security advisory + maintainer + Black Unicorn LLC explicit sign-off)

Default sunset action: donate to Software Heritage. Default time: 90 days after sunset declaration.

### Per-record exceptions

A specific record may carry a different retention period if:
- It documents a known-exploited vulnerability (KEV) — retain 10 years minimum
- It documents a precedent-setting QA decision (e.g. a novel security-vs-usability trade-off) — retain indefinitely
- It contains PII or third-party trade secrets — purge per the relevant data subject rights / NDA terms, not per this retention policy

Document exceptions in `team/qa/<version>/retention-exceptions.md`.

## Audit trail

- Git history of `team/qa/<version>/` is the immutable chronological record.
- Every gate close commits an ADR-style decision-log entry in `team/qa/<version>/decisions.md`.
- `05-senior-qa-signoff.md` is a git-committed, dated, hash-pinned (HEAD at signoff time) document.

## Cross-evidence checks

For each task, the senior QA reviewer spot-audits 10 % of evidence links by:
1. Pulling a random evidence file
2. Re-running the documented `_meta.command` from a clean checkout at `_meta.head_sha`
3. Comparing the output diff to the stored evidence
4. Filing a defect if the diff is non-trivial

## Evidence absence is a defect

If a checkbox in `02-master-checklist.md` is checked but the evidence link is broken or missing, file a defect at P1 severity. The release does not publish until every checked box has resolving evidence.
