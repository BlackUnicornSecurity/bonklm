# Recipe: pgvector + RetrievedDocValidator

Wire BonkLM's `createRetrievedDocValidator` (Story 1.2) into a
`pg`-based pgvector search so retrieved RAG hits flow through prompt-
injection / secret / PII scanning before reaching the LLM. No
dedicated `pgvector-connector` package is needed — pgvector is just
Postgres + the `vector` extension, so the standard `pg` driver
combined with a thin wrapper carries the full Story 1.2 surface.

## When to use this recipe

- You already run Postgres and want vector search in the same store
  rather than introducing a separate vector DB.
- You're using `pgvector` (any version) via the standard `pg` /
  `node-postgres` driver, Drizzle, Kysely, or any other Postgres
  ORM that returns rows as plain objects.
- You want the same drop / block-all / redact mode semantics that the
  pinecone / qdrant / weaviate / chroma retrofits ship.

## Install

```bash
npm install @blackunicorn/bonklm pg
# pgvector extension already enabled in your Postgres:
#   CREATE EXTENSION IF NOT EXISTS vector;
```

## Schema (reference)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_base (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url   TEXT,
  chunk_text   TEXT NOT NULL,
  metadata     JSONB DEFAULT '{}'::jsonb,
  embedding    vector(1536),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON knowledge_base
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

## Wiring

```ts
import { Pool } from 'pg';
import {
  createRetrievedDocValidator,
  PromptInjectionValidator,
  SecretGuard,
  PIIGuard,
} from '@blackunicorn/bonklm';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// One-time builder. Reuse across requests — the validator is
// stateless, so a single instance carries the validator chain
// across every retrieval.
const docValidator = createRetrievedDocValidator({
  validators: [
    new PromptInjectionValidator(),
    new SecretGuard(),
    new PIIGuard(),
  ],
  onPerDocFailure: 'redact', // or 'drop' / 'block-all'
  // 'redact' uses the RedactingValidator capability (SecretGuard +
  // PIIGuard implement it; PromptInjection findings fall back to
  // Finding.match substring-replace).
});

/**
 * Run a pgvector similarity search and pipe surviving rows through
 * BonkLM's RetrievedDocValidator. Returns the filtered + (optionally)
 * redacted documents, plus the aggregate result for telemetry.
 */
export async function safeSimilaritySearch(
  queryEmbedding: number[],
  topK = 10
): Promise<{ docs: KbDoc[]; result: { allowed: boolean; severity: string } }> {
  // 1. Cast the embedding into pgvector format. `pg` does not auto-
  //    serialise arrays into the `vector` type; use the documented
  //    `[1.0, 2.0, ...]` string cast.
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;
  const { rows } = await pool.query<{
    id: string;
    source_url: string | null;
    chunk_text: string;
    metadata: Record<string, unknown>;
    similarity: number;
  }>(
    `SELECT
       id,
       source_url,
       chunk_text,
       metadata,
       1 - (embedding <=> $1::vector) AS similarity
     FROM knowledge_base
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorLiteral, topK]
  );

  // 2. Adapt the SQL rows into the validator's RetrievedDoc shape.
  //    `content` is the field the validator scans; `metadata` flows
  //    through unchanged for downstream use.
  const docs = rows.map((row) => ({
    id: row.id,
    content: row.chunk_text,
    metadata: {
      source_url: row.source_url,
      similarity: row.similarity,
      ...row.metadata,
    },
  }));

  // 3. Validate. `validateBatch` returns BOTH the aggregate
  //    GuardrailResult (with per-doc subResults) AND the surviving
  //    documents (with redacted content under 'redact' mode).
  const batch = await docValidator.validateBatch(docs);

  // 4. Re-shape for the caller. Redacted content is in
  //    batch.docs[i].content; the original SQL row's chunk_text is
  //    discarded for blocked / redacted docs so an attacker payload
  //    cannot reach the LLM.
  return {
    docs: batch.docs.map((d) => ({
      id: d.id ?? '',
      sourceUrl: (d.metadata?.source_url as string | null) ?? null,
      chunkText: d.content,
      similarity: (d.metadata?.similarity as number) ?? 0,
    })),
    result: {
      allowed: batch.result.allowed,
      severity: batch.result.severity,
    },
  };
}

export interface KbDoc {
  id: string;
  sourceUrl: string | null;
  chunkText: string;
  similarity: number;
}
```

## Caller integration

```ts
import { safeSimilaritySearch } from './kb-search.js';

const userQuery = 'How do I configure the OAuth callback URL?';
const queryEmbedding = await embed(userQuery);
const { docs, result } = await safeSimilaritySearch(queryEmbedding, 5);

if (!result.allowed) {
  // 'block-all' mode lands here when ANY retrieved doc tripped a
  // validator. With 'drop' / 'redact' the batch passes through
  // (filtered or redacted) and `allowed` stays true.
  throw new Error('Knowledge-base retrieval blocked.');
}

// Pass surviving / redacted chunks to the LLM. Secrets and PII have
// been replaced with [REDACTED] under 'redact' mode; injection-tripped
// chunks have been dropped under 'drop' mode.
const context = docs.map((d) => d.chunkText).join('\n\n');
```

## Failure-mode trade-offs

| Mode | When to use | Behaviour |
|---|---|---|
| `'drop'` | RAG with `topK >= 5` — losing 1-2 docs is acceptable. | Drop flagged docs; keep the rest. `result.allowed` stays `true`. |
| `'block-all'` | Compliance use cases — a single tripped doc means the entire batch is contaminated. | Top-level `result.blocked = true`. Caller must abort. |
| `'redact'` | Customer-support transcripts, internal-doc KB. | Keep docs; replace `SecretGuard` / `PIIGuard` matched regions with `[REDACTED]` (or your `redactReplacement`). Injection-pattern findings dropped if no `Finding.match` available (rare). |

## Composed-context follow-on

If your application concatenates retrieved chunks into a single recall
blob before the LLM call, ALSO run `createComposedContextValidator`
(Story 1.3a) on the joined string. The wake-up attack class — three
benign chunks that combine into an injection — is invisible to a
per-doc scan.

```ts
import { createComposedContextValidator } from '@blackunicorn/bonklm';

const composedValidator = createComposedContextValidator({
  validators: [new PromptInjectionValidator()],
});

const combined = docs.map((d) => d.chunkText);
const composedResult = await composedValidator.validateEntries(combined);
if (composedResult.result.blocked) {
  throw new Error('Composed context tripped wake-up-attack detection.');
}
```

## Notes

- **No new package.** This recipe uses the standard `pg` driver and
  BonkLM's existing `@blackunicorn/bonklm` core. A dedicated
  `bonklm-pgvector` package is not in the roadmap because pgvector
  is "just Postgres" — wiring through the standard `pg` driver
  surfaces the same `chunk_text` + `metadata` shape the existing 4
  vector-DB connectors normalise to.
- **Performance**: the validator runs in-process on each query.
  Latency adds roughly the per-validator cost summed across the
  validator stack — typically <5ms for the default
  `PromptInjectionValidator + SecretGuard + PIIGuard` chain on a
  `topK=10` batch with 1-2KB chunks. Benchmark in your environment
  before assuming.
- **Pool reuse**: keep the `Pool` instance module-level; do NOT
  create one per request.
- **Backpressure**: pgvector returns sorted rows; you can apply a
  cosine-similarity threshold filter BEFORE the validator if your
  KB is large.
