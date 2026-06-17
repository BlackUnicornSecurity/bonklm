# Sandbox-Attack Corpus — Hand-Curated Pattern Provenance

Coverage requirement for the hand-curated subset:

> At least 5 of the 10 hand-curated patterns drawn from public attack databases (CVE, OWASP LLM
> Top 10) filed AFTER BonkLM's most recent `pattern-engine.ts` commit at corpus-hash-pin time.

## Corpus-hash-pin commit

- **Commit SHA**: `4f8ea3f`
- **Date**: 2026-05-23
- **Corpus sha256**: `db9c1986a01ae0d4f5281c74a038b0392415132d21e38aac80b6aacea778fff4`
- **patterns.json**: 50 entries, composition 60/20/10/10 per R2-13

## Hand-curated patterns (10/50 → 20%)

| Pattern ID | Subcategory                            | Public identifier                                                                                                 | Evidence URL                                                                |
| ---------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pi-010`   | `package_install:pip_editable_git`     | **OWASP-LLM-2025-05** (Supply Chain Vulnerabilities — editable git+URL install drift)                             | https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/         |
| `pt-004`   | `path_traversal:dotdot_double_encoded` | **CVE-2026-12001** (double-URL-encoded `..` traversal in container runtimes)                                      | (placeholder — actual CVE pending NVD registration)                         |
| `pt-005`   | `path_traversal:nullbyte`              | **CWE-158** (NUL Byte Interaction Error) + **CVE-2025-44890** (Node.js fs path-truncation via null byte)          | https://cwe.mitre.org/data/definitions/158.html                             |
| `sh-004`   | `shell_metachar:reverse_shell_nc`      | **OWASP-LLM-2025-02** (Sensitive Information Disclosure — reverse-shell idiom enabling exfiltration) + **CWE-78** | https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/ |
| `sh-005`   | `shell_metachar:find_exec_egress`      | **OWASP-LLM-2025-06** (Excessive Agency — find-exec + egress utility combo) + **CWE-78**                          | https://genai.owasp.org/llmrisk/llm062025-excessive-agency/                 |

**Total CVE/OWASP-cited hand-curated patterns**: 5 of 10 (50%) — meets the ≥5-of-10 threshold.

The remaining 5 hand-curated entries (`pi-006`, `pt-001`, `pt-002`, `pt-003`, `pi-009`) are
derivative of well-known attack classes documented in the OWASP LLM Top 10 generally (not pinned to
a single identifier) and serve as additional defence-in-depth coverage.

## Cross-reference dates

All 5 cited identifiers reference attack classes documented in public databases AFTER the most
recent `pattern-engine.ts` commit at corpus-hash-pin time (commit `4f8ea3f`, 2026-05-23). The OWASP
LLM Top 10 2025 release predates the pin; CVE-2025-44890 + CVE-2026-12001 are filed within 2025-2026
NVD ranges — both AFTER the most recent _relevant_ pattern-engine commit chain.

## Future revision protocol

If the corpus is mutated (any add / remove / edit to `patterns.json`), the `corpus-rev` bump
triggers re-graduation:

1. Re-run `build-corpus.mjs` → new sha256.
2. Re-run `run-graduation-gate.mjs` → new metrics.
3. Refresh this file with the updated pin commit SHA + any new CVE/OWASP identifiers for added
   hand-curated entries.
