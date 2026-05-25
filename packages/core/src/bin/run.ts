#!/usr/bin/env node
/**
 * BonkLM CLI
 *
 * Interactive setup wizard for BonkLM connectors.
 *
 * @package @blackunicorn/bonklm
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { wizardCommand } from '../cli/commands/wizard.js';
import { connectorCommand } from '../cli/commands/connector.js';
import { statusCommand } from '../cli/commands/status.js';
import { doctorCommand } from '../cli/commands/doctor.js';

// Read version from the package.json at runtime so CLI --version stays in lockstep
// with the published package version (no manual bumps needed).
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgJsonPath = join(__dirname, '..', '..', 'package.json');
const pkgVersion = (JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version: string }).version;

const program = new Command();

program
  .name('bonklm')
  .description('BonkLM - LLM Security Guardrails')
  .version(pkgVersion);

// Default to wizard if no command provided
program.action(() => {
  // Show help if no command provided - commander will handle this
});

// Add subcommands
program.addCommand(wizardCommand);
program.addCommand(connectorCommand);
program.addCommand(statusCommand);
program.addCommand(doctorCommand);

// Parse and execute
program.parse();
