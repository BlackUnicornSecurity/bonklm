# BonkLM Architecture

> Last updated: 2026-06-03 Audience: senior engineers onboarding to `@blackunicorn/bonklm`. Project
> version: `1.0.0-rc.4`. Source of truth: `packages/core/package.json` + the `[1.0.0-rc.4]`
> CHANGELOG entry. Root `package.json` (private; repo metadata only) is aligned to the same version.
> Per [CONTRIBUTING.md](../CONTRIBUTING.md#versioning-changesets-and-releases), the changeset
> `linked` group releases together. Scope: this is a _what exists in the source_ doc. Aspirational
> design lives in internal planning notes. Cross-references point at the load-bearing files.

## 1. System overview

BonkLM is a **deterministic, framework-agnostic, provider-agnostic Node.js library for LLM
application security**. It composes pattern + structural validators (`Validator`) and content guards
(`Guard`) behind a single orchestrator (`GuardrailEngine`) and ships 52 publishable workspace
packages, including connectors that wire that orchestrator into specific SDKs (OpenAI, Anthropic,
LangChain, Vercel AI SDK, ElizaOS, LiveKit, E2B, Pinecone, …). The core engine is Node-first; a
portable subset (`@blackunicorn/bonklm/edge`) runs on Workerd (with `nodejs_compat`) / Deno / Bun —
Node-compatible edge runtimes, not strict Vercel Edge (`edge-light`); see §6. BonkLM is **NOT** an
ML model, **NOT** a WAF, **NOT** a sandbox — it is a deterministic in-process detection + redaction
layer that runs in your call path BEFORE the LLM and (optionally) on the way back. See
`packages/core/src/index.ts` and `README.md`.

## 2. The 7-surface model

`HookSurface` is a closed 7-string vocabulary locked at
`packages/core/src/engine/GuardrailEngine.types.ts:21-28`. It is the canonical taxonomy referenced
by every connector, hook registration, OTel attribute (`bonklm.surface`), and validator routing
decision. Synonyms (`prompt`, `output`, `tool_args`) are forbidden.

```
                         ┌─────────────────────────────────────────┐
                         │            GuardrailEngine              │
                         │  (packages/core/src/engine/             │
                         │   GuardrailEngine.ts)                   │
                         │                                         │
                         │  ┌─────────────┐    ┌──────────────┐    │
caller surfaces  ──────► │  │ validators[]│ ─► │  guards[]    │    │
                         │  └─────────────┘    └──────────────┘    │
                         │         │                  │            │
                         │         ▼                  ▼            │
                         │   aggregateResults() → EngineResult     │
                         │         │                               │
                         │         ▼                               │
                         │   invokeInterceptCallbacks(...)         │
                         └─────────────────────┬───────────────────┘
                                               │
                                               ▼
                                       ┌──────────────┐
                                       │  connector   │ ──► LLM / vector DB / sandbox / voice
                                       └──────────────┘

  Validator surfaces (ValidatorInput.kind, GuardrailEngine.types.ts:38-68):
    text                — wraps a string for legacy validators
    tool_call           — { toolName, args }
    retrieved_docs      — { docs: [{ id?, content, metadata? }] }
    memory_write        — { payload: { content, userId?, sessionId?, metadata? } }
    composed_context    — { entries: string[] }
    audio_partial       — { content, isFinal? }

  HookSurface vocabulary (`bonklm.surface` OTel attribute):
    text_input          text_output       tool_call          retrieved_doc
    memory_write        audio_partial     composed_context
```

The per-surface composite validators (`createToolCallArgsValidator`, `createRetrievedDocValidator`,
`createMemoryWriteValidator`, `createComposedContextValidator`) all live under
`packages/core/src/validators/`. Surface-to-validator mapping and connector-coverage tables are in
`docs/user/threat-surfaces.md`.

## 3. Core components

| Component                                                        | Role                                                                                                                                                                                                                                                                                            | File                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GuardrailEngine`                                                | Orchestrator: runs `validators[]` then `guards[]`, short-circuits on first block, aggregates findings, fires `onIntercept` callbacks. Holds a per-instance `instanceId` for cache-salt isolation.                                                                                               | `packages/core/src/engine/GuardrailEngine.ts`                                      |
| `Validator` interface                                            | `validate(input: string \| ValidatorInput): GuardrailResult \| Promise<GuardrailResult>`. Frozen `@public` at v1.0-RC1.                                                                                                                                                                         | `packages/core/src/engine/GuardrailEngine.types.ts:84-98`                          |
| Validators (pattern + composite)                                 | `PromptInjectionValidator`, `JailbreakValidator`, `ReformulationDetector`, `MultilingualDetector`, `AudioStreamValidator`, `CodeInjectionValidator`, `PathTraversalValidator` + the four composites in §2.                                                                                      | `packages/core/src/validators/` (20 files; barrel at `index.ts`)                   |
| `Guard` interface                                                | `validate(content: string, context?: string): GuardrailResult \| Promise<GuardrailResult>`. Frozen `@public`. Fires only on `engine.validate(string)`, **not** on `engine.validateInput(ValidatorInput)` — see §10 trade-off note.                                                              | `packages/core/src/engine/GuardrailEngine.types.ts:107-117`                        |
| Guards                                                           | `SecretGuard`, `PIIGuard`, `BashSafetyGuard`, `XSSGuard`, `ProductionGuard` (env helpers).                                                                                                                                                                                                      | `packages/core/src/guards/` (barrel at `index.ts`)                                 |
| `HookManager` / `HookSandbox` / `EdgeHookManager`                | Lifecycle hooks per `HookPhase × HookSurface`. `HookSandbox` runs string handlers in `node:vm` with a deny-list pattern check; `EdgeHookManager` refuses string handlers (no `node:vm` on edge).                                                                                                | `packages/core/src/hooks/index.ts`, `HookSandbox.ts`, `EdgeHookManager.ts`         |
| `TelemetryService` + `bonklmTrace`                               | Centralised event collector (sample-rated, buffered) + OTLP span exporter with the R2-10 locked attribute vocabulary. Caller-provides `Tracer`; works with any `@opentelemetry/api`-compatible implementation.                                                                                  | `packages/core/src/telemetry/TelemetryService.ts`, `otlp-export.ts`                |
| Logger (`sanitizeLogString` / `sanitizeMeta` / `serializeError`) | CWE-117 boundary — every emit site that interpolates attacker-influenceable strings runs through one of these. Canonical primitive is `sanitizeLogString` (hex-escape, 500-char cap, `\r\n` → literal `\n`). See ADR-0001.                                                                      | `packages/core/src/common/index.ts`, `packages/core/src/connector-utils/logger.ts` |
| Connector-utils                                                  | Shared primitives every connector imports: `ConnectorValidationError`, `StreamValidator` + `BufferedReleaseGate`, `assertNotWrapped`/`markWrapped` (wrap-sentinel), `validateWithTimeoutSecure`, `applyRetrievedDocValidatorToMatches`, `adaptValidatorToUniversalInput`, `sanitizeReasonText`. | `packages/core/src/connector-utils/` (barrel at `index.ts`)                        |
| `cachedValidate`                                                 | Memoization for replay-aware runtimes (Inngest, Trigger.dev, Temporal, Restate). Pluggable `ValidatorCache`; default `InMemoryLRUCache`; `createSaltedKeyFn(engine.getInstanceId())` prevents cross-engine cache poisoning.                                                                     | `packages/core/src/engine/cached-validator.ts`                                     |

## 4. Connector pattern (canonical shape)

Connector authoring is governed by six locked shapes documented in
`docs/user/connector-style-guide.md`. The three most common are sketched below. All three MUST
surface failures as `ConnectorValidationError`, log via `logValidationFailure`, and apply the
wrap-sentinel defence.

### 4a. SDK / client wrap (shape #1, e.g. `wrapAgent`, `wrapMem0Client`)

```
caller              wrapped client (Proxy)            real SDK client
  │                          │                              │
  │── invoke method ────────►│                              │
  │                          │── build ValidatorInput ──┐   │
  │                          │   ({ kind, payload, … }) │   │
  │                          │                          ▼   │
  │                          │            engine.validate / .validateInput
  │                          │                          │   │
  │                          │ ◄────── GuardrailResult ─┘   │
  │                          │                              │
  │                          │ if !allowed: throw ConnectorValidationError
  │                          │ else        : Reflect.apply ►│
  │                          │                              │── original call ─►
  │                          │ ◄──────────── response ──────│
  │ ◄───── response ─────────│                              │
```

Subject is 1st positional arg, engine 2nd, options 3rd. Connectors return a NEW object (Proxy) —
never mutate the subject in place. Two documented exceptions: `installSealedWrapMemory` (ElizaOS,
uses `Object.defineProperty({ writable: false })`) and `wrapRealtime` (OpenAI Agents, pushes into
`session.outputGuardrails`).

### 4b. Web framework middleware (shape #3, e.g. `bonkMiddleware`, `honoGuardrails`, Express/Fastify/NestJS)

Engine is 1st positional arg; framework signature dictates the second. Runs
`engine.validate(reqBody)` in the inbound leg, optionally `engine.validate(responseBody)` in the
outbound leg, attaches structured findings to the framework's error path, and emits OTel spans via
`bonklmTrace` when a tracer is configured.

### 4c. Memory-client wrap (shape #2 + sealed `wrapMemory`)

Specialised SDK wrap that routes write methods through `createMemoryWriteValidator` and recall
methods through `createComposedContextValidator` built ONCE at wrap time. ElizaOS adds sealed
`wrapMemory` on top: replaces `runtime.createMemory` / `runtime.updateMemory` via
`Object.defineProperty({ writable: false, configurable: false })` with closure-captured
source-trust + verified-publisher allowlist + `metadata.bonklmTrust` marker. Function-only API (no
string config) because the sealing path must be tamper-resistant.

## 5. Threading & async model

- The engine is **single-threaded JavaScript**. `executionOrder: 'sequential'` (default) runs
  validators in chain order with early short-circuit on the first `blocked: true`; `'parallel'` runs
  them via `Promise.all` and only blocks at aggregation time. See
  `GuardrailEngine.ts:runValidatorsSequential` / `runValidatorsParallel`.
- Each validator may return sync OR async (`GuardrailResult | Promise<…>`). The engine `await`s
  every result before aggregation.
- **Timeouts** are connector-owned, not engine-owned. Every connector uses the canonical
  `validateWithTimeoutSecure` helper (`packages/core/src/connector-utils/timeout-wrapper.ts`) — a
  `Promise.race` with sentinel-on-timeout, post-timeout-rejection absorption, memoized sentinel
  factory, and a `TypeError` throw on misconfigured `timeoutMs ≤ 0`. This replaces the broken
  `AbortController` pattern previously copy-pasted across 20+ connectors (Sprint 29 audit).
- **Wrap-sentinel** (`assertNotWrapped` + `markWrapped` + `ensureWrappedOnce`,
  `connector-utils/wrap-sentinel.ts`) defeats double-wrap silent bypass. Marker is a non-enumerable,
  non-writable, non-configurable property keyed by a per-connector
  `Symbol.for('bonklm.<connector>.wired')`. Re-wrapping throws with a clear stack pointing at the
  offending connector.
- **Stream lifecycle**: `StreamValidator` (`connector-utils/stream-validator.ts`) buffers chunks,
  runs validators at a configurable `validationInterval`, and releases through a
  `BufferedReleaseGate`. The release threshold (`minBufferBeforeRelease`) defaults to 256 chars or
  first sentence boundary; flips to `Infinity` (full-response mode) when `chainHasSecretOrPii: true`
  — the only setting that prevents partial-leak. See `known-limitations.md` §5.

## 6. Edge vs Node runtime split

- `package.json` for `@blackunicorn/bonklm` declares an `./edge` subpath with workerd / deno / bun
  conditional exports (plus `import` for Node). All three edge runtimes resolve to
  `dist/edge/index.js`. The `edge-light` (strict Vercel Edge) condition is intentionally not
  declared — the edge surface transitively uses Node built-ins
  (`node:fs`/`node:path`/`node:crypto`), so it requires a Node-compatible edge runtime (`workerd`
  with `nodejs_compat`, Deno, Bun).
- `packages/core/src/edge/index.ts` exports the portable subset: engine, base types, all primary
  validators (`PromptInjectionValidator`, `JailbreakValidator`, `ReformulationDetector`,
  `BoundaryDetector`, `MultilingualDetector`), all four composites, all content guards except
  `ProductionGuard` (whose `isProductionEnvironment` / `isTestEnvironment` helpers are exported
  instead), `StreamValidator`, `BufferedReleaseGate`, the connector-utils error classes + log
  helpers, the portable codec helpers (`base64DecodeToUtf8`, `hexDecodeToUtf8`,
  `portableRandomUUID`), and `EdgeHookManager` + `assertAsyncLocalStorageHealthy`.
- **NOT available on edge**: `HookSandbox` (uses `node:vm`), `OverrideToken` HMAC validator (uses
  `node:crypto.timingSafeEqual`). Edge consumers wanting custom hooks use `EdgeHookManager` with
  **function** handlers only — string handlers throw `ConnectorValidationError`
  (`EdgeHookManager.ts:132-150`).
- Edge-string-handler migration guidance: `docs/user/migration/edge-string-handlers.md`.
- Bundle target labels per package (NODE / EDGE / ISO): `docs/user/package-matrix.md`.

## 7. Configuration model

`GuardrailEngineConfig` (`engine/GuardrailEngine.types.ts:127-228`) is the single config object
accepted by `new GuardrailEngine({…})`:

| Field                                               | Type                                        | Default         | Notes                                                                                  |
| --------------------------------------------------- | ------------------------------------------- | --------------- | -------------------------------------------------------------------------------------- |
| `validators`                                        | `Validator[]`                               | `[]`            | Empty list THROWS unless `allowEmptyForTesting: true` (Story 0.1 fail-safe).           |
| `guards`                                            | `Guard[]`                                   | `[]`            | Run AFTER validators. Skipped by `validateInput`.                                      |
| `shortCircuit`                                      | `boolean`                                   | `true`          | Stop at first `blocked: true`.                                                         |
| `executionOrder`                                    | `'sequential' \| 'parallel'`                | `'sequential'`  | Parallel disables short-circuit at validator phase.                                    |
| `sensitivity`                                       | `'strict' \| 'standard' \| 'permissive'`    | `'standard'`    | Global hint; individual validators may override.                                       |
| `action`                                            | `'block' \| 'sanitize' \| 'log' \| 'allow'` | `'block'`       | `'log'` and `'allow'` force `allowed: true` at aggregation time.                       |
| `overrideToken`                                     | `string \| OverrideTokenConfig`             | —               | String = legacy plaintext (insecure, warned); object = HMAC validator.                 |
| `validationTimeout`                                 | `number` (ms)                               | `5000`          | Per-validator timeout budget (enforced by connectors via `validateWithTimeoutSecure`). |
| `patternTimeout`                                    | `number` (ms)                               | `100`           | Per-regex ReDoS budget.                                                                |
| `maxBufferSize`                                     | `number` (bytes)                            | `1_048_576`     | Stream-buffer cap; violations trip the circuit breaker.                                |
| `circuitBreakerThreshold` / `circuitBreakerTimeout` | `number`                                    | `3` / `60_000`  | Breaker stays OPEN until timeout, then HALF_OPEN, then CLOSED on success.              |
| `logger`                                            | `Logger`                                    | console at INFO | Any object satisfying `base/GenericLogger.ts:Logger`.                                  |

Per-rule config validation lives at `packages/core/src/validation/` and exports
`ValidatorInstanceRule`, `OptionalRule`, `EnumRule`, `NumberRangeRule`, etc., re-exported from the
root barrel (`packages/core/src/index.ts:54-71`). Severity levels are
`'info' | 'warning' | 'blocked' | 'critical'` (`base/GuardrailResult.ts:Severity`).

## 8. Telemetry boundary

Two layers ship in core:

1. **`TelemetryService`** (`packages/core/src/telemetry/TelemetryService.ts`) — pluggable collectors
   (`ConsoleTelemetryCollector`, `CallbackTelemetryCollector`, `BufferedTelemetryCollector`),
   sample-rate gate, 15-event vocabulary (`TelemetryEventType`: validation.start / .complete /
   .blocked / .error, stream._ , api._, circuit.\*, retry.attempt). Every event passes `runId` +
   `operation` strings through `sanitizeMeta` at the collect boundary (CWE-117 — see ADR-0001 Sprint
   45 entry).
2. **`bonklmTrace(result, opts)`** (`packages/core/src/telemetry/otlp-export.ts`) — emits one OTLP
   span per validator decision with the R2-10 locked attribute vocabulary: `bonklm.validator`,
   `bonklm.severity`, `bonklm.action` (`allow|block`), `bonklm.finding_count`, `bonklm.surface` (one
   of the 7 strings). Caller passes any `@opentelemetry/api`-compatible `Tracer`; verified ingests
   include Langfuse, Phoenix, Arize AX, VoltOps, Datadog (`docs/user/otel-vendor-recipes.md`).

**`BonklmBlockEvent` discriminated union** (`telemetry/block-event.ts`) gives operators a single
`onBlock` shape across 7 connector kinds: `voice` | `sandbox` | `inference` | `durable-exec` |
`document` | `cf-agent` | `web-middleware`. `isBonklmBlockEvent(value)` is a TypeScript narrowing
guard, NOT a trust boundary — consumers forwarding `event.payload` to downstream sinks must treat
the payload as untrusted.

**`engine.onIntercept(callback)`** fires for every `engine.validate()` / `engine.validateInput()`
outcome AND for cached-validator paths via `engine.notifyCachedResult(results, content, ctx?)`.
Asymmetry: vector-DB write-path BLOCKs throw synchronously instead of firing the callback — see
`known-limitations.md` §21.

## 9. Build & release

- **Monorepo**: pnpm workspaces, 54 release-surface package directories (52 publishable package
  manifests + 2 private tooling/legacy manifests: `@blackunicorn/bonklm-openclaw` and
  `@blackunicorn/bonklm-wizard`) plus 8 private example manifests outside the workspace release
  surface.
- **Single-version policy**: all release-surface package manifests currently carry `1.0.0-rc.4`. The
  current `.changeset/config.json` linked array enumerates 21 package names and ignores
  `@blackunicorn/bonklm-wizard`; `docs/user/package-matrix.md` is the release-surface inventory.
- **Bundle targets** (per package-matrix.md):
  - NODE — Node 20.4+ only, uses `node:fs` / `node:vm` / native crypto.
  - EDGE — Workerd/Cloudflare (with `nodejs_compat`) / Deno / Bun + Node; strict Vercel Edge
    (`edge-light`) only where a package declares it.
  - ISO — Node + Edge + browser via Web standard APIs.
- **Engine requirement**: Node `>=20.4.0` (`packages/core/package.json` `engines.node`).
- **CI gates** (`.github/workflows/ci.yml`): lint, `tsc --noEmit`, build on Node 20 + 22, test on
  Node 20 + 22 with coverage upload, UAT harness, performance benchmark (NaN/Infinity/`[ERROR]`
  regex guard), R2-13 sandbox graduation gate (recall ≥ 95% / FPR ≤ 5% / precision ≥ 80% on the
  hash-pinned corpus), Temporal integration suite with binary SHA-256 capture. `pnpm audit` runs
  informationally (non-blocking).
- **Publish**: `pnpm exec changeset publish` (single command publishes everything in the linked
  group). Prerelease tags blocked from publishing as stable (per RELEASE-NOTES.md archive of v0.3.0
  and CONTRIBUTING.md release process).

## 10. Design trade-offs (honest)

### Pattern engine vs ML

- **Chose**: deterministic regex + structural validators.
- **Pro**: zero network round-trips, predictable latency (<10ms typical), no vendor lock-in, runs at
  the edge, easy to audit.
- **Con**: multilingual coverage is regex breadth, not depth. Native-speaker rewrites in
  non-canonical phrasings pass (`known-limitations.md` §4). Multilingual roadmap retired Pass 2 in
  Sprint 23 — 12 languages shipped, remainder backlogged pending native-speaker reviewer pipeline
  (Story 4.2 / v0.7+).
- **Mitigation**: BonkLM is positioned as the deterministic short-circuit in front of ML moderation
  services (Lakera, OpenAI Moderation) — see README comparison table.

### Wrap-sentinel vs deep proxy

- **Chose**: `Symbol.for('bonklm.<connector>.wired')` marker via
  `Object.defineProperty({ writable: false, configurable: false })`.
- **Pro**: works uniformly on plain objects, class instances, and class constructors
  (`cloudflare-agents` uses it on a mixin class). Non-enumerable → doesn't leak through
  `Object.keys` / `JSON.stringify` / spread.
- **Con**: caller controls when to fall back — a connector that catches the double-wrap throw and
  silently uses the inner client defeats the defence. Detection is loud-on-misuse, not
  enforced-by-runtime.

### Sealed memory wrappers

- **Chose**: ElizaOS `installSealedWrapMemory` replaces `runtime.createMemory` /
  `runtime.updateMemory` via `Object.defineProperty({ writable: false, configurable: false })` with
  closure-captured source-trust + verified-publisher allowlist.
- **Pro**: subsequent plugins cannot re-wrap or mutate the memory contract; tenant-id rewrite is
  closure-protected; trust marker survives serialization.
- **Con**: function-only API — string-config sealing is not supported because the sealing path must
  be tamper-resistant. Forces in-place mutation of `runtime` (documented exception to the "return
  new object" rule in `connector-style-guide.md`).

### Guards skip `validateInput` (orthogonal trade-off worth flagging)

`SecretGuard` / `BashSafetyGuard` / `XSSGuard` / `PIIGuard` only fire on
`engine.validate(content: string, context?)`. The discriminated-union
`engine.validateInput(input: ValidatorInput)` path (used by Stagehand, Eko, browser-agents-core,
Inngest, Trigger.dev) deliberately skips guards because the `Guard.validate(content, context?)`
signature doesn't map cleanly to the union. Consumers needing guard coverage on structured surfaces
must either reimplement the check as a `Validator` subclass or call
`engine.validate(JSON.stringify(args))` themselves (`known-limitations.md` §10). Unification is
tracked for a future release.

## 11. Related documents

- `docs/user/threat-surfaces.md` — surface → validator → connector mapping.
- `docs/user/known-limitations.md` — 29 documented gaps with mitigations.
- `docs/user/package-matrix.md` — 54-package inventory with bundle targets and peer-dep ranges.
- `docs/user/connector-style-guide.md` — six canonical factory shapes.
- `docs/user/public-api-surface.md` — `@public` vs `@internal` catalogue.
- `docs/user/migration/edge-string-handlers.md` — edge hook migration.
- `docs/user/otel-vendor-recipes.md` — Tracer wiring per vendor.
- `docs/contributing/adr/0001-log-sanitization.md` — CWE-117 / `sanitizeLogString` contract.
- `RELEASE-NOTES.md` — single-version policy and changeset workflow.
