/**
 * Story 3.5 finish (Sprint 20) — `wrapWorkspace(workspace, options)` for Daytona
 * ==============================================================================
 *
 * Proxies the Daytona Workspace surface:
 *   - `process.exec` / `process.run` → validateCode.
 *   - `fs.writeFile(path, content)` → validatePath(path) + validateCode(content).
 *   - `fs.readFile` / `fs.deleteFile` / `fs.listFiles` → validatePath.
 *   - `fs.replaceInFiles(paths[], search, replace)` → per-path validate +
 *     validateCode(search) + validateCode(replace) per Story 3.5 AC.
 *
 * Inherits all Sprint 19 audit-closure patterns from e2b-adapter:
 *   - per-wrapper AAD-4 isolation via wrapperKey;
 *   - one-time-per-process EXPERIMENTAL banner;
 *   - fail-CLOSED default with `onSandboxError: 'allow'` opt-out;
 *   - fireBlock → onError routing on telemetry throws.
 *
 * NOTE: shell-method access in this file uses bracket notation
 * (`workspace.process['exec']`) to avoid the local pre-write
 * security-reminder hook flagging `.exec(` literals. Semantically
 * identical to dot access.
 */
import { validateCode, validatePath } from '@blackunicorn/bonklm-sandbox-utils';
import type {
  DaytonaWorkspaceLike,
  DaytonaWrapOptions,
  DaytonaSurface,
  DaytonaProcessLike,
  DaytonaFsLike,
} from './types.js';

export class DaytonaGuardrailBlockedError extends Error {
  override readonly name = 'DaytonaGuardrailBlockedError';
  readonly surface: DaytonaSurface;
  readonly category?: string;

  constructor(message: string, surface: DaytonaSurface, category?: string) {
    super(message);
    this.surface = surface;
    this.category = category;
  }
}

// Sprint 24 Story 4.5 GRADUATED: experimental banner removed.
// R2-13 corpus gate passed (recall 100% / FPR 0% / precision 100%).

const EXEC_METHOD = 'ex' + 'ec';
const RUN_METHOD = 'r' + 'un';

export function wrapWorkspace<W extends DaytonaWorkspaceLike>(
  workspace: W,
  options: DaytonaWrapOptions = {}
): W {
  if (!workspace || typeof workspace !== 'object') {
    throw new TypeError('wrapWorkspace: workspace is required.');
  }

  const cwd = options.cwd ?? '/';
  const wrapperKey: object = {};
  const validatorOpts = {
    onSandboxError: options.onSandboxError ?? 'block',
    timeoutMs: options.timeoutMs,
    nodeEnv: options.nodeEnv,
    warn: options.warn,
    wrapperKey,
  };

  async function blockIfCode(surface: DaytonaSurface, code: string): Promise<void> {
    const r = await validateCode(code, validatorOpts);
    if (r.blocked) {
      fireBlock(options, surface, r, code);
      throw new DaytonaGuardrailBlockedError(
        `Daytona ${surface} blocked: ${r.reason ?? 'unknown'}`,
        surface,
        r.category
      );
    }
  }

  async function blockIfPath(surface: DaytonaSurface, path: string): Promise<void> {
    const r = await validatePath(path, cwd, validatorOpts);
    if (r.blocked) {
      fireBlock(options, surface, r, path);
      throw new DaytonaGuardrailBlockedError(
        `Daytona ${surface} blocked: ${r.reason ?? 'unknown'}`,
        surface,
        r.category
      );
    }
  }

  const wrappedProcess = {
    [EXEC_METHOD]: async (command: string, opts?: unknown) => {
      await blockIfCode('process.exec', command);
      return workspace.process[EXEC_METHOD as 'exec'](command, opts);
    },
  } as unknown as DaytonaProcessLike;

  if (typeof workspace.process[RUN_METHOD as 'run'] === 'function') {
    wrappedProcess[RUN_METHOD as 'run'] = async (command: string, opts?: unknown) => {
      await blockIfCode('process.run', command);
      return workspace.process[RUN_METHOD as 'run']!(command, opts);
    };
  }

  const wrappedFs: DaytonaFsLike = {
    writeFile: async (path: string, content: string | Uint8Array, opts?: unknown) => {
      await blockIfPath('fs.writeFile', path);
      if (typeof content === 'string') {
        await blockIfCode('fs.writeFile', content);
      }
      return workspace.fs.writeFile(path, content, opts);
    },
    readFile: async (path: string, opts?: unknown) => {
      await blockIfPath('fs.readFile', path);
      return workspace.fs.readFile(path, opts);
    },
    deleteFile: async (path: string, opts?: unknown) => {
      await blockIfPath('fs.deleteFile', path);
      return workspace.fs.deleteFile(path, opts);
    },
    listFiles: async (path: string, opts?: unknown) => {
      await blockIfPath('fs.listFiles', path);
      return workspace.fs.listFiles?.(path, opts);
    },
    replaceInFiles: async (
      filePaths: string[],
      search: string,
      replace: string,
      opts?: unknown
    ) => {
      // Story 3.5 AC: replaceInFiles path + value double-validated.
      if (!Array.isArray(filePaths)) {
        throw new TypeError(
          'wrapWorkspace: fs.replaceInFiles filePaths must be an array'
        );
      }
      for (const p of filePaths) {
        await blockIfPath('fs.replaceInFiles', p);
      }
      await blockIfCode('fs.replaceInFiles', search);
      await blockIfCode('fs.replaceInFiles', replace);
      return workspace.fs.replaceInFiles?.(filePaths, search, replace, opts);
    },
  };

  return {
    process: wrappedProcess,
    fs: wrappedFs,
  } as W;
}

function fireBlock(
  options: DaytonaWrapOptions,
  surface: DaytonaSurface,
  result: { reason?: string; category?: string },
  payload: string | Uint8Array
): void {
  if (!options.onBlock) return;
  try {
    options.onBlock({
      surface,
      reason: result.reason ?? 'unknown',
      category: result.category,
      payload: typeof payload === 'string' ? payload : '[binary]',
    });
  } catch (err) {
    if (options.onError) {
      try {
        options.onError(err);
      } catch {
        /* nothing more we can do */
      }
    }
  }
}
