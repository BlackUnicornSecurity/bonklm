# RAG & Vector Store Connectors

Last updated: 2026-06-15

This guide covers BonkLM connectors for Retrieval-Augmented Generation (RAG) systems, vector
databases, and retriever pipelines.

For LLM provider connectors that may sit downstream of the retriever see
[LLM Provider Connectors](./llm-providers.md); for memory-client connectors (Letta / Mem0 / Zep) see
[AI SDK Connectors](./ai-sdks.md#letta-memory-client-connector).

## Available Connectors

### RAG frameworks

| Connector  | Package                           | Peer                                       | Status |
| ---------- | --------------------------------- | ------------------------------------------ | ------ |
| LlamaIndex | `@blackunicorn/bonklm-llamaindex` | `llamaindex ^0.11.0 / ^0.12.0`             | STABLE |
| LangChain  | `@blackunicorn/bonklm-langchain`  | `@langchain/core ^0.3.0 / ^0.4.0 / ^1.0.0` | STABLE |

### Vector databases

| Connector   | Package                            | Peer                                 | Bundle | Status |
| ----------- | ---------------------------------- | ------------------------------------ | ------ | ------ |
| Pinecone    | `@blackunicorn/bonklm-pinecone`    | `@pinecone-database/pinecone ^2.0.0` | Node   | STABLE |
| ChromaDB    | `@blackunicorn/bonklm-chroma`      | `chromadb ^1.0.0 / ^2.0.0 / ^3.0.0`  | Node   | STABLE |
| Weaviate    | `@blackunicorn/bonkviate`          | `weaviate-client ^3.11.0`            | Node   | STABLE |
| Qdrant      | `@blackunicorn/bonkdrant`          | `@qdrant/js-client-rest ^1.0.0`      | Node   | STABLE |
| LanceDB     | `@blackunicorn/bonklm-lance`       | `@lancedb/lancedb ^0.29.0`           | Node   | STABLE |
| Turbopuffer | `@blackunicorn/bonklm-turbopuffer` | `@turbopuffer/turbopuffer ^2.1.0`    | Edge   | STABLE |

The package manifests in this guide are pinned at `1.0.14`. The LanceDB connector is Node-only
(native bindings); the Turbopuffer connector is the edge-compatible alternative (Workerd / Deno /
Bun / Vercel Edge).

---

## LlamaIndex Connector

### Installation

```bash
npm install @blackunicorn/bonklm-llamaindex @blackunicorn/bonklm llamaindex
```

### Basic Usage — Query Engine

```typescript
import { createGuardedQueryEngine } from '@blackunicorn/bonklm-llamaindex';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const guardedEngine = createGuardedQueryEngine(queryEngine, {
  validators: [new PromptInjectionValidator()]
});

const response = await guardedEngine.query(userInput);
```

### Basic Usage — Retriever

```typescript
import { createGuardedRetriever } from '@blackunicorn/bonklm-llamaindex';

const guardedRetriever = createGuardedRetriever(retriever, {
  validators: [new PromptInjectionValidator()],
  validateRetrievedDocs: true,
  onBlockedDocument: 'filter'
});

const nodes = await guardedRetriever.retrieve(userQuery);
```

### Configuration Options

| Option                  | Type                               | Default                     | Description                       |
| ----------------------- | ---------------------------------- | --------------------------- | --------------------------------- |
| `validators`            | `Validator[]`                      | `[]`                        | Validators to apply               |
| `guards`                | `Guard[]`                          | `[]`                        | Guards to run                     |
| `validateRetrievedDocs` | `boolean`                          | `true`                      | Validate each retrieved document  |
| `onBlockedDocument`     | `'filter' \| 'abort' \| 'replace'` | `'filter'`                  | Action when a document is blocked |
| `maxRetrievedDocs`      | `number`                           | `10`                        | Max documents to retrieve         |
| `productionMode`        | `boolean`                          | `NODE_ENV === 'production'` | Generic errors in production      |
| `validationTimeout`     | `number`                           | `30000`                     | Timeout in milliseconds           |
| `onQueryBlocked`        | `Function`                         | —                           | Callback when query blocked       |
| `onDocumentBlocked`     | `Function`                         | —                           | Callback when a document blocked  |
| `onResponseBlocked`     | `Function`                         | —                           | Callback when response blocked    |

---

## LangChain Connector

Two patterns ship side-by-side:

- **`langchain@1.x` middleware (recommended).** `createBonklmMiddleware` returns a
  `BonklmLangchainMiddleware` for the v1 agent / runnable pipeline.
- **`@langchain/core@^0.3.x` callback handler (legacy).** `GuardrailsCallbackHandler` is kept for
  dual-path runtime detection and is marked `@deprecated`; it will be removed when the 0.3.x line
  reaches EOL.

For the v1 retriever surface — which the middleware pattern does NOT cover, since retriever
invocation lives outside the agent / runnable middleware lifecycle — use `withRetrieverGuardrails`.

A LangGraph node helper (`createBonklmLangGraphNode` / `bonklmLangGraphNode`) is also exported for
graph-based pipelines.

### Installation

```bash
npm install @blackunicorn/bonklm-langchain @blackunicorn/bonklm @langchain/core
```

For OpenAI-backed examples below, also install `@langchain/openai`.

### Retriever Wrap (`withRetrieverGuardrails`)

```typescript
import { withRetrieverGuardrails } from '@blackunicorn/bonklm-langchain';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const guardedRetriever = withRetrieverGuardrails(myRetriever, {
  validators: [new PromptInjectionValidator()],
  validationTimeout: 5000 // default 5000ms
});

const docs = await guardedRetriever.invoke('search query');
```

Per-doc validation runs through `validateWithTimeoutSecure` so a slow validator cannot silently hang
the retriever invoke call.

### `createBonklmMiddleware` (v1 middleware)

```typescript
import { createBonklmMiddleware } from '@blackunicorn/bonklm-langchain';
import { PromptInjectionValidator, GuardrailEngine } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()]
});

// Positional-engine form:
const middleware = createBonklmMiddleware(engine, {
  scope: 'input' // 'input' | 'output' | 'tool-call' | 'tool-result'
});
```

### `GuardrailsCallbackHandler` (legacy)

> `GuardrailsCallbackHandler` is deprecated — prefer `createBonklmMiddleware` for
> `@langchain/core@^1.0.0`. The handler remains for `@langchain/core@^0.3.x` dual-path runtime
> detection.

```typescript
import { GuardrailsCallbackHandler } from '@blackunicorn/bonklm-langchain';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';
import { ChatOpenAI } from '@langchain/openai';

const handler = new GuardrailsCallbackHandler({
  validators: [new PromptInjectionValidator()],
  validateStreaming: true
});

const llm = new ChatOpenAI({ model: 'gpt-4o', callbacks: [handler] });
const response = await llm.invoke([{ role: 'user', content: userInput }]);
```

### Error Type Guards

```typescript
import {
  isGuardrailsViolationError,
  isStreamValidationError,
  GuardrailsViolationError
} from '@blackunicorn/bonklm-langchain';

try {
  await chain.invoke({ topic: userInput });
} catch (error) {
  if (isGuardrailsViolationError(error)) {
    console.error('Guardrails violation:', error.reason);
    console.error('Findings:', error.findings);
  } else if (isStreamValidationError(error)) {
    console.error('Stream validation failed:', error.message);
  }
}
```

`ConnectorValidationError`, `ConnectorConfigurationError`, and `ConnectorTimeoutError` are also
re-exported for consistency with the other BonkLM connectors.

For LangChain v1 migration notes see [langchain-v1-migration.md](./langchain-v1-migration.md).

---

## Pinecone Connector

### Installation

```bash
npm install @blackunicorn/bonklm-pinecone @blackunicorn/bonklm @pinecone-database/pinecone
```

### Basic Usage

```typescript
import { Pinecone } from '@pinecone-database/pinecone';
import { createGuardedIndex } from '@blackunicorn/bonklm-pinecone';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index('my-index');

const guardedIndex = createGuardedIndex(index, {
  validators: [new PromptInjectionValidator()],
  validateRetrievedVectors: true,
  sanitizeMetadataFilters: true
});

// The guarded index exposes a single query(options) method. `namespace`
// is passed per-query and structurally validated (charset + length) before
// it reaches index.namespace():
const results = await guardedIndex.query({
  vector: embedding,
  topK: 10,
  namespace: 'documents',
  includeMetadata: true
});
```

> The guarded Pinecone index wraps the **query** path only — query input and retrieved vectors are
> validated. It does NOT wrap `upsert`; run writes through the raw `index`, or validate write
> content yourself with `createMemoryWriteValidator` (as the LanceDB / Turbopuffer connectors do).

### Configuration Options

| Option                     | Type                    | Default                     | Description                              |
| -------------------------- | ----------------------- | --------------------------- | ---------------------------------------- |
| `validators`               | `Validator[]`           | `[]`                        | Validators to apply                      |
| `guards`                   | `Guard[]`               | `[]`                        | Guards to run                            |
| `logger`                   | `Logger`                | `console`                   | Logger instance                          |
| `validateRetrievedVectors` | `boolean`               | `true`                      | Validate retrieved vectors               |
| `onBlockedVector`          | `'filter' \| 'abort'`   | `'filter'`                  | Action when a retrieved vector blocked   |
| `sanitizeMetadataFilters`  | `boolean`               | `true`                      | Sanitize metadata filter expressions     |
| `maxTopK`                  | `number`                | `100`                       | Maximum `topK` value                     |
| `retrievedDocValidator`    | `RetrievedDocValidator` | —                           | Opt-in batch retrieved-doc validator     |
| `productionMode`           | `boolean`               | `NODE_ENV === 'production'` | Generic errors in production             |
| `validationTimeout`        | `number`                | `30000`                     | Timeout in milliseconds                  |
| `onQueryBlocked`           | `(result) => void`      | —                           | Callback when query blocked              |
| `onVectorBlocked`          | `(id, result) => void`  | —                           | Callback when a retrieved vector blocked |

### Filter Sanitization

When `sanitizeMetadataFilters` is enabled (the default), the Pinecone connector sanitizes metadata
filter expressions to prevent filter-injection before they reach the index.

---

## ChromaDB Connector

### Installation

```bash
npm install @blackunicorn/bonklm-chroma @blackunicorn/bonklm chromadb
```

### Basic Usage

```typescript
import { ChromaClient } from 'chromadb';
import { createGuardedCollection } from '@blackunicorn/bonklm-chroma';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const chroma = new ChromaClient();
const collection = await chroma.getOrCreateCollection({ name: 'documents' });

const guardedCollection = createGuardedCollection(collection, {
  validators: [new PromptInjectionValidator()],
  validateQueries: true,
  validateDocuments: true,
  validateMetadata: true
});

const results = await guardedCollection.query({
  queryTexts: [userQuery],
  nResults: 10
});

await guardedCollection.add({
  documents: ['document content here'],
  ids: ['doc1'],
  metadatas: [{ source: 'trusted' }]
});
```

### Configuration Options

| Option                 | Type          | Default                     | Description                    |
| ---------------------- | ------------- | --------------------------- | ------------------------------ |
| `validators`           | `Validator[]` | `[]`                        | Validators to apply            |
| `guards`               | `Guard[]`     | `[]`                        | Guards to run                  |
| `validateQueries`      | `boolean`     | `true`                      | Validate queries               |
| `validateDocuments`    | `boolean`     | `true`                      | Validate documents             |
| `validateMetadata`     | `boolean`     | `true`                      | Validate metadata              |
| `sanitizeWhereFilters` | `boolean`     | `true`                      | Sanitize WHERE clauses         |
| `maxDocumentLength`    | `number`      | `100000`                    | Max document length            |
| `productionMode`       | `boolean`     | `NODE_ENV === 'production'` | Generic errors in production   |
| `validationTimeout`    | `number`      | `30000`                     | Timeout in milliseconds        |
| `onQueryBlocked`       | `Function`    | —                           | Callback when query blocked    |
| `onDocumentBlocked`    | `Function`    | —                           | Callback when document blocked |

The Chroma peer accepts three majors (`^1.0.0 / ^2.0.0 / ^3.0.0`) — the wrap surface is stable
across each listed major.

---

## Weaviate Connector

### Installation

```bash
npm install @blackunicorn/bonkviate @blackunicorn/bonklm weaviate-client
```

> Peer is the modern `weaviate-client ^3.11.0` (NOT the legacy `weaviate-ts-client`) — the floor is
> the version the connector's type conformance is verified against.

### Basic Usage

```typescript
import weaviate from 'weaviate-client';
import { createGuardedClient } from '@blackunicorn/bonkviate';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const weaviateClient = await weaviate.connectToLocal();

const guardedClient = createGuardedClient(weaviateClient, {
  validators: [new PromptInjectionValidator()],
  allowedClasses: ['Document', 'Article'],
  allowedFields: ['title', 'content', 'tags']
});

// The guarded client exposes a single query(options) method; queries execute
// through the real v3 namespace (nearText / bm25 / hybrid / fetchObjects):
const results = await guardedClient.query({
  className: 'Document',
  fields: ['title', 'content'],
  nearText: { concepts: ['search query'] },
  limit: 10
});

// Validated objects mirror the real client shape: { uuid, properties, metadata, ... }
for (const obj of results.objects) {
  console.log(obj.uuid, obj.properties.title);
}
```

### Configuration Options

| Option                     | Type                    | Default                     | Description                                  |
| -------------------------- | ----------------------- | --------------------------- | -------------------------------------------- |
| `validators`               | `Validator[]`           | `[]`                        | Validators to apply                          |
| `guards`                   | `Guard[]`               | `[]`                        | Guards to run                                |
| `allowedClasses`           | `string[]`              | `[]`                        | Class name allowlist (wildcards supported)   |
| `allowedFields`            | `string[]`              | `[]`                        | Field/filter allowlist (wildcards supported) |
| `validateFilters`          | `boolean`               | `true`                      | Validate `where` filter trees                |
| `validateRetrievedObjects` | `boolean`               | `true`                      | Validate retrieved objects                   |
| `onBlockedObject`          | `'filter' \| 'abort'`   | `'filter'`                  | Action when an object is blocked             |
| `maxLimit`                 | `number`                | `50`                        | Maximum `limit` value                        |
| `productionMode`           | `boolean`               | `NODE_ENV === 'production'` | Generic errors in production                 |
| `validationTimeout`        | `number`                | `30000`                     | Timeout in milliseconds                      |
| `onQueryBlocked`           | `(result) => void`      | —                           | Callback when query blocked                  |
| `onObjectBlocked`          | `(obj, result) => void` | —                           | Callback when an object is blocked           |
| `onClassNotAllowed`        | `(className) => void`   | —                           | Callback when class not allowed              |

### Wildcard Patterns

```typescript
const guardedClient = createGuardedClient(weaviateClient, {
  allowedClasses: ['Document*', 'Article*'],
  allowedFields: ['title', 'content*', 'meta*']
});
```

---

## Qdrant Connector

### Installation

```bash
npm install @blackunicorn/bonkdrant @blackunicorn/bonklm @qdrant/js-client-rest
```

### Basic Usage

```typescript
import { QdrantClient } from '@qdrant/js-client-rest';
import { createGuardedClient } from '@blackunicorn/bonkdrant';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const qdrant = new QdrantClient({ url: 'http://localhost:6333' });
const guardedClient = createGuardedClient(qdrant, {
  validators: [new PromptInjectionValidator()],
  validateRetrievedPoints: true,
  allowedPayloadFields: ['title', 'content']
});

// search(options) takes a single options object — the collection name,
// query vector, and payload selection all live inside it:
const results = await guardedClient.search({
  collectionName: 'documents',
  vector: embedding,
  limit: 10,
  withPayload: true
});

// upsert(collectionName, points) takes the collection name positionally
// and a bare array of points (each { id, vector, payload }):
await guardedClient.upsert('documents', [
  {
    id: 'doc1',
    vector: embedding,
    payload: { text: 'content here' }
  }
]);
```

### Configuration Options

| Option                    | Type                    | Default                     | Description                           |
| ------------------------- | ----------------------- | --------------------------- | ------------------------------------- |
| `validators`              | `Validator[]`           | `[]`                        | Validators to apply                   |
| `guards`                  | `Guard[]`               | `[]`                        | Guards to run                         |
| `logger`                  | `Logger`                | `console`                   | Logger instance                       |
| `validateRetrievedPoints` | `boolean`               | `true`                      | Validate retrieved points             |
| `onBlockedPoint`          | `'filter' \| 'abort'`   | `'filter'`                  | Action when a point is blocked        |
| `validateFilters`         | `boolean`               | `true`                      | Validate filter expressions           |
| `allowedPayloadFields`    | `string[]`              | `[]`                        | Payload field allowlist (empty = all) |
| `maxLimit`                | `number`                | `50`                        | Maximum search `limit`                |
| `maxFilterLength`         | `number`                | `10000`                     | Max filter string length              |
| `maxPayloadSize`          | `number`                | `1048576`                   | Max payload size in bytes (1MB)       |
| `regexTimeout`            | `number`                | `5000`                      | Regex execution timeout (ms)          |
| `retrievedDocValidator`   | `RetrievedDocValidator` | —                           | Opt-in batch retrieved-doc validator  |
| `productionMode`          | `boolean`               | `NODE_ENV === 'production'` | Generic errors in production          |
| `validationTimeout`       | `number`                | `30000`                     | Timeout in milliseconds               |
| `onQueryBlocked`          | `(result) => void`      | —                           | Callback when query blocked           |
| `onPointBlocked`          | `(id, result) => void`  | —                           | Callback when a point is blocked      |

### Filter Sanitization

Dangerous filter operators (e.g. `{ key: '$where', match: { any: [] } }`) are rejected before they
reach the index. The connector sanitises filter expressions on `search` and validates point payloads
on `upsert`.

---

## LanceDB Connector (Node-only)

LanceDB ships native bindings; the connector inherits that constraint. For edge / Workerd / Vercel
Edge consumers use [`@blackunicorn/bonklm-turbopuffer`](#turbopuffer-connector-edge-compatible)
below.

`createGuardedLanceTable(table, opts)` returns a Proxy-wrapped Table that applies
`MemoryWriteValidator` on writes (`add` / `update` / `mergeInsert(...).execute`) and
`RetrievedDocValidator` on retrieval (`.toArray()` of `search()` + `query()`). All other Table
methods pass through.

### Installation

```bash
npm install @blackunicorn/bonklm-lance @blackunicorn/bonklm @lancedb/lancedb
```

### Basic Usage

```typescript
import { connect } from '@lancedb/lancedb';
import { createGuardedLanceTable } from '@blackunicorn/bonklm-lance';
import {
  PromptInjectionValidator,
  SecretGuard,
  PIIGuard,
  createMemoryWriteValidator,
  createRetrievedDocValidator
} from '@blackunicorn/bonklm';

const db = await connect('./.lancedb');
const rawTable = await db.openTable('docs');

const guarded = createGuardedLanceTable(rawTable, {
  memoryWriteValidator: createMemoryWriteValidator({
    validators: [new SecretGuard(), new PIIGuard()],
    onFailure: 'block-write'
  }),
  retrievedDocValidator: createRetrievedDocValidator({
    validators: [new PromptInjectionValidator()],
    onFailure: 'filter'
  }),
  // Validate ALL user-influenceable text columns:
  contentField: ['text', 'summary']
});

// Writes are validated per-row, per-column:
await guarded.add([{ id: '1', text: 'safe content here', summary: 'short safe summary' }]);

// Retrieval is validated; blocked rows are filtered out (or hard-blocked
// depending on `onFailure`):
const rows = await guarded.search('safe query').limit(10).toArray();
```

The 6 ACced methods (`add`, `update`, `mergeInsert(...).execute`, `search().toArray`,
`query().toArray`, related builders) are intercepted via Proxy. Every other Table API call passes
straight through.

---

## Turbopuffer Connector (edge-compatible)

> **Supply-chain warning.** The OFFICIAL SDK is `@turbopuffer/turbopuffer` (scoped, currently
> `^2.1.0`). A separate npm package named `turbopuffer` (no scope, version `1.0.1`) is a placeholder
> NOT published by Turbopuffer Inc. Do NOT install the unscoped package.

`createGuardedNamespace(namespace, opts)` is the edge-compatible equivalent of
`createGuardedLanceTable`. Turbopuffer is a pure HTTP API; the connector uses no Node-only globals
and runs on Workerd, Deno, Bun, and Vercel Edge.

### Installation

```bash
npm install @blackunicorn/bonklm-turbopuffer @blackunicorn/bonklm \
  @turbopuffer/turbopuffer
```

### Basic Usage

```typescript
import { Turbopuffer } from '@turbopuffer/turbopuffer';
import { createGuardedNamespace } from '@blackunicorn/bonklm-turbopuffer';
import {
  PromptInjectionValidator,
  SecretGuard,
  PIIGuard,
  createMemoryWriteValidator,
  createRetrievedDocValidator
} from '@blackunicorn/bonklm';

const tpuf = new Turbopuffer({ apiKey: process.env.TPUF_API_KEY });
const rawNamespace = tpuf.namespace('docs');

const guarded = createGuardedNamespace(rawNamespace, {
  memoryWriteValidator: createMemoryWriteValidator({
    validators: [new SecretGuard(), new PIIGuard()],
    onFailure: 'block-write'
  }),
  retrievedDocValidator: createRetrievedDocValidator({
    validators: [new PromptInjectionValidator()],
    onFailure: 'filter'
  })
});

// Writes (upsert_rows / patch_rows) are validated per-row.
await guarded.write({
  upsert_rows: [{ id: '1', vector: embedding, attributes: { text: 'safe content' } }]
});

// Query response rows are validated; blocked rows are filtered out.
const response = await guarded.query({
  vector: embedding,
  top_k: 10
});
```

The 3 ACced methods (`write` / `query` / `deleteAll`) are intercepted via Proxy. All other Namespace
methods pass through.

---

## Common Security Features

All RAG / vector-store connectors include:

- **Query validation** — prevent prompt injection in search queries.
- **Document validation** — validate retrieved documents BEFORE they reach the LLM.
- **Filter sanitization** — prevent NoSQL injection in filter expressions (Pinecone, Qdrant,
  Chroma).
- **Field / class access control** — restrict what can be retrieved: Weaviate `allowedClasses` /
  `allowedFields`, Qdrant `allowedPayloadFields`. (Pinecone validates the query `namespace`
  structurally — charset + length — rather than against an allowlist.)
- **Metadata validation** — validate metadata fields and values.
- **Vector dimension limits** — prevent oversized vectors.
- **Distance-array filtering** — match filtered result rows with their distance scores so callers
  don't silently re-use stale alignment.

The `memory_write` + `composed_context` surfaces in `@blackunicorn/bonklm-lance` and
`@blackunicorn/bonklm-turbopuffer` use the same `MemoryWriteValidator` + `RetrievedDocValidator`
primitives as the memory-client connectors (Letta, Mem0, Zep — see
[AI SDK Connectors](./ai-sdks.md#letta-memory-client-connector)) so the threat model and `onFailure`
knobs (`'block-write'` / `'filter'`) line up across vector stores AND memory backends.

## Choosing a Vector-Store Connector

| If you...                                                            | Use                  |
| -------------------------------------------------------------------- | -------------------- |
| Run a Node service against Pinecone                                  | `bonklm-pinecone`    |
| Run a Node service against Chroma                                    | `bonklm-chroma`      |
| Run a Node service against Weaviate                                  | `bonkviate`          |
| Run a Node service against Qdrant                                    | `bonkdrant`          |
| Run a Node service against local LanceDB                             | `bonklm-lance`       |
| Need vector storage on Cloudflare Workers / Vercel Edge / Deno / Bun | `bonklm-turbopuffer` |
| Build LlamaIndex retrievers / query engines                          | `bonklm-llamaindex`  |
| Build LangChain v1 retrievers (or v0.3 chains)                       | `bonklm-langchain`   |

## Next Steps

- [Framework Middleware](./framework-middleware.md) — Express, Fastify, NestJS, Hono, Elysia,
  Next.js, Restate, Temporal, Trigger.dev, Inngest.
- [AI SDK Connectors](./ai-sdks.md) — OpenAI, Anthropic, Vercel AI SDK, Google GenAI, Mistral, MCP,
  Letta, Mem0, Zep, LiveKit, OpenAI Agents.
- [LLM Provider Connectors](./llm-providers.md) — provider helpers, voice webhooks, inference
  providers.
- [Emerging Framework Connectors](./emerging-frameworks.md) — Mastra, Genkit, CopilotKit, ElizaOS,
  Stagehand, Eko, VoltAgent, Cloudflare Agents, browser-agents-core.
- [LangChain v1 migration](./langchain-v1-migration.md) — middleware pattern upgrade notes.
- [Vercel AI SDK v6 migration](./vercel-v6-migration.md) — applies to vector-store consumers using
  Vercel AI SDK for embeddings.
