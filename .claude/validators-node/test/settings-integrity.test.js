import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateSettings,
  countHooks,
  loadAndValidate,
  REQUIRED_PRETOOLUSE_MATCHERS,
  REQUIRED_POSTTOOLUSE_MATCHERS,
} from '../lib/settings-integrity.js';

const CMD = { type: 'command', command: 'node x.js' };

function fullSettings() {
  const pre = REQUIRED_PRETOOLUSE_MATCHERS.map((m) => ({ matcher: m, hooks: [CMD, CMD, CMD, CMD, CMD] }));
  const post = REQUIRED_POSTTOOLUSE_MATCHERS.map((m) => ({ matcher: m, hooks: [CMD] }));
  return {
    hooks: {
      SessionStart: [{ hooks: [CMD, CMD] }],
      UserPromptSubmit: [{ hooks: [CMD] }],
      PreToolUse: pre,
      PostToolUse: post,
    },
  };
}

describe('countHooks', () => {
  it('counts across events, tolerating object and hook-less handlers', () => {
    expect(countHooks({ A: [{ hooks: [1, 2] }], B: { hooks: [3] } })).toBe(3);
    expect(countHooks({ C: [{}] })).toBe(0);
  });
});

describe('validateSettings', () => {
  it('accepts a complete settings object', () => {
    const r = validateSettings(fullSettings());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.stats.matcherCount).toBe(12);
  });

  it('rejects non-objects / missing hooks', () => {
    expect(validateSettings(null).valid).toBe(false);
    expect(validateSettings('x').valid).toBe(false);
    expect(validateSettings({}).valid).toBe(false);
  });

  it('flags a missing required event', () => {
    const s = fullSettings();
    delete s.hooks.PostToolUse;
    const r = validateSettings(s);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('PostToolUse');
  });

  it('flags a missing PreToolUse matcher', () => {
    const s = fullSettings();
    s.hooks.PreToolUse = s.hooks.PreToolUse.filter((h) => h.matcher !== 'Bash');
    expect(validateSettings(s).errors.join(' ')).toContain('"Bash"');
  });

  it('flags a missing PostToolUse matcher', () => {
    const s = fullSettings();
    s.hooks.PostToolUse = s.hooks.PostToolUse.filter((h) => h.matcher !== 'Task');
    expect(validateSettings(s).errors.join(' ')).toContain('"Task"');
  });

  it('flags a hook count below baseline', () => {
    const s = {
      hooks: {
        SessionStart: [{ hooks: [] }],
        UserPromptSubmit: [{ hooks: [] }],
        PreToolUse: REQUIRED_PRETOOLUSE_MATCHERS.map((m) => ({ matcher: m, hooks: [] })),
        PostToolUse: REQUIRED_POSTTOOLUSE_MATCHERS.map((m) => ({ matcher: m, hooks: [] })),
      },
    };
    const r = validateSettings(s);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('< baseline');
  });
});

describe('loadAndValidate', () => {
  it('reports an unreadable file', () => {
    expect(loadAndValidate('/no/such/settings.json').valid).toBe(false);
  });

  it('reports invalid JSON', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'si-')), 's.json');
    fs.writeFileSync(file, '{ not json');
    expect(loadAndValidate(file).errors[0]).toContain('invalid JSON');
  });

  it('accepts a valid settings file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'si2-')), 's.json');
    fs.writeFileSync(file, JSON.stringify(fullSettings()));
    expect(loadAndValidate(file).valid).toBe(true);
  });

  it("accepts this repo's real .claude/settings.json", () => {
    const real = path.join(process.cwd(), '.claude', 'settings.json');
    expect(loadAndValidate(real).valid).toBe(true);
  });
});
