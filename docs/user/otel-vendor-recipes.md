# OTel Vendor Recipes — `bonklmTrace()` integration

`bonklmTrace(result, opts)` emits a single OTLP span per validator decision with the locked
attribute vocabulary:

| Attribute              | Type   | Example                                          |
| ---------------------- | ------ | ------------------------------------------------ |
| `bonklm.validator`     | string | `'prompt-injection'`                             |
| `bonklm.severity`      | string | `'critical' \| 'warning' \| 'info' \| 'blocked'` |
| `bonklm.action`        | string | `'allow' \| 'block'`                             |
| `bonklm.finding_count` | number | `1`                                              |
| `bonklm.surface`       | string | one of the 7 locked surfaces                     |

7 locked surface values: `text_input` / `text_output` / `tool_call` / `retrieved_doc` /
`memory_write` / `audio_partial` / `composed_context`.

Plus per-finding `bonklm.finding` events with `category`, `severity`, `description` attributes.
`setStatus({code: 2, message: result.reason})` on BLOCK.

This guide covers 5 verified vendor integrations.

---

## 1. Langfuse

Langfuse ingests OTLP via its native `@langfuse/otel` integration. The official Langfuse tracer
satisfies the `BonklmTracer` structural type (any `@opentelemetry/api` Tracer does).

```ts
import { trace } from '@opentelemetry/api';
import { Langfuse } from 'langfuse';
import { bonklmTrace } from '@blackunicorn/bonklm';

// Standard Langfuse OTel setup (per Langfuse docs).
const tracer = trace.getTracer('my-app', '1.0.0');

const result = await engine.validate(userMessage);
bonklmTrace(result, {
  tracer,
  validator: 'prompt-injection',
  surface: 'text_input'
});
```

Langfuse dashboard pivots: filter by `bonklm.severity`, `bonklm.action`, `bonklm.validator`.
Per-finding events appear in the span timeline.

---

## 2. Arize Phoenix

Phoenix accepts any OTel-compatible span. Use the `@opentelemetry/api` tracer; Phoenix's OTLP
exporter handles the wire.

```ts
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { bonklmTrace } from '@blackunicorn/bonklm';

const provider = new NodeTracerProvider();
provider.addSpanProcessor(
  new BatchSpanProcessor(new OTLPTraceExporter({ url: 'http://phoenix:6006/v1/traces' }))
);
provider.register();

const tracer = trace.getTracer('bonklm');

bonklmTrace(await engine.validate(input), {
  tracer,
  validator: 'jailbreak',
  surface: 'text_input'
});
```

Phoenix's evaluation UI groups by `bonklm.validator` + `bonklm.action` columns out-of-the-box.

---

## 3. Arize AX

Arize AX (the production sibling of Phoenix) ingests the same OTLP spans. The exporter URL changes;
everything else is identical.

```ts
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';

new OTLPTraceExporter({
  url: process.env.ARIZE_OTLP_ENDPOINT, // e.g. https://otlp.arize.com
  headers: {
    'space-id': process.env.ARIZE_SPACE_ID,
    'api-key': process.env.ARIZE_API_KEY
  }
});
```

Arize AX adds `bonklm.*` attributes to the model-monitoring schema automatically — no schema
registration needed.

---

## 4. VoltOps

VoltAgent's VoltOps observability stack ships a dedicated adapter at
`@blackunicorn/bonklm-voltops-otel` that adds the `bonklm.scanner` attribute on top of the locked
set:

```ts
import { trace } from '@opentelemetry/api';
import { emitVoltOpsSpan } from '@blackunicorn/bonklm-voltops-otel';

const tracer = trace.getTracer('bonklm-voltops');
emitVoltOpsSpan(await engine.validate(input), {
  tracer,
  scanner: 'pii-redactor', // VoltOps-specific scanner ID
  surface: 'text_output'
});
```

VoltOps' "Scanners" dashboard pivots on `bonklm.scanner` directly.

---

## 5. Datadog

Datadog Application Performance Monitoring (APM) accepts OTLP via the
`@opentelemetry/exporter-trace-otlp-proto` exporter pointed at the Datadog agent's OTLP endpoint:

```ts
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { trace } from '@opentelemetry/api';
import { bonklmTrace } from '@blackunicorn/bonklm';

const provider = new NodeTracerProvider();
provider.addSpanProcessor(
  new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: 'http://localhost:4318/v1/traces' // Datadog agent OTLP receiver
    })
  )
);
provider.register();

const tracer = trace.getTracer('bonklm');
bonklmTrace(await engine.validate(input), {
  tracer,
  validator: 'prompt-injection',
  surface: 'text_input'
});
```

Datadog APM custom-attribute pivoting: `@bonklm.severity:critical`, `@bonklm.action:block`. Per-span
`bonklm.finding` events appear in the Span Events tab.

---

## Common patterns

### Chaining

`bonklmTrace` returns the result unchanged for fluent inlining:

```ts
const r = bonklmTrace(await engine.validate(input), opts);
if (r.blocked) throw new Error(r.reason);
```

### Per-finding events

The span emits one `bonklm.finding` event per finding. Vendors that flatten event attributes
(Datadog, Langfuse, VoltOps) make these queryable directly. Vendors that only show the parent span
(Phoenix default) require expanding the span to see them.

### `extraAttributes` merge

Pass additional attributes (service version, tenant ID, request ID) via `extraAttributes`:

```ts
bonklmTrace(result, {
  tracer,
  validator: 'prompt-injection',
  surface: 'text_input',
  extraAttributes: {
    'service.version': '2.3.1',
    'tenant.id': req.headers.get('x-tenant')
  }
});
```

### Sampling

Configure sampling at the OTel SDK level (not at `bonklmTrace`). Recommended: 100% sampling for
BLOCK events, percentage sampling for ALLOW. Custom sampler:

```ts
import {
  ParentBasedSampler,
  AlwaysOnSampler,
  TraceIdRatioBasedSampler
} from '@opentelemetry/sdk-trace-node';

const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(0.1) // 10% of ALLOWs
});
// (BLOCK events propagate via parent — keep all when called from a sampled trace)
```

---

## Migration from non-OTel telemetry

If you currently key dashboards on `onBlock` callback events, the `BonklmBlockEvent` discriminated
union gives you the same data structurally:

| `BonklmBlockEvent` field | OTel attribute                                  |
| ------------------------ | ----------------------------------------------- |
| `kind`                   | (not emitted by default; use `extraAttributes`) |
| `reason`                 | `bonklm.finding` event `description`            |
| `category`               | `bonklm.finding` event `category`               |
| `severity`               | `bonklm.severity`                               |

`bonklmTrace` is additive — you can keep `onBlock` for synchronous alerting AND emit spans for
retrospective analysis.

---

## Vendor support matrix

| Vendor   | OTLP version    | Native attribute filtering | Per-finding event support |
| -------- | --------------- | -------------------------- | ------------------------- |
| Langfuse | OTLP/HTTP       | ✅                         | ✅                        |
| Phoenix  | OTLP/HTTP+gRPC  | ✅                         | ⚠️ (expand span)          |
| Arize AX | OTLP/gRPC       | ✅                         | ✅                        |
| VoltOps  | OTLP/HTTP       | ✅ (scanner field)         | ✅                        |
| Datadog  | OTLP/HTTP+proto | ✅ (`@bonklm.*`)           | ✅                        |

All 5 verified during development.
