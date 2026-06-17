# BonkLM — Benchmark Results

Canonical performance numbers for marketing + comparison surfaces. Re-run `pnpm benchmark` to
regenerate.

## Methodology

- Suite: [`packages/core/benchmarks/benchmark.bench.ts`](./benchmark.bench.ts)
- Runner: `vitest bench`
- Hardware: Apple Silicon (M-series), single core, no thermal throttling
- Runtime: Node 22, no LLM-in-loop validators enabled
- Each row reports `hz` (operations/sec), `mean` (ms), `p75`, `p99`, `p99.9` — sampled until `±rme`
  stabilises
- Number citations on bonklm.com cite the `mean` column of the canonical suite (above the indicative
  section) unless noted
- Indicative micro-benchmarks: `pnpm benchmark:micro` (log-sanitizer hot path + credential / PII
  scrubber overhead) and `pnpm benchmark:cold-start` (package import / cold-start cost)
- Canonical engine target: full-engine **P99 < 200 ms** (long-form, ≤ 6 KB) / **< 100 ms**
  (short–medium); per-validator **5–50 ms**. Most numbers here clear it by 2–3 orders of magnitude
  (the long-form full-engine row by ~1).

Last run: **2026-05-26** (marketing-canonical suite, committed). Indicative micro-benchmarks
(log-sanitizer / scrubber / cold-start) added **2026-06-17** — see the indicative section below.

## Single Validator — PromptInjectionValidator

| Input                    |     hz |         mean |      p75 |      p99 |
| ------------------------ | -----: | -----------: | -------: | -------: |
| short text (10ms target) | 24,339 | **0.041 ms** | 0.041 ms | 0.069 ms |

## Single Validator — JailbreakValidator

| Input                                |     hz |         mean |      p75 |      p99 |
| ------------------------------------ | -----: | -----------: | -------: | -------: |
| short text (10ms target)             | 24,339 | **0.041 ms** | 0.041 ms | 0.069 ms |
| with jailbreak pattern (10ms target) |  4,523 | **0.221 ms** | 0.217 ms | 0.396 ms |

## Single Guard — SecretGuard

| Input                             |      hz |         mean |      p75 |      p99 |
| --------------------------------- | ------: | -----------: | -------: | -------: |
| short text (5ms target)           | 247,925 | **0.004 ms** | 0.004 ms | 0.010 ms |
| with API-key pattern (5ms target) | 227,651 | **0.004 ms** | 0.004 ms | 0.011 ms |

## Full GuardrailEngine — 2 validators + 1 guard

| Input                                        |     hz |         mean |      p75 |      p99 |
| -------------------------------------------- | -----: | -----------: | -------: | -------: |
| short text (100ms target)                    | 18,291 | **0.055 ms** | 0.055 ms | 0.085 ms |
| medium text (100ms target)                   |  3,205 | **0.312 ms** | 0.320 ms | 0.483 ms |
| long text — Lorem ipsum × 100 (200ms target) |     71 |  **14.0 ms** |  14.6 ms |  15.3 ms |

## Concurrent

| Input                                    |    hz |         mean |      p75 |      p99 |
| ---------------------------------------- | ----: | -----------: | -------: | -------: |
| 10 concurrent validations (100ms target) | 1,222 | **0.818 ms** | 0.855 ms | 1.070 ms |

## Indicative micro-benchmarks (dev — NOT marketing-canonical)

Single-core Apple Silicon (M-series), Node 25, @ source `73061e4`. These are dev-indicative hot-path
numbers for the log sanitizer and the secret / PII scrubbers — re-run with `pnpm benchmark:micro`.
Do **not** cite these in marketing copy; cite the canonical suite above.

### Log-sanitizer hot path — `sanitizeLogString`

`sanitizeLogString` truncates to `maxLen` (default 500), so the hot path is bounded at ~500 chars.

| Input                                                     |     hz |          mean |       p75 |       p99 |
| --------------------------------------------------------- | -----: | ------------: | --------: | --------: |
| clean short (~40 chars, fast path)                        |  4.1 M | **0.0002 ms** | 0.0003 ms | 0.0004 ms |
| clean ~560 chars (engages maxLen=500 truncation)          |  1.7 M | **0.0006 ms** | 0.0006 ms | 0.0007 ms |
| control/bidi-dense at cap (~500 chars, work path)         | 36.8 k |  **0.027 ms** |  0.027 ms |  0.035 ms |
| control/bidi-dense ~6 KB, `maxLen`=100k (unbounded worst) |  3.1 k |  **0.324 ms** |  0.323 ms |  0.430 ms |

### Scrubber overhead — credential + PII redaction

| Input                                             |     hz |          mean |       p75 |       p99 |
| ------------------------------------------------- | -----: | ------------: | --------: | --------: |
| `redactCredentials` — clean prose (no redaction)  | 2.19 M | **0.0005 ms** | 0.0005 ms | 0.0006 ms |
| `redactCredentials` — secret-laden                |  172 k | **0.0058 ms** | 0.0058 ms |  0.012 ms |
| `redactPIIInStringSync` — clean prose (no hit)    |  457 k | **0.0022 ms** | 0.0021 ms | 0.0071 ms |
| `redactPIIInStringSync` — PII-laden               |  242 k | **0.0041 ms** | 0.0040 ms |  0.010 ms |
| `redactPIIInStringSync` — clean ~6 KB (full scan) | 13.0 k |  **0.077 ms** |  0.078 ms |  0.113 ms |

### Cold-start / import-cost — `pnpm benchmark:cold-start`

Fresh `node` process per sample (20 samples). `import` = module load + eval; full = node boot +
import.

| Metric                               | median |  mean |   p95 |
| ------------------------------------ | -----: | ----: | ----: |
| `import('@blackunicorn/bonklm')`     |  34 ms | 34 ms | 35 ms |
| full cold-start (node boot + import) |  85 ms | 86 ms | 90 ms |

> StreamValidator streaming throughput is measured separately on the reference Linux/GPU host and is
> not part of this single-core macOS sheet.

## Citation-safe phrasing for marketing copy

- Single validator, short prompt: **p50 ~0.04 ms (~40 µs)** in-process — single-core M-series.
- Full engine (2 validators + 1 guard), short prompt: **p50 ~0.05 ms (~55 µs)**, p99 ~0.09 ms.
- Full engine, long-form prompt (~6 KB Lorem ipsum corpus): **p50 ~14 ms**, p99 ~15 ms.
- Engine throughput on a single core: **~18 k validations/sec** at short-prompt scale.

All numbers are in-process — no network hop. LLM-in-loop validators inherit upstream model latency
separately.

## Caveats (must accompany every public citation)

1. Single-machine numbers. Real-world hardware varies — production deployments should re-run the
   suite on their own infra and cite that.
2. Deterministic-validators only. If you wire an ML-based validator into the chain (Lakera, an
   in-house classifier, etc.) the chain inherits its latency.
3. Pattern catalogues evolve. The numbers above reflect the v1.0.0-rc.4 patterns. Future minor
   versions may add patterns and shift the numbers; re-run before re-quoting.
4. Short / medium / long correspond to the test fixtures in `benchmark.bench.ts` — short is 19
   chars, medium ~160 chars, long ~5.6 KB.
