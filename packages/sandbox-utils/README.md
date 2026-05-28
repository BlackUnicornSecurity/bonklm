# @blackunicorn/bonklm-sandbox-utils

**EXPERIMENTAL (Story 3.5)** — shared sandbox-validation primitives for BonkLM. Consumed by
`@blackunicorn/bonklm-e2b` (E2B Sandbox) and the upcoming `@blackunicorn/bonklm-daytona` (Sprint
20). Direct consumption is also supported for custom sandbox runtimes.

## Top-level warning

> **First-line defense only.** Sandbox isolation (network egress jail, filesystem chroot,
> time/CPU/seccomp limits) is the TRUE containment boundary. BonkLM does not replace sandbox
> hardening — it cuts the volume of payloads that reach the sandbox. Wire `validateCode` /
> `validatePath` / `wrapStream` IN ADDITION TO sandbox isolation, not as a substitute.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-sandbox-utils
```

## API

### `validateCode(code, options?) → Promise<SandboxValidationResult>`

Runs `CodeInjectionValidator` over a code blob. Returns
`{allowed, blocked, reason?, severity?, category?}`.

### `validatePath(path, cwd, options?) → Promise<SandboxValidationResult>`

Runs `PathTraversalValidator` over a path against the supplied cwd.

### `wrapStream(stream, options) → AsyncGenerator`

Wraps any async-iterable string stream (sandbox stdout, file-read output, etc.). Each chunk is
validated against the configured `validators: ('code' | 'path')[]`. On BLOCK, throws
`SandboxStreamBlocked`.

## Fail-CLOSED default

When the underlying validator throws, times out, or returns an indeterminate result, the wrapper
defaults to **BLOCK**:

```ts
const r = await validateCode(code); // validator timeout → BLOCK
// r === { blocked: true, reason: 'sandbox_validator_error', validatorError: true }
```

Opt out via `onSandboxError: 'allow'`:

```ts
const r = await validateCode(code, { onSandboxError: 'allow' });
// r === { allowed: true, reason: 'sandbox_validator_error_allowed' }
```

**Production observability (AAD-4)**: when `onSandboxError: 'allow'` AND
`process.env.NODE_ENV === 'production'`, the helper emits a WARN-severity log via the `warn`
callback ONCE per wrapper instance. Subsequent fail-open events on the same wrapper increment an
internal counter without re-emitting (defeats PagerDuty alert pollution while preserving
visibility). Configure your operator logging to alert on the `BONKLM_SANDBOX_EXPERIMENTAL_FAIL_OPEN`
label.

## Timeouts

`timeoutMs` (default 2000) bounds the per-call validator. `timeoutMs: 0` is a deterministic
"validator unavailable" signal that ALWAYS triggers the `onSandboxError` path — useful for forcing
fail-CLOSED in tests.

## License

MIT. © Black Unicorn Security.
