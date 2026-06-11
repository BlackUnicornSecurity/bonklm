# BonkLM CLI Reference

> Last updated: 2026-06-11. Applies to `@blackunicorn/bonklm` `1.0.0-rc.4`.

Source-verified reference for the BonkLM command-line tools. Two binaries ship with the project:

| Binary          | Package                       | Purpose                                                               |
| --------------- | ----------------------------- | --------------------------------------------------------------------- |
| `bonklm`        | `@blackunicorn/bonklm`        | Multi-subcommand CLI: wizard, connector mgmt, status, doctor          |
| `bonklm-server` | `@blackunicorn/bonklm-server` | Fastify HTTP guardrail server (LiteLLM / Portkey / OpenAI-compatible) |

## 1. Overview

```bash
pnpm add -g @blackunicorn/bonklm   # global
npx @blackunicorn/bonklm           # one-shot
bonklm --version                   # verify
bonklm --help                      # top-level help
```

`bonklm --version` is read at runtime from the installed `package.json`
(`packages/core/src/bin/run.ts`). Invoking `bonklm` with no subcommand prints help and exits — it
does **not** auto-run the wizard.

## 2. Commands

The CLI is built on `commander@^12`. Registered subcommands (from `packages/core/src/bin/run.ts`):
`wizard`, `connector add|remove|test`, `status`, `doctor`.

### `bonklm wizard`

Interactive setup wizard. Source: `packages/core/src/cli/commands/wizard.ts`.

| Flag     | Description                   |
| -------- | ----------------------------- |
| `--json` | Output results in JSON format |

Flow:

1. Detect frameworks (`detectFrameworks`).
2. Detect local services such as Ollama and vector DBs (`detectServices`).
3. Detect existing credentials in `process.env` (`detectCredentials`).
4. Present a `multiselect` of connectors detected as available.
5. For each selected connector, re-use existing env credentials or prompt via `@clack/prompts`
   `password`. Inputs capped at 2048 chars; OpenAI keys must start with `sk-`; Anthropic keys with
   `sk-ant-`.
6. Test each connector with a 10s timeout (`testConnectorWithTimeout`).
7. Write credentials to `.env` in the current directory via `EnvManager` (atomic write, `0o600`
   perms on Unix; `icacls`/`attrib` on Windows).
8. Print summary, or emit a JSON object when `--json` is set. JSON output redacts credentials and
   omits `envEntries`.

### `bonklm connector add <id>`

Add a single connector configuration. Source: `packages/core/src/cli/commands/connector-add.ts`.

| Argument | Description                                                    |
| -------- | -------------------------------------------------------------- |
| `<id>`   | One of `openai`, `anthropic`, `ollama`, `express`, `langchain` |

| Flag      | Description              |
| --------- | ------------------------ |
| `--force` | Skip the connection test |

The ID is validated against the registry-backed allow-list of available connectors. Unknown /
malformed IDs exit `1` and list available connectors.

Flow: validate ID → re-use existing env credentials or prompt → unless `--force`, run a 10s
connection test (failure exits `1`) → write `.env` via `EnvManager` → audit-log via `AuditLogger`.

```bash
bonklm connector add openai
bonklm connector add anthropic --force
```

### `bonklm connector remove <id>`

Remove a connector's credentials from `.env`. Source:
`packages/core/src/cli/commands/connector-remove.ts`.

| Argument | Description                                                    |
| -------- | -------------------------------------------------------------- |
| `<id>`   | One of `openai`, `anthropic`, `ollama`, `express`, `langchain` |

| Flag    | Description                  |
| ------- | ---------------------------- |
| `--yes` | Skip the confirmation prompt |

Registry-gated — the inverse of `connector add`: validate ID → resolve the connector → read `.env`
via `EnvManager` → if none of the connector's env vars are present, report "nothing to remove" and
exit `0` → otherwise show the affected key names (never values) and, unless `--yes`, prompt for
confirmation → atomically rewrite `.env` without those keys → audit-log via `AuditLogger`. Unknown /
malformed IDs and an aborted (Ctrl-C) confirmation exit `1`; a declined confirmation makes no
changes and exits `0`.

```bash
bonklm connector remove openai
bonklm connector remove anthropic --yes
```

### `bonklm connector test <id>`

Test an already-configured connector. Source: `packages/core/src/cli/commands/connector-test.ts`.

| Argument | Description                                                    |
| -------- | -------------------------------------------------------------- |
| `<id>`   | One of `openai`, `anthropic`, `ollama`, `express`, `langchain` |

| Flag     | Description                   |
| -------- | ----------------------------- |
| `--json` | Output results in JSON format |

Reads the connector's credentials from `process.env` overlaid on `.env`, then runs the connector's
two-tier connection + validation test with a 10s timeout and prints the result. Exit codes: `0` when
both connection and validation pass; `2` when the test ran but connection or validation failed (a
10s timeout is reported here as a connection failure); `1` for an unknown / malformed ID or an
unconfigured connector (run `bonklm connector add <id>` first).

```bash
bonklm connector test openai
bonklm connector test anthropic --json
```

### `bonklm status`

Show environment and connector status. Source: `packages/core/src/cli/commands/status.ts`.

| Flag     | Description           |
| -------- | --------------------- |
| `--json` | Output in JSON format |

Runs four detections in parallel: frameworks, services, credentials in `process.env`, and variables
declared in the project's `.env` (`EnvManager().read()`; silently `{}` on read failure).
Human-readable output renders:

```
══════════════════════════════════════════════════
  BonkLM Environment Status
══════════════════════════════════════════════════
Frameworks: ...
Services: ...
Credentials in environment: ...
Configured in .env: ...
Available connectors:
  [✓] OpenAI (openai)
  [ ] Anthropic (anthropic)
  ...
  Run 'bonklm wizard' to set up connectors
══════════════════════════════════════════════════
```

JSON output masks credential values via the `maskedValue` field emitted by `detectCredentials`.

### `bonklm doctor`

Diagnose the local BonkLM contributor environment. Added **Sprint 50** (closes architect M-2 from
Sprint 41). Source: `packages/core/src/cli/commands/doctor.ts`.

| Flag     | Description                  |
| -------- | ---------------------------- |
| `--json` | Output report in JSON format |

The doctor is **read-only, network-free, and safe to run anywhere**. It reads `.git/config` directly
(no `git` binary required) and only honours `hooksPath` declared under the `[core]` section,
matching git's own behaviour (Sprint 50 audit MUST-FIX 2).

**Current checks:**

| Check             | `pass`                                                                                                                              | `warn`                                                                                                                               | `fail`                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `pre-commit hook` | Hook file exists at the configured `hooksPath` and its body contains the `simple-git-hooks.pre-commit` command from `package.json`. | Cwd is not a git working tree, or `package.json` has no `simple-git-hooks.pre-commit` directive (expected for downstream consumers). | Hook file missing, unreadable, or installed but stale (does not reference the configured command). |

**Exit semantics (CI gate):** `pass` or `warn` → exit `0`; `fail` → exit `1` (via `process.exit(1)`
— deterministic, immediate). This is the contract CI gates rely on (see `CONTRIBUTING.md`
§pre-commit).

Sample human output:

```
══════════════════════════════════════════════════
  BonkLM Doctor
══════════════════════════════════════════════════
✓ pre-commit hook
  Pre-commit hook installed at /repo/.git/hooks/pre-commit and references `pnpm typecheck`.

══════════════════════════════════════════════════
  Overall: PASS
══════════════════════════════════════════════════
```

Stale-hook failure:

```
✗ pre-commit hook
  Pre-commit hook installed at /repo/.git/hooks/pre-commit but its body does not reference the configured command (`pnpm typecheck`).
  → package.json was likely updated after the hook was installed. Re-run `pnpm install` to refresh the hook.
```

Sample `--json` output:

```json
{
  "checks": [
    {
      "name": "pre-commit hook",
      "status": "pass",
      "message": "Pre-commit hook installed at /repo/.git/hooks/pre-commit and references `pnpm typecheck`."
    }
  ],
  "overallStatus": "pass"
}
```

## 3. Common flags

The CLI keeps the flag surface tiny. Only the flags below appear in source; anything else (e.g.
`--config`, `--verbose`, `--quiet`, `--no-color`) is **not** supported.

| Flag        | Available on                                           |
| ----------- | ------------------------------------------------------ |
| `--version` | `bonklm` (top-level)                                   |
| `--help`    | `bonklm` and all subcommands (provided by `commander`) |
| `--json`    | `wizard`, `connector test`, `status`, `doctor`         |
| `--force`   | `connector add`                                        |
| `--yes`     | `connector remove`                                     |

## 4. `bonklm-server` (separate binary)

Source: `packages/bonklm-server/src/bin/server.ts`. Full docs in `packages/bonklm-server/README.md`.

**Routes** (POST + HMAC unless noted):

| Route                     | Purpose                                  |
| ------------------------- | ---------------------------------------- |
| `POST /litellm`           | LiteLLM custom-guardrail plugin payloads |
| `POST /portkey`           | Portkey webhook guardrail payloads       |
| `POST /openai-compatible` | Standard OpenAI chat-completion envelope |
| `GET  /healthz`           | Liveness probe (no HMAC required)        |

**Auth:** `X-Bonklm-Signature: sha256=<hex>` + `X-Bonklm-Timestamp: <unix-ms>`. Signature =
`HMAC_SHA256(secret, "${timestamp}.${rawBody}")`. Replay window 5 min (configurable). HMAC secret
**must** be ≥ 32 chars — the server refuses to start otherwise.

**Env vars:**

| Var                       | Default    | Description                                                                                                        |
| ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `BONKLM_HMAC_SECRET`      | (required) | Shared secret, ≥ 32 chars                                                                                          |
| `BONKLM_PORT`             | `4123`     | Listen port                                                                                                        |
| `BONKLM_HOST`             | `0.0.0.0`  | Bind host                                                                                                          |
| `BONKLM_REPLAY_WINDOW_MS` | `300000`   | Replay window (5 min)                                                                                              |
| `BONKLM_PRODUCTION_MODE`  | `true`     | Strip validator reasons from HTTP responses. CLI defaults to `true` (sec v5#13); opt out explicitly for debugging. |

**Quick start:**

```bash
export BONKLM_HMAC_SECRET=$(openssl rand -base64 32)
npx @blackunicorn/bonklm-server
# bonklm-server listening on http://0.0.0.0:4123
```

Sample curl:

```bash
SECRET="$BONKLM_HMAC_SECRET"
BODY='{"data":{"messages":[{"role":"user","content":"hello"}]}}'
TS=$(date +%s%3N)
SIG="sha256=$(echo -n "${TS}.${BODY}" | openssl dgst -sha256 -hmac "${SECRET}" | awk '{print $2}')"
curl -X POST http://localhost:4123/litellm \
  -H "Content-Type: application/json" \
  -H "X-Bonklm-Timestamp: ${TS}" \
  -H "X-Bonklm-Signature: ${SIG}" \
  -d "${BODY}"
```

The default validator stack wired into the CLI entrypoint is `PromptInjectionValidator` +
`MultilingualDetector`. For custom validator wiring, import `createBonklmGuardrailServer` from
`@blackunicorn/bonklm-server` directly.

## 5. Exit codes

From `packages/core/src/cli/utils/error.ts` (`ExitCode` enum):

| Code | Name      | Meaning                                                                        |
| ---- | --------- | ------------------------------------------------------------------------------ |
| `0`  | `SUCCESS` | Command completed; for `doctor`, includes both `pass` and `warn`               |
| `1`  | `ERROR`   | Hard failure (validation, unknown/unconfigured connector, `doctor` FAIL, etc.) |
| `2`  | `PARTIAL` | `connector test` ran but connection or validation failed                       |

`bonklm-server`: exits `1` on missing/short HMAC secret, on bind failure, or on unhandled error.

## 6. Configuration file discovery

**There is no `bonklm.config.{js,ts,json}` file format.** The CLI configures itself by reading and
writing the `.env` file in the current working directory via `EnvManager` (default path `.env`, see
`packages/core/src/cli/config/env.ts`).

Discovery rules (from source):

- Path: `.env` in `process.cwd()` (constructor accepts an override, but no CLI command exposes it).
- Read: parsed with `dotenv.parse()` — returns `{}` if file missing.
- Write: atomic via `mkdtemp()` + `rename()`; mode `0o600` on Unix, inheritance removed on Windows.
- Key validation: `^[a-zA-Z_][a-zA-Z0-9_]*$`. Newlines in values are rejected. Path-traversal
  sequences (`..`) and null bytes are rejected. Max path length: 256 chars.

Credentials are also read from `process.env` for the "existing credentials detected" flow in
`wizard` and `connector add`.

## 7. CI integration

`bonklm doctor` is designed as a CI gate. Recommended usage from `CONTRIBUTING.md`:

```bash
pnpm exec bonklm doctor
```

GitHub Actions snippet (verified against the implemented exit-1 contract):

```yaml
- name: BonkLM doctor
  run: pnpm exec bonklm doctor
# Exit 1 on FAIL fails the job. Exit 0 on PASS / WARN passes.
```

Machine-readable output:

```bash
bonklm doctor --json | jq '.overallStatus'
```

## 8. Troubleshooting

**`command not found: bonklm`** — installed at `node_modules/.bin/bonklm` (workspace) or in the
global bin directory (after `pnpm add -g`). Use `npx @blackunicorn/bonklm`, `pnpm exec bonklm`, or
add `$(pnpm bin -g)` to `PATH`.

**Config not detected / no `.env`** — the CLI reads `.env` from the current working directory. Run
from your project root. There is no upward-search behaviour.

**`Invalid connector ID: <name>`** — `connector add` enforces an allow-list of `openai`,
`anthropic`, `ollama`, `express`, `langchain`. For other ecosystems (e.g. `vercel`, `mastra`),
install the corresponding `@blackunicorn/<connector>-package` per `docs/user/package-matrix.md`.

**`Connector test failed`** — wizard / `connector add` runs a 10s connection test. Common causes:
wrong API key format (OpenAI: `sk-`; Anthropic: `sk-ant-`), local service not running (Ollama
default port), network egress blocked. Pass `--force` to `connector add` to skip the test and write
credentials unconditionally.

**`Pre-commit hook missing` / `does not reference the configured command`** — re-run `pnpm install`
to reinstall the `simple-git-hooks` hook via the project's `prepare` script. `bonklm doctor` will
confirm the fix.

**`bonklm-server: BONKLM_HMAC_SECRET env var REQUIRED and MUST be >= 32 characters`** — generate
with `openssl rand -base64 32` and re-export.

## 9. Deprecated: `@blackunicorn/bonklm-wizard`

The standalone `@blackunicorn/bonklm-wizard` package is **deprecated**. Its `package.json` carries a
`deprecated` field and the package is `private` (not published). The `bonklm` CLI is now shipped
from `@blackunicorn/bonklm` directly.

Migration:

```bash
# Old (deprecated)
pnpm add @blackunicorn/bonklm-wizard

# New
pnpm add @blackunicorn/bonklm
bonklm wizard
```

No CLI flags changed across the merge — the surface documented above is the surface that used to
ship from the wizard package.
