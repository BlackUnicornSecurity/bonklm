import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveProjectDir } from '../lib/project-dir.js';

describe('resolveProjectDir', () => {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = saved;
  });

  it('prefers $CLAUDE_PROJECT_DIR when set', () => {
    process.env.CLAUDE_PROJECT_DIR = '/from/env';
    expect(resolveProjectDir('/hint')).toBe('/from/env');
  });

  it('walks up to find .claude/settings.json', () => {
    delete process.env.CLAUDE_PROJECT_DIR;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-'));
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{}');
    const deep = path.join(root, 'a', 'b');
    fs.mkdirSync(deep, { recursive: true });
    expect(resolveProjectDir(deep)).toBe(root);
  });

  it('falls back to the hint when no .claude is found up the tree', () => {
    delete process.env.CLAUDE_PROJECT_DIR;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-none-'));
    expect(resolveProjectDir(root)).toBe(root);
  });

  it('uses process.cwd() when no hint is given (repo has .claude/settings.json)', () => {
    delete process.env.CLAUDE_PROJECT_DIR;
    expect(resolveProjectDir()).toBe(process.cwd());
  });
});
