/**
 * Connector test timeouts.
 *
 * A leaf module on purpose. These constants used to live in `registry.ts`,
 * which the connector implementations import back — a real ESM cycle that
 * survived only because each implementation read the constant inside a
 * deferred `test()` closure. The registry now also builds every catalog
 * connector in its module body, so the cycle carries more weight than it did;
 * keeping the constants here removes it entirely.
 *
 * @module connectors/timeouts
 */

/** Default timeout in milliseconds for API-based connector tests */
export const DEFAULT_API_TIMEOUT = 5000;

/** Default timeout in milliseconds for local service connector tests */
export const DEFAULT_LOCAL_TIMEOUT = 2000;
