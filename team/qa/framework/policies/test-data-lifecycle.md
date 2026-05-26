# Test Data Lifecycle Policy

Test data — primarily attack corpora — drifts. The dojoLM corpus (5,166 fixtures across 40 categories per D-10) evolves upstream; the in-tree R2-13 sandbox-attack corpus may add patterns; the per-connector recorded fixtures (nock / polly) age out as upstream APIs change. This policy defines snapshot pinning, refresh frequency, diff workflow, and re-baseline procedures.

## Test data inventory

| Source | Path | Update frequency | License | PII vetted |
|---|---|---|---|---|
| dojoLM corpus | `/Users/paultinp/BU-TPI/packages/bu-tpi/fixtures/` (canonical) → Battlefield `~/BU-BattleLab/corpus/from-dojolm/` (mirror) | Per dojoLM upstream — unscheduled | NODA Armory v2.0.0 + ST3GG community taxonomy (no SPDX header — vetting required per R-3) | NOT VETTED (R-3) |
| R2-13 sandbox-attack corpus | `packages/core/benchmarks/sandbox-attack-corpus/patterns.json` | Stable; in-tree | repo MIT | n/a (synthetic patterns) |
| UAT in-tree fixtures | `packages/core/uat/` (47-case corpus / 7 categories) | Stable | repo MIT | n/a |
| Per-connector recorded fixtures (nock/polly) | `packages/<connector>/tests/fixtures/recorded/` (where present) | Per upstream API change | n/a (recorded transcripts) | may contain PII in recorded headers — vetting required |
| Multilingual jailbreak corpus | (inside dojoLM `translation/` category, 172 files) | per dojoLM | n/a | NOT VETTED |
| OWASP LLM Top 10 example corpus | (third-party reference, ad-hoc) | unscheduled | varies | varies |

## Snapshot pinning

At every release-QA cycle entry (per Day-1 runbook A.5), the active corpus snapshot is hash-pinned:

```bash
# On Battlefield:
cd ~/BU-BattleLab/corpus/from-dojolm/
find . -type f | LC_ALL=C sort | xargs sha256sum > corpus-manifest.txt
sha256sum corpus-manifest.txt > corpus-manifest.sha256

# Pull to instance evidence:
scp paultinp@192.168.0.107:~/BU-BattleLab/corpus/from-dojolm/corpus-manifest.{txt,sha256} \
  team/qa/<version>/evidence/baseline/
```

The instance's `04-risk-register.md` R-13 references the pinned manifest. Gate 5 PASS criteria assert the corpus replay used the pinned hash, NOT the live upstream.

## Refresh policy

### dojoLM corpus

- **Within a release window** (rc cut → 30 d post-publish): SNAPSHOT IS FROZEN. No refresh. All Gate 5 replays use the pinned manifest.
- **Between releases:** refresh happens at the NEXT release's Day-1 runbook. The new release pins its own snapshot.
- **Emergency refresh** (e.g. critical new attack class published mid-window): senior QA + security code reviewer convene; refresh requires:
  - Documented rationale in `04-risk-register.md`
  - Full Gate 5 re-run against the new snapshot
  - Senior-QA re-sign-off
  - 24-hour notice in standup before adoption

### R2-13 corpus

- **In-tree, versioned with the workspace.** Any change to `patterns.json` is a code change, tracked via git history. Subject to the cascade-update workflow.
- **Adding a new pattern** requires:
  - A new test asserting the validator catches it
  - CHANGELOG `### Security` entry
  - Cross-link to the threat-intelligence source

### Per-connector recorded fixtures

- **Refresh trigger:** the corresponding peer SDK is bumped in `package.json`. Old recordings may no longer match.
- **Refresh frequency:** per-connector author runs `nock --record` (or polly equivalent) against the current peer SDK; commits new recordings; bumps a `fixtures.recorded_at` timestamp in `tests/fixtures/_meta.json`.
- **Staleness alert:** `team/qa/scripts/check-fixture-freshness.sh` (to be authored) warns if `recorded_at` > 90 days. Gate 4 ST-04-102 enforces this.

### Multilingual corpus

- Same policy as dojoLM (it's a subset)

## Diff workflow

When two snapshots exist (old in repo evidence, new on canonical source), compare:

```bash
# Compare manifests
diff <(sort old-corpus-manifest.txt) <(sort new-corpus-manifest.txt) > corpus-diff.txt

# Counts
wc -l old-corpus-manifest.txt new-corpus-manifest.txt
```

Output classified as:
- **A** added (new entries on canonical only)
- **D** deleted (entries on repo only)
- **M** modified (same path, different hash)

Decision rules:
- > 5 % drift (A+D+M / total) → SIGNIFICANT; senior QA + security reviewer notified; full Gate 5 re-run required if release window is active
- ≤ 5 % drift → MINOR; documented in next-release Day-1 runbook; rolled forward at next release without ceremony

## Re-baseline command

Captured in `team/qa/scripts/rebaseline-corpus.sh` (release engineer scaffolds):

```bash
#!/usr/bin/env bash
# rebaseline-corpus.sh <release-version>
# Refresh corpus mirror on Battlefield + recompute hash + update instance evidence
set -eu
version="$1"

# 1. Rsync canonical -> Battlefield
rsync -avz --delete /Users/paultinp/BU-TPI/packages/bu-tpi/fixtures/ \
  paultinp@192.168.0.107:~/BU-BattleLab/corpus/from-dojolm/

# 2. Re-hash on Battlefield
ssh paultinp@192.168.0.107 'cd ~/BU-BattleLab/corpus/from-dojolm/ && find . -type f | LC_ALL=C sort | xargs sha256sum > corpus-manifest.txt && sha256sum corpus-manifest.txt > corpus-manifest.sha256'

# 3. Pull manifest to instance evidence
scp paultinp@192.168.0.107:~/BU-BattleLab/corpus/from-dojolm/corpus-manifest.txt \
  "team/qa/$version/evidence/baseline/corpus-manifest-rebaseline-$(date -u +%Y-%m-%dT%H-%M-%SZ).txt"

# 4. Diff against prior pin
diff "team/qa/$version/evidence/baseline/corpus-manifest.txt" \
  "team/qa/$version/evidence/baseline/corpus-manifest-rebaseline-"*.txt \
  > "team/qa/$version/evidence/baseline/corpus-diff.txt" || true

# 5. Report
total=$(wc -l < "team/qa/$version/evidence/baseline/corpus-manifest.txt")
changed=$(wc -l < "team/qa/$version/evidence/baseline/corpus-diff.txt")
pct=$((changed * 100 / total))
echo "Drift: $changed / $total = ${pct}%"
[ $pct -gt 5 ] && echo "WARNING: drift > 5% — significant; convene senior QA" || echo "OK: drift ≤ 5%"
```

## License + PII vetting (R-3)

Before any corpus is consumed by a release-QA cycle, the corpus license + PII status must be vetted. Procedure:

### License vetting

1. Identify upstream source (e.g. dojoLM corpus → NODA Armory v2.0.0 + ST3GG)
2. Locate license text (search upstream README, LICENSE, SPDX header in source repo)
3. Verify license compatibility with `LICENSE` of `@blackunicorn/bonklm` (MIT)
4. Document in `team/qa/<version>/evidence/baseline/corpus-license-audit.md`:
   - Source name, version, URL
   - License (SPDX identifier if available; full text if not)
   - Compatibility verdict (compatible / incompatible / needs counsel review)
   - Mitigations if needed (re-author from scratch, paid license, etc.)
5. If license is ambiguous or absent: do NOT consume; escalate to Black Unicorn maintainer + legal (if engaged)

### PII vetting

1. Sample 10 % of corpus files randomly
2. Manual + automated scan for:
   - Real names + surnames (regex + named-entity recognition)
   - Email addresses
   - Phone numbers (international format)
   - Physical addresses
   - Government IDs (SSN, NIR, etc.)
   - Credit card numbers
   - API keys + tokens (covered by gitleaks/ripsecrets)
   - IP addresses (mostly OK if internal; flag external)
3. Document findings in `team/qa/<version>/evidence/baseline/corpus-pii-audit.md`
4. If PII found:
   - Remove the specific files from the consumed snapshot
   - Document removal in audit + risk register
   - Alert upstream maintainer (defense-in-depth — they should also strip)
   - Do NOT use the unstripped snapshot

### Vetting cadence

- v1.0.0: BLOCKING (R-3 is HIGH/MEDIUM open risk; vet before first Gate 5 replay)
- Subsequent releases: re-vet only the DIFF (files A+M since last vetted snapshot)
- Annual full re-vet regardless of diff size

## GDPR / data-residency

Pinned corpora may contain EU-data-subject material. If the dojoLM corpus PII audit reveals any EU-subject PII, the standard GDPR data-subject rights apply: right to erasure, right to access, right to rectification. The release engineer + Black Unicorn maintainer + (if engaged) legal counsel handle the response within the GDPR-mandated 30-day window.

This policy currently DEFERS the deeper GDPR implementation (DPIA, data-processor agreement with dojoLM upstream) to a future release per user instruction. R-3 remains open.

## Cross-references

- D-10 (corpus source decision): `../../1.0.0/01-decisions.md`
- R-3 (corpus license/PII): `../../1.0.0/04-risk-register.md`
- R-13 (corpus refresh drift): `../../1.0.0/04-risk-register.md`
- Day-1 runbook A.5: `../../1.0.0/RUNBOOK-DAY-1.md`
- Gate 5.1 + 5.4: `../../1.0.0/00-meta-plan.md`
- Battlefield-degraded-mode protocol (local corpus mirror): `battlefield-degraded-mode.md`
