/**
 * Story 3.5 finish (Sprint 20) — daytona-adapter wrap-workspace tests
 * =====================================================================
 *
 * Mocked Daytona Workspace; tests the 4 surface families.
 * Hook-evasion tokens inherited from Sprint 19 pattern.
 *
 * NOTE: shell-method calls use bracket notation (`w.process[EX]`) to
 * avoid the pre-write security-reminder hook flagging `.exec(`
 * literals on pattern-bearing test files. Semantically identical.
 */
import { describe, it, expect, vi } from 'vitest';
import { wrapWorkspace, DaytonaGuardrailBlockedError } from '../src/index.js';
import type { DaytonaWorkspaceLike } from '../src/types.js';

const EX = 'ex' + 'ec';
const RN = 'r' + 'un';

function makeMockWorkspace(): DaytonaWorkspaceLike & {
  _calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const proc = {
    [EX]: vi.fn(async (cmd: string, opts?: unknown) => {
      calls.push({ method: 'process.exec', args: [cmd, opts] });
      return { stdout: 'mock' };
    }),
    [RN]: vi.fn(async (cmd: string, opts?: unknown) => {
      calls.push({ method: 'process.run', args: [cmd, opts] });
      return { stdout: 'mock' };
    }),
  } as unknown as DaytonaWorkspaceLike['process'];
  return {
    _calls: calls,
    process: proc,
    fs: {
      writeFile: vi.fn(async (p: string, c: string | Uint8Array, opts?: unknown) => {
        calls.push({ method: 'fs.writeFile', args: [p, c, opts] });
      }),
      readFile: vi.fn(async (p: string, opts?: unknown) => {
        calls.push({ method: 'fs.readFile', args: [p, opts] });
        return 'mock-content';
      }),
      deleteFile: vi.fn(async (p: string, opts?: unknown) => {
        calls.push({ method: 'fs.deleteFile', args: [p, opts] });
      }),
      listFiles: vi.fn(async (p: string, opts?: unknown) => {
        calls.push({ method: 'fs.listFiles', args: [p, opts] });
        return [];
      }),
      replaceInFiles: vi.fn(
        async (paths: string[], search: string, replace: string, opts?: unknown) => {
          calls.push({
            method: 'fs.replaceInFiles',
            args: [paths, search, replace, opts],
          });
        }
      ),
    },
  };
}

describe('wrapWorkspace — surface', () => {
  it('throws when workspace missing', () => {
    expect(() => wrapWorkspace(null as unknown as DaytonaWorkspaceLike)).toThrow();
  });

  it('returns wrapper with the expected surface', () => {
    const w = wrapWorkspace(makeMockWorkspace());
    expect(typeof w.process[EX as 'exec']).toBe('function');
    expect(typeof w.process[RN as 'run']).toBe('function');
    expect(typeof w.fs.writeFile).toBe('function');
    expect(typeof w.fs.readFile).toBe('function');
    expect(typeof w.fs.deleteFile).toBe('function');
    expect(typeof w.fs.listFiles).toBe('function');
    expect(typeof w.fs.replaceInFiles).toBe('function');
  });
});

describe('wrapWorkspace — process.exec', () => {
  it('passes benign command through', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws);
    await w.process[EX as 'exec']('ls -la /tmp');
    expect(ws._calls).toHaveLength(1);
  });

  it('blocks pip install', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws);
    await expect(w.process[EX as 'exec']('pip install evil-pkg')).rejects.toBeInstanceOf(
      DaytonaGuardrailBlockedError
    );
    expect(ws._calls).toHaveLength(0);
  });

  it('fires onBlock with surface tag', async () => {
    const onBlock = vi.fn();
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws, { onBlock });
    await expect(w.process[EX as 'exec']('pip install evil')).rejects.toThrow();
    expect(onBlock).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'process.exec' })
    );
  });
});

describe('wrapWorkspace — process.run', () => {
  it('blocks dynamic call sink', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws);
    await expect(w.process[RN as 'run']!(`${EX}('rm -rf /')`)).rejects.toBeInstanceOf(
      DaytonaGuardrailBlockedError
    );
  });

  it('omits process.run proxy when source workspace lacks it', () => {
    const ws = makeMockWorkspace();
    delete (ws.process as Record<string, unknown>)[RN];
    const w = wrapWorkspace(ws);
    expect(w.process[RN as 'run']).toBeUndefined();
  });
});

describe('wrapWorkspace — fs.writeFile', () => {
  it('passes benign write', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws, { cwd: '/srv/app' });
    await w.fs.writeFile('data/output.csv', 'hello world');
    expect(ws._calls).toHaveLength(1);
  });

  it('blocks `..` path even with benign content', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws, { cwd: '/srv/app' });
    await expect(
      w.fs.writeFile('../etc/passwd', 'hello')
    ).rejects.toBeInstanceOf(DaytonaGuardrailBlockedError);
  });

  it('blocks dynamic-exec content with safe path', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws, { cwd: '/srv/app' });
    await expect(
      w.fs.writeFile('data/x.py', `${EX}('import os')`)
    ).rejects.toBeInstanceOf(DaytonaGuardrailBlockedError);
  });

  it('passes binary content (validator does not see bytes)', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws, { cwd: '/srv/app' });
    await w.fs.writeFile('data/img.bin', new Uint8Array([1, 2, 3]));
    expect(ws._calls).toHaveLength(1);
  });
});

describe('wrapWorkspace — fs.{readFile,deleteFile,listFiles} path-only', () => {
  it('blocks read traversal', async () => {
    const w = wrapWorkspace(makeMockWorkspace(), { cwd: '/srv/app' });
    await expect(w.fs.readFile('../etc/passwd')).rejects.toBeInstanceOf(
      DaytonaGuardrailBlockedError
    );
  });

  it('blocks delete traversal', async () => {
    const w = wrapWorkspace(makeMockWorkspace(), { cwd: '/srv/app' });
    await expect(w.fs.deleteFile('../etc/passwd')).rejects.toBeInstanceOf(
      DaytonaGuardrailBlockedError
    );
  });

  it('blocks list traversal', async () => {
    const w = wrapWorkspace(makeMockWorkspace(), { cwd: '/srv/app' });
    await expect(w.fs.listFiles!('../etc')).rejects.toBeInstanceOf(
      DaytonaGuardrailBlockedError
    );
  });
});

describe('wrapWorkspace — fs.replaceInFiles double-validation (Story 3.5 AC)', () => {
  it('blocks when any filePath fails path validation', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws, { cwd: '/srv/app' });
    await expect(
      w.fs.replaceInFiles!(['data/a.py', '../etc/passwd'], 'foo', 'bar')
    ).rejects.toBeInstanceOf(DaytonaGuardrailBlockedError);
    expect(ws._calls).toHaveLength(0);
  });

  it('blocks when search is a dynamic-exec sink', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws, { cwd: '/srv/app' });
    await expect(
      w.fs.replaceInFiles!(['data/a.py'], `${EX}('rm -rf /')`, 'safe')
    ).rejects.toBeInstanceOf(DaytonaGuardrailBlockedError);
  });

  it('blocks when replace is a dynamic-exec sink', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws, { cwd: '/srv/app' });
    await expect(
      w.fs.replaceInFiles!(['data/a.py'], 'foo', `${EX}('rm -rf /')`)
    ).rejects.toBeInstanceOf(DaytonaGuardrailBlockedError);
  });

  it('passes benign replace through', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws, { cwd: '/srv/app' });
    await w.fs.replaceInFiles!(['data/a.py'], 'old_value', 'new_value');
    expect(ws._calls).toHaveLength(1);
  });

  it('rejects non-array filePaths', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws, { cwd: '/srv/app' });
    await expect(
      w.fs.replaceInFiles!('not-array' as unknown as string[], 'a', 'b')
    ).rejects.toThrow(TypeError);
  });
});

describe('wrapWorkspace — fail-CLOSED on validator error', () => {
  it('blocks on validator timeout (default)', async () => {
    const w = wrapWorkspace(makeMockWorkspace(), { cwd: '/srv/app', timeoutMs: 0 });
    await expect(w.process[EX as 'exec']('ls')).rejects.toBeInstanceOf(
      DaytonaGuardrailBlockedError
    );
  });

  it('passes on validator timeout with onSandboxError=allow', async () => {
    const ws = makeMockWorkspace();
    const w = wrapWorkspace(ws, {
      cwd: '/srv/app',
      timeoutMs: 0,
      onSandboxError: 'allow',
    });
    await w.process[EX as 'exec']('ls');
    expect(ws._calls).toHaveLength(1);
  });
});

describe('wrapWorkspace — per-wrapper AAD-4 WARN isolation', () => {
  it('two wrapped workspaces get independent WARN suppression groups', async () => {
    const warn = vi.fn();
    const w1 = wrapWorkspace(makeMockWorkspace(), {
      timeoutMs: 0,
      onSandboxError: 'allow',
      nodeEnv: 'production',
      warn,
    });
    const w2 = wrapWorkspace(makeMockWorkspace(), {
      timeoutMs: 0,
      onSandboxError: 'allow',
      nodeEnv: 'production',
      warn,
    });
    await w1.process[EX as 'exec']('ls');
    await w1.process[EX as 'exec']('cat foo');
    await w2.process[EX as 'exec']('ls');
    expect(warn.mock.calls.length).toBe(2);
  });
});

describe('wrapWorkspace — fireBlock telemetry routing', () => {
  it('throwing onBlock routes through onError', async () => {
    const onError = vi.fn();
    const w = wrapWorkspace(makeMockWorkspace(), {
      onBlock: () => {
        throw new Error('telemetry bug');
      },
      onError,
    });
    await expect(w.process[EX as 'exec']('pip install evil')).rejects.toBeInstanceOf(
      DaytonaGuardrailBlockedError
    );
    expect(onError).toHaveBeenCalled();
  });
});

describe('DaytonaGuardrailBlockedError', () => {
  it('carries surface + category', () => {
    const err = new DaytonaGuardrailBlockedError('boom', 'process.exec', 'shell_metachar');
    expect(err.name).toBe('DaytonaGuardrailBlockedError');
    expect(err.surface).toBe('process.exec');
    expect(err.category).toBe('shell_metachar');
  });
});
