/**
 * CLI program construction + exit-code contract — in-process smoke regression.
 *
 * CLI smoke: `bonklm --help` command parity and the user-error exit-code
 * contract. These run in-process (no subprocess, no built `dist/`) so they
 * execute identically under `pnpm test` locally and in CI. The end-to-end
 * behaviour of the actual built bin is captured separately in the CLI-smoke
 * evidence harness.
 *
 * Non-vacuity: deleting the `helpDisplayed`/`version` guard in `exitCodeForError`
 * turns the "exit 0" cases red; collapsing its default branch to `return 0`
 * turns every user-error case red. So these tests fail if the exit-code contract
 * regresses — they are not vacuous (ADR-0001).
 */
import { describe, it, expect } from 'vitest';
import { CommanderError } from 'commander';

import { createProgram, exitCodeForError } from './program.js';

describe('createProgram — command surface (help parity)', () => {
  it('registers exactly the four documented top-level commands', () => {
    const names = createProgram('1.2.3')
      .commands.map(c => c.name())
      .sort();
    expect(names).toEqual(['connector', 'doctor', 'status', 'wizard']);
  });

  it('names the program `bonklm`', () => {
    expect(createProgram('1.2.3').name()).toBe('bonklm');
  });

  it('surfaces the injected runtime version via --version', () => {
    expect(createProgram('9.9.9-test').version()).toBe('9.9.9-test');
  });
});

describe('exitCodeForError — exit-code contract', () => {
  // (exitCode, code) mirrors how Commander builds the error it hands to the
  // exitOverride callback. Cases below vary BOTH fields so no branch is vacuous:
  //  - collapse the whole body to `return 0`       → every exit-1 case goes red;
  //  - collapse to `return err.exitCode ?? 0`      → the force-1 case goes red;
  //  - hardcode the commander.help branch to 0     → the bare-invocation case goes red;
  //  - make helpDisplayed/version honour exitCode   → the stray-exitCode case goes red.
  const err = (exitCode: number, code: string): CommanderError => new CommanderError(exitCode, code, 'msg');

  // --- help/version display: always 0, regardless of Commander's exitCode ---
  it('maps `--help` (helpDisplayed, exitCode 0) to exit 0', () => {
    expect(exitCodeForError(err(0, 'commander.helpDisplayed'))).toBe(0);
  });

  it('maps `--version` (exitCode 0) to exit 0', () => {
    expect(exitCodeForError(err(0, 'commander.version'))).toBe(0);
  });

  it('maps a help/version display to 0 even with a stray non-zero exitCode', () => {
    // helpDisplayed/version are unconditional non-failures: a subcommand --help
    // can carry exitCode 1, yet an explicit help/version display must exit 0.
    expect(exitCodeForError(err(1, 'commander.helpDisplayed'))).toBe(0);
  });

  // --- the `help` command (commander.help): split on exitCode ---
  it('maps an explicit `help` command (commander.help, exitCode 0) to exit 0', () => {
    expect(exitCodeForError(err(0, 'commander.help'))).toBe(0);
  });

  it('maps the bare invocation (commander.help, exitCode 1) to exit 1 (missing command)', () => {
    // Same code as the explicit `help` above, different exitCode → different
    // result: proves the commander.help branch splits on err.exitCode.
    expect(exitCodeForError(err(1, 'commander.help'))).toBe(1);
  });

  // --- user-input errors: forced to 1 regardless of Commander's exitCode ---
  it('maps an unknown command to exit 1 (regression guard)', () => {
    expect(exitCodeForError(err(1, 'commander.unknownCommand'))).toBe(1);
  });

  it('forces a non-display error to 1 even if its exitCode were 0 (force-1 branch)', () => {
    // Defends the `return 1` branch independently of err.exitCode: a user error
    // must never pass as success — the whole point of forcing it non-zero.
    expect(exitCodeForError(err(0, 'commander.unknownCommand'))).toBe(1);
  });

  it('maps a missing required argument to exit 1', () => {
    expect(exitCodeForError(err(1, 'commander.missingArgument'))).toBe(1);
  });

  it('maps an unknown option to exit 1', () => {
    expect(exitCodeForError(err(1, 'commander.unknownOption'))).toBe(1);
  });

  it('maps an invalid argument to exit 1', () => {
    expect(exitCodeForError(err(1, 'commander.invalidArgument'))).toBe(1);
  });
});

describe('createProgram — end-to-end parse contract', () => {
  // Drive a real parse under exitOverride() (Commander throws instead of calling
  // process.exit), with output silenced, and return the raised CommanderError.
  const parseAndCatch = (argv: string[], version = '1.2.3'): CommanderError | undefined => {
    const program = createProgram(version).exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    try {
      program.parse(['node', 'bonklm', ...argv], { from: 'node' });
      return undefined;
    } catch (e) {
      return e as CommanderError;
    }
  };

  it('raises unknownCommand (→ exit 1) for an unrecognized subcommand', () => {
    const e = parseAndCatch(['definitely-not-a-command']);
    expect(e?.code).toBe('commander.unknownCommand');
    expect(exitCodeForError(e as CommanderError)).toBe(1);
  });

  it('raises unknownOption (→ exit 1) for an unrecognized root option', () => {
    const e = parseAndCatch(['--definitely-not-an-option']);
    expect(e?.code).toBe('commander.unknownOption');
    expect(exitCodeForError(e as CommanderError)).toBe(1);
  });

  it('treats `--version` as a clean exit-0 path', () => {
    const e = parseAndCatch(['--version'], '7.7.7');
    expect(e?.code).toBe('commander.version');
    expect(exitCodeForError(e as CommanderError)).toBe(0);
  });

  it('treats an explicit `help` command as exit 0 (regression guard)', () => {
    const e = parseAndCatch(['help']);
    expect(e?.code).toBe('commander.help');
    expect(e?.exitCode).toBe(0);
    expect(exitCodeForError(e as CommanderError)).toBe(0);
  });

  it('treats the bare invocation as exit 1 (no command given)', () => {
    const e = parseAndCatch([]);
    expect(e?.code).toBe('commander.help');
    expect(e?.exitCode).toBe(1);
    expect(exitCodeForError(e as CommanderError)).toBe(1);
  });
});
