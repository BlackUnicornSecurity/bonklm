#!/usr/bin/env node
/* istanbul ignore file -- bin entry: a shebang shim integration-exercised via `bonklm-doctor`; the logic + unit tests live in ../doctor-cli.ts */
/**
 * `bonklm-doctor` — executable entry for the ElizaOS static-audit CLI.
 *
 * Deliberately thin: argument parsing, file IO, rendering, and the exit-code
 * contract all live in `../doctor-cli.ts` (linted, type-checked, unit-tested).
 * This file only bridges `process.argv` / `process.exit` so that heavy logic
 * stays testable without spawning a subprocess — mirroring the way
 * `@blackunicorn/bonklm`'s `src/bin/run.ts` delegates to its command modules.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import { sanitizeLogString } from '@blackunicorn/bonklm/common';
import { main } from '../doctor-cli.js';

main(process.argv.slice(2)).then(
  code => {
    process.exit(code);
  },
  (error: unknown) => {
    // Last-resort handler for an unexpected (non-CliInputError) fault. Sanitise
    // the message — it could carry control bytes — before it reaches stderr.
    const message = sanitizeLogString(error instanceof Error ? error.message : String(error));
    process.stderr.write(`bonklm-doctor: unexpected error: ${message}\n`);
    process.exit(2);
  }
);
