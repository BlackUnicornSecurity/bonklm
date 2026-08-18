import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
// @ts-expect-error — dependency-free release scripts have no declaration files
import { getAuditJson, main, parseArgs, runCli } from '../scripts/supply-chain-audit.mjs';

const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };

function advisory(moduleName: string, severity: 'low' | 'high' | 'critical', paths: string[], version = '1.0.0') {
  return {
    module_name: moduleName,
    severity,
    patched_versions: '>=2.0.0',
    vulnerable_versions: '<2.0.0',
    title: `${moduleName} advisory`,
    findings: [{ paths, version }]
  };
}

const workspace = {
  root: {
    name: '@blackunicorn/root',
    private: false,
    selected: true,
    deps: { shipped: '1.0.0' },
    opt: {},
    peers: { optional: '1.0.0', required: '1.0.0' },
    peerMeta: { optional: { optional: true } },
    devs: { development: '1.0.0' }
  }
};

describe('supply-chain audit command boundary', () => {
  it('parses every supported command option', () => {
    expect(
      parseArgs(['--input', 'audit.json', '--json', 'report.json', '--level', 'critical', '--root', 'packages/core'])
    ).toEqual({
      input: 'audit.json',
      json: 'report.json',
      level: 'critical',
      roots: ['packages/core']
    });
    expect(parseArgs(['--help'])).toMatchObject({ help: true });
    const error = vi.fn();
    const exit = vi.fn();
    expect(parseArgs(['--unknown'], { error, exit })).toBeNull();
    expect(exit).toHaveBeenCalledWith(2);
    expect(parseArgs(['--level', 'unknown'], { error, exit })).toBeNull();
  });

  it('loads saved, live-success, and advisory-exit audit JSON', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bonklm-audit-input-'));
    onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
    const input = join(directory, 'audit.json');
    const raw = JSON.stringify({ advisories: {}, metadata: { vulnerabilities: counts } });
    writeFileSync(input, raw);
    expect(getAuditJson(input)).toMatchObject({ advisories: {} });
    expect(getAuditJson(null, { run: vi.fn(() => raw) })).toMatchObject({ advisories: {} });
    expect(
      getAuditJson(null, {
        run: vi.fn(() => {
          throw { signal: null, status: 1, stdout: raw };
        })
      })
    ).toMatchObject({ advisories: {} });
  });

  it('fails closed on unexpected audit process exits and signals', () => {
    const raw = JSON.stringify({ advisories: {}, metadata: { vulnerabilities: counts } });
    for (const failure of [
      { signal: null, status: 2, stdout: raw },
      { signal: 'SIGTERM', status: null, stdout: raw },
      { stdout: raw }
    ]) {
      const error = vi.fn();
      const exit = vi.fn();
      expect(
        getAuditJson(null, {
          error,
          exit,
          run: vi.fn(() => {
            throw failure;
          })
        })
      ).toBeNull();
      expect(exit).toHaveBeenCalledWith(2);
      expect(error).toHaveBeenCalledWith('fatal: `pnpm audit --prod --json` did not complete normally');
    }
  });

  it('fails closed when a completed live audit returns absent or malformed output', () => {
    for (const stdout of ['', '{']) {
      const error = vi.fn();
      const exit = vi.fn();
      expect(
        getAuditJson(null, {
          error,
          exit,
          run: vi.fn(() => stdout)
        })
      ).toBeNull();
      expect(exit).toHaveBeenCalledWith(2);
      expect(error).toHaveBeenCalled();
    }
  });

  it('classifies blocking, optional-peer, and non-shipped advisory paths', () => {
    const output = join(mkdtempSync(join(tmpdir(), 'bonklm-audit-report-')), 'report.json');
    onTestFinished(() => rmSync(join(output, '..'), { recursive: true, force: true }));
    const log = vi.fn();
    const exit = vi.fn();
    const audit = {
      advisories: {
        low: advisory('low-module', 'low', ['root > shipped']),
        shipped: advisory('shipped', 'high', ['root > shipped']),
        required: advisory('required', 'high', ['root > required']),
        unknown: advisory('unknown', 'critical', ['root > mystery']),
        optional: advisory('optional', 'high', ['root > optional']),
        development: advisory('development', 'high', ['root > development'])
      },
      metadata: { vulnerabilities: counts }
    };
    const result = main({
      argv: ['--json', output],
      audit,
      closure: new Map([['optional@2.0.0', { name: 'optional' }]]),
      exit,
      log,
      roots: [],
      workspace
    });

    expect(result.shipped.map((entry: { module: string }) => entry.module).sort()).toEqual([
      'required',
      'shipped',
      'unknown'
    ]);
    expect(result.peerSupplied).toMatchObject([{ module: 'optional' }]);
    expect(result.notShipped).toMatchObject([{ module: 'development' }]);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('UNCLASSIFIED'));
  });

  it('reports an optional peer without a shipped-closure overlap', () => {
    const result = main({
      argv: [],
      audit: {
        advisories: {
          zeta: { ...advisory('zeta', 'high', ['root > optional']), title: undefined },
          alpha: advisory('alpha', 'high', ['root > optional'])
        },
        metadata: { vulnerabilities: counts }
      },
      closure: new Map(),
      exit: vi.fn(),
      log: vi.fn(),
      roots: [],
      workspace
    });
    expect(result.peerSupplied).toEqual([
      expect.objectContaining({ module: 'alpha' }),
      expect.objectContaining({ module: 'zeta' })
    ]);
    expect(result.peerSupplied).toEqual(
      expect.arrayContaining([expect.not.objectContaining({ reviewShippedOverlap: true })])
    );
  });

  it('classifies pathless pnpm findings against the independently resolved install closure', () => {
    const exit = vi.fn();
    const result = main({
      argv: [],
      audit: {
        advisories: {
          shipped: advisory('shipped', 'high', []),
          absent: advisory('absent', 'high', [])
        },
        metadata: { vulnerabilities: { ...counts, high: 2 } }
      },
      closure: new Map([['shipped@1.0.0', { name: 'shipped' }]]),
      exit,
      log: vi.fn(),
      roots: [],
      workspace
    });

    expect(result.shipped).toMatchObject([{ module: 'shipped', closureVersions: ['1.0.0'] }]);
    expect(result.notShipped).toMatchObject([{ module: 'absent' }]);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('blocks only the exact vulnerable version present in the independently resolved closure', () => {
    const vulnerableExit = vi.fn();
    const vulnerable = main({
      argv: [],
      audit: {
        advisories: { shared: advisory('shared', 'high', ['root > optional'], '1.0.0') },
        metadata: { vulnerabilities: { ...counts, high: 1 } }
      },
      closure: new Map([['shared@1.0.0', { name: 'shared', version: '1.0.0' }]]),
      exit: vulnerableExit,
      log: vi.fn(),
      roots: [],
      workspace
    });
    expect(vulnerable.shipped).toMatchObject([{ module: 'shared', closureVersions: ['1.0.0'] }]);
    expect(vulnerableExit).toHaveBeenCalledWith(1);

    const patched = main({
      argv: [],
      audit: {
        advisories: { shared: advisory('shared', 'high', ['root > optional'], '1.0.0') },
        metadata: { vulnerabilities: { ...counts, high: 1 } }
      },
      closure: new Map([['shared@2.0.0', { name: 'shared', version: '2.0.0' }]]),
      exit: vi.fn(),
      log: vi.fn(),
      roots: [],
      workspace
    });
    expect(patched.shipped).toEqual([]);
    expect(patched.peerSupplied).toEqual([expect.not.objectContaining({ reviewShippedOverlap: true })]);
  });

  it('permits optional-peer findings and a local critical-only triage floor', () => {
    const error = vi.fn();
    const exit = vi.fn();
    const result = main({
      argv: ['--level', 'critical'],
      audit: {
        advisories: { optional: advisory('optional', 'high', ['root > optional']) },
        metadata: { vulnerabilities: counts }
      },
      closure: new Map(),
      env: {},
      error,
      exit,
      log: vi.fn(),
      roots: [],
      workspace
    });

    expect(result.shipped).toEqual([]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('local triage'));
  });

  it('rejects a relaxed CI floor, prints help, and routes its entrypoint', () => {
    const exit = vi.fn();
    expect(main({ argv: ['--level', 'critical'], env: { CI: 'true' }, exit, error: vi.fn(), log: vi.fn() })).toBeNull();
    expect(exit).toHaveBeenCalledWith(2);
    expect(main({ argv: ['--help'], exit, log: vi.fn() })).toBeNull();
    const run = vi.fn();
    expect(runCli({ argv1: '/other', scriptPath: '/script', run })).toBe(false);
    expect(runCli({ argv1: '/script', scriptPath: '/script', run })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it('stops when argument parsing or audit loading fails and exercises repository defaults', () => {
    expect(main({ argv: ['--unknown'], error: vi.fn(), exit: vi.fn(), log: vi.fn() })).toBeNull();
    expect(
      main({
        auditLoader: vi.fn(() => null),
        argv: [],
        closure: new Map(),
        exit: vi.fn(),
        log: vi.fn(),
        roots: [],
        workspace
      })
    ).toBeNull();
    const exit = vi.fn();
    expect(
      main({
        audit: { advisories: {}, metadata: {} },
        exit,
        log: vi.fn()
      })
    ).toMatchObject({ shipped: [] });
    expect(exit).toHaveBeenCalledWith(0);
  });
});
