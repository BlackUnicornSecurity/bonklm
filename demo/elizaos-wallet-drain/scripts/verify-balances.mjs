#!/usr/bin/env node
// On-chain balance dump for all 3 demo wallets. Read-only.

import { config } from 'dotenv';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.demo') });

const RPC = process.env.SOLANA_RPC_URL;
if (!RPC?.includes('devnet')) {
  console.error('Refusing: SOLANA_RPC_URL is not devnet.');
  process.exit(2);
}

const connection = new Connection(RPC, 'confirmed');
const redact = (s) => (s ? `${s.slice(0, 4)}...${s.slice(-4)}` : '<unset>');
const wallets = [
  ['AGENT',     process.env.AGENT_WALLET_PUBLIC_KEY],
  ['ATTACKER',  process.env.ATTACKER_WALLET_PUBLIC_KEY],
  ['RECIPIENT', process.env.RECIPIENT_WALLET_PUBLIC_KEY],
];

console.log(`Cluster: ${process.env.SOLANA_CLUSTER}  RPC: ${RPC}\n`);
for (const [role, pub] of wallets) {
  if (!pub) {
    console.log(`  ${role.padEnd(10)} (not generated)`);
    continue;
  }
  try {
    const lamports = await connection.getBalance(new PublicKey(pub));
    const sol = (lamports / LAMPORTS_PER_SOL).toFixed(6);
    console.log(`  ${role.padEnd(10)} ${redact(pub).padEnd(14)} ${sol.padStart(12)} SOL`);
  } catch (e) {
    console.log(`  ${role.padEnd(10)} ${redact(pub).padEnd(14)} ERROR ${e.message}`);
  }
}
