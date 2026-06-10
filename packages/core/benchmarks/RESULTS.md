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
- Number citations on bonklm.com cite the `mean` column unless noted

Last run: **2026-05-26** (commit checked into source control).

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
