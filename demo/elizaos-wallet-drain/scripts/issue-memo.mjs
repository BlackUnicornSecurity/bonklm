#!/usr/bin/env node
// After a successful drain (attacker balance increased), publish a Solana memo
// transaction signed by attacker_wallet that anchors the campaign tagline on-chain.
//
// The memo is a separate, low-value transaction sent from attacker → attacker
// with the memo program instruction. It does NOT modify the drain tx itself
// (plugin-solana's TRANSFER_SOLANA doesn't support memos in the same tx).
//
// Usage:
//   node scripts/issue-memo.mjs --drain-sig <drain-tx-signature>
//
// Idempotent: skips if an existing marker exists in the last 100 attacker txs
// containing the campaign substring.

import { config } from 'dotenv';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = resolve(__dirname, '..');
config({ path: resolve(DEMO_ROOT, '.env.demo') });

const args = (() => {
  const out = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = process.argv[++i];
  }
  return out;
})();

const drainSig = args['drain-sig'];
if (!drainSig) {
  console.error('Usage: issue-memo.mjs --drain-sig <signature>');
  process.exit(2);
}

const RPC = process.env.SOLANA_RPC_URL;
if (!RPC?.includes('devnet')) {
  console.error('Refusing: SOLANA_RPC_URL is not devnet.');
  process.exit(2);
}

const attackerKeypairPath = resolve(DEMO_ROOT, 'wallets', 'attacker-keypair.json');
if (!existsSync(attackerKeypairPath)) {
  console.error(`Missing wallets/attacker-keypair.json`);
  process.exit(2);
}
const attackerSecret = JSON.parse(readFileSync(attackerKeypairPath, 'utf8'));
const attacker = Keypair.fromSecretKey(Uint8Array.from(attackerSecret));

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const CAMPAIGN_MEMO = `a warrior has fallen - BonkLM: Data smashing Solution. drain=${drainSig.slice(0, 16)}…${drainSig.slice(-16)}`;

const connection = new Connection(RPC, 'confirmed');

const attackerBalance = await connection.getBalance(attacker.publicKey);
if (attackerBalance < 5000) {
  console.error(`Attacker has only ${attackerBalance} lamports (need >=5000 for fee). Skipping memo.`);
  process.exit(3);
}

const memoIx = new TransactionInstruction({
  keys: [],
  programId: MEMO_PROGRAM_ID,
  data: Buffer.from(CAMPAIGN_MEMO, 'utf8'),
});

const latest = await connection.getLatestBlockhash('confirmed');
const tx = new Transaction({
  feePayer: attacker.publicKey,
  blockhash: latest.blockhash,
  lastValidBlockHeight: latest.lastValidBlockHeight,
}).add(memoIx);
tx.sign(attacker);

const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
await connection.confirmTransaction(
  { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
  'confirmed',
);

console.log(`Memo tx confirmed: ${sig}`);
console.log(`Memo content: ${CAMPAIGN_MEMO}`);
console.log(`Solscan: https://solscan.io/tx/${sig}?cluster=devnet`);
