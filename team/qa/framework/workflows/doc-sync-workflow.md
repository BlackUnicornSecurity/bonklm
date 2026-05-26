# Doc-Sync Workflow

At the end of every QA task, before checking the master-checklist box, reconcile docs with code. Prevents docs drifting from shipped behavior.

## Trigger

Every QA task. Cheap to run; expensive to skip.

## Steps

### 1. Identify doc scope

For the task, list the docs that could be affected:

- `docs/user/<area>/` — public-facing docs (quick-start, API reference, guides)
- `packages/<pkg>/README.md` — per-package README on npm
- `CHANGELOG.md` — release notes
- `team/lessonslearned.md` — internal lessons
- `docs/contributing/adr/<NNNN>-<title>.md` — architectural decisions

If the task touched no public surface, scope is just CHANGELOG and (if applicable) lessons.

### 2. Re-read each doc in scope

Open each one. Compare to current code behavior.

For docs containing code samples:
- Copy each fenced code block into a scratch file
- Compile it against the rc.N workspace
- Run it if runnable
- Fix anything that breaks

For docs containing API references:
- For each documented function / class / type: confirm it exists at the documented export path
- For each documented parameter: confirm name, type, default, required-ness
- For each documented return: confirm shape

For docs containing CLI examples:
- For each documented command: run it
- Compare output to documented output
- Fix divergences

### 3. Reconcile CHANGELOG

CHANGELOG entries for the task already exist (from `cascade-update-workflow.md` Step 4). Re-read them. Confirm:
- Entries are in the right section (Added / Changed / Deprecated / Removed / Fixed / Security)
- Entries cite the affected package(s)
- Entries link to the commit OR defect ID where relevant
- Entries are under `[Unreleased]` OR the active RC heading (never under a frozen released version)

### 4. Update `team/lessonslearned.md` if a lesson emerged

If the task surfaced a non-obvious gotcha, a fix pattern worth remembering, or a process improvement, add an entry under the current sprint heading:

```markdown
## Sprint N — YYYY-MM-DD
- **Lesson:** {{1-2 sentence summary}}
- **Context:** {{what we were doing}}
- **Root cause:** {{why it happened}}
- **Fix:** {{what we did}}
- **Takeaway:** {{what to do differently next time}}
- **Refs:** {{commit / defect / story IDs}}
```

The CLAUDE.md rule applies: always log mistakes; always read this file before the next task.

### 5. Update ADR if status changed

If the task touched an architectural decision:
- Update the ADR `Status:` line with a revised-on date and the sprint
- Add a "Decision history" entry if material

### 6. Cross-verify docs <-> code

```bash
# Every public symbol in docs/user/ must exist in source
grep -rh '`createGuardedAnthropic`' docs/user/ | sort -u
grep -rh 'createGuardedAnthropic' packages/anthropic-connector/src/

# Every example import in docs must resolve
grep -rE "from ['\"]@blackunicorn/" docs/user/ | sort -u
# For each: confirm package + subpath exists
```

If a doc references a symbol that doesn't exist in source, choose:
- a) Fix the doc (symbol was renamed / removed)
- b) Add the symbol (doc described intended surface that wasn't shipped)

Either way, file a defect if the divergence ships.

### 7. Run markdownlint + link check

```bash
# Lint
npx markdownlint-cli2 'docs/**/*.md' 'packages/*/README.md' 'CHANGELOG.md'

# Broken links
npx markdown-link-check 'docs/**/*.md' --quiet
```

PASS criterion: 0 lint errors; 0 broken links (or documented exceptions in `.markdownlintignore` / `.linkcheckignore`).

### 8. Log the doc-sync

Append to `team/qa/<version>/doc-sync-log.md`:

```markdown
## Doc-sync — {{task-id}} (YYYY-MM-DD HH:MM)
- **Task:** {{description}}
- **Docs scope:** {{list of files}}
- **Code samples recompiled:** {{count pass / count fail}}
- **API references verified:** {{count pass / count fail}}
- **CHANGELOG updated:** YES | NO (reason)
- **lessonslearned.md updated:** YES | NO (reason)
- **ADR(s) touched:** {{list or N/A}}
- **markdownlint:** clean | {{N errors → fix-commit}}
- **link check:** clean | {{N broken → fix-commit}}
- **Sync-complete:** YES | NO
- **Commit:** {{SHA}}
```

## Failure mode

If a doc cannot be brought into sync within scope (e.g. requires a new feature to land), file a Gate 7 defect and link it to the task. The task does NOT close until the defect is resolved or explicitly deferred with a documented rationale in the senior-QA sign-off.

## Exit criterion (per task)

Doc-sync log entry exists with `Sync-complete: YES`. Master checklist box may be checked.

## Special cases

### Doc-only task

Doc-only tasks still run Steps 1-3, 6-8. Step 5 (ADR) is rare for doc-only.

### Connector task

Connector tasks always touch `packages/<connector>/README.md` AND `docs/user/connectors/<name>.md`. Verify both.

### CLI task

CLI tasks always re-verify `bonklm --help` output matches docs AND `docs/user/cli/` references.

### Security task

Security tasks ALWAYS update ADR-0001 (`docs/contributing/adr/0001-log-sanitization.md`) status line if any sanitizer / validator / guard touched. ALWAYS add a `### Security` CHANGELOG entry. ALWAYS add a `lessonslearned.md` entry.
