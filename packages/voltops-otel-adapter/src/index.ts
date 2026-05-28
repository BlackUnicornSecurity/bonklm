/**
 * `@blackunicorn/bonklm-voltops-otel` — VoltOps OTel adapter (Story 3.10).
 *
 * Thin wrapper that pairs `bonklmTrace` (core/telemetry) with a
 * VoltOps tracer instance. Adds the VoltOps-specific
 * `bonklm.scanner` attribute alongside the R2-10 locked set.
 *
 * ```ts
 * import { trace } from '@opentelemetry/api';
 * import { emitVoltOpsSpan } from '@blackunicorn/bonklm-voltops-otel';
 *
 * const tracer = trace.getTracer('my-app');
 *
 * const result = await engine.validate(userMessage);
 * emitVoltOpsSpan(result, {
 *   tracer,
 *   scanner: 'prompt-injection',
 *   surface: 'text_input',
 * });
 * ```
 */
import {
  bonklmTrace,
  type BonklmTracer,
  type BonklmTraceSurface,
} from '@blackunicorn/bonklm';
import type { GuardrailResult } from '@blackunicorn/bonklm';

export interface EmitVoltOpsSpanOptions {
  tracer: BonklmTracer;
  /**
   * VoltOps-specific scanner identifier (mapped to `bonklm.scanner`
   * + `bonklm.validator` attributes).
   */
  scanner: string;
  /** R2-10 locked surface. */
  surface: BonklmTraceSurface;
  /** Optional span name override. */
  spanName?: string;
  /** Additional attributes merged into the span. */
  extraAttributes?: Record<string, string | number | boolean>;
}

/**
 * Emit a VoltOps-flavoured OTel span. Adds `bonklm.scanner` on top
 * of the standard R2-10 attribute set so VoltOps dashboards can
 * pivot by scanner name (alongside `bonklm.validator`).
 */
export function emitVoltOpsSpan<R extends GuardrailResult>(
  result: R,
  options: EmitVoltOpsSpanOptions
): R {
  if (!options?.scanner || typeof options.scanner !== 'string') {
    throw new TypeError('emitVoltOpsSpan: options.scanner (non-empty string) is required.');
  }
  return bonklmTrace(result, {
    tracer: options.tracer,
    validator: options.scanner,
    surface: options.surface,
    spanName: options.spanName,
    extraAttributes: {
      'bonklm.scanner': options.scanner,
      ...(options.extraAttributes ?? {}),
    },
  });
}

export {
  bonklmTrace,
  type BonklmTraceSurface,
  type BonklmTracer,
  type BonklmSpan,
  type BonklmSpanOptions,
  type BonklmTraceAction,
  type BonklmTraceOptions,
} from '@blackunicorn/bonklm';
