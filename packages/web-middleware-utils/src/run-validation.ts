import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  WebMiddlewareBlockedError,
  type WebMiddlewareBlockEvent,
  type WebMiddlewarePhase,
} from './errors.js';

export interface RunValidationOptions {
  engine: GuardrailEngine;
  /** When true, return the BLOCK result instead of throwing. Default false. */
  returnInsteadOfThrow?: boolean;
  /** Skip validation entirely (operator allowlist). */
  shouldValidate?: (body: string) => boolean;
  /** Fires on BLOCK before throw (or return). */
  onBlock?: (event: WebMiddlewareBlockEvent) => void;
  /** Error sink for validator exceptions. */
  onError?: (err: unknown) => void;
}

export interface RunValidationResult {
  blocked: boolean;
  reason?: string;
  category?: string;
  severity?: string;
  excerpt?: string;
  skipped?: boolean;
}

/**
 * Validate a raw request body string through the engine. Throws
 * `WebMiddlewareBlockedError` on BLOCK (unless `returnInsteadOfThrow`).
 */
export async function runRequestValidation(
  options: RunValidationOptions,
  body: string
): Promise<RunValidationResult> {
  return runValidation('request', options, body);
}

/**
 * Validate a raw response body string through the engine. Same
 * semantics as `runRequestValidation` but tags telemetry as
 * `phase: 'response'`.
 */
export async function runResponseValidation(
  options: RunValidationOptions,
  body: string
): Promise<RunValidationResult> {
  return runValidation('response', options, body);
}

async function runValidation(
  phase: WebMiddlewarePhase,
  options: RunValidationOptions,
  body: string
): Promise<RunValidationResult> {
  if (typeof body !== 'string') {
    throw new TypeError(
      'web-middleware-utils: body must be a string. Use getRequestBody(req, framework) first.'
    );
  }
  if (!options?.engine) {
    throw new TypeError('web-middleware-utils: options.engine is required.');
  }
  if (body.trim().length === 0) return { blocked: false };
  if (options.shouldValidate && options.shouldValidate(body) === false) {
    return { blocked: false, skipped: true };
  }

  let result;
  try {
    result = await options.engine.validate(body);
  } catch (err) {
    safeOnError(options, err);
    throw err;
  }

  if (!result.blocked) return { blocked: false };

  const finding = result.findings[0];
  const excerpt = body.slice(0, 200);
  const event: WebMiddlewareBlockEvent = {
    kind: 'web-middleware',
    phase,
    reason: finding?.description ?? `${phase}_blocked`,
    category: finding?.category,
    severity: String(result.severity),
    excerpt,
  };
  safeOnBlock(options, event);

  if (options.returnInsteadOfThrow) {
    return {
      blocked: true,
      reason: event.reason,
      category: event.category,
      severity: event.severity,
      excerpt,
    };
  }
  throw new WebMiddlewareBlockedError(
    `${phase} body blocked: ${event.reason}`,
    phase,
    { category: event.category, severity: event.severity }
  );
}

function safeOnBlock(
  options: RunValidationOptions,
  ev: WebMiddlewareBlockEvent
): void {
  if (!options.onBlock) return;
  try {
    options.onBlock(ev);
  } catch (err) {
    safeOnError(options, err);
  }
}

function safeOnError(options: RunValidationOptions, err: unknown): void {
  if (!options.onError) return;
  try {
    options.onError(err);
  } catch {
    /* swallow */
  }
}
