# @blackunicorn/bonkviate

> Guarded vector-database client wrapper for BonkLM — every query and result passes the guardrail
> engine before it reaches your application.

Wraps the vector-search client used by RAG pipelines with BonkLM validation: prompt-injection
detection on retrieved documents, secret-leak blocking on stored payloads, and fail-closed error
boundaries. Drop-in, framework-agnostic.

## Install

```bash
pnpm add @blackunicorn/bonkviate @blackunicorn/bonklm
```

## Usage

```ts
import { createGuardedClient } from '@blackunicorn/bonkviate';
import { QdrantClient } from '@qdrant/js-client-rest';
import { PromptInjectionValidator, SecretGuard, GuardrailEngine } from '@blackunicorn/bonklm';

const client = createGuardedClient(new QdrantClient({ url: process.env.VECTOR_DB_URL! }), {
  engine: new GuardrailEngine({
    validators: [new PromptInjectionValidator()],
    guards: [new SecretGuard()]
  })
});

// queries are validated; blocked operations throw GuardrailBlockedError
const results = await client.query('search text', { limit: 5 });
```

## Guardrail surfaces

| Surface           | What is validated                               |
| ----------------- | ----------------------------------------------- |
| query input       | injection payloads in search text               |
| retrieved results | indirect prompt injection in returned documents |
| errors            | sanitized, fail-closed — no internals leak      |

## License

Apache-2.0 — same as BonkLM core. The underlying engine is a trademark of its respective owner; this
package is an independent wrapper and is not affiliated with or endorsed by them.
