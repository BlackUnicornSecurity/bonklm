# @blackunicorn/bonklm-llamaindex

LlamaIndex.TS connector for BonkLM - Provides security validation for RAG (Retrieval-Augmented
Generation) queries and document retrieval.

## Installation

```bash
npm install @blackunicorn/bonklm-llamaindex
npm install llamaindex
```

## Usage

### Guarded Query Engine

Wrap your LlamaIndex `QueryEngine` to validate queries, retrieved documents, and responses:

```typescript
import { VectorStoreIndex, Document } from 'llamaindex';
import { createGuardedQueryEngine } from '@blackunicorn/bonklm-llamaindex';
import { PromptInjectionValidator, PIIGuard } from '@blackunicorn/bonklm';

// Create your index
const document = new Document({ text: 'Your document content' });
const index = await VectorStoreIndex.fromDocuments([document]);
const queryEngine = index.asQueryEngine();

// Wrap with guardrails
const guardedEngine = createGuardedQueryEngine(queryEngine, {
  validators: [new PromptInjectionValidator()],
  guards: [new PIIGuard()],
  validateRetrievedDocs: true,
  onBlockedDocument: 'filter'
});

// Query with protection
const result = await guardedEngine.query('What is the capital of France?');
console.log(result.response);
console.log('Documents blocked:', result.documentsBlocked);
```

### Guarded Retriever

Wrap your `Retriever` for document-level validation:

```typescript
import { createGuardedRetriever } from '@blackunicorn/bonklm-llamaindex';

const guardedRetriever = createGuardedRetriever(retriever, {
  validators: [new PromptInjectionValidator()],
  guards: [new PIIGuard()],
  maxRetrievedDocs: 10
});

const nodes = await guardedRetriever.retrieve('AI safety research');
```

## Options

### GuardedLlamaIndexOptions

| Option                  | Type                    | Default                     | Description                          |
| ----------------------- | ----------------------- | --------------------------- | ------------------------------------ |
| `validators`            | `Validator[]`           | `[]`                        | Validators for queries and responses |
| `guards`                | `Guard[]`               | `[]`                        | Guards for content filtering         |
| `logger`                | `Logger`                | `console`                   | Logger instance                      |
| `validateRetrievedDocs` | `boolean`               | `true`                      | Validate retrieved documents         |
| `onBlockedDocument`     | `'filter' \| 'abort'`   | `'filter'`                  | Action when document is blocked      |
| `productionMode`        | `boolean`               | `NODE_ENV === 'production'` | Generic errors in production         |
| `validationTimeout`     | `number`                | `30000`                     | Validation timeout in ms             |
| `maxRetrievedDocs`      | `number`                | `10`                        | Max documents to retrieve            |
| `onQueryBlocked`        | `(result) => void`      | -                           | Callback when query is blocked       |
| `onDocumentBlocked`     | `(doc, result) => void` | -                           | Callback when document is blocked    |
| `onResponseBlocked`     | `(result) => void`      | -                           | Callback when response is blocked    |

## Security Features

1. **Query Injection Protection** - Validates queries for prompt injection attempts
2. **Document Poisoning Detection** - Validates retrieved documents before synthesis
3. **Response Validation** - Checks synthesized responses for policy violations
4. **Metadata Filtering** - Controls what metadata is exposed
5. **Timeout Protection** - Prevents hanging on malicious inputs

## Example Application

See `examples/` directory for a complete RAG application with guardrails.

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn
