/**
 * Connector Utilities - Stream Validator
 * ======================================
 *
 * Standard utilities for stream validation in connectors.
 * Provides shared streaming logic with buffer size protection.
 *
 * @package @blackunicorn/bonklm/core
 */

import type { Logger } from '../base/GenericLogger.js';
import { StreamValidationError } from './errors.js';

/**
 * Default maximum buffer size for streaming (1MB).
 */
export const DEFAULT_MAX_BUFFER_SIZE = 1024 * 1024;

/**
 * Default validation interval (number of chunks between validations).
 */
export const DEFAULT_VALIDATION_INTERVAL = 10;

/**
 * Stream validation options.
 */
export interface StreamValidationOptions {
  /** Maximum buffer size in bytes (default: 1MB) */
  maxBufferSize?: number;
  /** Number of chunks between validations (default: 10) */
  validationInterval?: number;
  /** Logger for validation events */
  logger?: Logger;
  /** Callback when stream is blocked */
  onBlocked?: (accumulated: string, reason: string) => void;
}

/**
 * Stream validator state for tracking accumulated content.
 */
export interface StreamValidatorState {
  /** Accumulated text content */
  accumulated: string;
  /** Chunk count since last validation */
  chunkCount: number;
  /** Whether stream has been blocked */
  blocked: boolean;
  /** Current byte size of accumulated content */
  byteSize: number;
}

/**
 * Creates a new stream validator state.
 *
 * @returns Initial validator state
 *
 * @example
 * ```ts
 * const state = createStreamValidatorState();
 * // Use in streaming loop
 * ```
 */
export function createStreamValidatorState(): StreamValidatorState {
  return {
    accumulated: '',
    chunkCount: 0,
    blocked: false,
    byteSize: 0,
  };
}

/**
 * Validates buffer size before accumulating a new chunk.
 * Throws StreamValidationError if the buffer would exceed the maximum size.
 *
 * This check MUST happen BEFORE adding the chunk to the accumulator.
 *
 * @param state - Current validator state
 * @param chunk - New chunk to be added
 * @param options - Validation options
 * @throws {StreamValidationError} If buffer size would be exceeded
 *
 * @example
 * ```ts
 * // BEFORE accumulating the chunk
 * validateBufferBeforeAccumulation(state, chunk, { maxBufferSize: 1024 * 1024 });
 * state.accumulated += chunk;
 * ```
 */
export function validateBufferBeforeAccumulation(
  state: StreamValidatorState,
  chunk: string,
  options: StreamValidationOptions = {}
): void {
  const maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;

  // Calculate byte size of new chunk
  const chunkByteSize = getByteSize(chunk);

  // Check if adding this chunk would exceed the limit
  if (state.byteSize + chunkByteSize > maxBufferSize) {
    const reason = 'Buffer overflow prevented';
    const message = `Stream buffer exceeded maximum size of ${maxBufferSize} bytes`;

    options.logger?.warn('[Stream Validator] Buffer overflow prevented', {
      currentSize: state.byteSize,
      chunkSize: chunkByteSize,
      maxSize: maxBufferSize,
    });

    options.onBlocked?.(state.accumulated, reason);

    throw new StreamValidationError(message, reason, true);
  }
}

/**
 * Updates validator state with a new chunk.
 * Call this AFTER validateBufferBeforeAccumulation.
 *
 * @param state - Current validator state
 * @param chunk - New chunk to add
 * @returns Updated chunk count
 *
 * @example
 * ```ts
 * validateBufferBeforeAccumulation(state, chunk);
 * const count = updateStreamValidatorState(state, chunk);
 * if (count % validationInterval === 0) {
 *   // Run validation
 * }
 * ```
 */
export function updateStreamValidatorState(
  state: StreamValidatorState,
  chunk: string
): number {
  state.accumulated += chunk;
  state.byteSize += getByteSize(chunk);
  return ++state.chunkCount;
}

/**
 * Checks if validation should run based on chunk count.
 *
 * @param state - Current validator state
 * @param interval - Validation interval
 * @returns True if validation should run
 *
 * @example
 * ```ts
 * if (shouldValidateStream(state, 10)) {
 *   const result = await engine.validate(state.accumulated);
 *   if (!result.allowed) {
 *     // Handle blocked content
 *   }
 * }
 * ```
 */
export function shouldValidateStream(
  state: StreamValidatorState,
  interval: number = DEFAULT_VALIDATION_INTERVAL
): boolean {
  return !state.blocked && state.chunkCount > 0 && state.chunkCount % interval === 0;
}

/**
 * Returns true if the stream has accumulated content since the last scheduled
 * validation interval but has not yet been validated.
 *
 * Connectors MUST call this after the stream ends and run a final validation pass
 * if it returns true — otherwise the tail of the stream (chunks since the last
 * interval boundary) may bypass detection.
 *
 * @example
 * ```ts
 * for await (const chunk of stream) {
 *   processStreamChunk(state, chunk);
 *   if (shouldValidateStream(state, 10)) {
 *     const r = await engine.validate(state.accumulated);
 *     if (!r.allowed) { markStreamBlocked(state, r.reason); break; }
 *   }
 * }
 * if (hasUnvalidatedTail(state, 10)) {
 *   const r = await engine.validate(state.accumulated);
 *   if (!r.allowed) markStreamBlocked(state, r.reason);
 * }
 * ```
 */
export function hasUnvalidatedTail(
  state: StreamValidatorState,
  interval: number = DEFAULT_VALIDATION_INTERVAL
): boolean {
  return !state.blocked && state.chunkCount > 0 && state.chunkCount % interval !== 0;
}

/**
 * Marks the stream as blocked.
 * Use this when validation fails.
 *
 * @param state - Current validator state
 * @param reason - Reason for blocking
 *
 * @example
 * ```ts
 * if (!validationResult.allowed) {
 *   markStreamBlocked(state, validationResult.reason);
 *   throw new Error('Content blocked');
 * }
 * ```
 */
export function markStreamBlocked(
  state: StreamValidatorState,
  _reason: string
): void {
  // Reason is accepted for API consistency and potential future logging
  state.blocked = true;
  state.accumulated = '';
  state.byteSize = 0;
  state.chunkCount = 0;
}

/**
 * Resets validator state for a new stream.
 *
 * @param state - Current validator state
 *
 * @example
 * ```ts
 * resetStreamValidatorState(state);
 * ```
 */
export function resetStreamValidatorState(state: StreamValidatorState): void {
  state.accumulated = '';
  state.blocked = false;
  state.byteSize = 0;
  state.chunkCount = 0;
}

/**
 * Gets the byte size of a string.
 * Handles UTF-16 encoding properly.
 *
 * @param str - String to measure
 * @returns Byte size
 *
 * @internal
 */
function getByteSize(str: string): number {
  // JavaScript uses UTF-16, so each character is 2 bytes
  // For accurate byte size in UTF-8, we need to count properly
  let size = str.length;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code > 0x7F && code <= 0x7FF) {
      size++;
    } else if (code > 0x7FF && code <= 0xFFFF) {
      size += 2;
    } else if (code >= 0x10000) {
      // Surrogate pair handling
      size += 3;
      i++; // Skip the next character (low surrogate)
    }
  }
  return size;
}

/**
 * Validates and processes a stream chunk with all safety checks.
 * This is a convenience function that combines all stream validation steps.
 *
 * @param state - Current validator state
 * @param chunk - New chunk to process
 * @param options - Validation options
 * @returns The accumulated content so far
 * @throws {StreamValidationError} If buffer size exceeded
 *
 * @example
 * ```ts
 * for await (const chunk of stream) {
 *   const accumulated = processStreamChunk(state, chunk, { maxBufferSize: 1024 * 1024 });
 *   if (shouldValidateStream(state, 10)) {
 *     // Run validation
 *   }
 * }
 * ```
 */
export function processStreamChunk(
  state: StreamValidatorState,
  chunk: string,
  options: StreamValidationOptions = {}
): string {
  validateBufferBeforeAccumulation(state, chunk, options);
  updateStreamValidatorState(state, chunk);
  return state.accumulated;
}
