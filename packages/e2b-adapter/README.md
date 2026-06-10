# @blackunicorn/bonklm-e2b

**EXPERIMENTAL (Story 3.5)** — E2B Sandbox wrapper for BonkLM. Proxies the four E2B surface
families:

- `commands.run(command)` — code-injection / pip-install / shell metachar / network-egress
  validation.
- `runCode(code)` — Python/JS dynamic-execution detection.
- `files.write(path, content)` — path-traversal + code-injection validation (path required; content
  validated when string).
- `files.{read, remove, list}(path)` — path-traversal validation.

## Top-level warning

> **First-line defense only.** Sandbox isolation (network egress jail, filesystem chroot,
> time/CPU/seccomp limits) is the TRUE containment boundary. BonkLM does not replace E2B's own
> hardening — it cuts the volume of payloads that reach the sandbox. Always run E2B with
> minimum-privilege execution + outbound-network restrictions regardless of this wrapper.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-e2b @e2b/code-interpreter
```

`@e2b/code-interpreter` is an OPTIONAL peer dep — the connector installs without it.

## Quick start

```ts
import { Sandbox } from '@e2b/code-interpreter';
import { wrapSandbox } from '@blackunicorn/bonklm-e2b';

const raw = await Sandbox.create('python-data-science');

const sandbox = wrapSandbox(raw, {
  cwd: '/home/user',
  onSandboxError: 'block', // fail-CLOSED default
  onBlock: event => {
    console.warn(`[bonklm-e2b] ${event.surface} BLOCKED: ${event.reason}`);
  }
});

try {
  // Benign — proxied through.
  await sandbox.commands.run('ls -la /home/user');

  // Blocked — throws E2BGuardrailBlockedError; the underlying
  // sandbox.commands.run is NEVER invoked.
  await sandbox.commands.run('pip install evil-pkg');
} catch (err) {
  if (err.name === 'E2BGuardrailBlockedError') {
    console.error('Blocked:', err.surface, err.category);
  }
}
```

## What gets blocked

- `commands.run` with pip/poetry/gem/cargo/npm install, shell-pipe-to- shell, network egress to
  non-allowlisted hosts, `rm -rf /`, etc.
- `runCode` with dynamic-execution sinks (Python dynamic-call, subprocess, deserialization sinks, JS
  Function constructor / child_process / vm runtime).
- `files.write` with:
  - `..` path traversal (rejected even if it resolves inside cwd)
  - absolute paths outside cwd
  - code-injection sinks in the content (when string)
- `files.{read, remove, list}` with the same path-traversal patterns.

## Fail-CLOSED default

If the validator itself throws or times out, the wrapper defaults to BLOCK. The underlying E2B
operation is NOT invoked. Opt-out via `onSandboxError: 'allow'`:

```ts
const sandbox = wrapSandbox(raw, {
  onSandboxError: 'allow' // fail-OPEN — emits a production warning
});
```

See `@blackunicorn/bonklm-sandbox-utils` README for the production WARN semantics.

## Recall benchmark gate (v0.7)

The `experimental: true` flag in `package.json` is removed at v0.7 contingent on the Story 4.5
graduation gate: **>=95% recall** on the 50-pattern sandbox-attack-corpus hash-pinned at Sprint 16
close (`packages/core/benchmarks/sandbox-attack-corpus/`).

## License

MIT. (c) Black Unicorn Security.
