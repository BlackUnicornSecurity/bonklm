# @blackunicorn/bonklm-pinecone

Pinecone vector database connector for BonkLM - Provides security validation for vector queries and
retrieval.

## Installation

```bash
npm install @blackunicorn/bonklm-pinecone
npm install @pinecone-database/pinecone
```

## Usage

### Guarded Pinecone Index

Wrap your Pinecone index to validate queries and retrieved vectors:

```typescript
import { Pinecone } from '@pinecone-database/pinecone';
import { createGuardedIndex } from '@blackunicorn/bonklm-pinecone';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

// Initialize Pinecone
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index('my-index');

// Wrap with guardrails
const guardedIndex = createGuardedIndex(index, {
  validators: [new PromptInjectionValidator()],
  validateRetrievedVectors: true,
  sanitizeMetadataFilters: true,
  maxTopK: 100
});

// Query with protection
const results = await guardedIndex.query({
  vector: embedding,
  topK: 10,
  namespace: 'documents',
  includeMetadata: true
});

console.log('Matches:', results.matches.length);
console.log('Vectors blocked:', results.vectorsBlocked);
```

## Options

### GuardedPineconeOptions

| Option                     | Type                   | Default                     | Description                     |
| -------------------------- | ---------------------- | --------------------------- | ------------------------------- |
| `validators`               | `Validator[]`          | `[]`                        | Validators for queries          |
| `guards`                   | `Guard[]`              | `[]`                        | Guards for content filtering    |
| `logger`                   | `Logger`               | `console`                   | Logger instance                 |
| `validateRetrievedVectors` | `boolean`              | `true`                      | Validate retrieved vectors      |
| `onBlockedVector`          | `'filter' \| 'abort'`  | `'filter'`                  | Action when vector is blocked   |
| `productionMode`           | `boolean`              | `NODE_ENV === 'production'` | Generic errors in production    |
| `validationTimeout`        | `number`               | `30000`                     | Validation timeout in ms        |
| `maxTopK`                  | `number`               | `100`                       | Maximum topK value              |
| `sanitizeMetadataFilters`  | `boolean`              | `true`                      | Sanitize filter expressions     |
| `onQueryBlocked`           | `(result) => void`     | -                           | Callback when query is blocked  |
| `onVectorBlocked`          | `(id, result) => void` | -                           | Callback when vector is blocked |

## Security Features

1. **Query Validation** - Validates query parameters and vectors
2. **Metadata Filter Sanitization** - Prevents filter injection attacks
3. **Vector Validation** - Validates retrieved vector content
4. **TopK Enforcement** - Prevents excessive retrieval
5. **Timeout Protection** - Prevents hanging on slow operations

## Filter Injection Prevention

The connector automatically sanitizes metadata filters to prevent:

- Path traversal attacks (`..`)
- JavaScript injection (`eval`)
- Prototype pollution (`__proto__`)
- Constructor access

```typescript
// This filter will be rejected
const results = await guardedIndex.query({
  vector: embedding,
  filter: { $..: 'malicious' }  // Blocked!
});
```

## Example Application

See `examples/` directory for a complete vector search application with guardrails.

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn
