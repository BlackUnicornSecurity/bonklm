/**
 * `bonklm-doctor` CLI shim tests (Story 1.8 Construct D — Sprint 12 wiring).
 *
 * Exercises the testable surface of `src/doctor-cli.ts` (the logic the
 * `src/bin/doctor.ts` shebang entry delegates to) through an injected IO
 * seam — no real filesystem, no `process.exit`, no spawned subprocess.
 *
 * Coverage intent: every branch of arg-parsing, file reading, plugin
 * normalisation, rendering, the output-sanitisation contract, and the
 * 0/1/2 exit-code matrix.
 */
import { describe, expect, it } from 'vitest';
import {
  CliInputError,
  MAX_INPUT_BYTES,
  MAX_INPUT_DEPTH,
  MAX_PLUGIN_NAME_LENGTH,
  USAGE,
  main,
  normalizePlugins,
  parseArgs,
  readVersion,
  renderHuman,
  renderJson,
  type CliIo
} from '../src/doctor-cli.js';
import type { DoctorReport } from '../src/types.js';

const ESC = String.fromCharCode(27); // U+001B escape — ANSI-injection probe (no raw control byte in source)

/**
 * In-memory IO double. `files` maps a path (matched exactly or by suffix)
 * to its text content. `sizes` optionally overrides the reported byte size
 * so the too-large branch can be exercised without allocating a huge string.
 */
function makeIo(files: Record<string, string>, sizes: Record<string, number> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const resolve = (p: string): string | undefined => {
    if (p in files) return files[p];
    const key = Object.keys(files).find(k => p.endsWith(k));
    return key === undefined ? undefined : files[key];
  };
  const io: CliIo = {
    readFileText(p) {
      const text = resolve(p);
      if (text === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return text;
    },
    fileSize(p) {
      if (p in sizes) return sizes[p];
      const sizeKey = Object.keys(sizes).find(k => p.endsWith(k));
      if (sizeKey !== undefined) return sizes[sizeKey];
      const text = resolve(p);
      if (text === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return Buffer.byteLength(text, 'utf8');
    },
    write(t) {
      out.push(t);
    },
    writeError(t) {
      err.push(t);
    }
  };
  return { io, out: () => out.join(''), err: () => err.join('') };
}

const CLEAN_CHARACTER = JSON.stringify({ system: 'You are a helpful assistant for a web3 wallet agent.' });
const SECRET_CHARACTER = JSON.stringify({
  system: 'You are a helpful assistant.',
  bio: 'my key is sk-ant-abc1234567 do not share'
});

describe('parseArgs', () => {
  it('parses a single required positional', () => {
    expect(parseArgs(['character.json'])).toEqual({
      kind: 'run',
      characterPath: 'character.json',
      pluginsPath: undefined,
      json: false
    });
  });

  it('parses both positionals plus --json', () => {
    expect(parseArgs(['c.json', 'p.json', '--json'])).toEqual({
      kind: 'run',
      characterPath: 'c.json',
      pluginsPath: 'p.json',
      json: true
    });
  });

  it('treats --help / -h as help regardless of other args', () => {
    expect(parseArgs(['--help']).kind).toBe('help');
    expect(parseArgs(['c.json', '-h']).kind).toBe('help');
  });

  it('treats --version / -V as version', () => {
    expect(parseArgs(['--version']).kind).toBe('version');
    expect(parseArgs(['-V']).kind).toBe('version');
  });

  it('errors on a missing required positional', () => {
    const parsed = parseArgs(['--json']);
    expect(parsed.kind).toBe('error');
    expect(parsed.message).toMatch(/character\.json/);
  });

  it('errors on an unknown option', () => {
    const parsed = parseArgs(['--bogus', 'c.json']);
    expect(parsed.kind).toBe('error');
    expect(parsed.message).toMatch(/Unknown option/);
  });

  it('errors on too many positionals', () => {
    const parsed = parseArgs(['a', 'b', 'c']);
    expect(parsed.kind).toBe('error');
    expect(parsed.message).toMatch(/Too many/);
  });
});

describe('normalizePlugins', () => {
  it('accepts an array of strings', () => {
    expect(normalizePlugins(['@elizaos/plugin-solana'])).toEqual([{ name: '@elizaos/plugin-solana' }]);
  });

  it('accepts an array of objects with a name', () => {
    expect(normalizePlugins([{ name: '@x/p', priority: 5 }])).toEqual([{ name: '@x/p' }]);
  });

  it('accepts an object with a plugins array', () => {
    expect(normalizePlugins({ plugins: ['@x/p'] })).toEqual([{ name: '@x/p' }]);
  });

  it('skips entries without a string name', () => {
    expect(normalizePlugins(['@x/p', 42, { noName: true }, { name: 7 }])).toEqual([{ name: '@x/p' }]);
  });

  it('throws CliInputError on a non-list shape', () => {
    expect(() => normalizePlugins(42)).toThrow(CliInputError);
    expect(() => normalizePlugins({ nope: true })).toThrow(CliInputError);
  });
});

describe('renderJson / renderHuman — output-sanitisation contract', () => {
  const hostileReport: DoctorReport = {
    findings: [
      {
        severity: 'MEDIUM',
        category: 'plugin_not_in_allowlist',
        description: `Plugin @evil/${ESC}[31mspoof is not in the verified-publisher allowlist.`,
        pluginName: `@evil/${ESC}[31mspoof`
      }
    ],
    criticalCount: 0,
    exitCode: 0
  };

  it('renderJson strips raw control/ANSI bytes and stays valid JSON', () => {
    const json = renderJson(hostileReport);
    expect(json).not.toContain(ESC);
    const parsed = JSON.parse(json) as DoctorReport;
    expect(parsed.exitCode).toBe(0);
    expect(parsed.findings[0].category).toBe('plugin_not_in_allowlist');
  });

  it('renderHuman strips raw control/ANSI bytes', () => {
    const human = renderHuman(hostileReport);
    expect(human).not.toContain(ESC);
    expect(human).toContain('[MEDIUM]');
  });

  it('renderHuman reports a clean run', () => {
    const clean: DoctorReport = { findings: [], criticalCount: 0, exitCode: 0 };
    expect(renderHuman(clean)).toMatch(/No findings/);
  });
});

describe('readVersion', () => {
  it('returns the package version from package.json', () => {
    const { io } = makeIo({ 'package.json': JSON.stringify({ version: '9.9.9-test' }) });
    expect(readVersion(io)).toBe('9.9.9-test');
  });

  it('falls back to "unknown" when package.json is unreadable', () => {
    const { io } = makeIo({});
    expect(readVersion(io)).toBe('unknown');
  });
});

describe('main — exit-code matrix', () => {
  it('clean character → exit 0', async () => {
    const { io, out } = makeIo({ 'character.json': CLEAN_CHARACTER });
    const code = await main(['character.json'], io);
    expect(code).toBe(0);
    expect(out()).toMatch(/BonkLM Doctor/);
  });

  it('plaintext secret → CRITICAL → exit 1', async () => {
    const { io, out } = makeIo({ 'character.json': SECRET_CHARACTER });
    const code = await main(['character.json'], io);
    expect(code).toBe(1);
    expect(out()).toContain('[CRITICAL]');
    expect(out()).toContain('character_plaintext_secret');
  });

  it('typo-squat plugin → CRITICAL → exit 1', async () => {
    const { io } = makeIo({
      'character.json': CLEAN_CHARACTER,
      'plugins.json': JSON.stringify(['@elizaos/plugin-soIana'])
    });
    const code = await main(['character.json', 'plugins.json'], io);
    expect(code).toBe(1);
  });

  it('plugin not in allowlist → MEDIUM only → exit 0', async () => {
    const { io, out } = makeIo({
      'character.json': CLEAN_CHARACTER,
      'plugins.json': JSON.stringify(['@random/unrelated-plugin'])
    });
    const code = await main(['character.json', 'plugins.json'], io);
    expect(code).toBe(0);
    expect(out()).toContain('plugin_not_in_allowlist');
  });

  it('--json emits parseable JSON with the findings', async () => {
    const { io, out } = makeIo({ 'character.json': SECRET_CHARACTER });
    const code = await main(['character.json', '--json'], io);
    expect(code).toBe(1);
    const parsed = JSON.parse(out()) as DoctorReport;
    expect(parsed.criticalCount).toBe(1);
    expect(parsed.exitCode).toBe(1);
  });

  it('--help → usage, exit 0, no audit', async () => {
    const { io, out } = makeIo({});
    const code = await main(['--help'], io);
    expect(code).toBe(0);
    expect(out()).toContain('Usage:');
  });

  it('--version → version string, exit 0', async () => {
    const { io, out } = makeIo({ 'package.json': JSON.stringify({ version: '1.2.3-rc.test' }) });
    const code = await main(['--version'], io);
    expect(code).toBe(0);
    expect(out()).toContain('1.2.3-rc.test');
  });

  it('missing required argument → exit 2 + usage on stderr', async () => {
    const { io, err } = makeIo({});
    const code = await main([], io);
    expect(code).toBe(2);
    expect(err()).toContain('Usage:');
  });

  it('unknown option → exit 2 (and ANSI in the bad arg is sanitised)', async () => {
    const { io, err } = makeIo({});
    const code = await main([`--x${ESC}[31m`], io);
    expect(code).toBe(2);
    expect(err()).not.toContain(ESC);
  });

  it('missing input file → exit 2', async () => {
    const { io, err } = makeIo({});
    const code = await main(['nope.json'], io);
    expect(code).toBe(2);
    expect(err()).toMatch(/cannot read/);
  });

  it('invalid JSON → exit 2', async () => {
    const { io } = makeIo({ 'character.json': '{ not json' });
    const code = await main(['character.json'], io);
    expect(code).toBe(2);
  });

  it('character that is not a JSON object → exit 2', async () => {
    const { io, err } = makeIo({ 'character.json': JSON.stringify(['array', 'not', 'object']) });
    const code = await main(['character.json'], io);
    expect(code).toBe(2);
    expect(err()).toMatch(/JSON object/);
  });

  it('oversized input → exit 2', async () => {
    const { io, err } = makeIo({ 'character.json': CLEAN_CHARACTER }, { 'character.json': MAX_INPUT_BYTES + 1 });
    const code = await main(['character.json'], io);
    expect(code).toBe(2);
    expect(err()).toMatch(/too large/);
  });

  it('invalid plugins file shape → exit 2', async () => {
    const { io } = makeIo({
      'character.json': CLEAN_CHARACTER,
      'plugins.json': JSON.stringify(42)
    });
    const code = await main(['character.json', 'plugins.json'], io);
    expect(code).toBe(2);
  });

  it('proto-pollution payload in character does not pollute Object.prototype', async () => {
    const { io } = makeIo({
      'character.json': '{ "__proto__": { "polluted": true }, "system": "You are a helpful assistant." }'
    });
    const code = await main(['character.json'], io);
    expect(code).toBe(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('USAGE constant', () => {
  it('documents the exit-code matrix', () => {
    expect(USAGE).toContain('Exit codes:');
    expect(USAGE).toContain('bonklm-doctor');
  });
});

describe('audit-loop hardening (Sprint 54)', () => {
  it('parseArgs: treats arguments after -- as positionals', () => {
    expect(parseArgs(['--', '--json', 'c.json'])).toEqual({
      kind: 'run',
      characterPath: '--json',
      pluginsPath: 'c.json',
      json: false
    });
  });

  it('parseArgs: a lone "-" is a positional, not an unknown option', () => {
    expect(parseArgs(['-']).kind).toBe('run');
  });

  it('normalizePlugins: skips absurdly long plugin names (CPU guard)', () => {
    const longName = `@evil/${'a'.repeat(MAX_PLUGIN_NAME_LENGTH + 1)}`;
    expect(normalizePlugins([longName, '@elizaos/plugin-solana'])).toEqual([{ name: '@elizaos/plugin-solana' }]);
  });

  it('main: rejects pathologically deep input with exit 2 (no stack overflow)', async () => {
    const depth = MAX_INPUT_DEPTH + 50;
    const deep = `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;
    const { io, err } = makeIo({ 'character.json': deep });
    const code = await main(['character.json'], io);
    expect(code).toBe(2);
    expect(err()).toMatch(/depth/);
  });

  it('main: re-throws an unexpected (non-CliInputError) fault rather than swallowing it', async () => {
    const { io } = makeIo({ 'character.json': CLEAN_CHARACTER });
    const badIo: CliIo = {
      ...io,
      write() {
        throw new Error('stdout exploded');
      }
    };
    await expect(main(['character.json'], badIo)).rejects.toThrow('stdout exploded');
  });

  it('renderJson/renderHuman strip C1 control bytes (U+009B 8-bit CSI)', () => {
    const csi = String.fromCharCode(0x9b);
    const report: DoctorReport = {
      findings: [
        { severity: 'MEDIUM', category: 'plugin_not_in_allowlist', description: `x${csi}31m`, pluginName: `p${csi}` }
      ],
      criticalCount: 0,
      exitCode: 0
    };
    expect(renderJson(report)).not.toContain(csi);
    expect(renderHuman(report)).not.toContain(csi);
  });
});
