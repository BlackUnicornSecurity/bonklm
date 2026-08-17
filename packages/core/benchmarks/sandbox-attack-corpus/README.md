# Sandbox-Attack Corpus (R2-13)

Hash-pinned 50-pattern corpus consumed by the sandbox-connector graduation gate.

## Composition (R2-13, 60/20/10/10)

| Category                                    | Count  | %        |
| ------------------------------------------- | ------ | -------- |
| `CODE_INJECTION` (Python + JS dynamic exec) | 30     | 60%      |
| `PACKAGE_INSTALL`                           | 10     | 20%      |
| `PATH_TRAVERSAL`                            | 5      | 10%      |
| `SHELL_METACHAR`                            | 5      | 10%      |
| **Total**                                   | **50** | **100%** |

## Hash pin

`patterns.json` is the authoritative corpus. Its `sha256` lives in `corpus.hash`. The graduation
gate MUST consume this exact corpus by hash; any drift produces a CI failure at graduation time.

To recompute (after corpus mutation):

```bash
shasum -a 256 packages/core/benchmarks/sandbox-attack-corpus/patterns.json | awk '{print $1}' > packages/core/benchmarks/sandbox-attack-corpus/corpus.hash
```

## Curator-separation evidence (R2-13)

10 of the 50 patterns (20%) are hand-curated rather than mechanically derived from the
`CodeInjectionValidator` and `PathTraversalValidator` pattern sets. At least 5 of those 10 are
cross-referenced against CVE / OWASP-LLM-Top-10 entries filed AFTER BonkLM's most recent
`pattern-engine.ts` / `code-injection.ts` commits at the hash-pin timestamp.

The corpus + hash are the first deliverable; the CVE / OWASP date-evidence cross-reference is
populated into `evidence.md` alongside this file before the graduation PR opens. The graduation PR
cites the specific CVE / OWASP identifier per hand-curated pattern.

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

`expected_block: true` for all 50. The graduation gate measures **recall** = (blocked count) / 50;
FPR is measured against a separate benign corpus.

## Stability

This corpus is FROZEN. Any mutation (add, remove, edit) bumps the hash and triggers a graduation
re-run. Treat the file as append-only in pre-v0.7 development; mutations land via a separate "corpus
refresh" PR labelled `corpus-rev: 1+`.

The graduation gate's committed reports (`graduation-report.json` / `.txt`) are **deterministic**:
for a fixed validator build they are a pure function of this hash-pinned corpus, carry **no per-run
timestamp**, and are regenerated in place by `run-graduation-gate.mjs` (the live run time is printed
to the console only). A no-op gate run therefore leaves `git status` clean; the full
`pnpm quality-gate` run enforces this locally and fails if a gate run leaves the committed reports
changed. Do **not** reintroduce a wall-clock field into the committed reports.
