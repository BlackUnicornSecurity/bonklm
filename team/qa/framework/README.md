# BonkLM Release QA Framework (BR-QAF v1)

A reusable framework for pre-publish QA of any future BonkLM (`@blackunicorn/bonklm`) release. Authored 2026-05-25 alongside the v1.0.0 instance. Future releases (v1.0.x, v1.1, v2.0) instantiate this framework into a versioned directory (`team/qa/<version>/`) and fill in the per-release specifics.

## Why this exists

Eight sprints of post-rc.3 hardening surfaced repeated themes: CWE-117 sweeps across 5 variable-binding-site patterns, exports-map drift, engines.node skew, missing per-package LICENSE/README, ad-hoc evidence capture. Each release re-invented its own gate scaffolding. This framework codifies the discipline once so that every release rolls out under the same lifecycle, the same evidence conventions, and the same sign-off matrix.

The framework is opinionated. It enforces:

1. **Evidence-based QA.** Every gate task produces machine-readable, reproducible evidence under `team/qa/<version>/evidence/<gate>/<story-id>/`. No check is closed without an evidence link.
2. **100 % pass.** Per `CLAUDE.md`, no severity is postponed. Medium and Low findings ship-block exactly like High and Critical.
3. **Cascade discipline.** After any code fix, contributors execute a cascade-update workflow (paths / dependents / docs / tests) and a doc-sync workflow before closing the task.
4. **Retest discipline.** Every fix re-runs the failing test plus the regression-set scoped to the affected subsystem.
5. **Multi-persona review.** Each release passes through red-team, security code reviewer, senior QA engineer, scrum master, architect reviewer, release engineer, and Black Unicorn maintainer signoffs. All but the last two may be Claude agents.

## Directory layout

```
team/qa/
├── framework/                              # this directory — universal
│   ├── README.md                           # you are here
│   ├── templates/
│   │   ├── meta-plan-template.md           # 10-gate skeleton
│   │   ├── gate-template.md                # Owner/PASS/Blockers/Triage
│   │   ├── per-connector-template.md       # public-surface × test-case matrix
│   │   ├── master-checklist-template.md    # Gate × Connector × Task matrix
│   │   ├── uat-scenario-template.md        # consumer-side UAT skeleton
│   │   └── evidence-conventions.md         # storage / naming / retention
│   ├── workflows/
│   │   ├── retest-workflow.md              # fix → verify → regression-set
│   │   ├── cascade-update-workflow.md      # path + dep + doc + test ripple
│   │   └── doc-sync-workflow.md            # docs reconciliation at task close
│   └── policies/
│       ├── entry-exit-criteria.md          # start + signoff gates
│       ├── defect-taxonomy.md              # severity + priority + SLA
│       ├── sign-off-matrix.md              # who signs off on what
│       ├── rollback-procedure.md           # unpublish + deprecate
│       └── post-publish-monitoring.md      # 24h / 7d / 30d watch
└── <version>/                              # per-release instance (e.g. 1.0.0/)
    ├── README.md                           # instance index + status dashboard
    ├── 00-meta-plan.md                     # instantiated from template
    ├── 01-decisions.md                     # D-1 … D-N outcomes
    ├── 02-master-checklist.md              # filled, tracked
    ├── 03-defects.md                       # P0-P3 + Info tracker
    ├── 04-risk-register.md                 # R-1 … R-N
    ├── 05-senior-qa-signoff.md             # 20-item gating checklist
    ├── 06-epics-stories.md                 # scrum-master output
    ├── 07-connectors-matrix.md             # per-connector test plans
    ├── 08-uat-plan.md                      # consumer-side UAT scenarios
    ├── 09-security-addendum.md             # red-team + security-code-review contributions
    ├── standups/<date>.md                  # daily standups
    └── evidence/<gate>/<story-id>/         # captured evidence
```

## Lifecycle

```
pre-RC ─► RC cut ─► entry-criteria check ─► Gates run (parallel where possible)
       ─► defect intake ─► fix loop (retest + cascade + doc-sync per fix)
       ─► gate re-run ─► 100 % green ─► senior-QA signoff
       ─► tag + publish dry-run ─► publish ─► post-publish monitoring
       ─► retrospective ─► framework amendments ─► archive
```

Stages map 1:1 to sprint structure. A typical release uses 4-6 sprints (e.g. v1.0.0 uses Sprints 51-55).

## Gates (universal)

Every release runs the same 10 numbered gates plus any release-specific security sub-gates. The skeleton is in `templates/meta-plan-template.md`. The 10 gates:

1. Package coherence
2. Install + publish dry-runs
3. Runtime matrix smoke (Node + edge)
4. Connector smoke matrix
5. Security regression sweep (incl. sub-gates 5.6-5.N for release-specific findings)
6. CLI smoke
7. Documentation validity
8. Performance gates
9. Distribution / supply chain
10. Final gates before tag + publish

## Roles

| Role | Signs off on | Typically |
|---|---|---|
| Senior QA | Plan structure + framework instantiation + exit criteria | Claude agent + human verification |
| Red team | Gate 5 attack-corpus recall + secret-leak sweep | Claude agent (security-reviewer subagent) |
| Security code reviewer | Gate 5 CWE-117 sweep + dependency CVE coverage | Claude agent (security-reviewer subagent) |
| Architect reviewer | Gates 1, 2, 3, 9 (structural + supply chain) | Claude agent (architect subagent) |
| Scrum master | Sprint mapping + story breakdown | Claude agent (general-purpose) |
| Release engineer | Tag + publish (Gate 10 manual close) | Human |
| Black Unicorn maintainer | External-facing narrative (README, docs/user/) | Human |

See `policies/sign-off-matrix.md`.

## How to instantiate for a new release

1. `mkdir team/qa/<version>` and `cp -r team/qa/framework/templates/* team/qa/<version>/` (rename as appropriate).
2. Populate `00-meta-plan.md` from the template; fill HEAD, target version, sprint window.
3. Populate `01-decisions.md` with any open questions resolved at release start.
4. Scaffold `02-master-checklist.md` from the gate template — one row per task, per connector, per gate.
5. Seed `04-risk-register.md` from `team/lessonslearned.md` tail + carryover risks from the previous release.
6. Run `policies/entry-exit-criteria.md` entry checks; if any fail, do not start QA.
7. Execute gates per sprint plan; capture evidence per gate.
8. Hold weekly mid-sprint risk check.
9. At publish time, run `policies/post-publish-monitoring.md` watch.
10. Retrospective; merge lessons into `team/lessonslearned.md`; archive instance.

## Cross-references

- Project rules: `/Users/paultinp/LLM-Guardrails/CLAUDE.md`
- Lessons learned (read before every release): `/Users/paultinp/LLM-Guardrails/team/lessonslearned.md`
- Canonical security ADR: `/Users/paultinp/LLM-Guardrails/docs/contributing/adr/0001-log-sanitization.md`
- Roadmap: `/Users/paultinp/LLM-Guardrails/team/plans/2026-05-21-v0.4-v0.7-roadmap-FINAL.md`
- Battlefield testbed: `/Users/paultinp/Projects/BU-BattleLab/docs/spec.md`
- dojoLM attack corpus: `/Users/paultinp/BU-TPI/packages/bu-tpi/fixtures/`
- Obsidian vault (device access, creds): `/Volumes/Familly/Documents/ObsidianJulien/Julien v2/Julien Perso/IT and Infra/` and `Pro/BlackUnicorn/BU-BattleLab/`

## Version

BR-QAF v1.0 (2026-05-25). First instance: BonkLM v1.0.0.

## Framework versioning policy

The framework itself is a versioned artifact. Different framework versions may be incompatible with each other.

### Version scheme

`BR-QAF v<MAJOR>.<MINOR>`

- **MAJOR** bump: breaking change to template structure, gate definitions, policy semantics, or workflow contract. Requires migration plan for existing release instances.
- **MINOR** bump: additive change (new template, new policy, new workflow); existing instances continue to work unchanged.
- No patch level — typo fixes and clarifications commit without a version bump but get an entry in the changelog below.

### Compatibility commitment

An instance under `team/qa/<release>/` declares its framework version in `00-meta-plan.md` front matter (`Framework version: BR-QAF v1.0`). The instance MUST continue to work with that exact framework version for the lifetime of the release window (rc cut → 30 d post-publish).

If the framework upgrades during a release window:
- The release instance pins to the **old** framework version (do NOT auto-migrate)
- The next release instance opts into the new framework version
- Migration documented per the procedure below

### Migration procedure (when framework v1 → v2)

1. Senior QA + architect reviewer draft a migration ADR at `docs/contributing/adr/<NNNN>-br-qaf-vN-migration.md`
2. Migration ADR enumerates:
   - Breaking changes (with code-search examples for each)
   - Per-template / per-policy / per-workflow diff
   - Automated migration script (where possible) at `team/qa/scripts/migrate-vN-to-vN+1.sh`
   - Risk assessment: which existing instances + which gates are affected
3. Migration ADR approved by senior QA + release engineer + Black Unicorn maintainer
4. New framework version published to `team/qa/framework/` (overwrites old; old preserved via git history)
5. First release instance to opt in declares the new version in its `00-meta-plan.md`
6. Migration script run against any in-flight instances if they explicitly opt to upgrade

### Framework changelog

```markdown
## BR-QAF v1.0 (2026-05-25)
- Initial release. Framework authored alongside BonkLM v1.0.0 instance.
- 15 framework files: README, 6 templates, 3 workflows, 5 policies.
- Plus TOOLS.md (G1 audit fix) and policies/battlefield-degraded-mode.md (G3 audit fix).
- Plus workflows/parallel-agent-coordination.md (G6) and policies/test-data-lifecycle.md (G7).

## Future: BR-QAF v1.1 (planned post-v1.0.1)
- Open questions: per-connector author identity for multi-maintainer releases; expanded i18n test coverage; accessibility statement
- Likely additive, no breaking changes anticipated
```

## Self-test

A `validate-framework.sh` script (`team/qa/scripts/validate-framework.sh`) verifies framework consistency at any HEAD:
- All declared files exist
- All cross-references resolve
- All scripts referenced are present + executable
- All templates have at least one filled-instance example referenced

Run at sprint entry (`policies/entry-exit-criteria.md` item 11). CI may run it on every PR touching `team/qa/`.
