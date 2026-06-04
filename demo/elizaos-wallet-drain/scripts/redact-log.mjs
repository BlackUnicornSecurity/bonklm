#!/usr/bin/env node
// Redact base58 public keys + mnemonics + private keys from stdin or file.
// Public keys: first 4 + last 4 chars preserved, middle replaced with "...".
// Private keys / mnemonics / secret-key arrays: fully removed.
//
// Usage: node scripts/redact-log.mjs <input-file> [output-file]
//        cat raw.log | node scripts/redact-log.mjs -
//
// Reads .env.demo to find demo-specific pubkeys and redacts them by exact match.
// Generic base58 strings 32-44 chars long are also redacted defensively.

import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.demo') });

const knownPubkeys = [
  process.env.AGENT_WALLET_PUBLIC_KEY,
  process.env.ATTACKER_WALLET_PUBLIC_KEY,
  process.env.RECIPIENT_WALLET_PUBLIC_KEY,
].filter(Boolean);

const knownPrivkeys = [
  process.env.AGENT_WALLET_PRIVATE_KEY,
  process.env.ATTACKER_WALLET_PRIVATE_KEY,
  process.env.RECIPIENT_WALLET_PRIVATE_KEY,
  process.env.SOLANA_PRIVATE_KEY,
].filter(Boolean);

const redactPub = (s) => `${s.slice(0, 4)}...${s.slice(-4)}`;
const BASE58_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const PRIVKEY_RE = /\b[1-9A-HJ-NP-Za-km-z]{64,90}\b/g;
const SECRET_ARRAY_RE = /\[\s*\d+\s*(?:,\s*\d+\s*){63,127}\]/g;
const ENV_LEAK_RE = /(SOLANA_PRIVATE_KEY|WALLET_PRIVATE_KEY|MNEMONIC|SEED_PHRASE)=[^\s\n]+/gi;

const redact = (input) => {
  let out = input;
  for (const pk of knownPrivkeys) out = out.split(pk).join('[REDACTED-PRIVKEY]');
  for (const pk of knownPubkeys) out = out.split(pk).join(redactPub(pk));
  out = out.replace(SECRET_ARRAY_RE, '[REDACTED-SECRET-ARRAY]');
  out = out.replace(ENV_LEAK_RE, (m) => `${m.split('=')[0]}=[REDACTED]`);
  out = out.replace(PRIVKEY_RE, '[REDACTED-PRIVKEY]');
  out = out.replace(BASE58_RE, (m) => (m.length >= 32 && m.length <= 44 ? redactPub(m) : m));
  return out;
};

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: redact-log.mjs <input-file|-> [output-file]');
  process.exit(2);
}

const [inPath, outPath] = args;
let input;
if (inPath === '-') {
  input = readFileSync(0, 'utf8');
} else {
  if (!existsSync(inPath)) {
    console.error(`Input not found: ${inPath}`);
    process.exit(2);
  }
  input = readFileSync(inPath, 'utf8');
}

const output = redact(input);
if (outPath) {
  writeFileSync(outPath, output);
  console.error(`Redacted to ${outPath} (${output.length} bytes)`);
} else {
  process.stdout.write(output);
}
