# Rollback Procedure

If publish must be unwound, follow this procedure exactly.

## Triggers

Roll back if:
- A P0 defect surfaces in the wild within 72h of publish
- A P1 defect cluster (≥ 3) surfaces in the wild within 72h
- A security advisory is filed against the released version
- A consumer reports unrecoverable data loss caused by the release
- The release-engineer decides for any other reason — they have final authority

Do NOT roll back for:
- Single P2 / P3 defects (patch in next minor)
- Documentation issues (fix docs in place; no version change)
- Consumer misconfiguration that the docs cover (clarify docs; no rollback)

## Procedure

### A. Within 72h of publish — full unpublish

npm allows unpublish within 72h of publish for a version that has no dependents on npm. This window is the cleanest.

1. Verify the window: `npm view @blackunicorn/bonklm time.<version>` returns a timestamp < 72h ago.
2. Verify no dependents: `npm view @blackunicorn/bonklm dependents` (or the npmjs.com page) shows the package was not yet a transitive dependency of another published package.
3. Unpublish (one per package):
   ```bash
   for pkg in $(jq -r '.packages[]' team/qa/<version>/02-master-checklist.json); do
     npm unpublish "$pkg@<version>"
   done
   ```
4. Verify: `npm view @blackunicorn/bonklm versions` no longer lists the rolled-back version.
5. Re-tag the rolled-back commit with a `-rollback` suffix in git for the audit trail.
6. Communicate (see Step D).

### B. After 72h — deprecate + patch

If the 72h window has passed, unpublish is not permitted. Deprecate + ship a corrective patch.

1. Deprecate (one per package):
   ```bash
   for pkg in $(jq -r '.packages[]' team/qa/<version>/02-master-checklist.json); do
     npm deprecate "$pkg@<version>" "rolled back: <one-line reason>; use <next-version>"
   done
   ```
2. Cut a corrective patch version (`<major>.<minor>.<patch+1>`). This patch MUST:
   - Revert the offending change OR include the fix
   - Have its own full QA cycle (compressed if the issue is isolated — minimum: hot-fix branch + targeted tests + senior-QA sign-off)
   - Ship within 7 days of the rollback decision
3. Publish the patch per the standard Gate 10 procedure.
4. Add a deprecation banner to `README.md` of the rolled-back version directing consumers to the patch.
5. Communicate (see Step D).

### C. Investigate root cause

Regardless of which path was taken (A or B):

1. Open a P0 defect documenting the in-the-wild failure mode
2. Reproduce locally OR on Battlefield
3. Identify the QA gate that should have caught the issue
4. File a follow-up story to add the missing test coverage
5. Post-mortem written to `team/lessonslearned.md`:

```markdown
## Sprint N — Rollback post-mortem — YYYY-MM-DD
- **Released version:** vX.Y.Z
- **In-the-wild symptom:** {{description}}
- **Root cause:** {{description}}
- **Why QA missed it:** {{gate that should have caught it; missing test type}}
- **Rollback path taken:** A (unpublish) | B (deprecate + patch)
- **Patch version:** {{vX.Y.Z+1 or N/A}}
- **Follow-up:** {{story IDs to add missing coverage}}
- **Framework changes:** {{any updates to BR-QAF templates / workflows}}
```

### D. Communication

1. **Within 1h** of rollback decision: update `README.md` of the affected version with a top banner:
   ```markdown
   > **⚠️ v{{VERSION}} ROLLED BACK** — do not use. Upgrade to v{{NEXT}}. See [CHANGELOG.md](./CHANGELOG.md) for details.
   ```
2. **Within 4h**: CHANGELOG.md entry under a new heading `## [{{VERSION}}] - YYYY-MM-DD - ROLLED BACK`
3. **Within 8h**: Black Unicorn maintainer drafts a public communication (LinkedIn post / X thread / blog) explaining the rollback. Use `blackunicorn-writing-style` skill for the tone.
4. **Within 24h**: an ADR entry under `docs/contributing/adr/` documenting the architectural lesson if applicable
5. **Within 72h**: the patch version (Path B) is in consumers' hands

## Rehearsal

A dry-run of the rollback is mandatory before any release publishes. Rehearsal steps:

1. Publish a sacrificial package name (e.g. `@blackunicorn/bonklm-rollback-test`) to npm at version 0.0.1
2. Wait ≥ 30 minutes
3. Execute the Path A unpublish on that package
4. Verify the unpublish succeeded
5. Capture the full transcript to `evidence/baseline/rollback-rehearsal.log`

This rehearsal is an Entry criterion (Item 10 in `policies/entry-exit-criteria.md`).

## Decision authority

| Decision | Authority |
|---|---|
| Trigger rollback | Release engineer (final) — senior QA + maintainer can recommend |
| Choose Path A vs Path B | Release engineer |
| Patch version content | Senior QA + release engineer jointly |
| Communication wording | Black Unicorn maintainer |
| Framework amendment | Senior QA + architect reviewer jointly |

## What rollback does NOT change

- The original release tag remains in git history (audit trail)
- The git commit for the original release remains in `main` (audit trail)
- The pre-rollback CHANGELOG entry remains, with the new `## ROLLED BACK` heading appended
- The defects log retains every P0/P1 that triggered the rollback

## Out-of-band: registry compromise

If the rollback is triggered by a compromised npm token (someone published malicious code as us):
1. Rotate the npm token immediately
2. Engage npm support for a force-unpublish (outside the 72h window) on grounds of compromise
3. Publish a patch only after the token rotation is verified
4. Notify consumers via every channel within 1 hour, not 8

This path is rare but documented for completeness.
