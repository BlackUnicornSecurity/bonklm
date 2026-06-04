#!/usr/bin/env node
// Generate three fresh devnet keypairs: agent, attacker, recipient.
// Writes wallets/*.json (Solana Uint8Array format) + updates .env.demo.
// Refuses to overwrite existing keypairs — `rm wallets/*.json .env.demo` to regenerate.

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = resolve(__dirname, '..');
const WALLETS_DIR = resolve(DEMO_ROOT, 'wallets');
const ENV_PATH = resolve(DEMO_ROOT, '.env.demo');
const ENV_EXAMPLE_PATH = resolve(DEMO_ROOT, '.env.demo.example');

const KEYPAIRS = [
  { role: 'AGENT',     file: 'agent-keypair.json' },
  { role: 'ATTACKER',  file: 'attacker-keypair.json' },
  { role: 'RECIPIENT', file: 'recipient-keypair.json' },
];

const redact = (s) => `${s.slice(0, 4)}...${s.slice(-4)}`;

const refuseIfExists = () => {
  for (const { file } of KEYPAIRS) {
    const path = resolve(WALLETS_DIR, file);
    if (existsSync(path)) {
      console.error(`REFUSING: ${file} already exists.`);
      console.error('  To regenerate: rm wallets/*.json .env.demo');
      console.error('  Existing keypairs are devnet-only and ephemeral; safe to delete.');
      process.exit(2);
    }
  }
};

const bootstrapEnvDemo = () => {
  if (existsSync(ENV_PATH)) return;
  if (!existsSync(ENV_EXAMPLE_PATH)) {
    console.error('Missing .env.demo.example template');
    process.exit(2);
  }
  writeFileSync(ENV_PATH, readFileSync(ENV_EXAMPLE_PATH, 'utf8'), { mode: 0o600 });
  console.log('Bootstrapped .env.demo from template (LLM API keys still need to be filled).');
};

const setEnvKey = (text, key, value) => {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, `${key}=${value}`);
  return text + `\n${key}=${value}\n`;
};

if (!existsSync(WALLETS_DIR)) mkdirSync(WALLETS_DIR, { mode: 0o700, recursive: true });
refuseIfExists();
bootstrapEnvDemo();

let envText = readFileSync(ENV_PATH, 'utf8');

const generated = [];
for (const { role, file } of KEYPAIRS) {
  const kp = Keypair.generate();
  const path = resolve(WALLETS_DIR, file);
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  const pub = kp.publicKey.toBase58();
  const priv = bs58.encode(kp.secretKey);
  envText = setEnvKey(envText, `${role}_WALLET_PUBLIC_KEY`, pub);
  envText = setEnvKey(envText, `${role}_WALLET_PRIVATE_KEY`, priv);
  generated.push({ role, pub });
}

const agentSecret = JSON.parse(readFileSync(resolve(WALLETS_DIR, 'agent-keypair.json'), 'utf8'));
envText = setEnvKey(envText, 'SOLANA_PRIVATE_KEY', bs58.encode(Uint8Array.from(agentSecret)));
envText = setEnvKey(envText, 'SOLANA_PUBLIC_KEY', generated.find((g) => g.role === 'AGENT').pub);

writeFileSync(ENV_PATH, envText, { mode: 0o600 });

console.log('Generated 3 fresh devnet keypairs:');
for (const { role, pub } of generated) {
  console.log(`  ${role.padEnd(10)} ${redact(pub)}`);
}
console.log(`\nKeypair files written to wallets/ (mode 0600, gitignored).`);
console.log(`Env file updated at .env.demo (mode 0600, gitignored).`);
console.log(`SOLANA_PRIVATE_KEY (plugin-solana env var) bound to AGENT keypair.`);
