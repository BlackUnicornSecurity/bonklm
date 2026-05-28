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
