# BonkLM Package Compatibility Matrix

v1.0.0-rc.4 release surface. 52 publishable workspace packages + 2 private tooling/legacy packages =
54 release-surface package manifests. The repository also contains 8 private example manifests
outside this matrix.

## Bundle target legend

| Tag     | Meaning                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 NODE | Node 20+ only (uses `node:fs`, native crypto, etc.)                                                                                           |
| 🟡 EDGE | Edge runtimes (Workerd/Cloudflare with `nodejs_compat`, Deno, Bun) + Node; strict Vercel Edge (`edge-light`) only where a package declares it |
| 🟣 ISO  | Isomorphic — Node + Edge + browser via Web standard APIs                                                                                      |

## Core

| Package                                    | Bundle                                   | Peer dep | Status |
| ------------------------------------------ | ---------------------------------------- | -------- | ------ |
| `@blackunicorn/bonklm`                     | 🟢 NODE / 🟡 EDGE (via `./edge` subpath) | —        | STABLE |
| `@blackunicorn/bonklm-logger`              | 🟣 ISO                                   | —        | STABLE |
| `@blackunicorn/bonklm-memory-utils`        | 🟡 EDGE                                  | —        | STABLE |
| `@blackunicorn/bonklm-browser-agents-core` | 🟣 ISO                                   | —        | STABLE |

## Voice + realtime

| Package                               | Bundle  | Peer dep                                              | Status |
| ------------------------------------- | ------- | ----------------------------------------------------- | ------ |
| `@blackunicorn/bonklm-livekit`        | 🟢 NODE | `@livekit/agents ^1.4.0`, `@livekit/rtc-node ^0.13.0` | STABLE |
| `@blackunicorn/bonklm-voice-webhooks` | 🟣 ISO  | — (Web Request + Node crypto)                         | STABLE |

## Sandbox execution

| Package                              | Bundle  | Peer dep                       | Status                            |
| ------------------------------------ | ------- | ------------------------------ | --------------------------------- |
| `@blackunicorn/bonklm-sandbox-utils` | 🟢 NODE | —                              | **STABLE (Sprint 24 graduation)** |
| `@blackunicorn/bonklm-e2b`           | 🟢 NODE | `@e2b/code-interpreter ^2.0.0` | **STABLE (Sprint 24 graduation)** |
| `@blackunicorn/bonklm-daytona`       | 🟢 NODE | `@daytonaio/sdk ~0.175.0`      | **STABLE (Sprint 24 graduation)** |

Sprint 24 Story 4.5 graduation gate passed at 100% recall / 0% FPR / 100% precision against the
R2-13 hash-pinned 50-pattern corpus + 50-pattern benign corpus. Full attestation in CHANGELOG
§0.7.0.

## Inference providers

| Package                                    | Bundle  | Peer dep                                                                   | Status |
| ------------------------------------------ | ------- | -------------------------------------------------------------------------- | ------ |
| `@blackunicorn/bonklm-openai`              | 🟢 NODE | `openai ^4.0.0`                                                            | STABLE |
| `@blackunicorn/bonklm-anthropic`           | 🟢 NODE | `@anthropic-ai/sdk ^0.28.0 ‖ ^0.30.0 ‖ ^0.40.0 ‖ ^0.50.0 ‖ ^0.98.0`        | STABLE |
| `@blackunicorn/bonklm-mistral`             | 🟢 NODE | `@mistralai/mistralai ^2.2.0` (ESM-only)                                   | STABLE |
| `@blackunicorn/bonklm-google-genai`        | 🟢 NODE | `@google/genai ^2.0.0`                                                     | STABLE |
| `@blackunicorn/bonklm-huggingface`         | 🟢 NODE | `@huggingface/inference ^2.0.0 ‖ ^3.0.0 ‖ ^4.0.0`                          | STABLE |
| `@blackunicorn/bonklm-ollama`              | 🟢 NODE | `ollama ^0.6.0`                                                            | STABLE |
| `@blackunicorn/bonklm-inference-providers` | 🟢 NODE | `groq-sdk` + `@cerebras/cerebras_cloud_sdk` + `together-ai` (all optional) | STABLE |
| `@blackunicorn/bonklm-voltagent`           | 🟢 NODE | `@voltagent/core ^2.7.0`                                                   | STABLE |

## Agent frameworks

| Package                              | Bundle  | Peer dep                                   | Status |
| ------------------------------------ | ------- | ------------------------------------------ | ------ |
| `@blackunicorn/bonklm-langchain`     | 🟢 NODE | `@langchain/core ^0.3.0 ‖ ^0.4.0 ‖ ^1.0.0` | STABLE |
| `@blackunicorn/bonklm-llamaindex`    | 🟢 NODE | `llamaindex ^0.11.0 ‖ ^0.12.0`             | STABLE |
| `@blackunicorn/bonklm-mastra`        | 🟢 NODE | `@mastra/core ^1.0.0`                      | STABLE |
| `@blackunicorn/bonklm-genkit`        | 🟢 NODE | `genkit ^1.0.0`                            | STABLE |
| `@blackunicorn/bonklm-eko`           | 🟢 NODE | `@eko-ai/eko ^4.1.0`                       | STABLE |
| `@blackunicorn/bonklm-openai-agents` | 🟢 NODE | `@openai/agents ^0.11.0`                   | STABLE |
| `@blackunicorn/bonklm-elizaos`       | 🟢 NODE | `@elizaos/core >=1.7.0 <3.0.0`             | STABLE |
| `@blackunicorn/bonklm-letta`         | 🟢 NODE | `@letta-ai/letta-client ^1.11.0`           | STABLE |
| `@blackunicorn/bonklm-mem0`          | 🟢 NODE | `mem0ai ^3.0.0`                            | STABLE |
| `@blackunicorn/bonklm-zep`           | 🟢 NODE | `@getzep/zep-cloud ^3.0.0`                 | STABLE |
| `@blackunicorn/bonklm-mcp`           | 🟢 NODE | `@modelcontextprotocol/sdk ^1.0.0`         | STABLE |
| `@blackunicorn/bonklm-copilotkit`    | 🟢 NODE | `@copilotkit/react-core ^1.0.0`            | STABLE |
| `@blackunicorn/bonklm-stagehand`     | 🟢 NODE | `@browserbasehq/stagehand ^3.4.0`          | STABLE |

## Web frameworks + edge

| Package                                     | Bundle  | Peer dep                               | Status |
| ------------------------------------------- | ------- | -------------------------------------- | ------ |
| `@blackunicorn/bonklm-express`              | 🟢 NODE | `express ^4.18.0 ‖ ^5.0.0`             | STABLE |
| `@blackunicorn/bonklm-fastify`              | 🟢 NODE | `fastify ^4.0.0 ‖ ^5.0.0`              | STABLE |
| `@blackunicorn/bonklm-nestjs`               | 🟢 NODE | `@nestjs/common ^10.0.0 ‖ ^11.0.0`     | STABLE |
| `@blackunicorn/bonklm-hono`                 | 🟡 EDGE | `hono ^4.12.0`                         | STABLE |
| `@blackunicorn/bonklm-vercel`               | 🟣 ISO  | `ai ^3.0.0 ‖ ^4.0.0 ‖ ^5.0.0 ‖ ^6.0.0` | STABLE |
| `@blackunicorn/bonklm-elysia`               | 🟣 ISO  | `elysia ^1.4.0` (optional)             | STABLE |
| `@blackunicorn/bonklm-nextjs`               | 🟣 ISO  | `next ^16.0.0` (optional)              | STABLE |
| `@blackunicorn/bonklm-web-middleware-utils` | 🟣 ISO  | —                                      | STABLE |
| `@blackunicorn/bonklm-cloudflare-agents`    | 🟡 EDGE | `agents ^0.13.0` (optional)            | STABLE |
| `@blackunicorn/bonklm-server`               | 🟢 NODE | `fastify ^4.0.0 ‖ ^5.0.0`              | STABLE |

## Vector DBs

| Package                            | Bundle  | Peer dep                             | Status                         |
| ---------------------------------- | ------- | ------------------------------------ | ------------------------------ |
| `@blackunicorn/bonklm-chroma`      | 🟢 NODE | `chromadb ^1.0.0 ‖ ^2.0.0 ‖ ^3.0.0`  | STABLE                         |
| `@blackunicorn/bonklm-lance`       | 🟢 NODE | `@lancedb/lancedb ^0.29.0`           | STABLE                         |
| `@blackunicorn/bonklm-pinecone`    | 🟢 NODE | `@pinecone-database/pinecone ^2.0.0` | STABLE                         |
| `@blackunicorn/bonklm-qdrant`      | 🟢 NODE | `@qdrant/js-client-rest ^1.0.0`      | STABLE                         |
| `@blackunicorn/bonklm-turbopuffer` | 🟡 EDGE | `@turbopuffer/turbopuffer ^2.1.0`    | STABLE                         |
| `@blackunicorn/bonklm-weaviate`    | 🟢 NODE | `weaviate-client ^3.0.0`             | **EXPERIMENTAL (preview API)** |

## Workflow + durable execution

| Package                         | Bundle  | Peer dep                          | Status |
| ------------------------------- | ------- | --------------------------------- | ------ |
| `@blackunicorn/bonklm-inngest`  | 🟢 NODE | `inngest ^4.4.0`                  | STABLE |
| `@blackunicorn/bonklm-trigger`  | 🟢 NODE | `@trigger.dev/sdk ^4.0.0`         | STABLE |
| `@blackunicorn/bonklm-restate`  | 🟢 NODE | `@restatedev/restate-sdk ^1.14.0` | STABLE |
| `@blackunicorn/bonklm-temporal` | 🟢 NODE | `@temporalio/worker ^1.16.0`      | STABLE |

## Document ingest

| Package                                | Bundle  | Peer dep                                                                                            | Status |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- | ------ |
| `@blackunicorn/bonklm-document-ingest` | 🟢 NODE | `@llamaindex/llama-cloud ^2.4.0`, `unstructured-client ^0.31.0`, `reductoai ^0.15.0` (all optional) | STABLE |

## Telemetry

| Package                             | Bundle | Peer dep                 | Status |
| ----------------------------------- | ------ | ------------------------ | ------ |
| `@blackunicorn/bonklm-voltops-otel` | 🟣 ISO | — (caller passes Tracer) | STABLE |

## Deprecated / legacy

| Package                         | Status                                                                                                                                                                                       | Migration                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@blackunicorn/bonklm-openclaw` | **PRIVATE / REMOVED FROM PUBLISH SET v1.0.0** (`private:true`). Original deprecation date gate 2026-07-01 retained for rc.x consumers via `docs/openclaw-integration.md` deprecation banner. | Migrate to native framework middleware (Express, Fastify, NestJS, Hono, Elysia, Next.js) — see [Connectors index](./connectors/framework-middleware.md). |
| `@blackunicorn/bonklm-wizard`   | **PRIVATE / DEPRECATED** (`private:true`). The CLI ships from `@blackunicorn/bonklm` via the `bonklm` bin.                                                                                   | Install `@blackunicorn/bonklm` and run `bonklm wizard` or `npx @blackunicorn/bonklm`.                                                                    |

## Cross-package patterns

### Telemetry — unified `BonklmBlockEvent` discriminated union

7 kinds: `voice` / `sandbox` / `inference` / `durable-exec` / `document` / `cf-agent` /
`web-middleware`. Single `onBlock` handler across all connectors:

```ts
import { isBonklmBlockEvent } from '@blackunicorn/bonklm';

function onBlock(event: unknown) {
  if (!isBonklmBlockEvent(event)) return;
  switch (event.kind) {
    case 'voice':
      logger.warn(`voice ${event.surface}`);
      break;
    case 'sandbox':
      logger.warn(`sandbox ${event.surface}`);
      break;
    case 'inference':
      logger.warn(`${event.provider} ${event.phase}`);
      break;
    // ...
  }
}
```

### OTel — `bonklmTrace()` core export

Caller-provides-exporter. Compatible with any `@opentelemetry/api` Tracer. Verified ingest at
Langfuse / Phoenix / Arize AX / VoltOps / Datadog — see `docs/user/otel-vendor-recipes.md`.

### Validator interface

All core validators implement
`Validator { name: string; validate(input: string | ValidatorInput): GuardrailResult | Promise<GuardrailResult> }`.
`adaptValidatorToUniversalInput(v, label)` handles capability detection for legacy string-only
validators routed through cachedValidate (restate + temporal middleware).

### Wrap-sentinel

`assertNotWrapped` + `markWrapped` + `ensureWrappedOnce` in
`@blackunicorn/bonklm/core/connector-utils` defeat double-wrap silent bypass across all wrap-pattern
connectors.

## v1.0-RC scope (Sprints 26-28)

- Public API surface audit — mark internal vs public exports.
- Deprecated paths removed: `messagesToTextLegacy`, `GuardrailsCallbackHandler`, sync
  `validateToken`, openclaw-adapter (REMOVED from v1.0.0 publish set — see Deprecated/legacy table
  above for migration path).
- API freeze — no removal until v2.0.
- v1.0-RC tag cut.

## Compatibility statement

`@blackunicorn/bonklm-*` packages follow synchronised SemVer — all packages bump together via
Changesets `linked` config. Major-version peer deps are listed disjunctively (`^4.0.0 ‖ ^5.0.0`)
where the BonkLM wrap surface is stable across vendor majors. Workerd `nodejs_compat` flag required
for edge bundles.

Last updated: v1.0.0-rc.4.
