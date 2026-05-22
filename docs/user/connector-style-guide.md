# BonkLM Connector Style Guide

> **Status**: Authoritative for Epic 2+ connectors. Adopted at Story 2.1b-connector-style-ADR (Sprint 11, v0.5.0).
> **Audience**: connector authors writing or extending packages under `packages/*-connector/`.

This guide locks the canonical factory naming + signature shape for every BonkLM connector
shipping in v0.5.0+. Read it BEFORE writing or extending a connector. Every Epic 2+
connector AC references this guide; PR reviewers reject divergences.

---

## TL;DR — The four canonical sub-conventions

Every connector exports ONE OR MORE factories matching one of these four shapes. Pick
the shape that matches your vendor SDK's primary API surface; do NOT invent a fifth
shape without an ADR amendment to this guide.

### 1. Object / client wrap

```ts
wrap<Subject>(subject, engine, options?)
```

Use when wrapping a single client object or agent instance. The subject is the FIRST
positional argument; the engine is the SECOND positional argument; options is an
optional THIRD positional argument.

Examples:
- `wrapAgent(agent, engine, options?)` — OpenAI Agents SDK (Story 1.6).
- `wrapMCPClient(client, engine, options?)` — Vercel MCP (Story 1.4 Phase-2).

### 2. Memory-client wrap (subset of #1)

```ts
wrap<Vendor>Client(client, engine, options?)
```

A specialised form of #1 for vendor memory clients. The CLIENT is the subject; the
factory MUST follow this exact name shape for memory connectors so consumers find
them via predictable import names. Locked at Story 2.5.

Examples:
- `wrapMem0Client(client, engine, options?)` — `@blackunicorn/bonklm-mem0`.
- `wrapZepClient(client, engine, options?)` — `@blackunicorn/bonklm-zep`.
- `wrapLettaClient(client, engine, options?)` — `@blackunicorn/bonklm-letta`.

Future memory connectors MUST use `wrap<Vendor>Client(...)` naming.

The generic `wrapMemoryClient(client, { engine, adapter, getTenantId })` stays
exported from `@blackunicorn/bonklm-memory-utils` for advanced callers building
custom adapters. The per-vendor `wrap<Vendor>Client` is a typed convenience over
this generic.

### 3. Framework middleware factory

```ts
<framework>Guardrails(engine, options?)
```

Use when the consumer registers BonkLM as middleware in a host framework. Engine is
the FIRST positional argument; options is the SECOND positional argument.

Examples:
- `honoGuardrails(engine, options?)` — Hono (Story 2.2).
- `bonkMiddleware(engine, options?)` — Vercel AI SDK (Story 1.4 — legacy name kept for
  backwards compat; new framework middleware connectors follow `<framework>Guardrails`).
- `expressGuardrails(engine, options?)` — future Express middleware.

### 4. Plugin pattern (host-required only)

```ts
<library>Plugin(options)
```

Use ONLY when the host runtime forces a plugin-shaped registration. Engine lives INSIDE
`options.engine`; the factory takes ONE positional argument.

Example:
- `bonklmPlugin({ engine, validators, ... })` — ElizaOS (Story 1.8).

**Avoid #4 for new connectors UNLESS the host runtime literally cannot consume #1 or #3.**
ElizaOS uses #4 because the runtime's `Plugin` interface dictates the registration shape;
your connector's host probably does not.

---

## Multi-surface connectors (Mem0 worked example)

A single vendor SDK can span multiple BonkLM HookSurfaces. Two patterns apply
depending on whether the SDK's surface paths are OVERLAPPING or ORTHOGONAL.

### Pattern A — One factory, two composite validators (OVERLAPPING surfaces)

Use when the vendor SDK exposes both surfaces via the SAME client (e.g. Mem0's
`add` writes and `search` recalls flow through one `client` object; a Mem0
`infer=true` call can produce BOTH a memory-write AND a recall observation).

```ts
// PRIMARY EXAMPLE — wrapMem0Client (Story 2.5, ships in v0.5.0)
//
// Surface hooks are invoked by calling composite validators directly on
// the appropriate ValidatorInput discriminated-union shape. The composite
// factories live in `@blackunicorn/bonklm` core:
//   - createMemoryWriteValidator({ validators }) → handles `{ kind: 'memory_write', payload }`
//   - createComposedContextValidator({ validators }) → handles `{ kind: 'composed_context', entries }`
//
// The connector author builds them ONCE at wrap-time, then calls
// `.validate(input)` on the matching ValidatorInput inside each routed method.
import {
  createLogger,
  createMemoryWriteValidator,
  createComposedContextValidator,
  type GuardrailEngine,
  type Logger,
  type Validator,
} from '@blackunicorn/bonklm';
import {
  ConnectorValidationError,
  logValidationFailure,
} from '@blackunicorn/bonklm/core/connector-utils';

export function wrapMem0Client(
  client: Mem0ClientLike,
  engine: GuardrailEngine,
  options?: WrapMem0ClientOptions,
): Mem0ClientLike {
  const logger: Logger = options?.logger ?? createLogger('console');
  // Build the two composite validators ONCE. The validator list MUST come
  // from `options.validators` — `GuardrailEngine` does NOT expose its
  // configured validators as a public field. Connector authors pass the
  // same list they used to construct the engine (or a connector-specific
  // subset) via options.
  //
  // CRITICAL: explicit length check below — `options?.validators ?? []`
  // would silently accept a truthy empty array, defeating validation.
  // Story 0.1 fail-safe only catches null/undefined at engine construction;
  // composite-validator factories also throw on empty list, but a clear
  // wrap-time error names `wrapMem0Client` in the stack trace.
  const underlying: Validator[] = options?.validators ?? [];
  if (underlying.length === 0) {
    throw new ConnectorValidationError(
      'wrapMem0Client requires at least one validator in options.validators',
      'configuration_error',
    );
  }
  const memoryWriteValidator = createMemoryWriteValidator({ validators: underlying });
  const composedContextValidator = createComposedContextValidator({ validators: underlying });

  return new Proxy(client, {
    get(target, prop) {
      const original = Reflect.get(target, prop);

      // memory_write surface — fires on add/update/history/reset
      if (prop === 'add' || prop === 'update' || prop === 'history' || prop === 'reset') {
        return async function (...args: unknown[]) {
          // CONSUMER-SUPPLIED HELPER (see note below the block) — extracts
          // `{ content, userId?, sessionId?, metadata? }` from the SDK's
          // call args. Shape per ValidatorInput's `memory_write` payload.
          const payload = extractMemoryWritePayload(prop, args);
          const result = await memoryWriteValidator.validate({
            kind: 'memory_write',
            payload,
          });
          if (!result.allowed) {
            const reason = result.reason ?? 'memory_write blocked';
            logValidationFailure(logger, reason, {
              connector: '@blackunicorn/bonklm-mem0',
              surface: 'memory_write',
              risk_level: result.risk_level,
            });
            throw new ConnectorValidationError(reason, 'validation_failed');
          }
          return Reflect.apply(original, target, args);
        };
      }

      // composed_context surface — fires on search/get/getAll recall paths
      if (prop === 'search' || prop === 'get' || prop === 'getAll') {
        return async function (...args: unknown[]) {
          const recall = await Reflect.apply(original, target, args);
          // CONSUMER-SUPPLIED HELPER (see note below the block) — flattens
          // the SDK's recall result into the `entries: string[]` shape
          // ComposedContextValidator expects.
          const result = await composedContextValidator.validate({
            kind: 'composed_context',
            entries: extractRecallEntries(recall),
          });
          if (!result.allowed) {
            const reason = result.reason ?? 'composed_context blocked';
            logValidationFailure(logger, reason, {
              connector: '@blackunicorn/bonklm-mem0',
              surface: 'composed_context',
              risk_level: result.risk_level,
            });
            throw new ConnectorValidationError(reason, 'validation_failed');
          }
          return recall;
        };
      }

      return original;
    },
  });
}
```

> **Consumer-supplied helpers** — the example references two helpers that
> are NOT exported from `@blackunicorn/bonklm`: `extractMemoryWritePayload(prop, args)`
> and `extractRecallEntries(recall)`. Each connector implements these against
> the vendor SDK's exact call/return shapes. For Mem0:
> `extractMemoryWritePayload('add', [{ messages, userId }, ...])` returns
> `{ content: JSON.stringify(messages), userId }`; `extractRecallEntries({ results: [...] })`
> returns `results.map(r => r.memory)`. Copy the pattern, NOT the function names.

> **⚠️ Do NOT swallow `ConnectorValidationError` with a bare `try/catch`.**
> JavaScript has no language-level "unsuppressible" marker, but consumers
> catching this error MUST either re-throw it or log it via their own
> structured-error pipeline. A silent catch defeats every guarantee this
> ADR establishes. Future Sprint 12 ESLint rule
> `bonklm/no-bare-catch-of-connector-validation-error` enforces this at
> CI; today it is a reviewer-checked discipline.

**This is "one factory, two composite validators" — NOT "two factories."** The
same `wrapMem0Client` proxy routes to `createMemoryWriteValidator` for write
methods and `createComposedContextValidator` for recall methods, both running
the same underlying validator stack. The call site for the consumer is unchanged:

```ts
const guardedClient = wrapMem0Client(rawClient, engine);
await guardedClient.add(...);    // fires memory_write hook
await guardedClient.search(...); // fires composed_context hook
```

### Pattern B — Two factories (ORTHOGONAL surfaces)

Use when the vendor SDK exposes the surfaces via DIFFERENT objects or DIFFERENT
entry points (e.g. a hypothetical Zep separation between `client.thread.*`
memory operations and `client.graph.*` retrieval operations).

> **⚠️ Illustrative — `wrapZepGraphRetriever` is NOT implemented in v0.5.0.**
> The block below documents a forward-looking PATTERN, not a shipping API.
> Consumers attempting to import `wrapZepGraphRetriever` from
> `@blackunicorn/bonklm-zep` in v0.5.0 will get a module-not-found error.
> The import path below uses a non-existent subpath specifier
> (`/UNRELEASED`) so any accidental copy-paste fails at TypeScript compile,
> not at runtime in production. Do NOT copy this code into production.

<!-- skip-doc-tsc-validation -->
```ts-skip
// ILLUSTRATIVE ONLY — types not yet available. Compile-time poisoned
// import to prevent accidental copy-paste into a real package.
import {
  wrapZepClient,
  wrapZepGraphRetriever,
} from '@blackunicorn/bonklm-zep/UNRELEASED';

export function wrapZepClient(client, engine, options?) { /* memory surface */ }
export function wrapZepGraphRetriever(graphClient, engine, options?) {
  /* retrieved-docs surface */
}
```

**Choice rubric**: if the consumer holds ONE client and calls overlapping methods on
it, ship Pattern A. If the consumer holds TWO clients (or two distinct entry points
that consumers reach via DIFFERENT names), ship Pattern B.

---

## Required behaviour for every connector

Regardless of which shape you pick, every connector MUST:

1. **Accept the engine via the canonical position** (1st arg for shapes #3, 2nd
   arg for shapes #1+#2, inside options for shape #4). Do NOT mix positions across
   factories within the same package.

2. **Return a NEW object or proxy** — do NOT mutate the subject in place. Exception:
   when the SDK requires in-place mutation (e.g. ElizaOS sealed `wrapMemory` via
   `Object.defineProperty`, OpenAI Agents `session.outputGuardrails.push`), document
   the exception inline in the connector source AND in this guide's "Documented
   exceptions" section below. PR reviewers enforce the immutability default.

3. **Surface validation failures as `ConnectorValidationError`** from
   `@blackunicorn/bonklm/core/connector-utils`. Do NOT use bare `Error` or
   vendor-specific error types — consumers across connectors recover via the
   same `errorCategory` taxonomy.

4. **Log validation failures via `logValidationFailure`** from
   `@blackunicorn/bonklm/core/connector-utils`. The helper sanitises log control
   characters (`stripLogControlChars`) so attacker-controlled metadata cannot
   inject ANSI escapes or null bytes into log lines.

5. **Declare peer dependencies in `packages/<name>/package.json`** with TIGHT
   pre-1.0 vendor SDK ranges (e.g. `"@openai/agents": "^0.11.0"`, not `"*"`). Vendor
   SDKs change shape between minors before 1.0; pinning the peer surfaces vendor
   breaking changes through the build, not at runtime.

6. **Cross-reference `tools/audit-baselines/sprint-11-story-2.1b-checklist.md`**
   when writing Phase-2 ACs that touch `runtime.bonklm.*`, the probe-await
   semantics, or the AsyncLocalStorage call-context isolation.

---

## Documented Epic-1 deviations

Five connectors shipped before this style guide was authored. They follow four
different shapes; they remain as-is for semver compatibility through v0.5 but each
gains an additional canonical-shape entrypoint in Story 2.1b-connectors so consumers
can pick. The legacy entrypoints become `@deprecated` in v0.5 and are removed in v1.0
(matching the HMAC sync-removal cadence at R2-6).

| Connector | Legacy shape | Canonical shape (added 2.1b) | Sunset |
|---|---|---|---|
| Vercel | `bonkMiddleware(engine, options)` — shape #3 (already canonical) | (no change) | n/a |
| LangChain | `createBonklmMiddleware(engine \| config)` — overloaded | `langchainGuardrails(engine, options?)` — shape #3 | `@deprecated` v0.5 → removed v1.0 |
| OpenAI Agents | `wrapAgent(agent, engine, options?)` — shape #1 (already canonical) | (no change) | n/a |
| Google GenAI | `createGuardedGoogleGenAI(client, options)` — engine inside `options.validators` | `wrapGoogleGenAIClient(client, engine, options?)` — shape #1 | `@deprecated` v0.5 → removed v1.0 |
| ElizaOS | `bonklmPlugin(options)` — shape #4 (host-required, already canonical) | (no change) | n/a |

The two deviations (LangChain overloaded, Google GenAI engine-in-options) gain
canonical-shape additions in Story 2.1b-connectors. Both legacy entrypoints emit
`@deprecated` warnings in v0.5 and throw `TypeError` at v1.0.

---

## Documented exceptions to the "return a new object" rule

In-place mutation via `Object.defineProperty` or push-into-array is permitted
ONLY when the SDK literally requires it. Each documented exception is recorded
here AND inline in the connector source.

| Connector | Method | SDK constraint that forces in-place mutation |
|---|---|---|
| ElizaOS | `installSealedWrapMemory(runtime)` seals `runtime.createMemory` + `runtime.updateMemory` via `Object.defineProperty({ writable: false, configurable: false })` | The ElizaOS plugin contract is that other plugins read `runtime.createMemory`; we must REPLACE the method ON the runtime object, not on a proxy. Sealing prevents subsequent plugins from re-wrapping. |
| OpenAI Agents | `wrapRealtime(session, ...)` pushes into `session.outputGuardrails` | OpenAI Agents `RealtimeSession` reads `outputGuardrails` directly off the session instance; a proxy would not be observed by the SDK's internal dispatch. |

NEW exceptions require:
1. An inline source-code comment explaining the SDK constraint.
2. A row added to this table in the same PR.
3. PR reviewer approval explicitly acknowledging the deviation.

---

## Validation: how the audit-loop enforces this guide

Story 2.1b-connector-style-ADR establishes this guide as authoritative. From v0.5.0
onwards:

1. **Every Epic 2+ connector AC** in the roadmap references this guide explicitly
   ("MUST follow shape #1/#2/#3/#4 per `docs/user/connector-style-guide.md`").

2. **PR reviewers** verify the factory signature matches one of the four shapes
   before approving any new connector.

3. **The audit-loop architect lane** flags any connector PR proposing a fifth shape
   without an ADR amendment to this guide.

4. **Consumers** read this guide to know what import-name shape to expect when
   integrating a new vendor.

---

## Cross-references

- `docs/user/threat-surfaces.md` — the 7-string HookSurface taxonomy referenced by
  every connector's hook registrations.
- `docs/user/connectors/` — per-connector READMEs and migration guides.
- `docs/user/error-codes.md` (ships Story 3.13) — `ConnectorValidationError` codes.
- `tools/WORKSPACE-POLICY.md` — Tier A internal vs Tier B publishable workspace tooling.
- `team/plans/2026-05-21-v0.4-v0.7-roadmap-FINAL.md` — full v0.4 → v1.0 roadmap with
  per-story ACs that reference this guide.

---

## Amendment history

| Date | Story | Change |
|---|---|---|
| 2026-05-22 | Story 2.1b-connector-style-ADR | Initial authoring. 4 canonical sub-conventions, Mem0 PRIMARY multi-surface example, Zep ILLUSTRATIVE footnote, Epic-1 deviations table, documented exceptions, sunset clauses. |
