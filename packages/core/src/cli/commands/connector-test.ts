/**
 * Connector Test Command (EPIC-5)
 *
 * Tests an already-configured connector: reads its credentials from the
 * environment (`process.env` overlaid on the project `.env`), runs the
 * connector's two-tier connection + validation test with a bounded timeout,
 * and reports the result (human table or `--json`).
 *
 * The command surface is a thin shell over {@link runConnectorTest}, which
 * holds all decision logic and accepts injectable I/O dependencies so it can
 * be unit-tested without network, filesystem, or audit side effects (mirrors
 * the `runDoctor` pattern in `doctor.ts`).
 *
 * Exit codes (per the CLI exit-code matrix — 0 happy / 1 user-error / 2
 * system-or-partial): `0` when connection AND validation pass; `1` for an
 * invalid id, unknown connector, or an unconfigured connector (a user-error
 * the user must fix); `2` when the test ran but connection or validation
 * failed.
 *
 * @module commands/connector-test
 */

import { Command } from 'commander';
import type { ConnectorDefinition, TestResult } from '../connectors/base.js';
import { getConnector } from '../connectors/registry.js';
import { testConnectorWithTimeout } from '../testing/validator.js';
import { displayTestResults } from '../testing/display.js';
import { EnvManager } from '../config/env.js';
import { type AuditEvent, AuditLogger, createAuditEvent, safeAudit } from '../utils/audit.js';
import { sanitizeLogString } from '../../common/index.js';
import { formatAvailableConnectors, isValidConnectorIdFormat } from './connector-id.js';

/**
 * Default timeout for the connector test (milliseconds).
 */
const TEST_TIMEOUT_MS = 10000;

/**
 * Discriminator for the outcome of a connector test run.
 *
 * - `ok` — the test actually executed; inspect `result` for pass/fail.
 * - `invalid-id` — the id is structurally malformed.
 * - `unknown-connector` — the id is well-formed but not in the registry.
 * - `not-configured` — the connector has no credentials in the environment.
 */
export type ConnectorTestStatus = 'ok' | 'invalid-id' | 'unknown-connector' | 'not-configured';

/**
 * Structured result of {@link runConnectorTest}. Pure data — no side effects,
 * no `process.exit`. The command wrapper renders it and maps `exitCode`.
 */
export interface ConnectorTestReport {
  /** Outcome discriminator. */
  readonly status: ConnectorTestStatus;
  /** The (sanitized-at-render) connector id that was requested. */
  readonly connectorId: string;
  /** The connector's display name, when the id resolved to a connector. */
  readonly connectorName?: string;
  /** The test result, present only when `status === 'ok'`. */
  readonly result?: TestResult;
  /** Env var names that were absent, present when `status === 'not-configured'`. */
  readonly missing?: string[];
  /** Suggested exit code: 0 success, 1 user-error, 2 test failed. */
  readonly exitCode: 0 | 1 | 2;
}

/**
 * Injectable dependencies for {@link runConnectorTest}. All optional; the
 * defaults perform the real I/O. Tests inject stubs to avoid network /
 * filesystem / audit side effects.
 */
export interface ConnectorTestDeps {
  /** Loads connector credentials from the environment. */
  loadConfig?: (connector: ConnectorDefinition) => Promise<Record<string, string>>;
  /** Runs the actual connector test (defaults to {@link testConnectorWithTimeout}). */
  testFn?: (connector: ConnectorDefinition, config: Record<string, string>, timeout?: number) => Promise<TestResult>;
  /** Audit sink (defaults to a real {@link AuditLogger}). */
  audit?: { log: (event: AuditEvent) => Promise<void> };
  /** Test timeout in milliseconds. */
  timeout?: number;
}

/**
 * Default credential loader: overlays `process.env` on the parsed `.env` file,
 * keeping only the connector's declared env vars that have a non-empty value.
 */
async function defaultLoadConfig(connector: ConnectorDefinition): Promise<Record<string, string>> {
  const envFile = await new EnvManager().read().catch((): Record<string, string> => ({}));
  const config: Record<string, string> = {};
  for (const envVar of connector.detection.envVars ?? []) {
    const value = process.env[envVar] ?? envFile[envVar];
    if (value !== undefined && value !== '') {
      config[envVar] = value;
    }
  }
  return config;
}

/**
 * Test a connector's configuration. Pure decision logic with injectable I/O;
 * never calls `process.exit` and never throws for expected failure modes
 * (timeouts are folded into a failed {@link TestResult}).
 *
 * @param id - The connector id from the CLI argument.
 * @param deps - Injectable dependencies (see {@link ConnectorTestDeps}).
 * @returns A {@link ConnectorTestReport}.
 */
export async function runConnectorTest(id: string, deps: ConnectorTestDeps = {}): Promise<ConnectorTestReport> {
  const {
    loadConfig = defaultLoadConfig,
    testFn = testConnectorWithTimeout,
    audit = new AuditLogger(),
    timeout = TEST_TIMEOUT_MS
  } = deps;

  if (!isValidConnectorIdFormat(id)) {
    return { status: 'invalid-id', connectorId: id, exitCode: 1 };
  }

  const connector = getConnector(id);
  if (!connector) {
    return { status: 'unknown-connector', connectorId: id, exitCode: 1 };
  }

  const config = await loadConfig(connector);
  const envVars = connector.detection.envVars ?? [];
  const missing = envVars.filter(envVar => !(envVar in config));

  // "Not configured" = the connector declares credentials but none are present.
  // A partially-configured connector still runs the test; the connector's own
  // test() surfaces the specifics as a connection/validation failure.
  if (envVars.length > 0 && Object.keys(config).length === 0) {
    await safeAudit(audit, createAuditEvent('connector_tested', id, false, 'NOT_CONFIGURED'));
    return { status: 'not-configured', connectorId: id, connectorName: connector.name, missing, exitCode: 1 };
  }

  let result: TestResult;
  try {
    result = await testFn(connector, config, timeout);
  } catch (error) {
    // testConnectorWithTimeout throws a WizardError on timeout; fold any thrown
    // error into a failed result so the command reports it cleanly (exit 2)
    // rather than crashing with an unhandled rejection.
    result = {
      connection: false,
      validation: false,
      error: error instanceof Error ? error.message : 'Connector test failed'
    };
  }

  const success = result.connection && result.validation;
  await safeAudit(audit, createAuditEvent('connector_tested', id, success, success ? undefined : 'TEST_FAILED'));
  return { status: 'ok', connectorId: id, connectorName: connector.name, result, exitCode: success ? 0 : 2 };
}

/**
 * Options accepted by the `connector test` command.
 */
interface ConnectorTestOptions {
  json?: boolean;
}

/**
 * Renders a report as machine-readable JSON.
 *
 * Control characters are neutralised by `JSON.stringify` (escaped to `\uXXXX`),
 * so the output is always valid, parseable JSON; the echoed `connectorId` and the
 * connector-supplied `error` are additionally `sanitizeLogString`-hardened to keep
 * SIEM log lines intact (bidi / U+2028 / control chars).
 */
export function renderConnectorTestJson(report: ConnectorTestReport): void {
  console.log(
    JSON.stringify(
      {
        connectorId: sanitizeLogString(report.connectorId),
        connectorName: report.connectorName,
        status: report.status,
        connection: report.result?.connection ?? false,
        validation: report.result?.validation ?? false,
        // Connector-supplied error crosses a trust boundary; hex-escape control /
        // bidi chars per ADR-0001 (the human path sanitizes via display.ts's
        // sanitizeMeta). JSON.stringify alone keeps the output parseable but would
        // still pass U+2028/bidi/TAB-column-injection through to SIEM consumers.
        error: report.result?.error === undefined ? undefined : sanitizeLogString(report.result.error),
        latency: report.result?.latency,
        missing: report.missing,
        exitCode: report.exitCode
      },
      null,
      2
    )
  );
}

/**
 * Renders a report for human consumption. The `ok` branch delegates to the
 * shared {@link displayTestResults} renderer (which sanitizes connector-supplied
 * error strings); the error branches echo the user-supplied id through
 * `sanitizeLogString` (CWE-117, ADR-0001 alignment).
 */
export function renderConnectorTestHuman(report: ConnectorTestReport): void {
  const safeId = sanitizeLogString(report.connectorId);
  switch (report.status) {
    case 'ok':
      displayTestResults(
        [{ connectorId: report.connectorId, connectorName: report.connectorName, result: report.result! }],
        false
      );
      return;
    case 'invalid-id':
      console.error(`✗ Invalid connector ID: ${safeId}`);
      console.error(`  Connector IDs must match [a-z][a-z0-9-]* (max 50 chars).`);
      console.error(`  Available connectors: ${formatAvailableConnectors()}`);
      return;
    case 'unknown-connector':
      console.error(`✗ Unknown connector: ${safeId}`);
      console.error(`  Available connectors: ${formatAvailableConnectors()}`);
      return;
    case 'not-configured':
      console.error(`✗ ${report.connectorName} (${safeId}) is not configured.`);
      console.error(`  Missing: ${(report.missing ?? []).join(', ')}`);
      console.error(`  Run 'bonklm connector add ${safeId}' to configure it.`);
      return;
  }
}

/**
 * Connector test command implementation (thin shell over {@link runConnectorTest}).
 */
export const connectorTestCommand = new Command('test')
  .argument('<id>', 'Connector ID (e.g., openai, anthropic, ollama)')
  .description('Test a connector configuration')
  .option('--json', 'Output results in JSON format')
  .action(async (id: string, options: ConnectorTestOptions) => {
    const report = await runConnectorTest(id);

    if (options.json) {
      renderConnectorTestJson(report);
    } else {
      renderConnectorTestHuman(report);
    }

    if (report.exitCode !== 0) {
      process.exit(report.exitCode);
    }
  });
