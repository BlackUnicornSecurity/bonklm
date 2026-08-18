#!/usr/bin/env node
/* istanbul ignore file -- bin entry: shebang shim that wires + parses; the testable logic and its unit tests live in ../cli/program.ts (program.test.ts). */
/**
 * BonkLM CLI
 *
 * Thin executable shell: reads the runtime package version, builds the command
 * surface via {@link createProgram}, wires the user-error exit-code contract
 * ({@link exitCodeForError}) into `process.exit`, then parses argv. The testable
 * logic lives in `../cli/program.ts` (see `program.test.ts`).
 *
 * @package @blackunicorn/bonklm
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProgram, exitCodeForError } from '../cli/program.js';

// Read version from the package.json at runtime so CLI --version stays in
// lockstep with the published package version (no manual bumps needed).
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgJsonPath = join(__dirname, '..', '..', 'package.json');
const pkgVersion = (JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version: string }).version;

const program = createProgram(pkgVersion);

// Exit 1 on user-input error (unknown command, missing required argument,
// unknown option). Commander's default exits 0 after writing the error to
// stderr — which passes a failing invocation as success to CI pipelines. The
// mapping (0 happy path, 1 user-error) lives in `exitCodeForError`, regression-
// guarded by `program.test.ts`.
program.exitOverride(err => {
  process.exit(exitCodeForError(err));
});

// Parse and execute
program.parse();
