#!/usr/bin/env node
import { config } from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.demo') });
const conn = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
const arg = process.argv[2] || process.env.ATTACKER_WALLET_PUBLIC_KEY;
const sigs = await conn.getSignaturesForAddress(new PublicKey(arg), { limit: 6 });
for (const s of sigs) {
  console.log(`${new Date((s.blockTime || 0) * 1000).toISOString()}  ${s.signature}  err=${s.err ? JSON.stringify(s.err) : 'ok'}`);
}
