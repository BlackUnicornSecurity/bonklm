# Cascade-Update Workflow

When a code path changes, more than just the file you edited needs attention. Imports, dependents, docs, tests, ADRs, lessons — anything that referenced the modified symbol may now be out of sync. This workflow enforces the ripple discipline.

## Trigger

Any code change (fix or refactor) that modifies an exported symbol, a public-facing config key, or a documented contract. Pure internal refactors with no external surface change can skip Steps 5-7 but must still complete Steps 1-4.

## Steps

### 1. Enumerate dependents (grep sweep)

```bash
# For each modified exported symbol
git grep -l '<modified-symbol>' -- 'packages/**/*.{ts,tsx,js,mjs,cjs}'
git grep -l '<modified-symbol>' -- 'docs/**/*.md'
git grep -l '<modified-symbol>' -- 'team/lessonslearned.md'
git grep -l '<modified-symbol>' -- 'docs/contributing/adr/'
git grep -l '<modified-symbol>' -- 'team/qa/**/*.md'
```

Capture the file list. Save to `evidence/<gate>/<story-id>/cascade-dependents.txt`.

### 2. For each dependent file: review assumptions

Open each dependent. Confirm:
- The dependent's expectation of the symbol's shape, behavior, error semantics still holds
- The dependent's type imports resolve
- The dependent's test expectations cover the new behavior

If any expectation is now invalid, the dependent IS in cascade scope. Edit it. Re-test it.

### 3. Update tests

Any test that mocks, stubs, or asserts on the modified symbol may need updating:

```bash
git grep -l '<modified-symbol>' -- 'packages/**/tests/' 'packages/**/*.test.ts'
```

Run each affected test individually before running the full suite:

```bash
pnpm --filter <pkg> test <test-file>
```

### 4. Update CHANGELOG

Every change with external-surface impact gets an entry in `CHANGELOG.md` under `[Unreleased]` (or the active RC heading). Format per Conventional Commits:

- `### Added` for new public surface
- `### Changed` for behavioral changes
- `### Deprecated` for soft-removed surface
- `### Removed` for hard-removed surface (always paired with a major bump or pre-1.0 minor)
- `### Fixed` for bug fixes
- `### Security` for security-sensitive fixes

CWE-117 and similar security findings ALWAYS get a `### Security` entry, even for medium / low severity (per CLAUDE.md 100% rule).

### 5. Update docs

```bash
# Public-facing docs
git grep -l '<modified-symbol>' -- 'docs/user/'
# Connector-specific docs
git grep -l '<modified-symbol>' -- 'packages/*/README.md'
# Examples
git grep -l '<modified-symbol>' -- 'examples/'
```

Update each file. Re-run the doc-validity checks (`workflows/doc-sync-workflow.md`).

### 6. Update ADRs

If the change affects an architectural decision documented in `docs/contributing/adr/`:
- Update the ADR `Status:` line (e.g. `Status: Accepted (revised <date> per Sprint N)`)
- Add a "Decision history" section if not present
- Cross-link the commit / story

### 7. Update lessons learned

If the change resulted from a defect, the root-cause + fix + takeaway get an entry in `team/lessonslearned.md` under the current sprint heading.

### 8. Log the cascade

Append to `team/qa/<version>/cascade-log.md`:

```markdown
## Cascade — {{fix-commit-SHA}} (YYYY-MM-DD)
- **Trigger:** {{defect ID | story ID | refactor description}}
- **Modified symbol(s):** {{list}}
- **Dependents found (grep):** {{count}} files
- **Dependents touched:** {{count}} files (link to ripple commit)
- **Tests updated:** {{count}}
- **Docs updated:** {{list of doc files}}
- **ADRs updated:** {{list or N/A}}
- **CHANGELOG entry:** {{section heading}}
- **lessonslearned.md entry:** {{anchor}}
- **Cascade-complete:** YES | NO (reason)
```

## Failure mode

If the cascade reveals that the change was breaking and downstream consumers cannot be fixed within scope, ROLL BACK the change. Open a defect documenting the breakage. The release does NOT publish with a known broken cascade.

## Automation hints

A helper script (release engineer scaffolds per release) at `team/qa/scripts/cascade-check.sh`:

```bash
#!/usr/bin/env bash
# Usage: cascade-check.sh <symbol>
set -e
symbol="$1"
echo "=== Code dependents ==="
git grep -l "$symbol" -- 'packages/**/*.{ts,tsx,js,mjs,cjs}' || true
echo "=== Doc dependents ==="
git grep -l "$symbol" -- 'docs/' 'packages/*/README.md' || true
echo "=== Test dependents ==="
git grep -l "$symbol" -- 'packages/**/tests/' 'packages/**/*.test.ts' || true
echo "=== ADR dependents ==="
git grep -l "$symbol" -- 'docs/contributing/adr/' || true
echo "=== Lessons dependents ==="
git grep -l "$symbol" -- 'team/lessonslearned.md' || true
```

## Exit criterion (per fix)

A fix is NOT considered complete until:
1. Cascade-log entry exists with `Cascade-complete: YES`
2. All dependents either updated OR explicitly justified as no-op
3. CHANGELOG entry exists
4. Doc-sync workflow has been run (see next file)
