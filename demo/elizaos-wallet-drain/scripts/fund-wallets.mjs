#!/usr/bin/env node
// Fund agent_wallet from the devnet faucet via connection.requestAirdrop().
// Targets 2 SOL. Devnet rate-limits airdrops to 1-2 SOL per request; retries with backoff.

import { config } from 'dotenv';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = resolve(__dirname, '..');
config({ path: resolve(DEMO_ROOT, '.env.demo') });

const RPC = process.env.SOLANA_RPC_URL;
const CLUSTER = process.env.SOLANA_CLUSTER;
const AGENT_PUB = process.env.AGENT_WALLET_PUBLIC_KEY;
const TARGET_SOL = 2;
const PER_REQUEST_SOL = 1;

if (!RPC?.includes('devnet') || CLUSTER !== 'devnet') {
  console.error('Refusing: SOLANA_RPC_URL/SOLANA_CLUSTER does not look like devnet.');
  process.exit(2);
}
if (!AGENT_PUB) {
  console.error('AGENT_WALLET_PUBLIC_KEY missing — run npm run generate-wallets first.');
  process.exit(2);
}

const connection = new Connection(RPC, 'confirmed');
const agent = new PublicKey(AGENT_PUB);

const lamportsToSol = (l) => l / LAMPORTS_PER_SOL;
const redact = (s) => `${s.slice(0, 4)}...${s.slice(-4)}`;

const initialBalance = await connection.getBalance(agent);
console.log(`Initial balance: ${lamportsToSol(initialBalance)} SOL (${redact(AGENT_PUB)})`);

if (initialBalance >= TARGET_SOL * LAMPORTS_PER_SOL) {
  console.log('Already above target. Skipping airdrop.');
  process.exit(0);
}

const needed = Math.ceil(TARGET_SOL - lamportsToSol(initialBalance));
console.log(`Requesting ${needed} airdrop(s) of ${PER_REQUEST_SOL} SOL...`);

for (let i = 0; i < needed; i++) {
  let lastError;
  let success = false;
  for (let attempt = 1; attempt <= 5 && !success; attempt++) {
    try {
      const sig = await connection.requestAirdrop(agent, PER_REQUEST_SOL * LAMPORTS_PER_SOL);
      const latest = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction(
        { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        'confirmed',
      );
      const sigRedacted = `${sig.slice(0, 6)}...${sig.slice(-6)}`;
      console.log(`  airdrop ${i + 1}/${needed} confirmed: ${sigRedacted}`);
      success = true;
    } catch (e) {
      lastError = e;
      const delay = 2000 * attempt;
      console.log(`  attempt ${attempt} failed (${e.message}). Backing off ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  if (!success) {
    console.error(`Airdrop ${i + 1} failed after 5 attempts: ${lastError?.message}`);
    console.error('Faucet rate-limited. Try a public web faucet:');
    console.error(`  https://faucet.solana.com/?address=${AGENT_PUB}&cluster=devnet`);
    process.exit(3);
  }
}

const finalBalance = await connection.getBalance(agent);
console.log(`Final balance:   ${lamportsToSol(finalBalance)} SOL`);
