#!/usr/bin/env node
// Devnet invariant verifier. Runs before every signing operation.
// Exits non-zero if any invariant in SAFETY.md fails.

import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = resolve(__dirname, '..');

const ENV_PATH = resolve(DEMO_ROOT, '.env.demo');
const WALLETS_DIR = resolve(DEMO_ROOT, 'wallets');

config({ path: ENV_PATH });

const MAINNET_FORBIDDEN_PUBKEYS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'So11111111111111111111111111111111111111112',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
]);

const FAILURES = [];
const fail = (msg) => FAILURES.push(msg);

const rpcUrl = process.env.SOLANA_RPC_URL || '';
const cluster = process.env.SOLANA_CLUSTER || '';

if (!rpcUrl) fail('SOLANA_RPC_URL is empty');
else if (!rpcUrl.toLowerCase().includes('devnet')) {
  fail(`SOLANA_RPC_URL must contain "devnet" — got: ${rpcUrl}`);
}

if (cluster !== 'devnet') {
  fail(`SOLANA_CLUSTER must equal "devnet" — got: ${cluster}`);
}

const checkPubkey = (label, raw) => {
  if (!raw) return null;
  let pk;
  try {
    pk = new PublicKey(raw);
  } catch {
    fail(`${label} is not a valid base58 public key`);
    return null;
  }
  const s = pk.toBase58();
  if (MAINNET_FORBIDDEN_PUBKEYS.has(s)) {
    fail(`${label} matches a known mainnet token mint — REFUSING`);
  }
  return pk;
};

const agentPk = checkPubkey('AGENT_WALLET_PUBLIC_KEY', process.env.AGENT_WALLET_PUBLIC_KEY);
const attackerPk = checkPubkey('ATTACKER_WALLET_PUBLIC_KEY', process.env.ATTACKER_WALLET_PUBLIC_KEY);
const recipientPk = checkPubkey('RECIPIENT_WALLET_PUBLIC_KEY', process.env.RECIPIENT_WALLET_PUBLIC_KEY);

const checkKeypairFile = (label, pubkeyEnv, filename) => {
  if (!pubkeyEnv) return;
  const path = resolve(WALLETS_DIR, filename);
  if (!existsSync(path)) {
    fail(`${label} set in env but ${filename} missing under wallets/`);
    return;
  }
  try {
    const arr = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(arr) || arr.length !== 64) {
      fail(`${filename} is not a 64-byte secret-key Uint8Array JSON`);
      return;
    }
    const secret = Uint8Array.from(arr);
    const derivedPub = bs58.encode(secret.slice(32));
    if (derivedPub !== pubkeyEnv) {
      fail(`${label}: env pubkey does not match ${filename} keypair`);
    }
  } catch (e) {
    fail(`${filename} unreadable: ${e.message}`);
  }
};

if (existsSync(WALLETS_DIR)) {
  checkKeypairFile('AGENT', process.env.AGENT_WALLET_PUBLIC_KEY, 'agent-keypair.json');
  checkKeypairFile('ATTACKER', process.env.ATTACKER_WALLET_PUBLIC_KEY, 'attacker-keypair.json');
  checkKeypairFile('RECIPIENT', process.env.RECIPIENT_WALLET_PUBLIC_KEY, 'recipient-keypair.json');
}

const report = () => {
  if (FAILURES.length === 0) {
    const redact = (s) => (s ? `${s.slice(0, 4)}...${s.slice(-4)}` : '<unset>');
    console.log('Safety check PASSED.');
    console.log(`  Cluster:         ${cluster}`);
    console.log(`  RPC:             ${rpcUrl}`);
    console.log(`  Agent pubkey:    ${redact(process.env.AGENT_WALLET_PUBLIC_KEY)}`);
    console.log(`  Attacker pubkey: ${redact(process.env.ATTACKER_WALLET_PUBLIC_KEY)}`);
    console.log(`  Recipient pubkey:${redact(process.env.RECIPIENT_WALLET_PUBLIC_KEY)}`);
    process.exit(0);
  }
  console.error('Safety check FAILED:');
  for (const f of FAILURES) console.error(`  - ${f}`);
  process.exit(1);
};

const probeRpcMatchesCluster = async () => {
  if (FAILURES.length > 0) return;
  try {
    const conn = new Connection(rpcUrl, 'confirmed');
    const genesis = await conn.getGenesisHash();
    const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
    const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
    if (genesis === MAINNET_GENESIS) {
      fail(`RPC endpoint returned MAINNET genesis hash. ABORT.`);
    } else if (genesis !== DEVNET_GENESIS) {
      fail(`RPC genesis hash ${genesis} does not match devnet — refusing.`);
    }
  } catch (e) {
    fail(`Could not probe RPC genesis hash: ${e.message}`);
  }
};

await probeRpcMatchesCluster();
report();
