/**
 * Wizard Command
 *
 * Run interactive setup wizard for BonkLM connectors.
 *
 * This command orchestrates the complete setup flow:
 * 1. Detects frameworks in the project
 * 2. Detects available services (Ollama, vector DBs)
 * 3. Detects existing credentials in environment
 * 4. Presents connector options to the user
 * 5. Collects credentials securely via password prompts
 * 6. Tests all selected connectors
 * 7. Writes configuration to .env file
 * 8. Displays summary of results
 *
 * @module commands/wizard
 */

import { Command } from 'commander';
import * as p from '@clack/prompts';
import { sanitizeMeta } from '../../connector-utils/logger.js';
import { getAllConnectors, getConnector } from '../connectors/registry.js';
import { detectFrameworks } from '../detection/framework.js';
import { detectServices } from '../detection/services.js';
import { detectCredentials } from '../detection/credentials.js';
import { testConnectorWithTimeout } from '../testing/validator.js';
import { EnvManager } from '../config/env.js';
import { AuditLogger } from '../utils/audit.js';
import { ExitCode, WizardError } from '../utils/error.js';
import type { TestResult } from '../connectors/base.js';

/**
 * Default timeout for connector tests in the wizard (milliseconds)
 */
const WIZARD_TEST_TIMEOUT = 10000;

/**
 * Maximum credential length to prevent DoS attacks
 */
const MAX_CREDENTIAL_LENGTH = 2048;

/**
 * Allowed connector IDs - whitelist for security
 */
const ALLOWED_CONNECTOR_IDS = [
  'openai',
  'anthropic',
  'ollama',
  'express',
  'langchain',
] as const;

/**
 * Valid connector ID format pattern
 * Must start with lowercase letter, contain only lowercase letters, numbers, and hyphens
 */
const VALID_CONNECTOR_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Options for the wizard command
 */
interface WizardOptions {
  json: boolean;
}

/**
 * Result of a connector test in the wizard
 */
interface ConnectorTestResult {
  connectorId: string;
  connectorName: string;
  result: TestResult;
}

/**
 * Validates a connector ID against security requirements
 *
 * @param id - The connector ID to validate
 * @returns True if valid
 */
function validateConnectorId(id: string): boolean {
  // Check length
  if (id.length < 1 || id.length > 50) {
    return false;
  }

  // Check against whitelist
  if (!ALLOWED_CONNECTOR_IDS.includes(id as any)) {
    return false;
  }

  // Check format pattern
  if (!VALID_CONNECTOR_ID_PATTERN.test(id)) {
    return false;
  }

  return true;
}

/**
 * Sanitizes values for JSON output to prevent credential leakage
 *
 * @param value - The value to sanitize
 * @returns Sanitized value
 */
function sanitizeForJson(value: unknown): unknown {
  if (typeof value === 'string') {
    // Remove potential credentials from error messages
    return value
      .replace(/sk-[a-zA-Z0-9\-_\.+/]{10,}/gi, '[API_KEY_REDACTED]')
      .replace(/sk-ant-[a-zA-Z0-9\-_\.+/]{10,}/gi, '[API_KEY_REDACTED]')
      .replace(/Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi, '[TOKEN_REDACTED]')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT_REDACTED]');
  }
  return value;
}

/**
 * Mapping of detected items to available connectors
 *
 * This function maps detected frameworks, services, and credentials
 * to the connectors that should be offered to the user.
 */
function getAvailableConnectors(detection: {
  frameworks: Awaited<ReturnType<typeof detectFrameworks>>;
  services: Awaited<ReturnType<typeof detectServices>>;
  credentials: Awaited<ReturnType<typeof detectCredentials>>;
}) {
  const allConnectors = getAllConnectors();
  const available: Array<{ id: string; name: string; category: string; detected: boolean }> = [];

  for (const connector of allConnectors) {
    let detected = false;

    // Check if framework was detected
    if (connector.detection.packageJson) {
      for (const pkg of connector.detection.packageJson) {
        if (detection.frameworks.some(f => f.name === pkg)) {
          detected = true;
          break;
        }
      }
    }

    // Check if service was detected
    if (!detected && connector.detection.ports) {
      for (const port of connector.detection.ports) {
        if (detection.services.some(s => s.address?.includes(`:${port}`))) {
          detected = true;
          break;
        }
      }
    }

    // Check if credentials were detected
    if (!detected && connector.detection.envVars) {
      for (const envVar of connector.detection.envVars) {
        if (detection.credentials.some(c => c.key === envVar && c.present)) {
          detected = true;
          break;
        }
      }
    }

    available.push({
      id: connector.id,
      name: connector.name,
      category: connector.category,
      detected,
    });
  }

  return available;
}

/**
 * Collects credentials for a connector via secure prompts
 *
 * @param connectorId - The connector ID
 * @returns Record of environment variable names to values
 */
async function collectCredentials(connectorId: string): Promise<Record<string, string>> {
  const connector = getConnector(connectorId);
  if (!connector) {
    throw new WizardError(
      'UNKNOWN_CONNECTOR',
      `Connector not found: ${connectorId}`,
      'Use a valid connector ID'
    );
  }

  const config: Record<string, string> = {};
  const envVars = connector.detection.envVars || [];

  for (const envVar of envVars) {
    const value = await p.password({
      message: `Enter ${envVar}:`,
      validate: (value) => {
        if (!value || value.length === 0) {
          return `${envVar} is required`;
        }
        // SECURITY: Validate input length to prevent DoS attacks
        if (value.length > MAX_CREDENTIAL_LENGTH) {
          return `${envVar} is too long (maximum ${MAX_CREDENTIAL_LENGTH} characters)`;
        }
        // Basic format validation for known keys
        if (envVar === 'OPENAI_API_KEY' && !value.startsWith('sk-')) {
          return 'OpenAI API key must start with "sk-"';
        }
        if (envVar === 'ANTHROPIC_API_KEY' && !value.startsWith('sk-ant-')) {
          return 'Anthropic API key must start with "sk-ant-"';
        }
        return undefined;
      },
    });

    if (p.isCancel(value)) {
      throw new WizardError(
        'USER_CANCELLED',
        'Credential collection was cancelled',
        undefined,
        undefined,
        ExitCode.ERROR
      );
    }

    if (typeof value === 'string') {
      config[envVar] = value;
    }
  }

  return config;
}

/**
 * Tests a single connector and displays progress
 *
 * @param connectorId - The connector ID
 * @param config - Configuration for the connector
 * @returns Test result
 */
async function testSingleConnector(
  connectorId: string,
  config: Record<string, string>
): Promise<ConnectorTestResult> {
  const connector = getConnector(connectorId);
  if (!connector) {
    throw new WizardError(
      'UNKNOWN_CONNECTOR',
      `Connector not found: ${connectorId}`,
      undefined
    );
  }

  p.log.step(`Testing ${connector.name}...`);

  const result = await testConnectorWithTimeout(connector, config, WIZARD_TEST_TIMEOUT);

  return {
    connectorId,
    connectorName: connector.name,
    result,
  };
}

/**
 * Wizard command implementation
 */
export const wizardCommand = new Command('wizard')
  .description('Run interactive setup wizard')
  .option('--json', 'Output results in JSON format')
  .action(async (options: WizardOptions) => {
    const audit = new AuditLogger();

    try {
      // Show intro
      p.intro('BonkLM Installation Wizard');

      // Phase 1: Framework Detection
      p.log.info('Detecting frameworks...');
      const frameworks = await detectFrameworks();
      if (frameworks.length > 0) {
        for (const fw of frameworks) {
          p.log.success(`Found ${fw.name}${fw.version ? ` (${fw.version})` : ''}`);
        }
      } else {
        p.log.warn('No frameworks detected');
      }

      // Phase 2: Service Detection
      p.log.info('Detecting services...');
      const services = await detectServices();
      if (services.length > 0) {
        for (const svc of services) {
          if (svc.available) {
            p.log.success(`Found ${svc.name}${svc.address ? ` at ${svc.address}` : ''}`);
          }
        }
      } else {
        p.log.warn('No services detected');
      }

      // Phase 3: Credential Detection
      p.log.info('Detecting credentials...');
      const credentials = await detectCredentials();
      if (credentials.length > 0) {
        for (const cred of credentials) {
          if (cred.present) {
            p.log.success(`Found ${cred.name} (${cred.maskedValue})`);
          }
        }
      } else {
        p.log.warn('No credentials detected');
      }

      // Get available connectors based on detection
      const availableConnectors = getAvailableConnectors({
        frameworks,
        services,
        credentials,
      });

      if (availableConnectors.length === 0) {
        p.note('No connectors available for your environment', 'No Connectors');
        p.outro('Wizard complete - no connectors to configure');
        return;
      }

      // Present connector selection
      const selected = await p.multiselect({
        message: 'Select connectors to configure:',
        options: availableConnectors.map(c => ({
          value: c.id,
          label: c.name,
          hint: c.detected ? 'detected' : undefined,
        })),
      });

      if (p.isCancel(selected)) {
        throw new WizardError(
          'USER_CANCELLED',
          'Connector selection was cancelled',
          undefined,
          undefined,
          ExitCode.ERROR
        );
      }

      if (!selected || selected.length === 0) {
        p.outro('No connectors selected. Exiting.');
        return;
      }

      // Collect credentials for selected connectors
      const envEntries: Record<string, string> = {};
      const testResults: ConnectorTestResult[] = [];

      for (const connectorId of selected) {
        // SECURITY: Validate connector ID before processing
        if (!validateConnectorId(connectorId)) {
          p.log.warn(`Skipping invalid connector ID: ${connectorId}`);
          continue;
        }

        p.log.warn(`\n--- Configuring ${connectorId} ---`);

        // Check if credentials already exist
        const connector = getConnector(connectorId);
        if (!connector) {
          continue;
        }

        const existingCredentials: Record<string, string> = {};
        for (const envVar of connector.detection.envVars || []) {
          if (process.env[envVar]) {
            existingCredentials[envVar] = process.env[envVar]!;
          }
        }

        let config: Record<string, string>;

        if (Object.keys(existingCredentials).length > 0) {
          // Ask if user wants to use existing credentials
          const useExisting = await p.confirm({
            message: `Use existing credentials for ${connector.name}?`,
            initialValue: true,
          });

          if (p.isCancel(useExisting)) {
            throw new WizardError(
              'USER_CANCELLED',
              'Credential selection was cancelled',
              undefined,
              undefined,
              ExitCode.ERROR
            );
          }

          if (useExisting) {
            config = existingCredentials;
          } else {
            config = await collectCredentials(connectorId);
          }
        } else {
          config = await collectCredentials(connectorId);
        }

        // Store for .env write
        Object.assign(envEntries, config);

        // Test the connector
        const testResult = await testSingleConnector(connectorId, config);
        testResults.push(testResult);

        if (testResult.result.connection && testResult.result.validation) {
          p.log.success(`${connector.name} is working!`);
        } else {
          // Sprint 47 CWE-117 sweep (security LOW closure from Sprint
          // 46 audit): `testResult.result.error` is a connector-
          // supplied error string. ANSI/control-char strip prevents
          // terminal-control injection from a hostile provider.
          p.log.error(`${connector.name} test failed: ${sanitizeMeta(testResult.result.error || 'Unknown error')}`);
        }
      }

      // Write to .env
      if (Object.keys(envEntries).length > 0) {
        p.log.info('\nWriting to .env file...');
        const envManager = new EnvManager();
        await envManager.write(envEntries);

        // Log audit event
        await audit.log({
          timestamp: new Date().toISOString(),
          action: 'connector_added',
          success: true,
        });

        p.log.success('Configuration saved to .env');
      }

      // Display summary
      p.log.warn('\n=== Summary ===');

      const successful = testResults.filter(r => r.result.connection && r.result.validation);
      const failed = testResults.filter(r => !r.result.connection || !r.result.validation);

      if (successful.length > 0) {
        p.log.success(`Successfully configured ${successful.length} connector(s):`);
        for (const r of successful) {
          p.log.message(`  - ${r.connectorName} (${r.result.latency}ms)`);
        }
      }

      if (failed.length > 0) {
        p.log.error(`Failed to configure ${failed.length} connector(s):`);
        for (const r of failed) {
          p.log.message(`  - ${r.connectorName}: ${r.result.error || 'Unknown error'}`);
        }
      }

      // JSON output if requested
      if (options.json) {
        // SECURITY: Sanitize error messages and remove envEntries metadata
        const safeOutput = {
          configured: successful.map(r => ({
            id: r.connectorId,
            name: r.connectorName,
            latency: r.result.latency,
          })),
          failed: failed.map(r => ({
            id: r.connectorId,
            name: r.connectorName,
            error: sanitizeForJson(r.result.error),
          })),
          // SECURITY: Remove envEntries entirely to avoid metadata leakage
          timestamp: new Date().toISOString(),
        };
        console.log(`\n${  JSON.stringify(safeOutput, null, 2)}`);
      }

      p.outro(
        successful.length > 0
          ? `Setup complete! ${successful.length} connector(s) configured.`
          : 'Setup complete. Some connectors failed configuration.'
      );

    } catch (error) {
      if (error instanceof WizardError) {
        if (error.exitCode === ExitCode.ERROR) {
          p.cancel(error.message);
          process.exit(1);
        }
        throw error;
      }
      throw error;
    }
  });
