/**
 * Telemetry module
 *
 * Provides centralized telemetry data collection for monitoring and observability.
 *
 * @package @blackunicorn/bonklm
 */

export {
  TelemetryService,
  createTelemetryService,
  ConsoleTelemetryCollector,
  CallbackTelemetryCollector,
  BufferedTelemetryCollector,
  type TelemetryCollector,
  type TelemetryEvent,
  type TelemetryMetrics,
  type TelemetryServiceOptions
} from './TelemetryService.js';

export { TelemetryEventType } from './TelemetryService.js';

// Sprint 21 architect C2 closure — unified cross-package block-event
// discriminated union.
export {
  isBonklmBlockEvent,
  type BonklmBlockEvent,
  type BonklmBlockEventBase,
  type BonklmBlockEventKind,
  type BonklmVoiceBlockEvent,
  type BonklmSandboxBlockEvent,
  type BonklmInferenceBlockEvent,
  type BonklmDurableExecBlockEvent,
  type BonklmDocumentBlockEvent,
  type BonklmCfAgentBlockEvent,
  type BonklmWebMiddlewareBlockEvent
} from './block-event.js';

// Sprint 23 Story 3.11 — OTLP span export for validator decisions
// with R2-10 locked attribute vocabulary.
export {
  bonklmTrace,
  type BonklmTraceSurface,
  type BonklmTraceAction,
  type BonklmTraceOptions,
  type BonklmTracer,
  type BonklmSpan,
  type BonklmSpanOptions
} from './otlp-export.js';
