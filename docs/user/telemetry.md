# Telemetry & Observability

> Last updated: 2026-05-25
> Audience: operators wiring BonkLM into existing observability stacks.

BonkLM ships three independent observability layers. They are additive — pick
any subset that maps to your stack.

| Layer | Where decisions go | Best for |
|---|---|---|
| `engine.onIntercept(callback)` | Your in-process callback per validation | Custom audit trails, in-process metrics, attack logger |
| `TelemetryService` | Pluggable collectors with typed event vocabulary + sample-rate gate | Structured metrics pipelines, batching to remote sinks |
| `bonklmTrace(result, opts)` | OTLP spans via caller-supplied `Tracer` | Distributed tracing, Langfuse / Phoenix / Arize / VoltOps / Datadog |

The unified `BonklmBlockEvent` discriminated union (`packages/core/src/telemetry/block-event.ts`)
gives you a single `onBlock` shape across all 7 connector kinds when you want
cross-connector aggregation.

---

## 1. `engine.onIntercept` Callback

**Source**: `packages/core/src/engine/GuardrailEngine.ts:302` /
`packages/core/src/engine/GuardrailEngine.types.ts:272`.

```ts
type InterceptCallback = (
  result: EngineResult,
  context: { content: string; validation_context?: string }
) => void | Promise<void>;

engine.onIntercept(callback: InterceptCallback): void;
```

**Fires for**:
- `engine.validate(content, context?)` outcomes (`GuardrailEngine.ts:466, 518, 534`).
- `engine.validateInput(input)` outcomes (`GuardrailEngine.ts:588, 623`).
- Cached-validator paths via `engine.notifyCachedResult(results, content, ctx?)`
  (`GuardrailEngine.ts:350` — Inngest / Trigger / Lance / Turbopuffer / Pinecone /
  Weaviate / Qdrant connectors call this after their own `cachedValidate`).

**Asymmetry (load-bearing)**: vector-DB **write-path** BLOCKs throw
`ConnectorValidationError` synchronously and **do not** fire intercept callbacks.
See `docs/user/known-limitations.md` §21 for the full list (Lance `add`/`update`/
`mergeInsert`, Turbopuffer `write({upsert_rows: …})` / `write({patch_rows: …})`).
Wrap the connector call with try/catch if you need write-path BLOCK telemetry.

**Execution model**: callbacks run fire-and-forget via `Promise.all` —
validation does not block on them, and a throwing callback is caught and
logged with `serializeError` rather than propagated
(`GuardrailEngine.ts:371-394`).

**Use cases**: ad-hoc logging, in-process counters, custom audit trails,
wiring `AttackLogger` (`packages/logger/src/AttackLogger.ts:219`).

```ts
import { AttackLogger } from '@blackunicorn/bonklm-logger';
const attackLogger = new AttackLogger({ max_logs: 1000 });
engine.onIntercept(attackLogger.getInterceptCallback());
```

---

## 2. `TelemetryService`

**Source**: `packages/core/src/telemetry/TelemetryService.ts`.

```ts
import { TelemetryService, ConsoleTelemetryCollector } from '@blackunicorn/bonklm';

const telemetry = new TelemetryService({
  collectors: [new ConsoleTelemetryCollector(logger)],
  sampleRate: 1.0,        // 0..1, default 1.0
  maxBufferSize: 100,     // events before flush, default 100
  flushInterval: 30_000,  // ms between flushes, default 30 s
  enabled: true,          // default true
});
```

### Event vocabulary (15 events)

The `TelemetryEventType` enum at `TelemetryService.ts:16-32` is the canonical
list. Do not invent new event names — the OTel exporter and the contract-locked
collectors key on these strings.

| Event | Trigger |
|---|---|
| `validation.start` | `recordValidationStart()` — input received |
| `validation.complete` | `recordValidationComplete()` with `allowed: true` |
| `validation.blocked` | `recordValidationComplete()` with `allowed: false` |
| `validation.error` | `recordValidationError()` — validator threw |
| `stream.start` | `recordStreamStart()` |
| `stream.chunk` | `recordStreamChunk()` — per chunk, with `tokenCount` + `charCount` |
| `stream.blocked` | `recordStreamBlocked()` — buffer / pattern hit |
| `stream.complete` | Stream finished cleanly |
| `api.call.start` | `recordApiCallStart()` |
| `api.call.complete` | `recordApiCallComplete({ success: true })` |
| `api.call.error` | `recordApiCallComplete({ success: false })` |
| `circuit.open` | Circuit breaker tripped |
| `circuit.half_open` | Breaker probing recovery |
| `circuit.close` | Breaker recovered |
| `retry.attempt` | `RetryPolicy` issued a retry |

### `TelemetryEvent` shape (`TelemetryService.ts:59-82`)

```ts
interface TelemetryEvent {
  type: TelemetryEventType;
  timestamp?: number;          // auto-set on record() if absent — caller object is NEVER mutated
  runId?: string;
  parentRunId?: string;
  connector?: string;
  operation?: string;
  metrics?: TelemetryMetrics;  // duration / tokenCount / charCount / etc.
  context?: Record<string, unknown>;
  error?: { name: string; message: string; code?: string };
}
```

**No-mutation guarantee:** `TelemetryService.record()` never
modifies the caller-supplied `event` object. If `timestamp` is absent or
`undefined`, a shallow clone is created internally (`{ ...event, timestamp:
Date.now() }`) before dispatch to collectors. The caller's reference is
unchanged.

### Pluggable collectors

All three implementations live in `TelemetryService.ts`.

| Collector | Use |
|---|---|
| `ConsoleTelemetryCollector` | Dev/debug. Sanitizes `runId` + `operation` at line 137-146. |
| `CallbackTelemetryCollector` | Wrap an arbitrary `(event) => void \| Promise<void>` function. |
| `BufferedTelemetryCollector` | Wraps a delegate; flushes every `flushInterval` or when `maxBufferSize` hit. The service auto-wraps non-buffered collectors when `maxBufferSize > 0 && flushInterval > 0` (line 236-247). |

### Sample-rate gate

`record()` at line 257-258 short-circuits via `Math.random() > sampleRate` —
sampling is per-event, not per-trace. Setting `sampleRate < 1.0` reduces volume
uniformly across all event types. Per-event-type sampling is not built in;
implement it inside a `CallbackTelemetryCollector` if needed.

### CWE-117 boundary

Every event passes `runId` and `operation` through `sanitizeMeta` at the
collect / record boundary (per ADR-0001 Sprint 45 closure):

- `ConsoleTelemetryCollector.collect()` — `TelemetryService.ts:140-145`.
- `recordValidationError()` — `TelemetryService.ts:347-357` sanitizes
  `error.name` and `error.message` before reaching downstream collectors.
- Catch blocks in `record()`, `flush()`, `shutdown()` use
  `serializeError(error)` for error metadata (Sprint 48 closure).
- `BufferedTelemetryCollector.flush()` — routes delegate errors through
  `serializeError` before writing to `console.error` (Sprint 48 sweep had
  missed this nested-class site; closed in a later revision).

Custom collectors that forward `runId`, `operation`, or `error.message` to
log surfaces MUST sanitize at their own boundary. See §7.

---

## 3. OTel Spans via `bonklmTrace`

**Source**: `packages/core/src/telemetry/otlp-export.ts:99`.

```ts
function bonklmTrace<R extends GuardrailResult>(
  result: R,
  options: {
    tracer: BonklmTracer;          // any @opentelemetry/api-compatible Tracer
    validator: string;              // required, e.g. 'prompt-injection'
    surface: BonklmTraceSurface;    // required, R2-10 locked vocab
    spanName?: string;              // default: `bonklm.validator.<surface>`
    extraAttributes?: Record<string, string | number | boolean>;
  }
): R;                               // returns result unchanged for fluent chaining
```

### Locked span attribute vocabulary (R2-10)

The Sprint 26/28 v1.0-RC1 API freeze locks these — no synonyms accepted.

| Attribute | Type | Values |
|---|---|---|
| `bonklm.validator` | string | e.g. `'prompt-injection'`, `'jailbreak'` |
| `bonklm.severity` | string | `'critical' \| 'warning' \| 'info' \| 'blocked'` |
| `bonklm.action` | string | `'allow' \| 'block'` |
| `bonklm.finding_count` | number | length of `result.findings` |
| `bonklm.surface` | string | one of 7 (below) |

### 7 locked surface values (`otlp-export.ts:31-39`)

`'text_input' | 'text_output' | 'tool_call' | 'retrieved_doc' |
'memory_write' | 'audio_partial' | 'composed_context'`.

Passing any other string throws `TypeError` at the call site
(`isValidSurface` guard, line 193-203). No `'prompt'`, no `'output'`,
no `'tool_args'`.

### Span events

One `bonklm.finding` event per finding in `result.findings`, carrying
sanitized `category`, `severity`, `description` attributes
(`otlp-export.ts:162-177`).

### Block semantics

On `result.blocked === true`, `bonklmTrace` calls
`span.setStatus({ code: 2, message: sanitizeMeta(result.reason) })`
(line 178-186; code 2 = OpenTelemetry `SpanStatusCode.ERROR`).

### Caller-provides-tracer contract

BonkLM does **not** depend on `@opentelemetry/sdk-trace-node` or any OTel
SDK. You construct the `Tracer`; we call `startActiveSpan` on it. Any
`@opentelemetry/api`-compatible implementation works — Langfuse, Phoenix,
Arize AX, VoltOps SDK, raw OTel NodeTracer. See `docs/user/otel-vendor-recipes.md`
for vendor-specific wiring.

---

## 4. `BonklmBlockEvent` Discriminated Union

**Source**: `packages/core/src/telemetry/block-event.ts`.

Cross-connector unified block-event shape. The `kind` discriminator lets one
`onBlock` handler aggregate across heterogeneous connectors without per-kind
mappers.

```ts
type BonklmBlockEventKind =
  | 'voice'           // livekit-connector, voice-webhooks
  | 'sandbox'         // e2b-adapter, daytona-adapter
  | 'inference'       // inference-providers (groq, cerebras, together)
  | 'durable-exec'    // restate-middleware, temporal-middleware
  | 'document'        // document-ingest (LlamaParse, Unstructured, Reducto)
  | 'cf-agent'        // cloudflare-agents
  | 'web-middleware'; // elysia + nextjs helpers
```

All variants share `BonklmBlockEventBase`: `kind`, `reason` (≤200 chars),
optional `category`, optional `severity`. Per-kind interfaces add
surface/phase/provider fields (see source for the full shape of each).

### `isBonklmBlockEvent(value)` narrowing guard

**NOT a security trust boundary.** Documented inline at `block-event.ts:181-203`:
a hand-crafted object with valid `kind` + `reason` fields passes the guard.
Consumers forwarding `event.payload` / `event.excerpt` to downstream sinks
MUST treat that field as untrusted (redact / escape / size-cap before logging).

### API stability

`@public` Sprint 26/28 v1.0-RC1 freeze. The 7 `kind` values are frozen;
adding a new `kind` is MINOR (additive), removing or renaming is MAJOR.
New OPTIONAL per-kind fields are additive.

---

## 5. MonitoringLogger Metrics

**Source**: `packages/core/src/logging/MonitoringLogger.ts`.

Drop-in `Logger` implementation that adds in-process counters / gauges /
histograms / timestamps on top of structured logging. Pairs cleanly with
`TelemetryService` — pass `MonitoringLogger` as the `logger` option and use
its metrics API for in-process aggregation alongside the event stream.

### Metrics API (`MonitoringLogger.ts:147-202`)

| Method | Purpose |
|---|---|
| `incrementCounter(name, value=1)` | Counter (e.g. blocks-by-validator). |
| `setGauge(name, value)` | Gauge (e.g. current circuit-breaker state). |
| `recordHistogram(name, value)` | Histogram. Keeps last 1000 values per name. |
| `recordTimestamp(name, timestamp=now)` | Last-occurrence marker. |
| `getMetrics()` | Returns `MetricsData` snapshot. |
| `resetMetrics()` | Clears all four metric stores. |

Metrics collection is gated on `options.metrics: true` — disabled by default
to avoid overhead in producers that only need structured logging.

### Logging behavior (`MonitoringLogger.ts:340-392`)

- PII redaction at log time via `redactPIIInStringSync` / `redactPIIInObject`
  on every `context` field.
- Stack-trace sanitization removes file paths + line numbers
  (`sanitizeStackTrace`, line 288-335).
- Optional audit log (`options.audit: true`) — keeps last 1000 WARN/ERROR
  entries in memory, retrievable via `getAuditLog()`.
- Optional JSON output (`options.json: true`).
- Sample rate applied to DEBUG only (line 342-344).

---

## 6. CWE-117 / Log Injection Defence

Per ADR-0001 (`docs/contributing/adr/0001-log-sanitization.md`), the
telemetry boundary is one of the enumerated sink classes that MUST sanitize
attacker-influenceable strings before they reach exporters.

| Primitive | Location | Use |
|---|---|---|
| `sanitizeLogString` | `packages/core/src/common/index.ts` | Canonical primitive. Hex-escapes `\x00-\x09`, `\x0B-\x1F`, `\x7F`; replaces `\r\n` / `\n` / `\r` / U+2028 / U+2029 with literal `\n`; hex-escapes bidi-override (U+202A-U+202E) and bidi-isolate (U+2066-U+2069) to `\uNNNN`; caps at 500 chars + `…[truncated]` marker. |
| `sanitizeMeta` | `packages/core/src/connector-utils/logger.ts:336` | Wraps `sanitizeLogString(String(x ?? ''))` for the most common combo. Fail-closes hostile `toString()` throws to `[unstringifiable]`. |
| `serializeError` | `packages/core/src/common/index.ts:192` | Canonical Error → safe `{ name, message, code, raw }` shape. Use as `{ error: serializeError(err) }` — bare `{ error }` renders empty post-`JSON.stringify`. |

### Why this matters for telemetry

OTel span attributes are **not** JSON-serialized by the SDK — values reach
the exporter as-is. RFC 8259 §7 permits literal TAB inside JSON strings, so
even JSON-emitting exporters propagate TAB. A TAB-injected field on a Splunk
TCP / Datadog agent syslog forwarder pivots TSV column parsing
(`otlp-export.ts:154-161` documents the rationale inline).

If you write a custom `TelemetryCollector` that forwards `runId`, `operation`,
`error.message`, or any other event-string field to a log surface, sanitize
at your collector boundary. The built-in `ConsoleTelemetryCollector` and the
`bonklmTrace` exporter already do this for the library-built event paths.

---

## 7. Operator Patterns

### Pattern A — Block-rate alarm

Count `validation.blocked` events per `connector` per minute. Alarm when the
rate exceeds your baseline (e.g. 3× rolling-1h-avg).

```ts
const telemetry = new TelemetryService({
  collectors: [new CallbackTelemetryCollector((event) => {
    if (event.type !== 'validation.blocked') return;
    metrics.incrementCounter(`bonklm.blocked.${event.connector ?? 'unknown'}`);
  })],
});
```

### Pattern B — Stream-block detector

Count `stream.blocked` events — should be non-zero only on confirmed attacks.
The accumulated buffer length is on `event.metrics.charCount`
(`TelemetryService.ts:399-413`).

```ts
if (event.type === 'stream.blocked') {
  metrics.incrementCounter('bonklm.stream.blocked');
  metrics.recordHistogram('bonklm.stream.blocked.bytes', event.metrics?.charCount ?? 0);
}
```

`[needs-info: the spec asked for a "stream.released" event with a
"chainHasSecretOrPii" flag, but neither exists in TelemetryEventType
(only stream.start / .chunk / .blocked / .complete). chainHasSecretOrPii
is an internal StreamValidator option (packages/core/src/connector-utils/
stream-validator.ts:64), not a telemetry event field. Confirm whether a
stream-release telemetry event should be added in a future sprint, or
remove this pattern from the operator catalog.]`

### Pattern C — Circuit-breaker observability

Track `circuit.open` / `circuit.half_open` / `circuit.close` to alert on
buffer-overflow circuit trips (defaults: 3 violations → OPEN for 60 s; see
`docs/architecture.md` §7).

```ts
const breakerState = new Map<string, 'open' | 'half_open' | 'closed'>();
if (event.type === 'circuit.open')      breakerState.set(event.connector ?? 'core', 'open');
if (event.type === 'circuit.half_open') breakerState.set(event.connector ?? 'core', 'half_open');
if (event.type === 'circuit.close')     breakerState.set(event.connector ?? 'core', 'closed');
```

### Pattern D — Per-tenant block attribution

Use `bonklmTrace` `extraAttributes` to add tenant metadata to each span.
`TelemetryEvent` itself has no built-in tenant field, but `connector`
distinguishes connector-emitted events.

```ts
bonklmTrace(await engine.validate(input), {
  tracer, validator: 'prompt-injection', surface: 'text_input',
  extraAttributes: {
    'tenant.id': req.headers.get('x-tenant') ?? 'unknown',
    'service.version': process.env.APP_VERSION ?? 'dev',
  },
});
```

### Pattern E — Cache hit-rate observability

Cached-validator connectors fire `engine.notifyCachedResult(...)` for the
ALLOW path only. Wire `engine.onIntercept` and key on
`context.validation_context` (e.g. `'inngest:validateInput'`) to attribute
cache vs fresh:

```ts
engine.onIntercept((result, ctx) => {
  const isCached = ctx.validation_context?.startsWith('inngest:') ?? false;
  metrics.incrementCounter(isCached ? 'bonklm.cache.hit' : 'bonklm.cache.miss');
});
```

`[needs-info: confirm whether a dedicated cache-hit/miss telemetry event is
planned; today the signal is inferred from validation_context tagging.]`

---

## 8. Dashboards

Recommended panels — every metric below is keyed only on attributes /
events that exist in source. No invented names.

### Validation latency
- **P50 / P95 / P99 `validation.complete` latency**, faceted by
  `event.metrics.duration`, grouped by `event.connector`.
- Source: `TelemetryEvent.metrics.duration` (set by
  `recordValidationComplete` at `TelemetryService.ts:306-332`).

### Block rate
- **`validation.blocked` count per minute**, grouped by `event.connector`.
- **OTel-span equivalent**: spans where `bonklm.action = 'block'`, faceted
  by `bonklm.validator` × `bonklm.surface`.

### Circuit-breaker state
- **State distribution** from `circuit.open` / `circuit.half_open` /
  `circuit.close` events.
- Gauge: current state per `event.connector`.

### Stream behavior
- **`stream.blocked` count per minute** — non-zero on attack.
- **`stream.chunk` `tokenCount` histogram** — throughput visibility.

### Finding distribution (OTel only)
- Stacked bar by `bonklm.finding` event `category` attribute.
- Heatmap by `bonklm.severity` × `bonklm.surface`.

---

## 9. Sensitive Data Handling

- **Never log full validated content.** Validator inputs can contain
  secrets, PII, or hostile control characters. The built-in
  `AttackLogger` (`packages/logger/src/AttackLogger.ts:259`) sanitizes
  content via `sanitizeForJSON` at storage time and applies optional PII
  redaction; replicate this in custom collectors.
- **`MonitoringLogger`** applies `redactPIIInStringSync` /
  `redactPIIInObject` to every `context` field by default
  (`MonitoringLogger.ts:233-278`). Sensitive-named keys (`content`,
  `match`, `secret`, `token`, `password`, `key`, `credential`) get
  field-aware treatment.
- **`bonklmTrace`** sanitizes `validator`, `spanName`, finding
  `category` / `severity` / `description`, span-status `message`, and
  string-typed `extraAttributes` at the boundary
  (`otlp-export.ts:124, 125, 148, 171-175, 185`).
- **`BonklmSandboxBlockEvent.payload` / `BonklmDocumentBlockEvent.excerpt`
  / `BonklmWebMiddlewareBlockEvent.excerpt`** carry first-200-chars
  user-controlled content (`block-event.ts:88-95, 127, 159`). Operators
  shipping logs to a less-trusted SIEM should redact at the forwarder.
- See `SECURITY.md` for the reporting flow and supported-version matrix.

---

## 10. Vendor-Specific Wiring

`docs/user/otel-vendor-recipes.md` covers verified wiring for:

- **Langfuse** — native `@langfuse/otel` integration.
- **Arize Phoenix** — OTLP/HTTP via `@opentelemetry/exporter-trace-otlp-http`.
- **Arize AX** — OTLP/gRPC.
- **VoltOps** — dedicated `@blackunicorn/bonklm-voltops-otel` adapter adds a
  `bonklm.scanner` attribute on top of the R2-10 set.
- **Datadog** — OTLP/proto via the agent's OTLP receiver; pivot on
  `@bonklm.severity` / `@bonklm.action`.

All five verified during Sprint 24 Story 4.3.

---

## See also

- `docs/architecture.md` §8 — telemetry boundary in the overall architecture.
- `docs/contributing/adr/0001-log-sanitization.md` — CWE-117 hardening
  history + audit checklist for new code.
- `docs/user/otel-vendor-recipes.md` — per-vendor wiring snippets.
- `docs/user/known-limitations.md` §21 — vector-DB write-path BLOCK
  asymmetry in `engine.onIntercept`.
- `packages/core/src/telemetry/` — source of truth for everything in this
  document.
