/**
 * Testing Framework Module Exports
 *
 * This module exports all testing functionality for BonkLM
 * Installation Wizard.
 */

// Connector validation and testing
export {
  testConnector,
  testConnectorWithTimeout,
  testMultipleConnectors,
  validateConnectorConfig,
  createTestResult,
  isTestSuccessful,
  isConnectionFailure,
  isValidationFailure,
  formatTestResult
} from './validator.js';

// Guardrail validation tests
export {
  runGuardrailTest,
  runGuardrailTestWithConnector,
  isCorePackageAvailable,
  formatGuardrailResult,
  isGuardrailTestSuccessful,
  type GuardrailTestResult
} from './guardrail-test.js';

// Test result display
export {
  displayTestResults,
  displaySingleTestResult,
  formatTestSummary,
  displayTestSummary,
  exportTestResultsJson,
  exportTestSummaryJson,
  createProgressBar,
  formatTestDetail,
  getFailedTests,
  getSuccessfulTests,
  type TestDisplay,
  type TestSummary
} from './display.js';
