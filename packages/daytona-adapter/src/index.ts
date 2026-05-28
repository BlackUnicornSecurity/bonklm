/**
 * `@blackunicorn/bonklm-daytona` — Daytona Workspace wrapper for BonkLM.
 *
 * **EXPERIMENTAL (Story 3.5)** — flag removal at v0.7 contingent on
 * Story 4.5 recall benchmark.
 *
 * Wires `validateCode` + `validatePath` from `@blackunicorn/bonklm-sandbox-utils`
 * into the Daytona Workspace surface:
 *
 *   - `process.exec` / `process.run` — code validation.
 *   - `fs.writeFile(path, content)` — path + content (when string).
 *   - `fs.{readFile, deleteFile, listFiles}(path)` — path validation only.
 *   - `fs.replaceInFiles(paths[], search, replace)` — paths AND search/replace
 *     values double-validated per Story 3.5 AC.
 *
 * Fail-CLOSED default. See `@blackunicorn/bonklm-sandbox-utils` README
 * for `onSandboxError: 'block' | 'allow'` semantics + AAD-4 WARN
 * production observability.
 */
export { wrapWorkspace, DaytonaGuardrailBlockedError } from './wrap-workspace.js';
export type {
  DaytonaWorkspaceLike,
  DaytonaProcessLike,
  DaytonaFsLike,
  DaytonaWrapOptions,
  DaytonaSurface,
  DaytonaBlockEvent
} from './types.js';
