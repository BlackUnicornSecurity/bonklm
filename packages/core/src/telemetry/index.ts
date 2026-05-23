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
  type TelemetryServiceOptions,
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
} from './block-event.js';
