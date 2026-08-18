# Performance & Benchmarks

Last updated: 2026-06-01

BonkLM is a deterministic pattern + structural guardrail engine. This document covers the engine's
performance budgets, the in-repo benchmark corpus, the CI gates that enforce performance
regressions, the tuning knobs available to operators, and how to measure actual latency in
production.

## 1. Overview

A validate call spends time in four places, in roughly this order:

1. **Pattern-engine regex evaluation** — per-validator `RegExp.test` / `.exec` calls, bounded per
   regex by `patternTimeout`.
2. **Structural walk** — tool-call arg traversal, composed-context bidirectional concat,
   retrieved-doc shape inspection.
3. **Hook + guard chain** — pre/post hooks (`HookManager` / `EdgeHookManager`) and the
   post-validator `guards[]` chain (string-only).
4. **Serialization** — telemetry collector emit + OTel span construction when `bonklmTrace` is
   wired.

Positioning vs network-call moderation (Lakera, OpenAI Moderation): the architecture target
documented in `docs/architecture.md` §10 is "zero network round-trips, predictable latency (<10ms
typical)". The deliberate trade-off is breadth-vs-depth on multilingual recall — see
`known-limitations.md` §4. BonkLM is designed as a deterministic short-circuit in front of ML
moderation services, not a replacement.

## 2. Default performance budgets

All defaults live in `GuardrailEngineConfig`
(`packages/core/src/engine/GuardrailEngine.types.ts:188-216`) and are documented in
`docs/architecture.md` §7. Operators override per-engine at construction time.

| Field                     | Default                  | What it bounds                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validationTimeout`       | `5000` ms                | Per-validator end-to-end budget. Enforced by connectors via `validateWithTimeoutSecure` (`connector-utils/timeout-wrapper.ts`) — `Promise.race` with sentinel-on-timeout. Connectors that ship their own timeout (Mistral, Inngest, Trigger.dev) override at wrap time. |
| `patternTimeout`          | `100` ms                 | Per-regex ReDoS budget. The `MAX_PATTERN_TIME_MS` constant; the engine checks `Date.now() - startTime > patternTimeout` per pattern. Catastrophic-backtracking regexes are rejected at pattern-engine build time by `pattern-engine.ts` lint.                           |
| `maxBufferSize`           | `1_048_576` bytes (1 MB) | Stream-buffer cap. Violations call `circuitBreaker.recordViolation()` and throw `StreamValidationError`.                                                                                                                                                                |
| `circuitBreakerThreshold` | `3` violations           | Count of buffer-overflow violations before the breaker trips OPEN.                                                                                                                                                                                                      |
| `circuitBreakerTimeout`   | `60_000` ms (1 minute)   | How long the breaker stays OPEN before transitioning to HALF_OPEN. CLOSED on next successful validate.                                                                                                                                                                  |

The engine refuses to construct with `validators: []` AND `guards: []` unless
`allowEmptyForTesting: true` is set (a deliberate fail-safe) — this is a correctness gate, not a
performance gate, but it prevents the zero-cost no-op engine antipattern.

## 3. Benchmark corpus

The in-repo benchmark suite lives at `packages/core/benchmarks/`.

### Vitest benchmarks (`*.bench.ts`)

- **`benchmark.bench.ts`** — single-validator and full-engine micro-benchmarks across short / medium
  / long / injection-bearing inputs. Stated targets (from the file header + `bench` labels): <10 ms
  single validator on short/medium text; <50 ms single validator on long text; <100 ms full engine
  (2 validators + 1 guard); <200 ms full engine on long text; <100 ms for 10 concurrent validations.
- **`composed-context.bench.ts`** — `createComposedContextValidator` hot path at the 32 KB soft cap.
  Stated target: P99 < 200 ms on 32 KB input, both benign and attack variants. Two-pass
  forward+reverse scan is baked into the validator design to defeat order-dependent payload splits
  (`known-limitations.md` §8).

Actual checked-in benchmark numbers live in `packages/core/benchmarks/RESULTS.md` (last run:
2026-05-26). The benchmark CI job uploads `.last-run.log` as an artifact (`benchmark-output`, 7-day
retention) — see §4.

### Hash-pinned attack corpora (recall + FPR gates)

- **`sandbox-attack-corpus/`** — hash-pinned 50-pattern corpus consumed by the sandbox-connector
  graduation gate. Composition: 60 % `CODE_INJECTION`, 20 % `PACKAGE_INSTALL`, 10 %
  `PATH_TRAVERSAL`, 10 % `SHELL_METACHAR`. `patterns.json` is hashed to `corpus.hash` and any drift
  fails CI. Latest reported metrics (`graduation-report.txt`, deterministic for a fixed validator
  build): recall 100 % (threshold ≥ 95 %), FPR 0 % (threshold ≤ 5 %), precision 100 % (threshold ≥
  80 %).
- **`multilingual-corpus/`** — per-language TP (20) + TN (20) corpora for `MultilingualDetector`
  per-language recall and FPR measurement. Status table in the folder README; current Tier-2
  measured baselines are `bn` 75 % recall / 0 % FPR, `ur` 80 % recall / 0 % FPR; Tier-1 languages do
  not yet have TP/TN corpora landed. Multilingual Pass 2 was retired — see `known-limitations.md`
  §25.

## 4. CI performance gates

`.github/workflows/ci.yml` runs two performance-relevant jobs on every commit (both gated on `test`
success per architect review):

### `benchmark` job

Runs `pnpm run benchmark` (the full Vitest bench suite) and applies a NaN/Infinity/`[ERROR]` regex
guard against the captured log:

- `\bNaN` or `\bInfinity` in benchmark output fails the build (broken measurement).
- `[ERROR] Error in (guard|validator)` in benchmark output fails the build (engine catch-site fired
  during the bench is an interface or contract violation — a lesson learned from a prior
  SecretGuard-context regression).

The benchmark log is uploaded as `benchmark-output` artifact for 7 days. There is currently **no
absolute-latency CI gate** beyond the broken-measurement guard — the bench files document targets in
their `bench` labels, but a regression that stays a valid number is not auto-rejected.

### `sandbox-gate` job

Runs `packages/core/benchmarks/sandbox-attack-corpus/run-graduation-gate.mjs`. The script exits
non-zero on ANY of:

- Recall < 95 % against the 50-attack corpus.
- FPR > 5 % against the 50-benign corpus.
- Precision < 80 %.
- Corpus hash drift from the pinned hash
  (`e3661e5c808ac604d894e6ead5dcc27960143f45927928d64ebfe64629b5302b`).

Report files (`graduation-report.json` + `.txt`) are uploaded as `sandbox-graduation-report`
artifact for 30 days.

## 5. Tuning knobs

Practical guidance for operators wiring `GuardrailEngine` into latency- sensitive paths.

### `executionOrder: 'parallel'`

Default `'sequential'` runs validators in chain order with short-circuit on the first
`blocked: true`. `'parallel'` runs every validator via `Promise.all` and aggregates after all
settle.

- **Worth it when**: validators are mutually independent AND blocking is rare on the hot path. Total
  wall-clock approaches the slowest validator's time instead of the sum.
- **Not worth it when**: the chain typically short-circuits early (e.g. `SecretValidator` first in
  chain catching most production traffic). Parallel mode pays for every validator on every call.
- Parallel mode disables short-circuit at the validator phase (per `docs/architecture.md` §7) — the
  per-validator timeout still applies.

### `cachedValidate` (replay-aware runtimes)

The `cachedValidate` wrapper (`packages/core/src/engine/cached-validator.ts`) memoizes validator
outputs through a pluggable `ValidatorCache` (default `InMemoryLRUCache`). Each engine carries an
`instanceId` (`getInstanceId()`) consumed by `createSaltedKeyFn` to salt cache keys — this prevents
cross-engine cache poisoning when multiple engines share one cache backend.

Use it for:

- **Inngest / Trigger.dev steps** — deterministic replay needs deterministic validator outputs.
  Without the cache, retried steps re-evaluate every regex.
- **Temporal / Restate workflows** — same replay semantic.

Pair with `AbortTaskRunError` / `NonRetriableError` on deterministic BLOCKs to avoid replay-storm
DoS — see `known-limitations.md` §12.

### `validationInterval` (streaming)

`StreamValidator` runs validators on the accumulated buffer at every `validationInterval` characters
(or punctuation boundary). Shorter interval = catches injections sooner but burns more CPU. Longer
interval = less work but later detection.

- Default `minBufferBeforeRelease: 256` chars or first sentence boundary (`docs/architecture.md`
  §5).
- Flips to `Infinity` (full-response mode) when `chainHasSecretOrPii: true` — the only setting that
  prevents partial-leak.
- For chat surfaces with sub-second TTFT (time-to-first-token) targets, consider reducing the
  interval to ~64–128 chars. Measure end-to-end before tuning.

### Sensitivity vs latency

The `sensitivity: 'strict' | 'standard' | 'permissive'` global hint modifies validator behaviour.
`'strict'` enables more patterns and deeper structural checks per validator; `'permissive'` skips
lower- confidence patterns. Individual validators may override the global.

This is primarily a recall vs FPR knob, not a latency knob — but `'strict'` does enable more regex
evaluations per call. Profile both modes against your representative corpus before settling.

### Reducing validator count for hot paths

The fastest validator is the one you don't run. Two patterns:

1. **Surface-specific engines** — construct separate `GuardrailEngine` instances per surface (user
   input vs tool args vs retrieved docs) with only the validators relevant to that surface. Avoids
   running `RetrievedDocValidator` on raw user input, etc.
2. **Pre-filter cheap checks first** — order `SecretValidator` and `CodeInjectionValidator` early in
   the chain when short-circuit is enabled; both have small pattern sets and high BLOCK rates on the
   payloads they target.

## 6. Production telemetry for latency

Two collection paths ship in core (`docs/architecture.md` §8).

### `bonklmTrace` (OTel spans)

`bonklmTrace(result, opts)` (`packages/core/src/telemetry/otlp-export.ts`) emits one OTLP span per
validator decision. Per-validator latency is the standard span `duration_ms` (end - start, recorded
by the tracer). The locked attribute vocabulary on each span:

- `bonklm.validator` — validator name.
- `bonklm.severity` — `info | warning | blocked | critical`.
- `bonklm.action` — `allow | block`.
- `bonklm.finding_count` — number of findings.
- `bonklm.surface` — one of 7 surface strings.

Caller passes any `@opentelemetry/api`-compatible `Tracer`. Verified ingests: Langfuse, Phoenix,
Arize AX, VoltOps, Datadog — see `docs/user/otel-vendor-recipes.md` for wiring.

### `TelemetryService` (event collector)

`TelemetryService` (`packages/core/src/telemetry/TelemetryService.ts`) emits a 15-event vocabulary
including `validation.start` and `validation.complete`. The `validation.complete` event's `metrics`
object (`TelemetryMetrics`, `TelemetryService.ts:37-54`) carries:

- `duration` — milliseconds.
- `validatorCount`, `findingCount`, `riskScore`, `charCount`, `tokenCount`, `retryCount`.
- Custom `[key: string]: number` keys for collector-defined metrics.

Both `runId` and `operation` are passed through `sanitizeMeta` at the collect boundary (ADR-0001,
CWE-117).

### Recommended dashboards

- **Per-validator latency P50/P95/P99** keyed on `bonklm.validator` and `bonklm.surface`.
- **BLOCK rate** keyed on `bonklm.validator` × `bonklm.surface` to spot drift in trigger frequency
  (helps tune short-circuit ordering).
- **Circuit-breaker state transitions** via the `circuit.*` events (`circuit.open`,
  `circuit.half_open`, `circuit.close`) — surface any production tripping of the `maxBufferSize` /
  threshold defaults.
- **Stream-validator chunk count** via `stream.chunk` to size `validationInterval` against actual
  traffic shape.

## 7. Known performance limitations

Performance-adjacent items from `docs/user/known-limitations.md`:

- **§5 Streaming partial-leak window** — `minBufferBeforeRelease: 256` releases the first 256 chars
  before validation; only `minBufferBeforeRelease: Infinity` (auto-flipped when
  `chainHasSecretOrPii: true`) is leak-free. Trade-off: full-response mode delays TTFT to the entire
  response duration.
- **§8 Composed-context bidirectional scan** — forward+reverse passes defeat order-dependent splits
  but a 3+ entry cross-permutation can slip past. The 32 KB soft cap and 200 KB hard cap bound
  attacker payload size and the per-bench P99 < 200 ms budget.
- **§22 AudioStreamValidator partial path is ASCII-fold only** — the zero-allocation hot-path
  contract (AC-c, <100 ms on 1 KB partial transcript) precludes NFKD normalisation on the partial
  path. Homoglyph attacks bypass `validatePartial`; `validateFinal` runs the full normalised stack.
- **§23 AudioStreamValidator one-instance-per-session** — sharing one instance across concurrent
  sessions causes state leakage. Use `validator.fork()` per session.

## 8. Reporting performance regressions

- **Vulnerability-class regression** (a regex pattern that ReDoS's, a buffer-overflow guard that
  fails open, a circuit-breaker that doesn't trip): follow `SECURITY.md`. Do NOT open a public
  GitHub issue.
- **Throughput / latency regression** (a P99 doubling, a benchmark baseline drift, a connector
  overhead spike): open a GitHub issue against `BlackUnicorn-Crypto/llm-guardrails` with the
  `performance` label.

Include:

- Node version (`node --version`) and runtime (Node / Workerd / Vercel Edge / Cloudflare / Deno /
  Bun).
- BonkLM version (`@blackunicorn/bonklm` and any connector packages).
- Validator chain (validator names, order, `executionOrder` setting, any non-default
  `validationTimeout` / `patternTimeout`).
- Corpus shape (representative input size distribution, BLOCK rate observed in production if known).
- Before/after measurement — wall-clock or P99 from your telemetry, with the time window and call
  volume the measurement covers.
- A minimal reproduction via the in-repo bench harness if possible
  (`packages/core/benchmarks/benchmark.bench.ts` pattern).

## See also

- `docs/architecture.md` §5 (threading), §7 (config), §8 (telemetry), §9 (CI gates), §10 (design
  trade-offs).
- `docs/user/known-limitations.md` §5, §8, §22, §23 (performance- adjacent limitations).
- `docs/user/otel-vendor-recipes.md` (Tracer wiring for production latency dashboards).
- `packages/core/benchmarks/` (bench files + hash-pinned corpora).
