#!/usr/bin/env node
// After a memory-inject run, dump where the injected message landed in the DB.
import { PGlite } from '@electric-sql/pglite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new PGlite(resolve(__dirname, '..', '.eliza', '.elizadb'));
await db.waitReady;

const mem = await db.query(
  `SELECT id, type, content, entity_id, room_id, created_at, metadata FROM memories ORDER BY created_at DESC LIMIT 15`,
);
console.log('=== memories (most recent 15) ===');
for (const m of mem.rows) {
  const ts = m.created_at.toISOString?.() || m.created_at;
  console.log(`  [${ts}] type=${m.type} room=${m.room_id.slice(0,8)} entity=${m.entity_id.slice(0,8)} content="${JSON.stringify(m.content).slice(0,140)}"`);
}

const rooms = await db.query(`SELECT id, channel_id, name, type FROM rooms ORDER BY created_at DESC LIMIT 10`);
console.log('\n=== rooms ===');
for (const r of rooms.rows) {
  console.log(`  room=${r.id.slice(0,8)} channel=${(r.channel_id||'').slice(0,8)} name=${r.name} type=${r.type}`);
}

const cm = await db.query(
  `SELECT id, channel_id, author_id, content, created_at FROM central_messages ORDER BY created_at DESC LIMIT 10`,
);
console.log('\n=== central_messages (most recent 10) ===');
for (const m of cm.rows) {
  console.log(`  [${m.created_at.toISOString?.() || m.created_at}] channel=${m.channel_id.slice(0,8)} author=${m.author_id.slice(0,8)} content="${String(m.content).slice(0,150)}"`);
}

await db.close();
