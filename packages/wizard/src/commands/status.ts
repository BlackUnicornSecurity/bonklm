/**
 * Status Command
 *
 * Show environment and connector status.
 *
 * This command displays:
 * 1. Detected frameworks in project
 * 2. Available services (Ollama, vector DBs)
 * 3. Configured credentials in .env and environment
 * 4. Available connectors
 *
 * @module commands/status
 */

import { Command } from 'commander';
import { detectFrameworks } from '../detection/framework.js';
import { detectServices } from '../detection/services.js';
import { detectCredentials } from '../detection/credentials.js';
import { getAllConnectors } from '../connectors/registry.js';
import { EnvManager } from '../config/env.js';
import type { DetectedFramework } from '../detection/framework.js';
import type { DetectedService } from '../detection/services.js';
import type { DetectedCredential } from '../detection/credentials.js';

/**
 * Status command options
 */
interface StatusOptions {
  json: boolean;
}

/**
 * Status output structure
 */
interface StatusOutput {
  frameworks: DetectedFramework[];
  services: DetectedService[];
  credentials: DetectedCredential[];
  configured: string[];
  available: Array<{ id: string; name: string; category: string }>;
}

/**
 * Formats a status item for display
 */
function formatStatusItem(label: string, items: Array<{ name: string; version?: string }>, empty = 'None') {
  if (items.length === 0) {
    return `${label}: ${empty}`;
  }

  return `${label}:\n${items.map(item => {
    const version = item.version ? ` (${item.version})` : '';
    return `  - ${item.name}${version}`;
  }).join('\n')}`;
}

/**
 * Status command implementation
 */
export const statusCommand = new Command('status')
  .description('Show environment and connector status')
  .option('--json', 'Output in JSON format')
  .action(async (options: StatusOptions) => {
    // Run all detections in parallel
    const [frameworks, services, credentials, env] = await Promise.all([
      detectFrameworks(),
      detectServices(),
      detectCredentials(),
      new EnvManager().read().catch(() => ({})),
    ]);

    const allConnectors = getAllConnectors();
    const configured = Object.keys(env);

    // Build output structure
    const output: StatusOutput = {
      frameworks,
      services,
      credentials,
      configured,
      available: allConnectors.map(c => ({
        id: c.id,
        name: c.name,
        category: c.category,
      })),
    };

    // Output JSON if requested
    if (options.json) {
      // Mask credential values in JSON output
      const maskedOutput = {
        ...output,
        credentials: output.credentials.map(c => ({
          ...c,
          maskedValue: c.maskedValue,
        })),
      };
      console.log(JSON.stringify(maskedOutput, null, 2));
      return;
    }

    // Human-readable output
    console.log(`\n${  '═'.repeat(50)}`);
    console.log('  LLM-Guardrails Environment Status');
    console.log(`${'═'.repeat(50)  }\n`);

    // Frameworks
    console.log(formatStatusItem('Frameworks', frameworks, 'No frameworks detected'));
    console.log('');

    // Services
    const availableServices = services.filter(s => s.available);
    console.log(formatStatusItem('Services', availableServices, 'No services detected'));
    if (services.length > availableServices.length) {
      const unavailable = services.filter(s => !s.available);
      if (unavailable.length > 0) {
        console.log(`  (Unavailable: ${  unavailable.map(s => s.name).join(', ')  })`);
      }
    }
    console.log('');

    // Credentials
    const presentCredentials = credentials.filter(c => c.present);
    if (presentCredentials.length > 0) {
      console.log('Credentials in environment:');
      for (const cred of presentCredentials) {
        console.log(`  ${cred.name}: ${cred.maskedValue}`);
      }
    } else {
      console.log('Credentials in environment: None');
    }
    console.log('');

    // Configured in .env
    if (configured.length > 0) {
      console.log('Configured in .env:');
      for (const key of configured) {
        // Mask the value for display
        const value = (env as Record<string, string>)[key] || '';
        const masked = value.length > 8
          ? `${value.slice(0, 2)}${'*'.repeat(value.length - 6)}${value.slice(-4)}`
          : '***';
        console.log(`  ${key}=${masked}`);
      }
    } else {
      console.log('Configured in .env: None');
    }
    console.log('');

    // Available connectors
    console.log('Available connectors:');
    for (const connector of allConnectors) {
      const isConfigured = connector.detection.envVars?.some(v => configured.includes(v) || process.env[v]);
      const status = isConfigured ? '✓' : ' ';
      console.log(`  [${status}] ${connector.name} (${connector.id})`);
    }

    console.log(`\n${  '═'.repeat(50)}`);
    console.log(`  Run 'bonklm wizard' to set up connectors`);
    console.log(`${'═'.repeat(50)  }\n`);
  });
