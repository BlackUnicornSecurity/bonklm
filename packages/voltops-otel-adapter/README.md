# @blackunicorn/bonklm-voltops-otel

> VoltOps OpenTelemetry adapter for BonkLM — emits OTLP spans tagged with the `bonklm.scanner` attribute on top of the R2-10 locked set so VoltOps' Scanners dashboard can pivot directly.

## Audience

**Direct consumer use.** End-users wiring VoltAgent's VoltOps observability stack import `emitVoltOpsSpan` directly from this package. Other vendors (Langfuse, Phoenix, Arize AX, Datadog) use the core `bonklmTrace(...)` helper — see [`docs/user/otel-vendor-recipes.md`](../../docs/user/otel-vendor-recipes.md).

## Installation

```bash
pnpm add @blackunicorn/bonklm-voltops-otel @blackunicorn/bonklm @opentelemetry/api
```

## Peer Dependencies

| Package | Version | Notes |
|---|---|---|
| `@blackunicorn/bonklm` | `workspace:*` | Required peer. |
| Node.js | `>=20.0.0` | — |
| `@opentelemetry/api` | no explicit pin (intentional — brought transitively by the consumer's tracer SDK such as `@opentelemetry/sdk-node`) | Any OTel `Tracer` matching the `BonklmTracer` structural shape works. Tested against `@opentelemetry/api@^1.9.0`. |

## Quick Start

```typescript
import { trace } from '@opentelemetry/api';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
import { emitVoltOpsSpan } from '@blackunicorn/bonklm-voltops-otel';

const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });
const tracer = trace.getTracer('bonklm-voltops');

const result = await engine.validate(userMessage);
emitVoltOpsSpan(result, {
  tracer,
  scanner: 'prompt-injection', // VoltOps-specific scanner ID
  surface: 'text_input',
});
```

`emitVoltOpsSpan` returns the `GuardrailResult` unchanged for fluent inlining.

## API Reference

### `emitVoltOpsSpan<R extends GuardrailResult>(result, options): R`

Thin wrapper around `bonklmTrace(...)` (re-exported from core). Emits a single OTLP span per validator decision with the R2-10 locked attribute vocabulary PLUS `bonklm.scanner`.

Throws `TypeError` when `options.scanner` is missing or not a non-empty string.

### `EmitVoltOpsSpanOptions`

| Option | Type | Required | Description |
|---|---|---|---|
| `tracer` | `BonklmTracer` | yes | Any `@opentelemetry/api`-compatible Tracer (structural shape). |
| `scanner` | `string` | yes | VoltOps-specific scanner identifier; mapped to both `bonklm.scanner` AND `bonklm.validator`. |
| `surface` | `BonklmTraceSurface` | yes | One of the 7 R2-10 surfaces. |
| `spanName` | `string` | no | Override default span name. |
| `extraAttributes` | `Record<string, string \| number \| boolean>` | no | Merged into the span (e.g. `service.version`, `tenant.id`). |

### Span attributes emitted

| Attribute | Source | Example |
|---|---|---|
| `bonklm.scanner` | `options.scanner` | `'pii-redactor'` |
| `bonklm.validator` | `options.scanner` (mirrored) | `'pii-redactor'` |
| `bonklm.surface` | `options.surface` | `'text_output'` |
| `bonklm.action` | `result.blocked` | `'allow'` \| `'block'` |
| `bonklm.severity` | `result.severity` | `'critical'`, `'warning'`, `'info'`, `'blocked'` |
| `bonklm.finding_count` | `result.findings.length` | `1` |

Plus one `bonklm.finding` event per finding (`category`, `severity`, `description`) and `setStatus({ code: 2, message: result.reason })` on BLOCK.

7 locked surface values: `text_input` / `text_output` / `tool_call` / `retrieved_doc` / `memory_write` / `audio_partial` / `composed_context`.

### Re-exports (from `@blackunicorn/bonklm`)

`bonklmTrace`, `BonklmTraceSurface`, `BonklmTracer`, `BonklmSpan`, `BonklmSpanOptions`, `BonklmTraceAction`, `BonklmTraceOptions`.

## Threat Surfaces Covered

N/A — this is a telemetry adapter, not a validator. It serialises a `GuardrailResult` (already produced by the engine) into OTLP spans. The `surface` option only tags the span; the actual validation surfaces are decided by whatever connector ran `engine.validate(...)`. See [`docs/user/threat-surfaces.md`](../../docs/user/threat-surfaces.md).

## Limitations

- Tracer construction is the caller's responsibility — this package does not create or register a `TracerProvider`.
- VoltOps' "Scanners" dashboard pivots on `bonklm.scanner`. The same value is also written to `bonklm.validator` for compatibility with the R2-10 set.
- Sampling is configured at the OTel SDK level (not at `emitVoltOpsSpan`). See `otel-vendor-recipes.md` § Common patterns.
- No CHANGELOG file ships with this package — see git history.

## Related

- [`docs/user/otel-vendor-recipes.md`](../../docs/user/otel-vendor-recipes.md) — § 4 VoltOps recipe + 4 other vendor recipes (Langfuse, Phoenix, Arize AX, Datadog).
- [`@blackunicorn/bonklm`](../core/) — `bonklmTrace(...)` lives here; use it directly for non-VoltOps vendors.

## License

MIT
