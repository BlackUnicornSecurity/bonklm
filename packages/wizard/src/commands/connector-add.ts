/**
 * Connector Add Command
 *
 * Add a single connector configuration to the .env file.
 *
 * This command:
 * 1. Validates connector ID exists
 * 2. Checks for existing credentials in environment
 * 3. Collects credentials via secure password prompt
 * 4. Tests connector before saving (unless --force is used)
 * 5. Writes configuration to .env file
 * 6. Logs audit event
 *
 * @module commands/connector-add
 */

import { Command } from 'commander';
import * as p from '@clack/prompts';
import { getConnector } from '../connectors/registry.js';
import { testConnectorWithTimeout } from '../testing/validator.js';
import { EnvManager } from '../config/env.js';
import { AuditLogger } from '../utils/audit.js';
import { WizardError } from '../utils/error.js';
import { ExitCode } from '../utils/error.js';
import { maskKey } from '../utils/mask.js';

/**
 * Default timeout for connector tests in the add command (milliseconds)
 */
const ADD_TEST_TIMEOUT = 10000;

/**
 * Connector add command options
 */
interface AddOptions {
  force: boolean;
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
 * Connector add command implementation
 */
export const connectorAddCommand = new Command('add')
  .argument('<id>', 'Connector ID (e.g., openai, anthropic, ollama)')
  .description('Add a connector configuration')
  .option('--force', 'Skip connection test')
  .action(async (id: string, options: AddOptions) => {
    const audit = new AuditLogger();

    // Validate connector exists
    const connector = getConnector(id);
    if (!connector) {
      p.cancel(`Unknown connector: ${id}`);
      p.log.info(`Available connectors: ${  [
        'openai',
        'anthropic',
        'ollama',
        'express',
        'langchain',
      ].join(', ')}`);
      process.exit(1);
    }

    p.intro(`Adding ${connector.name} connector`);

    try {
      // Check for existing credentials
      const existingCredentials: Record<string, string> = {};
      for (const envVar of connector.detection.envVars || []) {
        if (process.env[envVar]) {
          existingCredentials[envVar] = process.env[envVar]!;
        }
      }

      let config: Record<string, string>;

      if (Object.keys(existingCredentials).length > 0) {
        p.log.info(`Found existing credentials in environment:`);
        for (const [key, value] of Object.entries(existingCredentials)) {
          // Use maskKey utility for consistent masking
          p.log.info(`  ${key}=${maskKey(value)}`);
        }

        const useExisting = await p.confirm({
          message: `Use existing credentials for ${connector.name}?`,
          initialValue: true,
        });

        if (p.isCancel(useExisting)) {
          p.cancel('Operation cancelled');
          process.exit(1);
        }

        if (useExisting) {
          config = existingCredentials;
        } else {
          config = await collectCredentials(id);
        }
      } else {
        // No existing credentials - collect new ones
        config = await collectCredentials(id);
      }

      // Test the connector (unless --force is used)
      if (!options.force) {
        p.log.info(`Testing ${connector.name} connection...`);
        const result = await testConnectorWithTimeout(connector, config, ADD_TEST_TIMEOUT);

        if (!result.connection || !result.validation) {
          p.cancel(`Connector test failed: ${result.error || 'Unknown error'}`);
          await audit.log({
            timestamp: new Date().toISOString(),
            action: 'connector_added',
            connector_id: id,
            success: false,
            error_code: 'TEST_FAILED',
          });
          process.exit(1);
        }

        p.log.success(`${connector.name} connection successful (${result.latency}ms)`);
      } else {
        p.log.warn('Skipping connection test (--force used)');
      }

      // Write to .env
      p.log.info('Writing to .env file...');
      const envManager = new EnvManager();
      await envManager.write(config);

      // Log audit event
      await audit.log({
        timestamp: new Date().toISOString(),
        action: 'connector_added',
        connector_id: id,
        success: true,
      });

      p.log.success(`✓ ${connector.name} connector added successfully.`);
      p.log.info(`Run 'bonklm status' to see all configured connectors.`);
      p.outro('Done!');

    } catch (error) {
      if (error instanceof WizardError) {
        if (error.exitCode === ExitCode.ERROR) {
          p.cancel(error.message);
          process.exit(1);
        }
        throw error;
      }
      p.cancel(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });
