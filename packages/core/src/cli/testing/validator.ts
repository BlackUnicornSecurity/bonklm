/**
 * Connection Test Framework
 *
 * This module provides the two-tier testing framework for validating connectors:
 * 1. Connection test: Basic connectivity (port open, auth valid)
 * 2. Validation test: Full functionality (can send queries, returns valid responses)
 *
 * Features:
 * - Timeout enforcement with AbortController
 * - Secure credential handling with SecureCredential
 * - Graceful error handling with WizardError
 * - Latency measurement
 * - Comprehensive test results
 *
 * @module testing/validator
 */

import type { ConnectorDefinition, TestResult } from '../connectors/base.js';
import { ExitCode, WizardError } from '../utils/error.js';

/**
 * Default timeout for connector tests (milliseconds)
 *
 * This timeout applies to the overall test operation including
 * connection attempts, validation checks, and network latency.
 */
const DEFAULT_TEST_TIMEOUT = 10000;

/**
 * Maximum test timeout to prevent excessively long waits (milliseconds)
 */
const MAX_TEST_TIMEOUT = 30000;

/**
 * Validates a timeout value to ensure it's within acceptable bounds
 *
 * @param timeout - The timeout value in milliseconds
 * @returns A valid timeout value
 * @throws {WizardError} If timeout is negative or exceeds maximum
 */
export function validateTimeout(timeout: number): number {
  if (timeout < 0) {
    throw new WizardError(
      'INVALID_TIMEOUT',
      `Test timeout cannot be negative (received: ${timeout})`,
      'Use a positive timeout value in milliseconds'
    );
  }

  if (timeout > MAX_TEST_TIMEOUT) {
    throw new WizardError(
      'TIMEOUT_TOO_LARGE',
      `Test timeout exceeds maximum (received: ${timeout}, maximum: ${MAX_TEST_TIMEOUT})`,
      `Use a timeout value less than ${MAX_TEST_TIMEOUT}ms`
    );
  }

  return timeout;
}

/**
 * Re-keys a connector credential bag from env-var names to the config keys the
 * connector's `test()` / `configSchema` actually consume.
 *
 * The CLI credential loaders (`wizard`, `connector add`, `connector test`) build
 * config keyed by the connector's `detection.envVars` names (e.g.
 * `OPENAI_API_KEY`) because that is the shape persisted to `.env`. A connector's
 * `test()`, however, reads its own config keys (e.g. `apiKey`). A connector
 * declares this env-var -> config-key mapping via
 * {@link ConnectorDefinition.configKeyByEnvVar}; this function applies it,
 * returning a NEW object (the input is never mutated).
 *
 * Keys with no declared mapping pass through unchanged, and a connector that
 * declares no mapping at all (e.g. `ollama`, keyed only by ports, or the
 * framework connectors) yields a shallow copy — so connectors without an
 * env-var -> config-key indirection are unaffected. If two env vars map to the
 * same config key the last-enumerated value wins. Map keys/values come from
 * trusted compile-time connector definitions; as defense-in-depth a target key
 * of `__proto__`/`constructor`/`prototype` is skipped rather than assigned.
 *
 * @param connector - The connector whose mapping to apply.
 * @param config - The env-var-keyed credential bag.
 * @returns A new config object keyed for the connector's `test()`.
 */
export function applyConnectorConfigKeys(
  connector: ConnectorDefinition,
  config: Record<string, string>
): Record<string, string> {
  const mapping = connector.configKeyByEnvVar;
  if (!mapping) {
    return { ...config };
  }

  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    // `|| key` (not `??`): an empty-string mapping value is malformed, so fall
    // back to the original env-var key rather than landing the value under "".
    const target = mapping[key] || key;
    // Defense-in-depth: connector maps are trusted compile-time metadata, but
    // this helper is exported and generically typed — never let a target key
    // reach into the prototype chain (mirrors the __proto__/constructor guard
    // in cli/detection/framework.ts).
    if (target === '__proto__' || target === 'constructor' || target === 'prototype') {
      continue;
    }
    mapped[target] = value;
  }
  return mapped;
}

/**
 * Tests a connector with the provided configuration
 *
 * This function measures latency and handles errors gracefully,
 * returning a TestResult object with connection status, validation status,
 * error message (if any), and latency in milliseconds.
 *
 * @param connector - The connector definition to test
 * @param config - Configuration values for the connector
 * @param signal - Optional AbortSignal for cancelling the test
 * @returns Promise resolving to test results with latency
 *
 * @example
 * ```ts
 * const result = await testConnector(openaiConnector, {
 *   apiKey: 'sk-...'
 * });
 * console.log(result.connection, result.validation, result.latency);
 * ```
 */
export async function testConnector(
  connector: ConnectorDefinition,
  config: Record<string, string>,
  signal?: AbortSignal
): Promise<TestResult> {
  const startTime = Date.now();

  try {
    // Re-key the credential bag (built by the CLI loaders keyed by env-var name,
    // e.g. OPENAI_API_KEY, for .env persistence) into the config keys the
    // connector's test() consumes (e.g. apiKey). Connectors without an env-var
    // -> config-key indirection get a transparent shallow copy.
    const testConfig = applyConnectorConfigKeys(connector, config);

    // Call the connector's test function with the abort signal
    const result = await connector.test(testConfig, signal);

    // Ensure the result has the required fields
    if (typeof result.connection !== 'boolean' || typeof result.validation !== 'boolean') {
      return {
        connection: false,
        validation: false,
        error: 'Connector test returned invalid result format',
        latency: Date.now() - startTime
      };
    }

    // Return result with latency
    return {
      connection: result.connection,
      validation: result.validation,
      error: result.error,
      latency: Date.now() - startTime
    };
  } catch (error) {
    // Handle unexpected errors
    const message = error instanceof Error ? error.message : 'Unknown error';

    // If the error was due to abort, throw it so the timeout handler can catch it
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    return {
      connection: false,
      validation: false,
      error: message,
      latency: Date.now() - startTime
    };
  }
}

/**
 * Tests a connector with timeout enforcement
 *
 * This function wraps testConnector with an AbortController-based timeout.
 * If the test exceeds the specified timeout, it will be aborted and a
 * WizardError will be thrown with the TEST_TIMEOUT code.
 *
 * @param connector - The connector definition to test
 * @param config - Configuration values for the connector
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 * @returns Promise resolving to test results with latency
 * @throws {WizardError} If the test times out
 *
 * @example
 * ```ts
 * const result = await testConnectorWithTimeout(
 *   openaiConnector,
 *   { apiKey: 'sk-...' },
 *   5000 // 5 second timeout
 * );
 * ```
 */
export async function testConnectorWithTimeout(
  connector: ConnectorDefinition,
  config: Record<string, string>,
  timeout = DEFAULT_TEST_TIMEOUT
): Promise<TestResult> {
  // Validate timeout value
  const validTimeout = validateTimeout(timeout);

  // Create an abort controller for timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), validTimeout);

  try {
    // Run the test with the abort signal
    const result = await testConnector(connector, config, controller.signal);
    return result;
  } catch (error) {
    // Handle timeout specifically
    // Note: AbortError can be either Error.name or DOMException name
    const isError = error instanceof Error;
    const isErrorName = isError && error.name === 'AbortError';
    const isDOMException = error instanceof DOMException && error.name === 'AbortError';

    if (isErrorName || isDOMException) {
      throw new WizardError(
        'TEST_TIMEOUT',
        `Connector test timed out after ${validTimeout}ms`,
        'Check your network connection or increase the timeout',
        isError ? (error as Error) : undefined,
        ExitCode.PARTIAL
      );
    }

    // Re-throw other errors
    throw error;
  } finally {
    // Ensure timeout is always cleared (prevents race conditions)
    clearTimeout(timeoutId);
  }
}

/**
 * Tests multiple connectors in parallel
 *
 * This function runs multiple connector tests concurrently and returns
 * an array of results. This is useful when testing multiple connectors
 * at once, such as after the wizard has collected credentials.
 *
 * @param tests - Array of {connector, config} tuples to test
 * @param timeout - Maximum time to wait for each test in milliseconds
 * @returns Promise resolving to an array of test results
 *
 * @example
 * ```ts
 * const results = await testMultipleConnectors([
 *   [openaiConnector, { apiKey: 'sk-...' }],
 *   [anthropicConnector, { apiKey: 'sk-ant-...' }],
 * ]);
 * console.log(results); // [{ connectorId: 'openai', result: {...} }, ...]
 * ```
 */
export async function testMultipleConnectors(
  tests: Array<{ connectorId: string; connector: ConnectorDefinition; config: Record<string, string> }>,
  timeout = DEFAULT_TEST_TIMEOUT
): Promise<Array<{ connectorId: string; result: TestResult }>> {
  // Run all tests in parallel
  const results = await Promise.all(
    tests.map(async ({ connectorId, connector, config }) => {
      const result = await testConnectorWithTimeout(connector, config, timeout);
      return { connectorId, result };
    })
  );

  return results;
}

/**
 * Validates that a connector configuration is complete
 *
 * This function checks if all required configuration values are present
 * for a connector before attempting to test it. This provides early
 * feedback to users about missing credentials or settings.
 *
 * @param connector - The connector definition to validate
 * @param config - Configuration values to check
 * @returns Object with isValid flag and missing keys array
 *
 * @remarks Expects config keyed by the connector's CONFIG keys (e.g. `apiKey`),
 * not by env-var name. A caller holding an env-var-keyed credential bag (as the
 * CLI loaders build) must run it through {@link applyConnectorConfigKeys} first,
 * else `configSchema.safeParse` reports the real keys missing. No live caller
 * does this today.
 *
 * @example
 * ```ts
 * const validation = validateConnectorConfig(openaiConnector, {});
 * if (!validation.isValid) {
 *   console.log('Missing:', validation.missing); // ['apiKey']
 * }
 * ```
 */
export function validateConnectorConfig(
  connector: ConnectorDefinition,
  config: Record<string, string>
): { isValid: boolean; missing: string[]; errors: string[] } {
  const missing: string[] = [];
  const errors: string[] = [];

  // Parse the config schema to check for required fields
  const schemaResult = connector.configSchema.safeParse(config);

  if (!schemaResult.success) {
    // Extract error messages from Zod validation
    for (const issue of schemaResult.error.issues) {
      if (issue.code === 'invalid_type') {
        // ZodInvalidTypeIssue has 'received' field which is 'undefined' for missing required fields
        const invalidTypeIssue = issue as { received?: unknown };
        // Check if the field is missing (received is undefined) vs wrong type
        if (invalidTypeIssue.received === undefined) {
          missing.push(issue.path.join('.'));
        } else {
          errors.push(`${issue.path.join('.')}: ${issue.message}`);
        }
      } else {
        errors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
    }
  }

  return {
    isValid: missing.length === 0 && errors.length === 0,
    missing,
    errors
  };
}

/**
 * Creates a test result with a specific status
 *
 * Utility function for creating consistent TestResult objects.
 *
 * @param connection - Connection status
 * @param validation - Validation status
 * @param error - Optional error message
 * @param latency - Optional latency in milliseconds
 * @returns A TestResult object
 */
export function createTestResult(
  connection: boolean,
  validation: boolean,
  error?: string,
  latency?: number
): TestResult {
  return {
    connection,
    validation,
    error,
    latency
  };
}

/**
 * Checks if a test result indicates success
 *
 * @param result - The test result to check
 * @returns True if both connection and validation succeeded
 */
export function isTestSuccessful(result: TestResult): boolean {
  return result.connection === true && result.validation === true;
}

/**
 * Checks if a test result indicates a connection failure
 *
 * @param result - The test result to check
 * @returns True if connection failed but validation status is unknown
 */
export function isConnectionFailure(result: TestResult): boolean {
  return result.connection === false;
}

/**
 * Checks if a test result indicates a validation failure
 *
 * This occurs when connection succeeded but validation failed,
 * which typically means the service is reachable but credentials
 * or configuration are incorrect.
 *
 * @param result - The test result to check
 * @returns True if connection succeeded but validation failed
 */
export function isValidationFailure(result: TestResult): boolean {
  return result.connection === true && result.validation === false;
}

/**
 * Formats a test result for human-readable display
 *
 * @param result - The test result to format
 * @returns A formatted string representation
 */
export function formatTestResult(result: TestResult): string {
  const status = isTestSuccessful(result)
    ? '✓ Success'
    : isValidationFailure(result)
      ? '✗ Validation Failed'
      : '✗ Connection Failed';

  let output = status;

  if (result.latency !== undefined) {
    output += ` (${result.latency}ms)`;
  }

  if (result.error) {
    output += `\n  Error: ${result.error}`;
  }

  return output;
}
