/**
 * Telemetry Service
 *
 * Provides centralized telemetry data collection for monitoring and observability.
 *
 * @package @blackunicorn/bonklm
 */

import type { Logger } from '../base/GenericLogger.js';
import { serializeError } from '../common/index.js';
import { sanitizeMeta } from '../connector-utils/logger.js';

/**
 * Telemetry event types
 */
export enum TelemetryEventType {
  VALIDATION_START = 'validation.start',
  VALIDATION_COMPLETE = 'validation.complete',
  VALIDATION_BLOCKED = 'validation.blocked',
  VALIDATION_ERROR = 'validation.error',
  STREAM_START = 'stream.start',
  STREAM_CHUNK = 'stream.chunk',
  STREAM_BLOCKED = 'stream.blocked',
  STREAM_COMPLETE = 'stream.complete',
  API_CALL_START = 'api.call.start',
  API_CALL_COMPLETE = 'api.call.complete',
  API_CALL_ERROR = 'api.call.error',
  CIRCUIT_OPEN = 'circuit.open',
  CIRCUIT_HALF_OPEN = 'circuit.half_open',
  CIRCUIT_CLOSE = 'circuit.close',
  RETRY_ATTEMPT = 'retry.attempt',
}

/**
 * Telemetry metrics
 */
export interface TelemetryMetrics {
  /** Duration in milliseconds */
  duration?: number;
  /** Token count for streaming */
  tokenCount?: number;
  /** Character count */
  charCount?: number;
  /** Number of validators executed */
  validatorCount?: number;
  /** Number of findings */
  findingCount?: number;
  /** Risk score */
  riskScore?: number;
  /** Number of retries */
  retryCount?: number;
  /** Custom metrics */
  [key: string]: number | undefined;
}

/**
 * Telemetry event data
 */
export interface TelemetryEvent {
  /** Event type */
  type: TelemetryEventType;
  /** Timestamp (milliseconds since epoch) - auto-set if not provided */
  timestamp?: number;
  /** Unique run/operation identifier */
  runId?: string;
  /** Parent run ID for nested operations */
  parentRunId?: string;
  /** Connector name */
  connector?: string;
  /** Operation name */
  operation?: string;
  /** Metrics */
  metrics?: TelemetryMetrics;
  /** Additional context */
  context?: Record<string, unknown>;
  /** Error details (for error events) */
  error?: {
    name: string;
    message: string;
    code?: string;
  };
}

/**
 * Telemetry data collector interface
 */
export interface TelemetryCollector {
  /** Collect a telemetry event */
  collect(event: TelemetryEvent): void | Promise<void>;
  /** Flush any buffered events */
  flush?(): void | Promise<void>;
  /** Shutdown the collector */
  shutdown?(): void | Promise<void>;
}

/**
 * Telemetry service options
 */
export interface TelemetryServiceOptions {
  /** Logger instance */
  logger?: Logger;
  /** Telemetry collectors */
  collectors?: TelemetryCollector[];
  /** Enable/disable telemetry */
  enabled?: boolean;
  /** Sample rate (0-1) for reducing telemetry volume */
  sampleRate?: number;
  /** Maximum number of events to buffer before flushing */
  maxBufferSize?: number;
  /** Flush interval in milliseconds */
  flushInterval?: number;
}

/**
 * Default telemetry options
 */
const DEFAULT_OPTIONS: Required<Omit<TelemetryServiceOptions, 'collectors' | 'logger'>> = {
  enabled: true,
  sampleRate: 1.0,
  maxBufferSize: 100,
  flushInterval: 30000, // 30 seconds
};

/**
 * Console telemetry collector for development/debugging
 */
export class ConsoleTelemetryCollector implements TelemetryCollector {
  constructor(private readonly logger?: Logger) {}

  collect(event: TelemetryEvent): void {
    // Sprint 45 security MEDIUM #4 closure: `runId` and `operation`
    // flow from connector callers (e.g. LangChain runId, arbitrary
    // connector names) and may carry attacker-influenced content.
    // The langchain-handler Sprint 44 fix sanitizes at the warn-log
    // site in the handler; the TelemetryService is a separate sink
    // and must sanitize at the collect() boundary too.
    if (this.logger) {
      this.logger.debug('[Telemetry]', {
        type: event.type,
        runId: sanitizeMeta(event.runId),
        operation: sanitizeMeta(event.operation),
        metrics: event.metrics,
      });
    } else {
      console.debug('[Telemetry]', event.type, sanitizeMeta(event.runId), event.metrics);
    }
  }
}

/**
 * Callback telemetry collector for user-defined handling
 */
export class CallbackTelemetryCollector implements TelemetryCollector {
  constructor(
    private readonly callback: (event: TelemetryEvent) => void | Promise<void>
  ) {}

  async collect(event: TelemetryEvent): Promise<void> {
    await this.callback(event);
  }
}

/**
 * Buffered telemetry collector for batching events
 */
export class BufferedTelemetryCollector implements TelemetryCollector {
  private buffer: TelemetryEvent[] = [];
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly delegate: TelemetryCollector,
    private readonly maxBufferSize: number = 100,
    private readonly flushInterval: number = 30000
  ) {
    this.startFlushTimer();
  }

  collect(event: TelemetryEvent): void {
    this.buffer.push(event);

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0);

    for (const event of events) {
      try {
        this.delegate.collect(event);
      } catch (error) {
        // HB-5 (ST-05-005) Sprint 51 Wave 3: use serializeError to route
        // the error through sanitizeLogString before writing to stderr.
        // A hostile delegate whose .toString() returns ANSI/control chars
        // would otherwise inject terminal-control sequences into CI logs
        // and OTel exporters that capture stderr (CWE-117 residual from
        // Sprint 48 sweep which missed this nested-class site).
        console.error('[Telemetry] Error flushing event:', serializeError(error));
      }
    }
  }

  shutdown(): void {
    this.stopFlushTimer();
    this.flush();
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }
}

/**
 * Telemetry Service
 *
 * Centralized service for collecting and managing telemetry events.
 * Supports multiple collectors and sampling for high-volume scenarios.
 */
export class TelemetryService {
  private readonly options: Required<Omit<TelemetryServiceOptions, 'collectors' | 'logger'>>;
  private readonly collectors: TelemetryCollector[];
  private readonly logger: Logger;

  constructor(options: TelemetryServiceOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.collectors = options.collectors || [];
    this.logger = options.logger || console;

    // Wrap collectors in buffered collector if needed
    if (this.options.maxBufferSize > 0 && this.options.flushInterval > 0) {
      for (let i = 0; i < this.collectors.length; i++) {
        const collector = this.collectors[i];
        if (!(collector instanceof BufferedTelemetryCollector)) {
          this.collectors[i] = new BufferedTelemetryCollector(
            collector,
            this.options.maxBufferSize,
            this.options.flushInterval
          );
        }
      }
    }
  }

  /**
   * Record a telemetry event
   */
  record(event: TelemetryEvent): void {
    if (!this.options.enabled) return;

    // Apply sampling
    if (this.options.sampleRate < 1.0 && Math.random() > this.options.sampleRate) {
      return;
    }

    // B.11 (ST-05-108) Sprint 51 Wave 3: never mutate the caller-supplied
    // event object. Shallow-clone before assigning timestamp so the
    // caller's original object is left untouched (CLAUDE.md immutability
    // rule). Observable side-effect: caller holding a reference to the
    // passed object would see their timestamp property silently set,
    // violating the principle of least surprise.
    const safeEvent: TelemetryEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    };

    // Send to all collectors
    for (const collector of this.collectors) {
      try {
        collector.collect(safeEvent);
      } catch (error) {
        // Sprint 48 cross-subsystem CWE-117 sweep closure: raw
        // `{ error }` renders `error={}` post-JSON.stringify because
        // Error properties are non-enumerable; switch to canonical
        // serializeError per Sprint 33.
        this.logger.warn('[Telemetry] Error collecting event', { error: serializeError(error) });
      }
    }
  }

  /**
   * Record validation start
   */
  recordValidationStart(config: {
    runId: string;
    connector?: string;
    content: string;
    direction: 'input' | 'output';
  }): void {
    this.record({
      type: TelemetryEventType.VALIDATION_START,
      runId: config.runId,
      connector: config.connector,
      operation: `${config.direction}-validation`,
      metrics: {
        charCount: config.content.length,
      },
      context: {
        direction: config.direction,
      },
    });
  }

  /**
   * Record validation complete
   */
  recordValidationComplete(config: {
    runId: string;
    connector?: string;
    duration: number;
    validatorCount: number;
    findingCount: number;
    riskScore: number;
    allowed: boolean;
  }): void {
    this.record({
      type: config.allowed
        ? TelemetryEventType.VALIDATION_COMPLETE
        : TelemetryEventType.VALIDATION_BLOCKED,
      runId: config.runId,
      connector: config.connector,
      operation: 'validation',
      metrics: {
        duration: config.duration,
        validatorCount: config.validatorCount,
        findingCount: config.findingCount,
        riskScore: config.riskScore,
      },
      context: {
        allowed: config.allowed,
      },
    });
  }

  /**
   * Record validation error
   */
  recordValidationError(config: {
    runId: string;
    connector?: string;
    error: Error;
  }): void {
    // Sprint 45 security MEDIUM #4 closure: `config.error.message` /
    // `.name` can carry attacker-influenced text when the error wraps
    // user input (e.g. an upstream validator throws with a hostile
    // message). Sanitize at the record-event boundary so all
    // downstream collectors see safe values.
    this.record({
      type: TelemetryEventType.VALIDATION_ERROR,
      runId: config.runId,
      connector: config.connector,
      operation: 'validation',
      error: {
        name: sanitizeMeta(config.error.name),
        message: sanitizeMeta(config.error.message),
        code: (config.error as any).code,
      },
    });
  }

  /**
   * Record stream start
   */
  recordStreamStart(config: {
    runId: string;
    connector?: string;
  }): void {
    this.record({
      type: TelemetryEventType.STREAM_START,
      runId: config.runId,
      connector: config.connector,
      operation: 'stream',
    });
  }

  /**
   * Record stream chunk
   */
  recordStreamChunk(config: {
    runId: string;
    connector?: string;
    tokenCount: number;
    charCount: number;
  }): void {
    this.record({
      type: TelemetryEventType.STREAM_CHUNK,
      runId: config.runId,
      connector: config.connector,
      operation: 'stream',
      metrics: {
        tokenCount: config.tokenCount,
        charCount: config.charCount,
      },
    });
  }

  /**
   * Record stream blocked
   */
  recordStreamBlocked(config: {
    runId: string;
    connector?: string;
    accumulatedLength: number;
  }): void {
    this.record({
      type: TelemetryEventType.STREAM_BLOCKED,
      runId: config.runId,
      connector: config.connector,
      operation: 'stream',
      metrics: {
        charCount: config.accumulatedLength,
      },
    });
  }

  /**
   * Record API call start
   */
  recordApiCallStart(config: {
    runId: string;
    connector: string;
    method: string;
  }): void {
    this.record({
      type: TelemetryEventType.API_CALL_START,
      runId: config.runId,
      connector: config.connector,
      operation: config.method,
    });
  }

  /**
   * Record API call complete
   */
  recordApiCallComplete(config: {
    runId: string;
    connector: string;
    method: string;
    duration: number;
    success: boolean;
  }): void {
    this.record({
      type: config.success
        ? TelemetryEventType.API_CALL_COMPLETE
        : TelemetryEventType.API_CALL_ERROR,
      runId: config.runId,
      connector: config.connector,
      operation: config.method,
      metrics: {
        duration: config.duration,
      },
    });
  }

  /**
   * Flush all buffered events
   */
  flush(): void {
    for (const collector of this.collectors) {
      if (collector.flush) {
        try {
          collector.flush();
        } catch (err) {
          // Sprint 48 sister site to line ~270.
          this.logger.warn('[Telemetry] Error flushing collector', { error: serializeError(err) });
        }
      }
    }
  }

  /**
   * Shutdown the telemetry service
   */
  shutdown(): void {
    for (const collector of this.collectors) {
      if (collector.shutdown) {
        try {
          collector.shutdown();
        } catch (err) {
          // Sprint 48 sister site.
          this.logger.warn('[Telemetry] Error shutting down collector', { error: serializeError(err) });
        }
      }
    }
  }

  /**
   * Add a collector
   */
  addCollector(collector: TelemetryCollector): void {
    this.collectors.push(collector);
  }

  /**
   * Remove a collector
   */
  removeCollector(collector: TelemetryCollector): void {
    const index = this.collectors.indexOf(collector);
    if (index > -1) {
      this.collectors.splice(index, 1);
    }
  }
}

/**
 * Create a telemetry service with default console collector
 */
export function createTelemetryService(
  options?: TelemetryServiceOptions
): TelemetryService {
  const collectors = options?.collectors || [];

  // Add console collector if no collectors specified
  if (collectors.length === 0 && options?.enabled !== false) {
    collectors.push(new ConsoleTelemetryCollector(options?.logger));
  }

  return new TelemetryService({
    ...options,
    collectors,
  });
}
