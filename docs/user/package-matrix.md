# BonkLM Package Compatibility Matrix

v1.0.15 package surface. `packages/*` has 54 manifests: 52 linked publishable packages plus 2
private legacy packages outside the linked family. The workspace adds one separately versioned
Tier-B tool; 8 private example manifests are outside the workspace.

## Bundle target legend

| Tag     | Meaning                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 NODE | Node 20+ only (uses `node:fs`, native crypto, etc.)                                                                                           |
| 🟡 EDGE | Edge runtimes (Workerd/Cloudflare with `nodejs_compat`, Deno, Bun) + Node; strict Vercel Edge (`edge-light`) only where a package declares it |
| 🟣 ISO  | Isomorphic — Node + Edge + browser via Web standard APIs                                                                                      |

## Separately versioned Tier-B tooling

| Package                            | Version | License | Release scope                      |
| ---------------------------------- | ------- | ------- | ---------------------------------- |
| `@blackunicorn/eslint-plugin-edge` | 0.4.1   | MIT     | `@blackunicorn/eslint-plugin-edge` |

Tier-B tools are public, independently versioned artifacts. They do not join the 52-package linked
family and use scope-qualified GitHub Release tags.

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

| Package                              | Bundle  | Peer dep                       | Status                 |
| ------------------------------------ | ------- | ------------------------------ | ---------------------- |
| `@blackunicorn/bonklm-sandbox-utils` | 🟢 NODE | —                              | **STABLE (graduated)** |
| `@blackunicorn/bonklm-e2b`           | 🟢 NODE | `@e2b/code-interpreter ^2.0.0` | **STABLE (graduated)** |
| `@blackunicorn/bonklm-daytona`       | 🟢 NODE | `@daytonaio/sdk ~0.175.0`      | **STABLE (graduated)** |

The graduation gate passed at 100% recall / 0% FPR / 100% precision against the hash-pinned
50-pattern corpus + 50-pattern benign corpus. Full gate result in the CHANGELOG §0.7.0 "Sandbox
graduation gate result" section.

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
| `@blackunicorn/bonklm-mcp`           | 🟢 NODE | `@modelcontextprotocol/sdk ^1.25.2`        | STABLE |
| `@blackunicorn/bonklm-copilotkit`    | 🟢 NODE | `@copilotkit/react-core ^1.0.0`            | STABLE |
| `@blackunicorn/bonklm-stagehand`     | 🟢 NODE | `@browserbasehq/stagehand ^3.4.0`          | STABLE |

## Web frameworks + edge

| Package                                     | Bundle  | Peer dep                               | Status |
| ------------------------------------------- | ------- | -------------------------------------- | ------ |
| `@blackunicorn/bonklm-express`              | 🟢 NODE | `express ^4.18.0 ‖ ^5.0.0`             | STABLE |
| `@blackunicorn/bonklm-fastify`              | 🟢 NODE | `fastify ^5.8.5`                       | STABLE |
| `@blackunicorn/bonklm-nestjs`               | 🟢 NODE | `@nestjs/common ^11.1.18`              | STABLE |
| `@blackunicorn/bonklm-hono`                 | 🟡 EDGE | `hono ^4.12.34`                        | STABLE |
| `@blackunicorn/bonklm-vercel`               | 🟣 ISO  | `ai ^3.0.0 ‖ ^4.0.0 ‖ ^5.0.0 ‖ ^6.0.0` | STABLE |
| `@blackunicorn/bonklm-elysia`               | 🟣 ISO  | `elysia ^1.4.0` (optional)             | STABLE |
| `@blackunicorn/bonklm-nextjs`               | 🟣 ISO  | `next ^16.2.11` (optional)             | STABLE |
| `@blackunicorn/bonklm-web-middleware-utils` | 🟣 ISO  | —                                      | STABLE |
| `@blackunicorn/bonklm-cloudflare-agents`    | 🟡 EDGE | `agents ^0.13.0` (optional)            | STABLE |
| `@blackunicorn/bonklm-server`               | 🟢 NODE | `fastify ^5.12.0` (dependency)         | STABLE |

The release workflow publishes the server as `ghcr.io/blackunicornsecurity/bonklm-server` for
`linux/amd64` and `linux/arm64`. Its exact image tag matches the npm package version. GHCR exposes
only exact SemVer tags; npm prereleases use `next` and stable releases use `latest`.

## Vector DBs

| Package                            | Bundle  | Peer dep                             | Status |
| ---------------------------------- | ------- | ------------------------------------ | ------ |
| `@blackunicorn/bonklm-chroma`      | 🟢 NODE | `chromadb ^1.0.0 ‖ ^2.0.0 ‖ ^3.0.0`  | STABLE |
| `@blackunicorn/bonklm-lance`       | 🟢 NODE | `@lancedb/lancedb ^0.29.0`           | STABLE |
| `@blackunicorn/bonklm-pinecone`    | 🟢 NODE | `@pinecone-database/pinecone ^2.0.0` | STABLE |
| `@blackunicorn/bonkdrant`          | 🟢 NODE | `@qdrant/js-client-rest ^1.0.0`      | STABLE |
| `@blackunicorn/bonklm-turbopuffer` | 🟡 EDGE | `@turbopuffer/turbopuffer ^2.1.0`    | STABLE |
| `@blackunicorn/bonkviate`          | 🟢 NODE | `weaviate-client ^3.11.0`            | STABLE |

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

## Supported without a dedicated package

Some hosts are guarded at a **protocol boundary** rather than through an SDK wrapper, so there is no
`@blackunicorn/bonklm-*` package to install for them. They are listed here because "no connector
package" is not the same as "not supported" — but nothing below ships as a connector, and the setup
wizard does not offer them as one.

| Host                                     | Language | How BonkLM attaches                                                                                                               |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Hermes** (`NousResearch/hermes-agent`) | Python   | MCP host → guard the tool boundary with `@blackunicorn/bonklm-mcp`, or front its model traffic with `@blackunicorn/bonklm-server` |
| Any other MCP host                       | any      | same two paths — MCP is a wire protocol, so the host's language does not matter                                                   |
| Any HTTP LLM client                      | any      | `@blackunicorn/bonklm-server` (`/litellm`, `/portkey`, `/openai-compatible`)                                                      |

**Hermes** is the largest agentic project measured in
[agentic tool coverage](./agentic-tool-coverage.md) and it is Python, so a TypeScript connector
package would have nothing to wrap. Its own README documents it as an MCP host, which is a boundary
BonkLM already guards — so the integration exists today with no new package, and a first-class
Hermes plugin (Python, calling the gateway) would be a separate deliverable in a separate repo.

Detection caveat: a Python Hermes install is invisible to `bonklm wizard`, which reads
`package.json`. The wizard surfaces the MCP connector when `@modelcontextprotocol/sdk` is present in
a Node project, and makes no claim about Python hosts.

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

## v1.0 compatibility baseline

- Public API exports are separated from internal surfaces.
- Deprecated paths are removed: `messagesToTextLegacy`, `GuardrailsCallbackHandler`, sync
  `validateToken`, openclaw-adapter (REMOVED from v1.0.0 publish set — see Deprecated/legacy table
  above for migration path).
- The public API is frozen against removal until v2.0.

## Compatibility statement

`@blackunicorn/bonklm-*` packages follow synchronised SemVer. Coordinated family changesets
enumerate all 52 publishable packages, Changesets `linked` config aligns their target version, and
the prospective release-plan gate rejects omissions or split targets. Major-version peer deps are
listed disjunctively where the BonkLM wrap surface is stable across vendor majors. The Fastify
plugin supports the patched Fastify 5 line at `^5.8.5`. Workerd `nodejs_compat` flag required for
edge bundles.

Where a root `pnpm.overrides` entry pins a vendor for security, that package's peer floor matches
the override floor. Below the override floor nothing can resolve in this workspace, so a range
reaching under it advertises support that could not be built or tested even deliberately. Note the
floor is the lowest **reachable** version, not the version actually installed — the resolver takes
the highest match in the range, so `hono ^4.12.34` currently resolves 4.13.2.

Four floors were raised to restore that property: `@blackunicorn/bonklm-mcp` `^1.0.0` → `^1.25.2`,
`@blackunicorn/bonklm-nestjs` `^10.0.0 ‖ ^11.0.0` → `^11.1.18`, `@blackunicorn/bonklm-hono`
`^4.12.0` → `^4.12.34`, and `@blackunicorn/bonklm-nextjs` `^16.0.0` → `^16.2.11`. The NestJS change
withdraws a Nest 10 claim that was never compiled against; the other three withdraw spans the
security overrides already made unreachable. No BonkLM wrap surface changed — consumers below a new
floor upgrade the peer, not their BonkLM code.

Peers with no override (`@langchain/core`, `langchain`, `@elizaos/core`, …) are not covered by this
rule and may still advertise a low end the workspace does not build.

Last updated: v1.0.15.
