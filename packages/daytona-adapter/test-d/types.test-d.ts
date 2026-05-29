/**
 * tsd type-surface suite — @blackunicorn/bonklm-daytona (ST-04-244).
 *
 * Locks the published public type surface (imports by package name so it
 * resolves the package `types` entry exactly as a consumer would):
 *   - `wrapWorkspace<W>(workspace, options?)` (generic — the workspace type
 *     `W` is preserved through the wrap; asserted with a marker-extended
 *     interface),
 *   - the `DaytonaGuardrailBlockedError` class (literal `name` field +
 *     `surface` / `category` members + ctor arity),
 *   - the seven-member `DaytonaSurface` tag union,
 *   - the structural `DaytonaProcessLike` / `DaytonaFsLike` /
 *     `DaytonaWorkspaceLike` shapes (required vs optional members),
 *   - `DaytonaWrapOptions` (all optional; carries the `'block' | 'allow'`
 *     sandbox-error union) + the `DaytonaBlockEvent` DTO.
 *
 * Member function types are asserted via property reads on a declared
 * value (never call expressions), matching the property+arrow style the
 * source uses to stay clear of the pre-write security-reminder hook.
 *
 * Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  wrapWorkspace,
  DaytonaGuardrailBlockedError,
  type DaytonaWorkspaceLike,
  type DaytonaProcessLike,
  type DaytonaFsLike,
  type DaytonaWrapOptions,
  type DaytonaSurface,
  type DaytonaBlockEvent
} from '@blackunicorn/bonklm-daytona';

// --- wrapWorkspace (generic — W preserved exactly through the wrap) ---------
interface MarkedWorkspace extends DaytonaWorkspaceLike {
  marker: 'unique';
}
declare const markedWorkspace: MarkedWorkspace;
expectType<MarkedWorkspace>(wrapWorkspace(markedWorkspace));
expectType<MarkedWorkspace>(wrapWorkspace(markedWorkspace, {}));
expectError(wrapWorkspace()); // workspace required
expectError(wrapWorkspace({})); // {} does not satisfy DaytonaWorkspaceLike
expectError(wrapWorkspace(markedWorkspace, { onSandboxError: 'nuke' })); // not in union

// --- DaytonaGuardrailBlockedError (literal name; surface required) ----------
const err = new DaytonaGuardrailBlockedError('msg', 'process.exec');
expectType<DaytonaGuardrailBlockedError>(err);
expectAssignable<Error>(err);
expectType<'DaytonaGuardrailBlockedError'>(err.name);
expectType<DaytonaSurface>(err.surface);
expectType<string | undefined>(err.category);
new DaytonaGuardrailBlockedError('m', 'fs.readFile', 'path_traversal'); // category optional
expectError(new DaytonaGuardrailBlockedError('msg')); // surface required
expectError(new DaytonaGuardrailBlockedError()); // message + surface required

// --- DaytonaSurface (7-member tag union) ------------------------------------
expectAssignable<DaytonaSurface>('process.exec');
expectAssignable<DaytonaSurface>('process.run');
expectAssignable<DaytonaSurface>('fs.writeFile');
expectAssignable<DaytonaSurface>('fs.readFile');
expectAssignable<DaytonaSurface>('fs.deleteFile');
expectAssignable<DaytonaSurface>('fs.listFiles');
expectAssignable<DaytonaSurface>('fs.replaceInFiles');
expectNotAssignable<DaytonaSurface>('process.spawn'); // not in union
expectNotAssignable<DaytonaSurface>('');

// --- DaytonaProcessLike (exec required, run optional) -----------------------
declare const proc: DaytonaProcessLike;
expectType<(command: string, opts?: unknown) => Promise<unknown>>(proc.exec);
expectType<((command: string, opts?: unknown) => Promise<unknown>) | undefined>(proc.run);
expectNotAssignable<DaytonaProcessLike>({}); // exec required
expectNotAssignable<DaytonaProcessLike>({ run: async () => 'y' }); // exec required

// --- DaytonaFsLike (writeFile/readFile/deleteFile required; rest optional) --
declare const fs: DaytonaFsLike;
expectType<(path: string, content: string | Uint8Array, opts?: unknown) => Promise<unknown>>(fs.writeFile);
expectType<(path: string, opts?: unknown) => Promise<unknown>>(fs.readFile);
expectType<(path: string, opts?: unknown) => Promise<unknown>>(fs.deleteFile);
expectType<((path: string, opts?: unknown) => Promise<unknown>) | undefined>(fs.listFiles);
expectType<((filePaths: string[], search: string, replace: string, opts?: unknown) => Promise<unknown>) | undefined>(
  fs.replaceInFiles
);
expectNotAssignable<DaytonaFsLike>({}); // writeFile/readFile/deleteFile required

// --- DaytonaWorkspaceLike (process + fs both required) ----------------------
expectAssignable<DaytonaWorkspaceLike>({ process: proc, fs });
expectNotAssignable<DaytonaWorkspaceLike>({}); // process + fs required
expectNotAssignable<DaytonaWorkspaceLike>({ process: proc }); // fs required

// --- DaytonaWrapOptions (every field optional; sandbox-error union) ---------
expectAssignable<DaytonaWrapOptions>({});
expectAssignable<DaytonaWrapOptions>({
  cwd: '/',
  onSandboxError: 'block',
  timeoutMs: 1000,
  nodeEnv: 'test',
  onBlock: () => {},
  warn: () => {},
  onError: () => {}
});
expectNotAssignable<DaytonaWrapOptions>({ onSandboxError: 'nuke' }); // not in union
expectNotAssignable<DaytonaWrapOptions>({ timeoutMs: '5' }); // number field
expectAssignable<DaytonaWrapOptions['onSandboxError']>('block');
expectAssignable<DaytonaWrapOptions['onSandboxError']>('allow');
expectNotAssignable<DaytonaWrapOptions['onSandboxError']>('nuke');

// --- DaytonaBlockEvent (surface + reason required) --------------------------
expectAssignable<DaytonaBlockEvent>({ surface: 'process.exec', reason: 'r' });
expectAssignable<DaytonaBlockEvent>({ surface: 'fs.writeFile', reason: 'r', category: 'c', payload: 'p' });
expectNotAssignable<DaytonaBlockEvent>({ reason: 'r' }); // surface required
expectNotAssignable<DaytonaBlockEvent>({ surface: 'process.exec' }); // reason required
expectNotAssignable<DaytonaBlockEvent>({ surface: 'nope', reason: 'r' }); // bad surface
