# Sandbox-Attack Corpus (R2-13)

Hash-pinned 50-pattern corpus consumed by Story 4.5's sandbox-connector graduation gate. Built at
Sprint 16 close (Story 3.2).

## Composition (R2-13, 60/20/10/10)

| Category                                    | Count  | %        |
| ------------------------------------------- | ------ | -------- |
| `CODE_INJECTION` (Python + JS dynamic exec) | 30     | 60%      |
| `PACKAGE_INSTALL`                           | 10     | 20%      |
| `PATH_TRAVERSAL`                            | 5      | 10%      |
| `SHELL_METACHAR`                            | 5      | 10%      |
| **Total**                                   | **50** | **100%** |

## Hash pin

`patterns.json` is the authoritative corpus. Its `sha256` lives in `corpus.hash` — committed at
Sprint 16 close. Story 4.5 graduation MUST consume this exact corpus by hash; any drift produces a
CI failure at graduation time.

To recompute (after corpus mutation):

```bash
shasum -a 256 packages/core/benchmarks/sandbox-attack-corpus/patterns.json | awk '{print $1}' > packages/core/benchmarks/sandbox-attack-corpus/corpus.hash
```

## Curator-separation evidence (R2-13 / iteration-2 senior-dev AAD-D)

10 of the 50 patterns (20%) are hand-curated rather than mechanically derived from the
`CodeInjectionValidator` and `PathTraversalValidator` pattern sets. Per the iteration-2 audit
DEFAULT path, ≥5 of those 10 SHOULD be cross-referenced against CVE / OWASP-LLM-Top-10 entries filed
AFTER BonkLM's most recent `pattern-engine.ts` / `code-injection.ts` commits at the hash-pin
timestamp.

Sprint 16 deliverable: this corpus + hash. Sprint 24 (Story 4.5) deliverable: the CVE / OWASP
date-evidence cross-reference, populated into `evidence.md` alongside this file, before the
graduation PR opens. The graduation reviewer MUST cite the specific CVE / OWASP identifier per
pattern in the PR description (AAD-E protocol).

## Hand-curated patterns (indices 40-49)

These 10 entries are NOT mechanically lifted from the validator regex set. They exercise encoding
bypasses, behavioural idioms, and combination attacks that the per-regex sinks individually do not
capture.

| Index | Category        | Theme                                            |
| ----- | --------------- | ------------------------------------------------ |
| 40    | code_injection  | layered-encoding decode + dynamic-call class     |
| 41    | code_injection  | crafted object-graph deserialization trigger     |
| 42    | code_injection  | function-constructor sandbox escape class        |
| 43    | code_injection  | CLI-driven inline interpreter invocation         |
| 44    | code_injection  | reverse-shell behavioural idiom                  |
| 45    | shell_metachar  | egress utility + sensitive-file read combination |
| 46    | package_install | editable git-URL install drift                   |
| 47    | package_install | path-override install drift                      |
| 48    | path_traversal  | double-URL-encoded `..`                          |
| 49    | path_traversal  | null-byte + traversal                            |

## Schema

`patterns.json` is an array of:

```json
{
  "id": "ci-001",
  "category": "code_injection",
  "subcategory": "python_dyn_call",
  "payload": "<attack-string>",
  "expected_block": true,
  "hand_curated": false,
  "notes": "optional"
}
```

`expected_block: true` for all 50. Story 4.5 measures **recall** = (blocked count) / 50; FPR is
measured against a separate benign corpus.

## Stability

This corpus is FROZEN at Sprint 16 close. Any mutation (add, remove, edit) bumps the hash and
triggers Story 4.5 graduation re-run. Treat the file as append-only in pre-v0.7 development;
mutations land via a separate "corpus refresh" PR labelled `corpus-rev: 1+`.

The graduation gate's committed reports (`graduation-report.json` / `.txt`) are **deterministic**:
for a fixed validator build they are a pure function of this hash-pinned corpus, carry **no per-run
timestamp**, and are regenerated in place by `run-graduation-gate.mjs` (the live run time is printed
to the console only). A no-op gate run therefore leaves `git status` clean; the full
`pnpm quality-gate` run enforces this locally and fails if a gate run leaves the committed reports
changed. Do **not** reintroduce a wall-clock field into the committed reports.
