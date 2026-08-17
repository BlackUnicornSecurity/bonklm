/**
 * BonkLM - Connector validation helpers
 * ======================================
 * Small predicates shared across all connector packages. Hoisted here so the
 * same `validatePositiveNumber` isn't copy-pasted into nine files.
 *
 * @package @blackunicorn/bonklm/core/connector-utils
 */

/**
 * Asserts that a numeric option is a finite positive number.
 *
 * @throws {TypeError} If value is not a positive finite number.
 */
export function validatePositiveNumber(value: number, optionName: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${optionName} must be a positive number. Received: ${value}`);
  }
}

/**
 * Options for {@link normalizeLimit}.
 */
export interface NormalizeLimitOptions {
  /** Upper bound (clamped to at least 1). */
  max: number;
  /** Value used when `requested` is omitted or non-finite. */
  fallback: number;
}

/**
 * Normalizes a caller-supplied result-limit into the inclusive range
 * `[1, max]`: non-finite (`undefined` / `NaN` / `Infinity`) falls back to
 * `fallback`, fractional values are floored, and the result is clamped so a
 * zero, negative, or over-large limit can never reach the downstream client.
 *
 * Shared across vector-DB connectors so limit handling cannot drift between
 * them (the weaviate rewrite established this clamp; qdrant/pinecone adopt it
 * here).
 *
 * @param requested - The caller's requested limit (may be undefined).
 * @param options - `{ max, fallback }`.
 * @returns An integer in `[1, max]` (with `max` itself floored to ≥ 1).
 */
export function normalizeLimit(requested: number | undefined, options: NormalizeLimitOptions): number {
  const effectiveMax = Math.max(1, Math.floor(options.max));
  const base = typeof requested === 'number' && Number.isFinite(requested) ? Math.floor(requested) : options.fallback;
  return Math.min(Math.max(base, 1), effectiveMax);
}

/**
 * Canonical default result-limit for vector-DB connectors — the `fallback`
 * passed to {@link normalizeLimit} when a caller omits a limit. Centralized so
 * the value cannot drift between connectors (chroma/qdrant/pinecone previously
 * hardcoded the literal `10`; weaviate keeps its own public re-export of the
 * same value). Vector-DB family-parity.
 */
export const DEFAULT_QUERY_LIMIT = 10;
