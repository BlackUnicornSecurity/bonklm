<div align="center">

# @blackunicorn/bonklm-qdrant

### **Qdrant Security Guardrails for BonkLM**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/%40blackunicorn%2Fbonklm-qdrant.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

**Vector Database Security • RAG Protection • Query Validation**

</div>

---

## Overview

The `@blackunicorn/bonklm-qdrant` package provides security guardrails for
[Qdrant](https://qdrant.tech/) vector database operations. It validates queries, sanitizes filters,
and detects poisoned points to protect your RAG (Retrieval-Augmented Generation) applications from
adversarial attacks.

This package contains:

- **Vector Validation** - Validates vector format and dimensions
- **Filter Sanitization** - Prevents NoSQL injection with Unicode escape detection
- **Point Poisoning Detection** - Validates retrieved points for malicious content
- **Payload Field Access Control** - Restricts which payload fields are returned
- **ReDoS Protection** - Safe regex pattern matching with timeout

---

## Installation

```bash
npm install @blackunicorn/bonklm-qdrant @qdrant/js-client-rest
```

Or with pnpm:

```bash
pnpm add @blackunicorn/bonklm-qdrant @qdrant/js-client-rest
```

---

## Quick Start

### Basic Usage

```typescript
import { QdrantClient } from '@qdrant/js-client-rest';
import { createGuardedClient } from '@blackunicorn/bonklm-qdrant';
import { PromptInjectionValidator, PIIGuard } from '@blackunicorn/bonklm';

// Create Qdrant client
const client = new QdrantClient({ url: 'http://localhost:6333' });

// Wrap with guardrails
const guardedClient = createGuardedClient(client, {
  validators: [new PromptInjectionValidator()],
  guards: [new PIIGuard()],
  validateRetrievedPoints: true,
  allowedPayloadFields: ['title', 'content']
});

// Search with protection
const results = await guardedClient.search({
  collectionName: 'my_collection',
  vector: embedding,
  limit: 10
});

console.log('Points:', results.points.length);
console.log('Points blocked:', results.pointsBlocked);
```

---

## Configuration

### GuardedQdrantOptions

| Option                    | Type                   | Default                     | Description                         |
| ------------------------- | ---------------------- | --------------------------- | ----------------------------------- |
| `validators`              | `Validator[]`          | `[]`                        | Validators for queries              |
| `guards`                  | `Guard[]`              | `[]`                        | Guards for content filtering        |
| `logger`                  | `Logger`               | `console`                   | Logger instance                     |
| `validateRetrievedPoints` | `boolean`              | `true`                      | Validate retrieved points           |
| `validateFilters`         | `boolean`              | `true`                      | Validate filter expressions         |
| `allowedPayloadFields`    | `string[]`             | `[]`                        | Allowed payload field patterns      |
| `onBlockedPoint`          | `'filter' \| 'abort'`  | `'filter'`                  | Action when point is blocked        |
| `productionMode`          | `boolean`              | `NODE_ENV === 'production'` | Generic errors in production        |
| `validationTimeout`       | `number`               | `30000`                     | Validation timeout in ms            |
| `maxLimit`                | `number`               | `50`                        | Maximum limit value                 |
| `maxFilterLength`         | `number`               | `10000`                     | Maximum filter string length        |
| `maxPayloadSize`          | `number`               | `1048576`                   | Maximum payload size in bytes (1MB) |
| `regexTimeout`            | `number`               | `5000`                      | Regex timeout in ms                 |
| `onPointBlocked`          | `(id, result) => void` | -                           | Callback when point is blocked      |

---

## API Reference

### createGuardedClient

Creates a guarded Qdrant client wrapper.

```typescript
import { createGuardedClient } from '@blackunicorn/bonklm-qdrant';

const guardedClient = createGuardedClient(qdrantClient, options);
```

#### Methods

- **search(options)** - Executes a vector search with validation
  - `collectionName`: Collection name (validated for safe characters)
  - `vector`: Query vector (validated for format and dimensions)
  - `limit`: Number of results (max enforced)
  - `filter`: Filter expression (sanitized)

- **upsert(collectionName, points)** - Upserts points with validation
  - Validates collection name
  - Validates vector format for each point
  - Validates payload content

### GuardedQdrantResult

Result of a guarded search operation.

```typescript
interface GuardedQdrantResult {
  points: QdrantPoint[]; // Valid points only
  pointsBlocked: number; // Count of blocked points
  filtered: boolean; // True if any points blocked
  raw: any; // Original Qdrant result
}

interface QdrantPoint {
  id: string | number;
  score: number;
  payload?: Record<string, any>; // Filtered if allowedPayloadFields set
  vector?: number[];
}
```

---

## Security Features

### Vector Validation

Validates vector format and prevents invalid inputs:

```typescript
// Empty vector rejected
await guardedClient.search({
  collectionName: 'test',
  vector: [], // Error: Vector cannot be empty
  limit: 10
});

// Non-finite values rejected
await guardedClient.search({
  collectionName: 'test',
  vector: [1, 2, NaN, 4], // Error: Vector must contain only finite numbers
  limit: 10
});

// Dimension limits enforced
await guardedClient.search({
  collectionName: 'test',
  vector: new Array(100001).fill(0), // Error: Vector dimension exceeds maximum
  limit: 10
});
```

### Filter Sanitization

Prevents NoSQL injection with comprehensive pattern detection:

```typescript
// These filters will be rejected
await guardedClient.search({
  collectionName: 'test',
  vector: [1, 2, 3],
  filter: {
    must: [
      { key: '__proto__', match: { value: true } } // Blocked
    ]
  }
});

// Unicode escape detection
await guardedClient.search({
  collectionName: 'test',
  vector: [1, 2, 3],
  filter: {
    // \u0024 = $ (obfuscation attempt)
    must: [{ key: '\u0024where', match: { value: 'malicious' } }] // Blocked
  }
});
```

### Payload Field Access Control

Restrict which payload fields are returned:

```typescript
const guardedClient = createGuardedClient(client, {
  allowedPayloadFields: ['title', 'content', 'author*'] // Supports wildcards
});

const results = await guardedClient.search({
  collectionName: 'documents',
  vector: embedding,
  limit: 10
});

// Only title, content, and any author* fields are included
// Fields like 'password', 'apiKey', etc. are filtered out
```

### ReDoS Protection

Safe regex pattern matching with timeout protection:

```typescript
const guardedClient = createGuardedClient(client, {
  allowedPayloadFields: [
    'title',
    'content',
    // Patterns with excessive wildcards are skipped to prevent ReDoS
    '*****dangerous' // This pattern will be skipped
  ],
  regexTimeout: 1000 // 1 second timeout per pattern
});
```

---

## Advanced Usage

### Collection Name Validation

```typescript
// Only alphanumeric, underscore, and hyphen allowed
await guardedClient.search({
  collectionName: 'my_collection-123', // Valid
  vector: embedding,
  limit: 10
});

await guardedClient.search({
  collectionName: '../../etc/passwd', // Blocked: invalid characters
  vector: embedding,
  limit: 10
});
```

### Payload Size Limits

```typescript
const guardedClient = createGuardedClient(client, {
  maxPayloadSize: 50000 // 50KB limit
});

// Points with large payloads are rejected during retrieval validation
```

### Custom Blocked Point Handling

```typescript
const guardedClient = createGuardedClient(client, {
  onBlockedPoint: 'abort', // Fail closed
  onPointBlocked: (id, result) => {
    console.error(`Point ${id} blocked:`, result.reason);
  }
});

try {
  const results = await guardedClient.search({
    collectionName: 'test',
    vector: embedding,
    limit: 10
  });
} catch (error) {
  // Search aborted due to blocked point
  console.error('Search aborted:', error.message);
}
```

### Filter Length Limits

```typescript
const guardedClient = createGuardedClient(client, {
  maxFilterLength: 5000 // Prevent DoS via large filters
});

// Large filters are rejected
```

---

## See Also

- [Core Package](../core) - Core security engine
- [ChromaDB Connector](../chroma-connector) - ChromaDB integration
- [Pinecone Connector](../pinecone-connector) - Pinecone integration
- [Weaviate Connector](../weaviate-connector) - Weaviate integration

---

## License

MIT © Black Unicorn <info@blackunicorn.tech>
