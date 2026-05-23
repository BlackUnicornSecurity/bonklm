/**
 * `@blackunicorn/bonklm-e2b` — E2B Sandbox wrapper for BonkLM.
 *
 * **EXPERIMENTAL (Story 3.5)** — flag removal at v0.7 contingent on
 * recall benchmark.
 *
 * Wires `validateCode` + `validatePath` from `@blackunicorn/bonklm-sandbox-utils`
 * into the four E2B surface families:
 *
 *   - `commands.run(command)` — code validation.
 *   - `runCode(code)` — code validation (Python/JS interpreter).
 *   - `files.write(path, content)` — BOTH path + content (when string).
 *   - `files.{read,remove,list}(path)` — path validation only.
 *
 * Fail-CLOSED default. See sandbox-utils README for the
 * `onSandboxError: 'block' | 'allow'` semantics.
 */
export { wrapSandbox, E2BGuardrailBlockedError } from './wrap-sandbox.js';
export type {
  E2BSandboxLike,
  E2BWrapOptions,
  E2BSurface,
  E2BBlockEvent,
} from './types.js';
