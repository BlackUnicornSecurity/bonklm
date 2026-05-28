/**
 * Test Result Display
 *
 * This module provides functionality to display test results in various formats:
 * - Terminal-friendly table format with color-coded indicators
 * - JSON output for programmatic consumption
 * - Summary statistics for multiple test results
 *
 * The display functions adapt to terminal capabilities, showing colors when
 * available and falling back to plain text for non-TTY environments.
 *
 * @module testing/display
 */

import type { TestResult } from '../connectors/base.js';
import { sanitizeMeta } from '../../connector-utils/logger.js';
import { getTerminalCapabilities } from '../utils/terminal.js';

/**
 * Test result with associated connector ID for display
 */
export interface TestDisplay {
  /** The connector identifier */
  connectorId: string;
  /** The connector name (optional, for better display) */
  connectorName?: string;
  /** The test result */
  result: TestResult;
}

/**
 * Summary statistics for multiple test results
 */
export interface TestSummary {
  /** Total number of tests */
  total: number;
  /** Number of successful tests */
  successful: number;
  /** Number of failed tests */
  failed: number;
  /** Number of connection failures */
  connectionFailures: number;
  /** Number of validation failures */
  validationFailures: number;
  /** Average latency in milliseconds */
  averageLatency: number;
  /** Success rate as percentage */
  successRate: number;
}

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m'
} as const;

/**
 * Unicode symbols for status indicators
 */
const SYMBOLS = {
  success: '✓',
  failure: '✗',
  warning: '⚠',
  skipped: '⊘'
} as const;

/**
 * Latency threshold in milliseconds for "slow" connector tests
 *
 * Tests taking longer than this threshold are highlighted in yellow
 * to indicate potential performance issues.
 */
const SLOW_LATENCY_THRESHOLD_MS = 1000;

/**
 * Displays test results in terminal or JSON format
 *
 * @param tests - Array of test results to display
 * @param jsonMode - If true, output JSON instead of formatted text
 *
 * @example
 * ```ts
 * displayTestResults([
 *   { connectorId: 'openai', result: { connection: true, validation: true, latency: 123 } },
 *   { connectorId: 'anthropic', result: { connection: false, validation: false, error: 'Auth failed' } },
 * ]);
 * ```
 */
export function displayTestResults(tests: TestDisplay[], jsonMode = false): void {
  if (jsonMode) {
    exportTestResultsJson(tests);
    return;
  }

  const { supportsColor } = getTerminalCapabilities();

  for (const test of tests) {
    const status = getTestStatusSymbol(test.result, supportsColor);
    const name = test.connectorName || test.connectorId;

    console.log(`${status} ${name}`);

    if (test.result.latency !== undefined) {
      const latency = test.result.latency;
      const latencyColor = latency > SLOW_LATENCY_THRESHOLD_MS ? COLORS.yellow : COLORS.dim;
      console.log(`  ${latencyColor}Latency:${COLORS.reset} ${latency}ms`);
    }

    if (test.result.error) {
      const errorColor = supportsColor ? COLORS.red : '';
      const resetColor = supportsColor ? COLORS.reset : '';
      // Sprint 47 CWE-117 sweep (security LOW closure from Sprint 46
      // audit): `test.result.error` is a connector-supplied error
      // string. Pre-Sprint-47 raw newlines + ANSI escape sequences in
      // the error could hijack the terminal renderer (terminal-control
      // injection, not log-injection). `sanitizeMeta` strips ESC
      // (0x1B) + control chars per sanitizeLogString.
      console.log(`  ${errorColor}Error:${resetColor} ${sanitizeMeta(test.result.error)}`);
    }
  }
}

/**
 * Returns a color-coded status symbol for a test result
 *
 * @param result - The test result
 * @param supportsColor - Whether to use ANSI colors
 * @returns Formatted status string
 */
function getTestStatusSymbol(result: TestResult, supportsColor: boolean): string {
  const isSuccess = result.connection === true && result.validation === true;

  if (isSuccess) {
    return supportsColor ? `${COLORS.green}${SYMBOLS.success}${COLORS.reset}` : SYMBOLS.success;
  }

  return supportsColor ? `${COLORS.red}${SYMBOLS.failure}${COLORS.reset}` : SYMBOLS.failure;
}

/**
 * Displays a single test result with detailed information
 *
 * @param connectorId - The connector identifier
 * @param connectorName - Optional connector name
 * @param result - The test result
 * @param supportsColor - Whether to use ANSI colors (default: auto-detect)
 *
 * @example
 * ```ts
 * displaySingleTestResult('openai', 'OpenAI', {
 *   connection: true,
 *   validation: true,
 *   latency: 123
 * });
 * ```
 */
export function displaySingleTestResult(
  connectorId: string,
  connectorName: string | undefined,
  result: TestResult,
  supportsColor?: boolean
): void {
  const { supportsColor: colorSupported } = getTerminalCapabilities();
  const useColor = supportsColor ?? colorSupported;

  const status = getTestStatusSymbol(result, useColor);
  const name = connectorName || connectorId;

  console.log(`${status} ${name}`);

  // Show connection status
  const connSymbol = result.connection ? SYMBOLS.success : SYMBOLS.failure;
  const connColor = result.connection ? COLORS.green : COLORS.red;
  console.log(
    `  ${useColor ? connColor : ''}Connection:${useColor ? COLORS.reset : ''} ${connSymbol} ${
      result.connection ? 'OK' : 'Failed'
    }`
  );

  // Show validation status if connection succeeded
  if (result.connection) {
    const valSymbol = result.validation ? SYMBOLS.success : SYMBOLS.failure;
    const valColor = result.validation ? COLORS.green : COLORS.yellow;
    console.log(
      `  ${useColor ? valColor : ''}Validation:${useColor ? COLORS.reset : ''} ${valSymbol} ${
        result.validation ? 'OK' : 'Failed'
      }`
    );
  }

  // Show latency
  if (result.latency !== undefined) {
    const latency = result.latency;
    const latencyColor = latency > 1000 ? COLORS.yellow : COLORS.dim;
    console.log(`  ${useColor ? latencyColor : ''}Latency:${useColor ? COLORS.reset : ''} ${latency}ms`);
  }

  // Show error
  if (result.error) {
    const errorColor = useColor ? COLORS.red : '';
    const resetColor = useColor ? COLORS.reset : '';
    // Sprint 47 CWE-117 sweep (sister to line ~117 — single-test display).
    console.log(`  ${errorColor}Error:${resetColor} ${sanitizeMeta(result.error)}`);
  }
}

/**
 * Formats a test summary with statistics
 *
 * @param tests - Array of test results to summarize
 * @returns A TestSummary object with calculated statistics
 *
 * @example
 * ```ts
 * const summary = formatTestSummary(tests);
 * console.log(`Success rate: ${summary.successRate}%`);
 * ```
 */
export function formatTestSummary(tests: TestDisplay[]): TestSummary {
  const total = tests.length;
  const successful = tests.filter(t => t.result.connection && t.result.validation).length;
  const failed = total - successful;

  const connectionFailures = tests.filter(t => !t.result.connection).length;
  const validationFailures = tests.filter(t => t.result.connection && !t.result.validation).length;

  const latencies = tests.map(t => t.result.latency).filter((l): l is number => l !== undefined);
  const averageLatency = latencies.length > 0 ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length : 0;

  const successRate = total > 0 ? (successful / total) * 100 : 0;

  return {
    total,
    successful,
    failed,
    connectionFailures,
    validationFailures,
    averageLatency: Math.round(averageLatency),
    successRate: Math.round(successRate)
  };
}

/**
 * Displays a test summary in terminal format
 *
 * @param summary - The test summary to display
 *
 * @example
 * ```ts
 * const summary = formatTestSummary(tests);
 * displayTestSummary(summary);
 * // Output:
 * // Test Summary
 * // ✓ 3 successful
 * // ✗ 1 failed
 * // Success rate: 75%
 * ```
 */
export function displayTestSummary(summary: TestSummary): void {
  const { supportsColor } = getTerminalCapabilities();

  console.log('');
  if (supportsColor) {
    console.log(`${COLORS.bold}Test Summary${COLORS.reset}`);
  } else {
    console.log('Test Summary');
  }

  const successColor = supportsColor ? COLORS.green : '';
  const failureColor = supportsColor ? COLORS.red : '';
  const resetColor = supportsColor ? COLORS.reset : '';
  const dimColor = supportsColor ? COLORS.dim : '';

  console.log(`  ${successColor}${SYMBOLS.success} ${summary.successful} successful${resetColor}`);
  console.log(`  ${failureColor}${SYMBOLS.failure} ${summary.failed} failed${resetColor}`);

  if (summary.connectionFailures > 0) {
    console.log(`  ${dimColor}Connection failures: ${summary.connectionFailures}${resetColor}`);
  }

  if (summary.validationFailures > 0) {
    console.log(`  ${dimColor}Validation failures: ${summary.validationFailures}${resetColor}`);
  }

  if (summary.averageLatency > 0) {
    console.log(`  ${dimColor}Average latency: ${summary.averageLatency}ms${resetColor}`);
  }

  const rateColor = summary.successRate >= 80 ? COLORS.green : summary.successRate >= 50 ? COLORS.yellow : COLORS.red;
  console.log(
    `  ${supportsColor ? rateColor : ''}Success rate: ${summary.successRate}%${supportsColor ? COLORS.reset : ''}`
  );
}

/**
 * Exports test results as JSON
 *
 * @param tests - Array of test results to export
 * @param pretty - Whether to pretty-print the JSON (default: true)
 *
 * @example
 * ```ts
 * exportTestResultsJson(tests);
 * // Output: [{"connectorId":"openai","result":{"connection":true,...}},...]
 * ```
 */
export function exportTestResultsJson(tests: TestDisplay[], pretty = true): void {
  const output = tests.map(({ connectorId, connectorName, result }) => ({
    connectorId,
    connectorName,
    connection: result.connection,
    validation: result.validation,
    error: result.error,
    latency: result.latency
  }));

  console.log(JSON.stringify(output, null, pretty ? 2 : 0));
}

/**
 * Exports test summary as JSON
 *
 * @param summary - The test summary to export
 * @param pretty - Whether to pretty-print the JSON (default: true)
 *
 * @example
 * ```ts
 * const summary = formatTestSummary(tests);
 * exportTestSummaryJson(summary);
 * // Output: {"total":5,"successful":4,...}
 * ```
 */
export function exportTestSummaryJson(summary: TestSummary, pretty = true): void {
  console.log(JSON.stringify(summary, null, pretty ? 2 : 0));
}

/**
 * Creates a progress bar for test execution
 *
 * @param current - Current test number
 * @param total - Total number of tests
 * @param width - Width of the progress bar (default: 30)
 * @returns A string representation of the progress bar
 *
 * @example
 * ```ts
 * console.log(createProgressBar(2, 5)); // [======.......] 40%
 * ```
 */
export function createProgressBar(current: number, total: number, width = 30): string {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${percentage}%`;
}

/**
 * Formats a detailed test result for logging
 *
 * This function creates a detailed string representation suitable for
 * logging to files or external systems.
 *
 * @param test - The test display object to format
 * @returns A detailed string representation
 *
 * @example
 * ```ts
 * const detail = formatTestDetail({
 *   connectorId: 'openai',
 *   result: { connection: true, validation: true, latency: 123 }
 * });
 * console.log(detail);
 * // Output: [openai] Connection: ✓, Validation: ✓, Latency: 123ms
 * ```
 */
export function formatTestDetail(test: TestDisplay): string {
  const parts = [`[${test.connectorId}]`];

  parts.push(`Connection: ${test.result.connection ? '✓' : '✗'}`);

  if (test.result.connection) {
    parts.push(`Validation: ${test.result.validation ? '✓' : '✗'}`);
  }

  if (test.result.latency !== undefined) {
    parts.push(`Latency: ${test.result.latency}ms`);
  }

  if (test.result.error) {
    parts.push(`Error: ${test.result.error}`);
  }

  return parts.join(' ');
}

/**
 * Returns all test results that failed
 *
 * @param tests - Array of test results to filter
 * @returns Array of failed test results
 *
 * @example
 * ```ts
 * const failed = getFailedTests(tests);
 * console.log(`Failed tests: ${failed.map(t => t.connectorId).join(', ')}`);
 * ```
 */
export function getFailedTests(tests: TestDisplay[]): TestDisplay[] {
  return tests.filter(t => !t.result.connection || !t.result.validation);
}

/**
 * Returns all test results that succeeded
 *
 * @param tests - Array of test results to filter
 * @returns Array of successful test results
 *
 * @example
 * ```ts
 * const successful = getSuccessfulTests(tests);
 * console.log(`Successful tests: ${successful.length}`);
 * ```
 */
export function getSuccessfulTests(tests: TestDisplay[]): TestDisplay[] {
  return tests.filter(t => t.result.connection && t.result.validation);
}
