#!/usr/bin/env node
/**
 * Standalone settings-integrity CLI (invoked by team/scripts/security-regression.sh).
 * NOT a PreToolUse hook: it fails CLOSED (exit 1) on a real integrity problem and
 * never blocks a tool call. Exits 0 when .claude/settings.json is intact.
 */
import path from 'node:path';
import { resolveProjectDir } from '../lib/project-dir.js';
import { loadAndValidate } from '../lib/settings-integrity.js';
import { sanitizeForLog } from '../lib/sanitize.js';

const projectDir = resolveProjectDir(process.cwd());
const settingsPath = path.join(projectDir, '.claude', 'settings.json');
const result = loadAndValidate(settingsPath);

if (result.valid) {
  process.stdout.write(
    `settings integrity: VALID (${result.stats.totalHooks} hooks, ${result.stats.matcherCount} PreToolUse matchers)\n`,
  );
  process.exit(0);
}

process.stderr.write('settings integrity: FAILED\n');
for (const error of result.errors) {
  // Errors interpolate the settings path / JSON parser message (file-derived);
  // sanitize before stderr to avoid CWE-117 log injection.
  process.stderr.write(`  - ${sanitizeForLog(error, 500)}\n`);
}
process.exit(1);
