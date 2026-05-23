# @blackunicorn/bonklm-daytona

**EXPERIMENTAL (Story 3.5)** — Daytona Workspace wrapper for BonkLM.
Proxies the Daytona surface:

- `process.exec(cmd)` / `process.run(cmd)` — code-injection / pip-
  install / shell metachar / network-egress validation.
- `fs.writeFile(path, content)` — path-traversal + code-injection
  validation (path required; content validated when string).
- `fs.{readFile, deleteFile, listFiles}(path)` — path-traversal only.
- `fs.replaceInFiles(paths[], search, replace)` — paths AND
  search/replace values double-validated per Story 3.5 AC.

## Top-level warning

> **First-line defense only.** Sandbox isolation (network egress
> jail, filesystem chroot, time/CPU/seccomp limits) is the TRUE
> containment boundary. BonkLM does not replace Daytona's own
> hardening — it cuts the volume of payloads that reach the sandbox.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-daytona @daytonaio/sdk
```

`@daytonaio/sdk` is an OPTIONAL peer dep pinned at `~0.175.0`.

## Quick start

```ts
import { Daytona } from '@daytonaio/sdk';
import { wrapWorkspace } from '@blackunicorn/bonklm-daytona';

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const raw = await daytona.create({ language: 'python' });

const workspace = wrapWorkspace(raw, {
  cwd: '/home/daytona',
  onSandboxError: 'block',
  onBlock: (event) => {
    console.warn(`[bonklm-daytona] ${event.surface} BLOCKED: ${event.reason}`);
  },
});

try {
  await workspace.process.exec('python script.py');
  await workspace.fs.writeFile('output.txt', 'hello world');

  // Blocked — throws DaytonaGuardrailBlockedError.
  await workspace.fs.replaceInFiles(['app.py'], 'safe_value', 'malicious_payload');
} catch (err) {
  if (err.name === 'DaytonaGuardrailBlockedError') {
    console.error('Blocked:', err.surface, err.category);
  }
}
```

## What gets blocked

- `process.exec` / `process.run` with pip / poetry / gem / cargo / npm
  install, shell-pipe-to-shell, network egress, `rm -rf /`, etc.
- `fs.writeFile` with `..` traversal, absolute paths outside cwd, or
  dynamic-execution sinks in string content.
- `fs.{readFile, deleteFile, listFiles}` with the same path patterns.
- `fs.replaceInFiles`:
  - any filePath with traversal patterns
  - search/replace values containing dynamic-execution sinks

## What does NOT get blocked

- Binary `Uint8Array` content (per Story 3.1 audio-stream precedent).
- Future Daytona SDK methods not in `DaytonaWorkspaceLike` — the
  wrapped object exposes ONLY the proxied surfaces.

## Fail-CLOSED default

If the validator throws or times out, the wrapper defaults to BLOCK.
Opt-out via `onSandboxError: 'allow'`. AAD-4 WARN suppression is
per-wrapped-workspace (each `wrapWorkspace` call gets its own
suppression group).

## License

MIT. (c) Black Unicorn Security.
