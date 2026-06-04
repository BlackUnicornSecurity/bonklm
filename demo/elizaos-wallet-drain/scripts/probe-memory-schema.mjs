#!/usr/bin/env node
// One-shot: dump the PGlite schema for the running agent's DB.
import { PGlite } from '@electric-sql/pglite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = resolve(__dirname, '..', '.eliza', '.elizadb');

const db = new PGlite(DB_DIR);
await db.waitReady;

const tables = await db.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
);
console.log('Tables:', tables.rows.map((r) => r.table_name).join(', '));

for (const t of ['memories', 'messages', 'channel_messages', 'entities', 'rooms', 'channels', 'worlds']) {
  if (!tables.rows.find((r) => r.table_name === t)) continue;
  const cols = await db.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
    [t],
  );
  console.log(`\n[${t}] columns:`);
  for (const c of cols.rows) console.log(`  ${c.column_name}: ${c.data_type}`);
  const sample = await db.query(`SELECT * FROM "${t}" ORDER BY 1 DESC LIMIT 2`);
  if (sample.rows.length) {
    console.log(`[${t}] sample row (truncated):`);
    console.log(JSON.stringify(sample.rows[0], null, 2).slice(0, 1500));
  }
}

await db.close();
