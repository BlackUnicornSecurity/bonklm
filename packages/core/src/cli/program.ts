/**
 * BonkLM CLI program construction + exit-code mapping.
 *
 * Extracted from `bin/run.ts` so the command surface (help parity) and the
 * user-error exit-code contract are unit-testable in-process, without spawning
 * the built bin. `run.ts` stays a thin executable shell: it reads the runtime
 * package version, wires {@link exitCodeForError} into `process.exit`, and calls
 * `.parse()`. Tests drive the values returned here directly (see
 * `program.test.ts`).
 *
 * @module cli/program
 */

import { Command } from 'commander';
import type { CommanderError } from 'commander';
import { wizardCommand } from './commands/wizard.js';
import { connectorCommand } from './commands/connector.js';
import { statusCommand } from './commands/status.js';
import { doctorCommand } from './commands/doctor.js';

/**
 * Build the fully-configured `bonklm` root command.
 *
 * Pure: no argv parsing, no `process.exit`, no exit handler installed. The
 * caller (the bin) installs the `exitOverride` handler and calls `.parse()`.
 *
 * NO default `program.action()` is registered. With a default action, Commander
 * treats any unknown subcommand as an argument to that action instead of
 * emitting `commander.unknownCommand`, so the exit-override never fires for
 * invalid invocations. Without it, Commander emits `commander.unknownCommand`
 * for `bonklm notasubcommand` (→ exit 1) and `commander.help` for the bare
 * `bonklm` invocation (help shown, → exit 1: a missing command is an incomplete
 * invocation), which {@link exitCodeForError} maps to the documented exit codes.
 *
 * @param version - Version string surfaced by `--version`, read at runtime from
 *   the package.json so the CLI stays in lockstep with the published package.
 * @returns The configured root command, ready for `.exitOverride()` + `.parse()`.
 */
export function createProgram(version: string): Command {
  const program = new Command();

  program.name('bonklm').description('BonkLM - LLM Security Guardrails').version(version);

  program.showHelpAfterError('(use `bonklm --help` for available commands)');

  // Subcommands — the four documented top-level commands. The set asserted by
  // `program.test.ts` (help parity) MUST stay in sync with the user docs.
  program.addCommand(wizardCommand);
  program.addCommand(connectorCommand);
  program.addCommand(statusCommand);
  program.addCommand(doctorCommand);

  return program;
}

/**
 * Map a root-level Commander error/outcome to the process exit code, per the
 * documented CLI exit-code contract (0 happy path, 1 user-error, 2 system-error).
 *
 * Scope: this governs only outcomes that reach the ROOT program's `exitOverride`
 * — `--help`/`-h`, `--version`/`-V`, the bare `bonklm` invocation, the explicit
 * `help` command, and root-level user errors. Subcommand paths (`bonklm doctor
 * --help`, `bonklm help doctor`, `bonklm doctor --bad-option`) exit via
 * Commander's own per-subcommand handling (help → 0, error → 1) and never reach
 * this function — so it must not try to second-guess them.
 *
 * Mapping:
 *  - `commander.helpDisplayed` / `commander.version` — an explicit help/version
 *    request → always 0 (never a failure).
 *  - `commander.help` — surfaces for both the explicit `help` command (Commander
 *    `exitCode 0`) and the bare `bonklm` invocation with no command (Commander
 *    `exitCode 1`). Split on `exitCode`: explicit help → 0, bare → 1 (a missing
 *    command is an incomplete invocation). This keeps `bonklm help` consistent
 *    with `bonklm --help` and `bonklm help <command>`, which already exit 0.
 *  - anything else (unknown command/option, missing/invalid argument) → 1.
 *    Commander's *default* (without `exitOverride`) exits 0 here, which would
 *    pass a failing invocation to CI as success; forcing 1 prevents that.
 *
 * The contract is guarded non-vacuously by `program.test.ts` (see the mutation
 * note there).
 *
 * @param err - The error Commander passes to the root `exitOverride` callback.
 * @returns `0` for an explicit help/version display; `1` for the bare
 *   invocation and every user-input error.
 */
export function exitCodeForError(err: CommanderError): number {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
    return 0;
  }
  if (err.code === 'commander.help') {
    return err.exitCode === 0 ? 0 : 1;
  }
  return 1;
}
