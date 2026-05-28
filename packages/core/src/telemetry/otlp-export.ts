/**
 * Story 3.11 (Sprint 23) — OTLP span export for validator decisions
 * ===================================================================
 *
 * `bonklmTrace(result, opts)` emits a single OTLP span per validator
 * decision with the R2-10 locked attribute vocabulary:
 *
 *   - `bonklm.validator` — validator name (e.g. 'prompt-injection')
 *   - `bonklm.severity`  — 'critical' | 'warning' | 'info' | 'blocked'
 *   - `bonklm.action`    — 'allow' | 'block'
 *   - `bonklm.finding_count` — number
 *   - `bonklm.surface`   — R2-10 locked vocab:
 *       'text_input' | 'text_output' | 'tool_call' | 'retrieved_doc' |
 *       'memory_write' | 'audio_partial' | 'composed_context'
 *     (NO synonyms — `prompt`/`output`/`tool_args` are forbidden
 *     per R2-10 lock.)
 *
 * **Caller-provides-exporter** (Sprint 23 AC): we do NOT depend on
 * `@opentelemetry/sdk-trace-node` or `@opentelemetry/sdk-trace-web`.
 * The caller passes a `BonklmTracer` (structural — implementations
 * exist for Langfuse, Phoenix, Arize, VoltOps, raw `@opentelemetry/api`).
 *
 * Compatible-by-construction: the tracer surface matches the
 * `@opentelemetry/api` `Tracer.startActiveSpan` shape, so a real
 * OpenTelemetry SDK is a drop-in. Mock tracers in tests work via
 * the same structural interface.
 */
import type { GuardrailResult } from '../base/GuardrailResult.js';
import { sanitizeMeta } from '../connector-utils/logger.js';

/** R2-10 locked surface vocabulary. */
export type BonklmTraceSurface =
  | 'text_input'
  | 'text_output'
  | 'tool_call'
  | 'retrieved_doc'
  | 'memory_write'
  | 'audio_partial'
  | 'composed_context';

export type BonklmTraceAction = 'allow' | 'block';

/**
 * Subset of the `@opentelemetry/api` Tracer surface we call. Real
 * implementations (Langfuse, Phoenix, Arize, VoltOps SDK, the
 * official OpenTelemetry NodeTracer) all satisfy this shape — the
 * caller passes any of them via `bonklmTrace(...).tracer`.
 */
export interface BonklmTracer {
  startActiveSpan: <T>(name: string, options: BonklmSpanOptions, fn: (span: BonklmSpan) => T) => T;
}

export interface BonklmSpanOptions {
  attributes?: Record<string, string | number | boolean>;
}

export interface BonklmSpan {
  setAttribute: (key: string, value: string | number | boolean) => void;
  addEvent?: (name: string, attrs?: Record<string, string | number | boolean>) => void;
  setStatus?: (status: { code: number; message?: string }) => void;
  end: () => void;
}

export interface BonklmTraceOptions {
  tracer: BonklmTracer;
  /** Validator name — required (e.g. 'prompt-injection'). */
  validator: string;
  /** R2-10 surface — required. */
  surface: BonklmTraceSurface;
  /**
   * Optional span name override. Default: `bonklm.validator.<surface>`.
   */
  spanName?: string;
  /** Additional attributes merged into the span. */
  extraAttributes?: Record<string, string | number | boolean>;
}

/**
 * Emit an OTLP span for a single validator decision.
 *
 * Returns the result unchanged so this can be inlined into a
 * validation pipeline:
 *
 * ```ts
 * const r = bonklmTrace(await validator.validate(input), {
 *   tracer, validator: 'prompt-injection', surface: 'text_input',
 * });
 * if (r.blocked) throw new Error('blocked');
 * ```
 *
 * @public Sprint 26/28 v1.0-RC1 API freeze. Caller-provides-tracer
 * contract is frozen — bonklm will never instantiate its own SDK /
 * exporter / processor. Surface vocabulary (R2-10 locked) is frozen.
 */
export function bonklmTrace<R extends GuardrailResult>(result: R, options: BonklmTraceOptions): R {
  if (!options?.tracer) {
    throw new TypeError('bonklmTrace: options.tracer is required.');
  }
  if (typeof options.validator !== 'string' || options.validator.length === 0) {
    throw new TypeError('bonklmTrace: options.validator (non-empty string) is required.');
  }
  if (!isValidSurface(options.surface)) {
    throw new TypeError(
      `bonklmTrace: options.surface must be one of the R2-10 locked vocab ` +
        `('text_input', 'text_output', 'tool_call', 'retrieved_doc', ` +
        `'memory_write', 'audio_partial', 'composed_context'). Got '${options.surface}'.`
    );
  }

  // Sprint 45 security HIGH #1 + #2 closure: `options.validator` and
  // `options.spanName` are caller-supplied strings (library-integrator
  // controls them but no enforcement). Both flow to the OTel exporter
  // wire format — same threat class as the Sprint 38 finding-event
  // sites. Wrap at the boundary per Sprint 41 defensive-by-default.
  // `options.surface` is enum-guarded by `isValidSurface` (safe);
  // `severity` is `result.severity` enum-coerced (library-controlled).
  const safeValidator = sanitizeMeta(options.validator);
  const spanName = sanitizeMeta(options.spanName ?? `bonklm.validator.${options.surface}`);
  const action: BonklmTraceAction = result.blocked ? 'block' : 'allow';
  const findingCount = Array.isArray(result.findings) ? result.findings.length : 0;
  const severity = String(result.severity ?? 'info');

  const attributes: Record<string, string | number | boolean> = {
    'bonklm.validator': safeValidator,
    'bonklm.severity': severity,
    'bonklm.action': action,
    'bonklm.finding_count': findingCount,
    'bonklm.surface': options.surface,
    ...(options.extraAttributes ?? {})
  };

  options.tracer.startActiveSpan(spanName, { attributes }, span => {
    // Set attributes individually as well — some OTel implementations
    // ignore the constructor `attributes` field on activated spans.
    //
    // Sprint 45 security MEDIUM #3 closure: `extraAttributes` string
    // values are fully caller-controlled. Sanitize string values
    // before reaching the OTel exporter wire format. Numeric +
    // boolean values pass through unchanged (no CWE-117 vector).
    for (const [k, v] of Object.entries(attributes)) {
      span.setAttribute(k, typeof v === 'string' ? sanitizeMeta(v) : v);
    }
    // Per-finding event so downstream sinks can pivot on category.
    //
    // Sprint 38 security-HIGH closure: OTel span attributes are NOT
    // JSON-serialized by the SDK — values pass to the exporter as-is.
    // OTel collectors that emit TSV (Splunk TCP, Datadog agent syslog
    // forwarder, several Collector exporter contrib modules) treat an
    // unescaped TAB inside `description` / `category` as a column
    // separator, enabling CWE-117 log injection via the telemetry
    // path that entirely bypasses the engine-side `sanitizeLogString`
    // wraps. `RFC 8259 §7` permits literal TAB inside JSON strings, so
    // even a JSON-emitting exporter does not save us — TAB survives
    // the JSON wire format. Sanitize at the boundary.
    if (Array.isArray(result.findings) && span.addEvent) {
      for (const finding of result.findings) {
        // Sprint 45 S41-2 LOW closure (Sprint 41 deferred): retrofit
        // the `sanitizeLogString(String(x ?? '<default>'))` combo to
        // the canonical Sprint 41 helper `sanitizeMeta`. The `??
        // '<default>'` survives outside the call because sanitizeMeta
        // returns empty string for nullish — preserving the explicit
        // per-site defaults requires the coalescing operator at the
        // argument site.
        span.addEvent('bonklm.finding', {
          category: sanitizeMeta(finding.category ?? 'unknown'),
          severity: sanitizeMeta(finding.severity ?? severity),
          description: sanitizeMeta(finding.description ?? '')
        });
      }
    }
    if (action === 'block' && span.setStatus) {
      // OpenTelemetry SpanStatusCode.ERROR = 2.
      // Sprint 38 security-HIGH closure (same rationale as above):
      // `result.reason` carries pattern-engine-derived text and MUST
      // be sanitized before reaching the exporter wire-format.
      // Sprint 45 retrofit: switched to `sanitizeMeta` for consistency
      // with the finding-event branch above.
      span.setStatus({ code: 2, message: sanitizeMeta(result.reason ?? 'bonklm block') });
    }
    span.end();
  });

  return result;
}

function isValidSurface(surface: unknown): surface is BonklmTraceSurface {
  return (
    surface === 'text_input' ||
    surface === 'text_output' ||
    surface === 'tool_call' ||
    surface === 'retrieved_doc' ||
    surface === 'memory_write' ||
    surface === 'audio_partial' ||
    surface === 'composed_context'
  );
}
