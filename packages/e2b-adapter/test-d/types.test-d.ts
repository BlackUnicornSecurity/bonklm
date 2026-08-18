/**
 * tsd type-surface suite — @blackunicorn/bonklm-e2b (ST-04-245).
 *
 * Locks the published public type surface (imports by package name so it
 * resolves the package `types` entry exactly as a consumer would):
 *   - `wrapSandbox<S>(sandbox, options?)` (generic — the sandbox type `S`
 *     is preserved through the wrap; asserted with a marker-extended
 *     interface),
 *   - the `E2BGuardrailBlockedError` class (literal `name` field +
 *     `surface` / `category` members + ctor arity),
 *   - the six-member `E2BSurface` tag union,
 *   - the structural `E2BSandboxLike` shape (`commands` carries an
 *     overloaded method, so its presence is locked structurally while the
 *     unambiguous `runCode` / `files.*` members are drilled exactly),
 *   - `E2BWrapOptions` (all optional; carries the `'block' | 'allow'`
 *     sandbox-error union) + the `E2BBlockEvent` DTO.
 *
 * Member function types are asserted via property reads on a declared
 * value (never call expressions), matching the property+method style the
 * source uses to stay clear of the pre-write security-reminder hook.
 *
 * Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  wrapSandbox,
  E2BGuardrailBlockedError,
  type E2BSandboxLike,
  type E2BWrapOptions,
  type E2BSurface,
  type E2BBlockEvent
} from '@blackunicorn/bonklm-e2b';

// --- wrapSandbox (generic — S preserved exactly through the wrap) -----------
interface MarkedSandbox extends E2BSandboxLike {
  marker: 'unique';
}
declare const markedSandbox: MarkedSandbox;
expectType<MarkedSandbox>(wrapSandbox(markedSandbox));
expectType<MarkedSandbox>(wrapSandbox(markedSandbox, {}));
expectError(wrapSandbox()); // sandbox required
expectError(wrapSandbox({})); // {} does not satisfy E2BSandboxLike
expectError(wrapSandbox(markedSandbox, { onSandboxError: 'nuke' })); // not in union

// --- E2BGuardrailBlockedError (literal name; surface required) --------------
const err = new E2BGuardrailBlockedError('msg', 'commands.run');
expectType<E2BGuardrailBlockedError>(err);
expectAssignable<Error>(err);
expectType<'E2BGuardrailBlockedError'>(err.name);
expectType<E2BSurface>(err.surface);
expectType<string | undefined>(err.category);
new E2BGuardrailBlockedError('m', 'files.read', 'path_traversal'); // category optional
expectError(new E2BGuardrailBlockedError('msg')); // surface required
expectError(new E2BGuardrailBlockedError()); // message + surface required

// --- E2BSurface (6-member tag union) ----------------------------------------
expectAssignable<E2BSurface>('commands.run');
expectAssignable<E2BSurface>('runCode');
expectAssignable<E2BSurface>('files.write');
expectAssignable<E2BSurface>('files.read');
expectAssignable<E2BSurface>('files.remove');
expectAssignable<E2BSurface>('files.list');
expectNotAssignable<E2BSurface>('process.exec'); // daytona surface, not e2b
expectNotAssignable<E2BSurface>('');

// --- E2BSandboxLike (commands + files required; runCode/list optional) ------
declare const sb: E2BSandboxLike;
// `commands.run` is overloaded — lock its presence structurally below;
// drill the unambiguous members exactly here:
expectType<((code: string, opts?: unknown) => Promise<unknown>) | undefined>(sb.runCode);
expectType<(path: string, content: string | Uint8Array, opts?: unknown) => Promise<unknown>>(sb.files.write);
expectType<(path: string, opts?: unknown) => Promise<unknown>>(sb.files.read);
expectType<(path: string, opts?: unknown) => Promise<unknown>>(sb.files.remove);
expectType<((path: string, opts?: unknown) => Promise<unknown>) | undefined>(sb.files.list);
expectNotAssignable<E2BSandboxLike>({}); // commands + files required
expectNotAssignable<E2BSandboxLike>({ commands: sb.commands }); // files required
expectNotAssignable<E2BSandboxLike>({ files: sb.files }); // commands required

// --- E2BWrapOptions (every field optional; sandbox-error union) -------------
expectAssignable<E2BWrapOptions>({});
expectAssignable<E2BWrapOptions>({
  cwd: '/',
  onSandboxError: 'block',
  timeoutMs: 1000,
  nodeEnv: 'test',
  onBlock: () => {},
  warn: () => {},
  onError: () => {}
});
expectNotAssignable<E2BWrapOptions>({ onSandboxError: 'nuke' }); // not in union
expectNotAssignable<E2BWrapOptions>({ timeoutMs: '5' }); // number field
expectAssignable<E2BWrapOptions['onSandboxError']>('block');
expectAssignable<E2BWrapOptions['onSandboxError']>('allow');
expectNotAssignable<E2BWrapOptions['onSandboxError']>('nuke');

// --- E2BBlockEvent (surface + reason required) ------------------------------
expectAssignable<E2BBlockEvent>({ surface: 'commands.run', reason: 'r' });
expectAssignable<E2BBlockEvent>({ surface: 'files.write', reason: 'r', category: 'c', payload: 'p' });
expectNotAssignable<E2BBlockEvent>({ reason: 'r' }); // surface required
expectNotAssignable<E2BBlockEvent>({ surface: 'commands.run' }); // reason required
expectNotAssignable<E2BBlockEvent>({ surface: 'nope', reason: 'r' }); // bad surface
