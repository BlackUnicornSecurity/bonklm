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

program.name('bonklm').description('BonkLM - LLM Security Guardrails').version(pkgVersion);

// D-018 (Sprint 52 Gate 6 ST-06-007): NO default `program.action()`.
// Commander's behavior: if a default action is set, ANY unknown subcommand
// is treated as an argument to that action instead of emitting the
// `commander.unknownCommand` error, which means exitOverride below never
// fires for invalid invocations. Without a default action, Commander
// correctly emits unknownCommand for `bonklm notasubcommand` and shows
// help (exit 0) for bare `bonklm` invocation. exitOverride below then maps
// unknownCommand → exit 1.
program.showHelpAfterError('(use `bonklm --help` for available commands)');

// Add subcommands
program.addCommand(wizardCommand);
program.addCommand(connectorCommand);
program.addCommand(statusCommand);
program.addCommand(doctorCommand);

// D-018 (Sprint 52 Gate 6 ST-06-007): exit 1 on user-input error
// (unknown command, missing required argument, unknown option). Commander's
// default behavior is to exit 0 after writing the error to stderr — which
// passes a failing invocation as success to CI pipelines. Sprint 50 CLI
// contract specifies exit 1 on user-error per the documented exit-code
// matrix (0 happy path, 1 user-error, 2 system-error).
program.exitOverride(err => {
  // Help + version are not errors — they exit 0 cleanly via Commander's
  // standard path (these codes are emitted by Commander after writing
  // help/version output).
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
    process.exit(0);
  }
  // Everything else (unknown command, missing argument, unknown option,
  // invalid argument) is a user-error.
  process.exit(1);
});

// Parse and execute
program.parse();
