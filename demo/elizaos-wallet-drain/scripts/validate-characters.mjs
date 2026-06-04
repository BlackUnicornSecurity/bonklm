#!/usr/bin/env node
// Lint each character JSON against @elizaos/core's parseAndValidateCharacter.
// Exits non-zero if any character fails the official Zod schema.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAndValidateCharacter } from '@elizaos/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = resolve(__dirname, '..');
const CHARACTERS_DIR = resolve(DEMO_ROOT, 'characters');

const files = readdirSync(CHARACTERS_DIR).filter((f) => f.endsWith('.json'));

let failures = 0;
for (const file of files) {
  const path = resolve(CHARACTERS_DIR, file);
  const raw = readFileSync(path, 'utf8');
  const result = parseAndValidateCharacter(raw);
  if (result.success) {
    console.log(`PASS  ${file}  (name=${result.data?.name})`);
  } else {
    failures++;
    console.error(`FAIL  ${file}`);
    console.error(`      ${result.error?.message}`);
    if (result.error?.issues) {
      for (const issue of result.error.issues.slice(0, 5)) {
        console.error(`      - ${issue.path.join('.')}: ${issue.message}`);
      }
    }
  }
}

console.log(`\n${files.length - failures}/${files.length} character files valid.`);
process.exit(failures === 0 ? 0 : 1);
