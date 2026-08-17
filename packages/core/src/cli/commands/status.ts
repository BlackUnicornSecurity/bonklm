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
import { sanitizeMeta } from '../../connector-utils/logger.js';
import { type DetectedFramework, detectFrameworks } from '../detection/framework.js';
import { type DetectedService, detectServices } from '../detection/services.js';
import { detectCredentials, type DetectedCredential } from '../detection/credentials.js';
import { getAllConnectors } from '../connectors/registry.js';
import { EnvManager } from '../config/env.js';

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

  return `${label}:\n${items
    .map(item => {
      // `version` is a raw value from the project's package.json — the
      // untrusted input this command exists to read. Hex-escape control /
      // ANSI bytes before the TTY (CWE-117, ADR-0001).
      const version = item.version ? ` (${sanitizeMeta(item.version)})` : '';
      return `  - ${sanitizeMeta(item.name)}${version}`;
    })
    .join('\n')}`;
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
      detectFrameworks().catch(() => []),
      detectServices().catch(() => []),
      detectCredentials(),
      new EnvManager().read().catch(() => ({}))
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
        category: c.category
      }))
    };

    // Output JSON if requested
    if (options.json) {
      // Mask credential values in JSON output
      const maskedOutput = {
        ...output,
        frameworks: output.frameworks.map(f => ({
          ...f,
          version: f.version === undefined ? undefined : sanitizeMeta(f.version)
        })),
        credentials: output.credentials.map(c => ({
          ...c,
          // JSON.stringify alone keeps the output parseable but passes
          // U+2028 / bidi / control characters through to the consumer.
          maskedValue: sanitizeMeta(c.maskedValue)
        }))
      };
      console.log(JSON.stringify(maskedOutput, null, 2));
      return;
    }

    // Human-readable output
    console.log(`\n${'═'.repeat(50)}`);
    console.log('  BonkLM Environment Status');
    console.log(`${'═'.repeat(50)}\n`);

    // Frameworks
    console.log(formatStatusItem('Frameworks', frameworks, 'No frameworks detected'));
    console.log('');

    // Services
    const availableServices = services.filter(s => s.available);
    console.log(formatStatusItem('Services', availableServices, 'No services detected'));
    // One guard, not two: if the counts differ the unavailable list is
    // non-empty by construction, so the nested length check was unreachable.
    const unavailable = services.filter(s => !s.available);
    if (unavailable.length > 0) {
      console.log(`  (Unavailable: ${unavailable.map(s => sanitizeMeta(s.name)).join(', ')})`);
    }
    console.log('');

    // Credentials
    const presentCredentials = credentials.filter(c => c.present);
    if (presentCredentials.length > 0) {
      console.log('Credentials in environment:');
      for (const cred of presentCredentials) {
        // maskKey preserves the raw first-2/last-4 characters, so a control
        // byte in those positions reaches the terminal.
        console.log(`  ${cred.name}: ${sanitizeMeta(cred.maskedValue)}`);
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
        const masked =
          value.length > 8 ? `${value.slice(0, 2)}${'*'.repeat(value.length - 6)}${value.slice(-4)}` : '***';
        // Same masking shape, same exposure: the edge characters are raw and
        // they come from the user's own .env file.
        console.log(`  ${sanitizeMeta(key)}=${sanitizeMeta(masked)}`);
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

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  Run 'bonklm wizard' to set up connectors`);
    console.log(`${'═'.repeat(50)}\n`);
  });
