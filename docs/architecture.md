# BonkLM Architecture

> Last updated: 2026-08-14. Audience: senior engineers onboarding to `@blackunicorn/bonklm`.
>
> Project version: `1.0.13`.
>
> Source of truth: `packages/core/package.json` + the `[1.0.1]` CHANGELOG entry. Root `package.json`
> (private; repo metadata only) is aligned to the same version. Per
> [CONTRIBUTING.md](../CONTRIBUTING.md#versioning-changesets-and-releases), coordinated family
> changesets and the prospective release-plan gate keep every publishable package aligned. Scope:
> this is a _what exists in the source_ doc. Aspirational design lives in internal planning notes.
> Cross-references point at the load-bearing files.

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
| `Guard` interface                                                | `validate(content: string, context?: string): GuardrailResult \| Promise<GuardrailResult>`. Frozen `@public`. Fires on both `engine.validate(string)` and `engine.validateInput(ValidatorInput)` (the union is reduced to a text surface before guards run) — see §10 residual note.            | `packages/core/src/engine/GuardrailEngine.types.ts:107-117`                        |
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
  `AbortController` pattern previously copy-pasted across 20+ connectors.
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

### 5b. Connector-provenance layer & raw-upstream re-scan

The connector-boundary `IndirectInjectionValidator` scans content as it crosses a surface
(`retrieved_doc` / `composed_context` / `tool_result` / `memory_write`). A laundering chain defeats
a content-only scan: an agent reads a poisoned tool result, **paraphrases** it into benign prose,
then persists the paraphrase to memory — the surface text now matches nothing.

The provenance layer closes that gap with two cooperating primitives:

- **`Provenance` envelope** (`validators/provenance.ts`) — a JSON wire-contract carried on
  `MemoryWritePayload.metadata.provenance` (and intended for `ToolCallResult`). Its `derivedFrom`
  chain of `ToolResultRef`s records each upstream link's `source` (tool-result / http-fetch /
  agent-paraphrase / user-input) and a SHA-256 `rawBodyHash`. `hasToolResultProvenance` /
  `isToolDerivedRef` are the gates: a chain that is absent, empty, or all-`user-input` never
  triggers the stricter path, so genuine user writes keep the calibrated user-text false-positive
  floor.
- **Raw-upstream cache** (`validators/raw-upstream-cache.ts`) — an `AsyncLocalStorage`-scoped
  `rawBodyHash → raw body` map (256-entry cap) that lives only for the duration of one
  `runWithRawUpstreamCache` turn scope. It preserves the engine's stateless-per-turn semantics:
  outside a scope every accessor is an inert no-op (writes drop, reads return `undefined`), never a
  throw, so a connector that has not opted in degrades cleanly.

`rescanLaunderedProvenance` (`validators/provenance-rescan.ts`) is the consumer
`createMemoryWriteValidator` runs after its content chain: for each tool-derived ref carrying a
cached `rawBodyHash`, it re-scans the **raw body** through a shared `tool_result`
`IndirectInjectionValidator` and merges any hit into the write's verdict. The re-scan **fails
closed** — since the poison is not textually in the laundered `content`, redact mode cannot mitigate
it, so a hit blocks the write. Re-scan findings have their `match` REDACTED before they leave the
re-scan (the raw body may carry secrets/PII the laundered `content` never exposed), and the per-body
scan is byte-bounded with a per-chain fan-out cap so a pathological chain cannot turn one write into
unbounded regex work. Populating the cache + stamping the envelope is a per-connector follow-up
increment (mirroring how the PR-A core validator preceded the PR-B connector rollout); until a
connector stamps, the consumer is live but inert. The raw-upstream cache is Node-only: it is not a
named `/edge` export, but because `createMemoryWriteValidator` (which is `/edge`-exported) now
reaches it transitively, `node:async_hooks` joins the Node built-ins the edge surface requires (see
§6) — fine on the Node-compatible edge runtimes BonkLM targets, out of scope for strict
`edge-light`.

## 6. Edge vs Node runtime split

- `package.json` for `@blackunicorn/bonklm` declares an `./edge` subpath with workerd / deno / bun
  conditional exports (plus `import` for Node). All three edge runtimes resolve to
  `dist/edge/index.js`. The `edge-light` (strict Vercel Edge) condition is intentionally not
  declared — the edge surface transitively uses Node built-ins (`node:fs`/`node:path`/`node:crypto`,
  plus `node:async_hooks` via the memory-write provenance re-scan — see §5b), so it requires a
  Node-compatible edge runtime (`workerd` with `nodejs_compat`, Deno, Bun).
- **Edge `node:*` allowlist (enforced).** The complete set of Node built-ins reachable from the edge
  entry (`packages/core/src/edge/index.ts`) is locked by `tools/check-edge-node-builtins.js` (the
  `edge-node-builtins` CI job + local quality gate). A new edge-exported factory that drags a Node
  built-in outside this set into the graph fails the gate — e.g. re-exporting `HookSandbox` would
  add `node:vm`. The allowlist (canonical source: `EDGE_NODE_BUILTIN_ALLOWLIST`; this block is
  asserted to mirror it):
  <!-- edge-node-builtins:allowlist:start -->
  `node:async_hooks`, `node:crypto`, `node:fs`, `node:path`
  <!-- edge-node-builtins:allowlist:end -->
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
| `guards`                                            | `Guard[]`                                   | `[]`            | Run AFTER validators, on both `validate()` and `validateInput()`.                      |
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

- **Build graph**: every workspace manifest has a unique package name. The private root is
  `@blackunicorn/bonklm-workspace`; the published core is `@blackunicorn/bonklm`. This distinction
  is load-bearing because pnpm uses package names to construct the dependency graph. The root
  `pnpm run build` delegates to `pnpm -r run build`, so core's `dist/` exports are ready before its
  consumers compile. `tools/build-order.test.ts` rejects duplicate workspace names; a clean build in
  CI exercises the resulting graph.
- **Monorepo**: `packages/*` has 54 manifests: 52 linked publishable packages plus 2 private legacy
  packages outside the linked family (`@blackunicorn/bonklm-openclaw` and
  `@blackunicorn/bonklm-wizard`). The workspace adds the separately versioned, MIT-licensed Tier-B
  `@blackunicorn/eslint-plugin-edge` tool; 8 private example manifests sit outside the workspace.
  Tier-B tools have their own explicit release scope and are outside the linked family.
- **Single-version policy**: all 52 publishable package manifests and the private root metadata
  currently carry `1.0.13`. The `.changeset/config.json` linked array enumerates all 52 publishable
  package names. Because linked groups align versions without automatically adding untouched
  packages, every family changeset enumerates all 52 members; `tools/check-release-plan.js` rejects
  an incomplete or split target plan. The two private package manifests
  (`@blackunicorn/bonklm-openclaw`, `@blackunicorn/bonklm-wizard`) are outside this version lock,
  and both are explicitly excluded from Changesets versioning and tagging.
  `docs/user/package-matrix.md` is the release-surface inventory. `tools/*` Tier-B publishable
  packages (e.g. `@blackunicorn/eslint-plugin-edge`) are governed separately by
  `tools/WORKSPACE-POLICY.md` and are not in this linked group.
- **Bundle targets** (per package-matrix.md):
  - NODE — Node 20.4+ only, uses `node:fs` / `node:vm` / native crypto.
  - EDGE — Workerd/Cloudflare (with `nodejs_compat`) / Deno / Bun + Node; strict Vercel Edge
    (`edge-light`) only where a package declares it.
  - ISO — Node + Edge + browser via Web standard APIs.
- **Engine requirement**: Node `>=20.4.0` (`packages/core/package.json` `engines.node`).
- **CI gates** (`.github/workflows/ci.yml`): lint, `tsc --noEmit`, build on Node 20 + 22, test on
  Node 20 + 22 with coverage upload, UAT harness, performance benchmark (NaN/Infinity/`[ERROR]`
  regex guard), R2-13 sandbox graduation gate (recall ≥ 95% / FPR ≤ 5% / precision ≥ 80% on the
  hash-pinned corpus), and a Temporal integration suite that verifies the pinned archive and binary
  hashes before execution. `pnpm audit` runs informationally (non-blocking).
- **Release lifecycle**: distribution begins only from a human-published GitHub Release whose family
  `v<semver>` or Tier-B `<tool>-v<semver>` tag resolves to a commit on `main`. A shared preflight
  validates tag/manifest parity, the version-locked release family, build/test/UAT, OSS/EE export,
  shipped advisories and licenses, secrets, and tarball contents before registry credentials are
  available.
- **npm lane**: a `Release-Scope: family` release publishes all 52 linked public packages under the
  exact release version with npm provenance. An explicitly named Tier-B scope publishes only that
  tool. Prereleases move `next`; stable releases move `latest`.
- **Container lane**: `ghcr.io/blackunicornsecurity/bonklm-server` publishes the same exact version
  for `linux/amd64` and `linux/arm64`. Preflight builds one OCI artifact, checks package/label
  version parity, runs both platform images as the non-root user, probes `/healthz`, scans both at a
  zero HIGH/CRITICAL threshold, and records platform SBOMs. That exact multi-platform digest is
  pushed to a private opaque staging package and signed. The exact npm versions publish and pass
  provenance verification before that digest is copied to the public exact SemVer tag. The workflow
  refuses to retarget an existing exact tag and anonymously verifies that exact image. GHCR
  deliberately exposes no mutable `latest`/`next` channels; npm prereleases move `next` and stable
  releases move `latest`. The transaction is ready for announcement only after the exact commit's
  `bonklm/release-ready` status succeeds.

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

### Guards run on `validateInput` too (structured-surface unification)

`SecretGuard` / `BashSafetyGuard` / `XSSGuard` / `PIIGuard` fire on **both**
`engine.validate(content: string, context?)` and the discriminated-union
`engine.validateInput(input: ValidatorInput)` path (used by Stagehand, Eko, browser-agents-core,
Inngest, Trigger.dev). Because `Guard.validate(content, context?)` takes a string, each
`ValidatorInput` is reduced to a canonical text surface (`deriveGuardContent`) before guards run —
after validators, under the same short-circuit gate as `validate()`. The one residual: structured
fields (`tool_call` args, doc/memory metadata) are JSON-encoded for guard inspection, so a
quote-delimited source-syntax secret (`api_key = "…"`, the AWS _secret_ access key) may not match;
pass the raw value through `engine.validate(...)` or use a `Validator` if you need that
(`known-limitations.md` §10).

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
