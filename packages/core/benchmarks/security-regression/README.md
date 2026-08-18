# Security-Regression Gate (content surface)

Deterministic, offline replay of the committed, labelled corpora through every content-surface
detection component, failing on ANY per-component recall/FPR regression versus the committed
baseline (`baseline.json`).

## Why

The heavyweight corpus-replay evidence (dojoLM dual-accredited fixtures, Gate-5 recall floors) lives
under the gitignored `team/` tree with external corpus roots, so it cannot be a repo-default gate —
yet a security SDK whose quality gate prints `security-regression: SKIP` is not defensible. This
runner closes that gap using only in-repo, committed, hash-pinned corpora:

- `benchmarks/sandbox-attack-corpus/` — attack patterns verified by its own `corpus.hash`; the
  **benign corpus (the FPR denominator) is pinned by this gate's `corpus-integrity.hash`** — a
  benign-entry deletion could otherwise mask an FPR regression.
- `benchmarks/multilingual-corpus/<lang>/` — true-positives + true-negatives per language, pinned by
  the same `corpus-integrity.hash`.

## Semantics — baseline regression, NOT absolute floors

Each component's per-corpus recall may only go UP and FPR may only go DOWN versus `baseline.json`
(1e-9 epsilon for float formatting). The baseline is the measured behavior at gate-creation time —
no invented thresholds; the ratified Gate-5 floors stay with the internal team/ evidence.

Measurement is PER-COMPONENT, not union: a union baseline would mask a single detector's regression
whenever a sibling still catches the payload. Each of the content-surface components (six advertised
classes + Secret/PII/XSS/BashSafety guards + EncodedRescan/HarmIntent/ SocialEngineering layers,
typeof-guarded) is measured alone across every corpus.

## Run

```bash
pnpm --filter @blackunicorn/bonklm build   # gate replays the BUILT core
node packages/core/benchmarks/security-regression/run-gate.mjs
```

Wired into the local quality gate (`scripts/quality-gate.sh`, default for `BONKLM_SEC_REGRESSION`)
and the CI UAT Harness job. Deterministic: no wall-clock values, fixed insertion-order
serialization, 4-dp floats — a no-op re-run is byte-stable.

## Re-baselining (intentional trade-offs only)

If a detection change intentionally trades a corpus metric, regenerate with reviewer sign-off and
commit the diff for review (tarball-snapshot regen discipline):

```bash
node packages/core/benchmarks/security-regression/run-gate.mjs --regen-baseline
```

If a MEASURED corpus input itself changes, the `corpus-integrity.hash` pin fails first; re-pin and
re-baseline together, both with reviewer sign-off:

```bash
node packages/core/benchmarks/security-regression/run-gate.mjs --regen-hash
node packages/core/benchmarks/security-regression/run-gate.mjs --regen-baseline
```

(The sandbox attack patterns re-pin via the sandbox corpus's own documented procedure —
`corpus.hash` there, `corpus-integrity.hash` here.)
