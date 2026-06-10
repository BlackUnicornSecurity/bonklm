import { readFileSync } from 'node:fs';
import { parseHookInput } from './input.js';
import { resolveProjectDir } from './project-dir.js';
import { decide } from './decide.js';

/**
 * Read the raw hook payload from stdin (fd 0). Returns '' on any error.
 * @returns {string}
 */
function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * I/O entrypoint shared by every bin/*.js: read stdin -> parse -> resolve project
 * dir -> decide() -> write stderr -> exit with the decided code.
 *
 * This is the single process boundary (fd-0 read + process.exit) and is excluded
 * from unit coverage; it is proven end-to-end by the spawn-based integration tests
 * in test/bin.test.js (the pure logic it calls lives in decide.js et al. at 100%).
 *
 * @param {string} name - Validator name.
 * @param {Function} validate - Pure validate function returning a decision.
 * @returns {void}
 */
export function runHook(name, validate) {
  const raw = readStdin();
  const input = parseHookInput(raw, process.cwd());
  const projectDir = resolveProjectDir(input.cwd);
  const { exitCode, stderr } = decide(input, validate, { name, projectDir });
  if (stderr) {
    process.stderr.write(stderr);
  }
  process.exit(exitCode);
}
