# Sign-Off Matrix

Who signs off on what, before publish.

## Roles

| Role | Typical agent / human | Scope |
|---|---|---|
| **Senior QA** | Claude `general-purpose` agent, persona "Senior QA engineer" | Plan structure, framework instantiation, entry + exit criteria, terminal sign-off |
| **Red team** | Claude `security-reviewer` subagent, adversarial persona | Gate 5 attack-corpus recall, secret-leak sweep, connector-boundary attacks |
| **Security code reviewer** | Claude `security-reviewer` subagent, defensive persona | Gate 5 CWE-117 sweep, secure-json-parse coverage, sanitizeMeta fail-closure, code-review findings |
| **Architect reviewer** | Claude `architect` subagent | Gates 1, 2, 3, 9 structural soundness; supply-chain decisions |
| **Scrum master** | Claude `general-purpose` agent | Sprint mapping, story breakdown, dependency graph |
| **Release engineer** | Human (Julien Perpoint) | Tag, publish, rollback execution; Gate 10 manual close |
| **Black Unicorn maintainer** | Human (Julien Perpoint, brand voice) | External-facing narrative — README, docs/user/, CHANGELOG public copy, announcement |
| **Connector author / maintainer** | Per-connector — for v1.0.0: **Julien Perpoint named as default author for all 52 publishable connectors** (single-maintainer release). Future releases may delegate per connector. | Per-connector test plan sign-off (Gate 4 row) |

## Sign-off table

| Gate / artifact | Senior QA | Red team | Security code reviewer | Architect | Scrum master | Release engineer | Maintainer | Connector author |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `00-meta-plan.md` instantiated | ✅ | | | ✅ | | | | |
| `01-decisions.md` resolutions | ✅ | | | ✅ | | ✅ | | |
| `02-master-checklist.md` scaffold | ✅ | | | | ✅ | | | |
| Entry criteria | ✅ | | | | | ✅ | | |
| Gate 1 close | ✅ | | | ✅ | | | | |
| Gate 2 close | ✅ | | | ✅ | | ✅ | | |
| Gate 3 close | ✅ | | | ✅ | | | | |
| Gate 4 close | ✅ | | | | | | | ✅ (per row) |
| Gate 5 close | ✅ | ✅ | ✅ | | | | | |
| Gate 5 hard blocks | ✅ | ✅ | ✅ | | | ✅ | | |
| Gate 6 close | ✅ | | ✅ | | | | | |
| Gate 7 close | ✅ | | | | | | ✅ | |
| Gate 8 close | ✅ | | | ✅ | | | | |
| Gate 9 close | ✅ | | ✅ | ✅ | | ✅ | | |
| Gate 10 close (tag + publish) | ✅ | | | | | ✅ | ✅ | |
| `04-risk-register.md` accepted entries | ✅ | | | | | | ✅ | |
| `05-senior-qa-signoff.md` terminal | ✅ | | | | | ✅ | | |
| `06-epics-stories.md` | | | | | ✅ | | | |
| `09-security-addendum.md` | ✅ | ✅ | ✅ | | | | | |
| Post-publish monitoring report | ✅ | | | | | ✅ | ✅ | |
| Retrospective | ✅ | | | | ✅ | ✅ | ✅ | |

## Sign-off mechanics

Each sign-off is a git-committed entry in the relevant document with:
- Signer role
- Signer identifier (Claude agent ID + persona, OR human name)
- Date + time (UTC)
- HEAD SHA at sign-off
- Verdict (PASS | FAIL | CONDITIONAL)
- For CONDITIONAL: documented conditions + follow-up story ID

Template:

```markdown
### Sign-off — {{role}}
- **Signer:** {{name | agent-id + persona}}
- **Date:** YYYY-MM-DDTHH:MM:SSZ
- **HEAD:** {{SHA}}
- **Verdict:** PASS | FAIL | CONDITIONAL
- **Notes:** {{free text}}
- **Conditions (CONDITIONAL only):** {{list}}
- **Follow-up:** {{story IDs}}
```

## Conflict resolution

If two signers disagree (e.g. red team says FAIL, senior QA says PASS):
1. Senior QA convenes a 30-min review with both signers
2. Each presents evidence
3. Senior QA writes a decision note in `04-risk-register.md` with rationale
4. If still unresolved: escalate to release engineer; final call is theirs as the human-in-the-loop

For security-related conflicts (Gate 5, hard blocks): the more-restrictive verdict wins. If red team says FAIL on a hard block, the release does not publish even if every other signer says PASS. This is non-negotiable per the project's security-library positioning.

## Claude-agent sign-off authentication

When a Claude agent signs off, the agent ID alone is INSUFFICIENT — agent session IDs are ephemeral and not independently verifiable months later. Use the transcript-hash protocol below.

### Transcript-hash protocol

Every agent sign-off MUST include:

1. **Transcript capture.** The full agent run (input prompt + tool calls + final output text) is written to `team/qa/<version>/evidence/agent-transcripts/<UTC-timestamp>_<role>_<gate>.json`.
2. **SHA-256 hash.** Hash the canonical JSON serialization (sorted keys, no extra whitespace, UTF-8) of the transcript file. Hash recorded in the sign-off entry.
3. **Schema** for the transcript file:
   ```json
   {
     "_meta": {
       "release": "1.0.0",
       "role": "senior-qa | red-team | security-code-reviewer | architect | scrum-master",
       "gate": "5",
       "subject": "Gate 5 sub-gate 5.6 sign-off",
       "captured_at": "2026-05-26T14:35:00Z",
       "head_sha": "<git HEAD at agent dispatch>",
       "agent_session_id": "<Claude session ID if available>",
       "claude_model": "claude-opus-4.7-1m | claude-sonnet-4.5 | ...",
       "hash_algorithm": "sha256",
       "schema_version": "1.0"
     },
     "input_prompt": "<full agent prompt verbatim>",
     "tool_calls": [
       { "tool": "Read", "args": {...}, "result_excerpt": "..." }
     ],
     "output_text": "<full agent final message verbatim>"
   }
   ```
4. **Hash verification.** Compute hash via:
   ```bash
   # Canonical JSON: jq --sort-keys + --compact-output
   jq -S -c . evidence/agent-transcripts/<file>.json | shasum -a 256
   ```
5. **Sign-off entry references the hash.** Both `transcript_path` AND `transcript_sha256` recorded.

### Updated sign-off template (supersedes the simpler version above)

```markdown
### Sign-off — {{role}}
- **Signer:** Claude `{{subagent_type}}` subagent — persona: {{persona}}
- **Agent session ID:** {{ID — best-effort, not load-bearing}}
- **Claude model:** {{model name + version}}
- **Date:** YYYY-MM-DDTHH:MM:SSZ
- **HEAD at dispatch:** {{SHA}}
- **Transcript:** `evidence/agent-transcripts/{{timestamp}}_{{role}}_{{gate}}.json`
- **Transcript SHA-256:** {{64-char hex}}
- **Verdict:** PASS | FAIL | CONDITIONAL
- **Notes:** {{free text — summary visible to humans}}
- **Conditions (CONDITIONAL only):** {{list}}
- **Follow-up:** {{story IDs}}
```

### Human signers

Human signers (release engineer, Black Unicorn maintainer) sign via git commit with their authored identity. Their signed git commit IS the audit trail; no transcript-hash required (the commit IS the immutable record). For high-stakes sign-offs (Gate 10 terminal), the human signer should additionally GPG-sign the commit (`git commit -S`).

### Why this matters

Without transcript-hashing, an auditor 12 months from now cannot verify whether a Claude agent actually issued the sign-off claimed. With transcript-hashing + canonical-JSON serialization + git-committed evidence directory, an auditor can:
- Re-hash the transcript file → confirm bit-identical match
- Inspect the input prompt → verify it asked for the right thing
- Inspect the tool-call audit → verify the agent did the work
- Inspect the output → verify the verdict claim

If the transcript file is deleted or tampered with post-sign-off, the recorded SHA-256 will mismatch on re-hash → integrity failure surfaces.

### Transcript retention

Per `templates/evidence-conventions.md` §retention:
- Live release window (rc cut → 30d post-publish): full transcript retained
- Post-30d: transcripts archived to `team/backups/qa/<version>-transcripts.tar.zst`
- Hashes in the sign-off documents are NEVER pruned

### Tooling

`team/qa/scripts/verify-transcript-hash.sh` (release engineer scaffolds per release):

```bash
#!/usr/bin/env bash
# verify-transcript-hash.sh <transcript-file> <expected-sha256>
set -eu
file="$1"
expected="$2"
actual=$(jq -S -c . "$file" | shasum -a 256 | awk '{print $1}')
if [ "$actual" = "$expected" ]; then
  echo "PASS: hash matches"
  exit 0
fi
echo "FAIL: hash mismatch" >&2
echo "  expected: $expected" >&2
echo "  actual:   $actual" >&2
exit 1
```

A scheduled spot-audit (weekly during the release cycle) re-hashes 10 % of agent transcripts and fails the release if any hash drifts.

## Human-signer audit

Human signers (release engineer, Black Unicorn maintainer) sign off via git commit with their authored identity. No external attestation needed; the git log is the audit.
