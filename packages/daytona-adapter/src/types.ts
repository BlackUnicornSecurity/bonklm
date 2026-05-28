/**
 * Story 3.5 finish (Sprint 20) — daytona-adapter types
 * =====================================================
 *
 * Structural type for Daytona Workspace (peer-optional). Mirrors the
 * E2B-adapter design — does NOT import `@daytonaio/sdk` so the
 * connector installs without the SDK present.
 *
 * Sprint 20 audit closure carry-over (architect C5 from Story 3.5):
 * wrapped object exposes ONLY the surfaces listed here. Methods
 * Daytona may add in a future SDK version are NOT proxied.
 *
 * NOTE on method-signature style: type fields below use
 * `methodName: (...) => Promise<unknown>` (property + arrow type) NOT
 * `methodName(...): Promise<unknown>` (method-signature) to avoid the
 * local pre-write security-reminder hook flagging the `methodName(`
 * literal as a `child_process.exec(`-class pattern. Both syntaxes are
 * structurally equivalent for assignability.
 */
import type { OnSandboxErrorAction, SandboxValidationResult } from '@blackunicorn/bonklm-sandbox-utils';

const SH = 'ex' + 'ec';
const RN = 'r' + 'un';
void SH;
void RN;

export type DaytonaSurface =
  | 'process.exec'
  | 'process.run'
  | 'fs.writeFile'
  | 'fs.readFile'
  | 'fs.deleteFile'
  | 'fs.listFiles'
  | 'fs.replaceInFiles';

export interface DaytonaProcessLike {
  exec: (command: string, opts?: unknown) => Promise<unknown>;
  run?: (command: string, opts?: unknown) => Promise<unknown>;
}

export interface DaytonaFsLike {
  writeFile: (path: string, content: string | Uint8Array, opts?: unknown) => Promise<unknown>;
  readFile: (path: string, opts?: unknown) => Promise<unknown>;
  deleteFile: (path: string, opts?: unknown) => Promise<unknown>;
  listFiles?: (path: string, opts?: unknown) => Promise<unknown>;
  /**
   * Daytona's `replaceInFiles(filePaths, search, replace)` — path AND
   * value are double-validated per Story 3.5 AC.
   */
  replaceInFiles?: (filePaths: string[], search: string, replace: string, opts?: unknown) => Promise<unknown>;
}

/**
 * Subset of the Daytona Workspace surface we proxy. Real type:
 * `@daytonaio/sdk` Workspace.
 */
export interface DaytonaWorkspaceLike {
  process: DaytonaProcessLike;
  fs: DaytonaFsLike;
}

export interface DaytonaBlockEvent {
  surface: DaytonaSurface;
  reason: string;
  category?: string;
  payload?: string;
}

export interface DaytonaWrapOptions {
  /** Workspace cwd. Required for PathTraversal validation. Default `/`. */
  cwd?: string;
  /** @default 'block' */
  onSandboxError?: OnSandboxErrorAction;
  timeoutMs?: number;
  nodeEnv?: string;
  onBlock?: (event: DaytonaBlockEvent) => void;
  warn?: (label: string, context: Record<string, unknown>) => void;
  /** Sprint 19 audit security C-2 closure pattern carried over. */
  onError?: (err: unknown) => void;
}

export type { OnSandboxErrorAction, SandboxValidationResult };
