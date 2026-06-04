#!/usr/bin/env node
// Read Obsidian API KEYS.md, extract Anthropic + OpenRouter keys, write to .env.demo.
// Keys flow disk-to-disk; nothing is printed to stdout/stderr except masked confirmations.
//
// Refuses if .env.demo doesn't exist yet — run generate-wallets first.
// Only TOUCHES the LLM_KEY env vars; does not overwrite wallet fields.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(DEMO_ROOT, '.env.demo');

const VAULT_PATH =
  process.env.OBSIDIAN_API_KEYS_PATH ||
  '/Volumes/Familly/Documents/ObsidianJulien/Julien v2/Julien Perso/IT and Infra/API KEYS.md';

if (!existsSync(ENV_PATH)) {
  console.error('Missing .env.demo. Run `npm run generate-wallets` first.');
  process.exit(2);
}
if (!existsSync(VAULT_PATH)) {
  console.error(`Vault note not found: ${VAULT_PATH}`);
  console.error('Override with OBSIDIAN_API_KEYS_PATH=<path>.');
  process.exit(2);
}

const noteText = readFileSync(VAULT_PATH, 'utf8');

const grab = (label, pattern) => {
  const m = noteText.match(pattern);
  if (!m) {
    console.error(`Could not locate ${label} in vault note.`);
    return null;
  }
  return m[1].trim();
};

const anthropic = grab(
  'Anthropic',
  /^\s*anthropic:\s*(sk-ant-[A-Za-z0-9_\-]+)\s*$/im,
);
const openrouter = grab(
  'OpenRouter',
  /^\s*openrouter:\s*(sk-or-[A-Za-z0-9_\-]+)\s*$/im,
);

if (!anthropic || !openrouter) {
  console.error('Aborting: required keys not all found.');
  process.exit(3);
}

const mask = (k) => `${k.slice(0, 8)}...${k.slice(-4)}`;

let envText = readFileSync(ENV_PATH, 'utf8');
const setEnvKey = (text, key, value) => {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, `${key}=${value}`);
  return text + `\n${key}=${value}\n`;
};

envText = setEnvKey(envText, 'ANTHROPIC_API_KEY', anthropic);
envText = setEnvKey(envText, 'OPENROUTER_API_KEY', openrouter);

writeFileSync(ENV_PATH, envText, { mode: 0o600 });

console.log(`Populated .env.demo with:`);
console.log(`  ANTHROPIC_API_KEY  ${mask(anthropic)}`);
console.log(`  OPENROUTER_API_KEY ${mask(openrouter)}`);
console.log(`  (OLLAMA_API_ENDPOINT untouched; expects pre-set value)`);
