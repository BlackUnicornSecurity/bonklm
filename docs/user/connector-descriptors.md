# Connector descriptors

The setup wizard (`npx @blackunicorn/bonklm wizard`) covers **every publishable BonkLM connector
package**. It does that from a declarative catalog rather than a hand-maintained list, so a
connector cannot ship without the wizard knowing about it.

This page documents the descriptor shape, what "detect / configure / test" actually means per
connector, and how to add one.

---

## Where things live

| Piece                     | Path                                                          |
| ------------------------- | ------------------------------------------------------------- |
| Descriptor type + factory | `packages/core/src/cli/connectors/descriptor.ts`              |
| Catalog data              | `packages/core/src/cli/connectors/catalog/*.ts`               |
| Registry (composition)    | `packages/core/src/cli/connectors/registry.ts`                |
| Coverage guard            | `packages/core/src/cli/connectors/registry.workspace.test.ts` |
| Hand-written connectors   | `packages/core/src/cli/connectors/implementations/*.ts`       |

The catalog lives in `packages/core`, not in each connector package. Every connector package depends
on core, so core importing them back would be a dependency cycle. The coverage guard closes the gap
that colocation would have given: it reads `packages/*/package.json` off disk and fails the build if
registry membership and the published package set disagree in either direction.

---

## The descriptor

The descriptor API is **in-tree only** — `packages/core` exposes no `./cli` export subpath, so there
is nothing to import from the published package. Descriptors are added by editing the catalog in
this repository, and the coverage guard is what keeps that honest.

```ts
// packages/core/src/cli/connectors/catalog/data.ts
import { defineConnector } from '../descriptor.js';

defineConnector({
  id: 'qdrant', // [a-z][a-z0-9-]* — the CLI id
  name: 'Qdrant', // display name
  category: 'vector-db', // groups the wizard's selection list
  npmPackage: '@blackunicorn/bonkdrant', // the package that ships this connector
  peerPackages: ['@qdrant/js-client-rest'], // upstream SDKs, from the package's peerDependencies
  ports: [6333], // local service ports
  dockerContainers: ['qdrant'], // `docker ps` name substrings
  probe: { kind: 'tcp', port: 6333 }, // how the live test verifies it
  summary: 'Vector database security for RAG applications backed by Qdrant.'
});
```

### Fields

| Field              | Required | Meaning                                                                                                      |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------ |
| `id`               | yes      | Connector id used by `connector add\|test\|remove` and the wizard's multiselect                              |
| `name`             | yes      | Human-readable display name                                                                                  |
| `category`         | yes      | One of `llm`, `agent`, `framework`, `vector-db`, `memory`, `sandbox`, `workflow`, `observability`, `utility` |
| `npmPackage`       | yes      | The npm package that ships the connector. Also always a detection signal                                     |
| `summary`          | yes      | One line, rendered above the generated snippet                                                               |
| `peerPackages`     | no       | Upstream SDK packages, copied from the connector package's `peerDependencies`                                |
| `detectEnvVars`    | no       | Env vars whose presence hints the connector is relevant, but which the wizard will not require               |
| `ports`            | no       | Local TCP ports probed by service detection                                                                  |
| `dockerContainers` | no       | Container-name substrings matched against `docker ps`                                                        |
| `credentials`      | no       | Credentials the wizard prompts for and writes to `.env`                                                      |
| `probe`            | no       | `{ kind: 'installed' }` (default) or `{ kind: 'tcp', port, host? }`                                          |

### Credentials

```ts
credentials: [{ env: 'OPENAI_API_KEY', configKey: 'apiKey', prefix: 'sk-', label: 'API key' }];
```

- `env` — the exact name written to the user's `.env`.
- `configKey` — the key the connector's own options object reads. The CLI collects config keyed by
  env-var name (that is the `.env` shape) and re-keys it before calling `test()`.
- `prefix` — optional input-format hint. Rejects a malformed value at the prompt **and** becomes a
  `startsWith` constraint in the generated zod schema.
- `label` — used in prompt errors; defaults to `API key`.

> **Only declare an env-var name the connector package itself documents.** The wizard writes that
> exact name; a guessed name produces a `.env` entry nothing reads. Where BonkLM has no documented
> name, the descriptor declares none — detection then runs off `package.json`, which is exact.

### Probes

| Probe                   | What it proves                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installed` _(default)_ | Every declared credential is present and well-formed, **and** the connector package or one of its peer SDKs is in the project's `package.json`. Local, offline, no network call. |
| `tcp`                   | A service accepts a connection on the declared port (Ollama, Qdrant).                                                                                                            |

There is deliberately no generic "call the provider's API" probe for catalog connectors. An endpoint
BonkLM has not verified would be an invented fact, and a wrong one reports a healthy connector as
broken. Connectors that do need a live API probe are written by hand — see below.

---

## What the wizard does per connector

| Step          | Every connector | Notes                                                                                                                                                                    |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Detect**    | yes             | `package.json` deps (connector package + peer SDKs), env vars, ports, Docker                                                                                             |
| **Select**    | yes             | Detected connectors sort first and start pre-selected                                                                                                                    |
| **Configure** | yes             | Prompts for declared credentials; connectors with none are configured with zero prompts                                                                                  |
| **Test**      | yes             | `installed` or `tcp` probe, or the connector's own hand-written `test()`                                                                                                 |
| **Snippet**   | available       | `generateSnippet()` names the real package and the real config keys. Built for every connector, but no CLI command prints it yet — it is API surface, not wizard output. |

"Configure" is not the same as "prompts for a secret". Most BonkLM connectors are configured in code
against a client you have already authenticated — for those, configuration is detection plus the
snippet, and there is nothing to write to `.env`. Connectors that own a documented env var do prompt
for it.

---

## Optional env vars

`ConnectorDefinition.optionalEnvVars` marks a declared env var as skippable at the prompt. Two real
cases:

- a setting with a working default — `OLLAMA_HOST` (Ollama already works on `localhost:11434`);
- one of several alternative provider secrets — `VAPI_HMAC_SECRET` / `RETELL_HMAC_SECRET`, where
  BonkLM must not pick a voice provider for you.

A skipped prompt is not written to `.env`, and an absent optional env var never makes
`bonklm connector test` report `not-configured`.

---

## When to hand-write a connector instead

Write a module under `connectors/implementations/` when the connector needs something a descriptor
cannot express:

- a **live API probe** against a verified endpoint (OpenAI, Anthropic);
- a **tuned code snippet** showing real framework wiring (Express middleware, a LangChain callback
  handler).

Hand-written connectors set `npmPackage` like everything else, so the coverage guard treats both
kinds identically.

---

## Adding a connector

1. Create the connector package under `packages/`.
2. Add a descriptor to the matching file in `packages/core/src/cli/connectors/catalog/`.
   - `peerPackages` come from the new package's `peerDependencies`.
   - `credentials` only for env vars the package's own README documents.
3. Regenerate the changeset `linked` array (`pnpm run check:changeset-linked` tells you if it
   drifted).
4. Run `pnpm --filter @blackunicorn/bonklm test` — `registry.workspace.test.ts` fails until step 2
   is done, which is the point.

---

## Related

- [CLI guide](./cli-guide.md) — `wizard`, `status`, `connector add|test|remove`
- [Package matrix](./package-matrix.md) — the published package surface
- [Agentic tool coverage](./agentic-tool-coverage.md) — where BonkLM has connectors and where it
  does not
