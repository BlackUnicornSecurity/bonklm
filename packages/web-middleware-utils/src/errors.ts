export type WebMiddlewarePhase = 'request' | 'response';

export interface WebMiddlewareBlockEvent {
  /** cross-package kind. */
  kind: 'web-middleware';
  phase: WebMiddlewarePhase;
  reason: string;
  category?: string;
  severity?: string;
  /** First 200 chars of the blocked body. */
  excerpt?: string;
}

export class WebMiddlewareBlockedError extends Error {
  override readonly name = 'WebMiddlewareBlockedError';
  readonly phase: WebMiddlewarePhase;
  readonly category?: string;
  readonly severity?: string;

  constructor(message: string, phase: WebMiddlewarePhase, extra?: { category?: string; severity?: string }) {
    super(message);
    this.phase = phase;
    this.category = extra?.category;
    this.severity = extra?.severity;
  }
}
