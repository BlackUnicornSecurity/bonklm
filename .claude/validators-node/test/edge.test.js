import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isPathInRepo, resolvePath } from '../lib/paths.js';
import { resolveProjectDir } from '../lib/project-dir.js';
import { validateSecret } from '../lib/validators/secret.js';
import { protectedReason } from '../lib/validators/env-protection.js';
import { findSuspectInstall } from '../lib/validators/supply-chain.js';
import { findPii, luhnValid } from '../lib/validators/pii.js';
import { sensitiveExternalReason, validateOutsideRepo, caseFold } from '../lib/validators/outside-repo.js';
import { validateBashSafety } from '../lib/validators/bash-safety.js';
import { getWriteContent } from '../lib/input.js';
import { validateSettings, REQUIRED_PRETOOLUSE_MATCHERS, REQUIRED_POSTTOOLUSE_MATCHERS } from '../lib/settings-integrity.js';

const REPO = process.cwd();
const AWS_KEY = `AKIA${'ABCDEFGHIJKLMNOP'}`;

describe('coverage edges', () => {
  it('secret falls back to "(write content)" target when no file path', () => {
    const decision = validateSecret({ toolName: 'Write', toolInput: { content: `k="${AWS_KEY}"` } });
    expect(decision.target).toBe('(write content)');
  });

  it('env protectedReason returns null for an empty path', () => {
    expect(protectedReason('')).toBeNull();
  });

  it('supply-chain handles an install command with no package args', () => {
    expect(findSuspectInstall('run npm install')).toBeNull();
  });

  it('pii findPii returns null for empty and clean text', () => {
    expect(findPii('')).toBeNull();
    expect(findPii('just some ordinary code here')).toBeNull();
  });

  it('outside-repo: empty path and gcloud nested + home dotfile', () => {
    expect(sensitiveExternalReason('', REPO, REPO)).toBeNull();
    const gcloud = path.join(os.homedir(), '.config', 'gcloud', 'credentials.db');
    expect(validateOutsideRepo({ toolName: 'Edit', toolInput: { file_path: gcloud }, cwd: REPO }, { projectDir: REPO }).block).toBe(true);
  });

  it('bash-safety: --recursive --force, /bin/rm, and operator break', () => {
    const ctx = { projectDir: REPO };
    const cmd = (command) => ({ toolName: 'Bash', toolInput: { command }, cwd: REPO });
    expect(validateBashSafety(cmd('rm --recursive --force /tmp/elsewhere'), ctx).block).toBe(true);
    expect(validateBashSafety(cmd('/bin/rm -rf /tmp/elsewhere'), ctx).block).toBe(true);
    // '>' ends the rm argument list; 'dist' (in repo) is the only target -> allow.
    expect(validateBashSafety(cmd('rm -rf dist > out.log'), ctx)).toBeNull();
  });

  it('bash-safety: defaults cwd to ctx.projectDir; tolerates an unrelated long flag; blocks a ${} mid-token target', () => {
    const ctx = { projectDir: REPO };
    expect(validateBashSafety({ toolName: 'Bash', toolInput: { command: 'rm -rf /tmp/out' } }, ctx).block).toBe(true);
    expect(validateBashSafety({ toolName: 'Bash', toolInput: { command: 'rm --recursive --force --verbose /tmp/out' }, cwd: REPO }, ctx).block).toBe(true);
    // short flags that lack r / f ('-v') exercise the negative branches before '-rf'
    expect(validateBashSafety({ toolName: 'Bash', toolInput: { command: 'rm -v -rf /tmp/out' }, cwd: REPO }, ctx).block).toBe(true);
    expect(validateBashSafety({ toolName: 'Bash', toolInput: { command: 'rm -rf out${DIR}' }, cwd: REPO }, ctx).block).toBe(true);
  });

  it('outside-repo allows a non-sensitive home file; defaults cwd to ctx.projectDir', () => {
    const file = path.join(os.homedir(), 'scratch-xyz-9183.txt');
    expect(validateOutsideRepo({ toolName: 'Write', toolInput: { file_path: file }, cwd: REPO }, { projectDir: REPO })).toBeNull();
    // no cwd on the payload -> falls back to ctx.projectDir, still blocks ~/.ssh
    const ssh = path.join(os.homedir(), '.ssh', 'authorized_keys');
    expect(validateOutsideRepo({ toolName: 'Write', toolInput: { file_path: ssh } }, { projectDir: REPO }).block).toBe(true);
  });

  it('resolvePath falls back to process.cwd() when cwd is falsy', () => {
    expect(resolvePath('rel/x', '')).toBe(path.resolve(process.cwd(), 'rel/x'));
  });

  it('luhnValid covers the doubled-digit > 9 reduction', () => {
    expect(luhnValid('5555555555554444')).toBe(true);
  });

  it('isPathInRepo matches via the plain-resolved root when the repo root is a symlink', () => {
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-real-'));
    const linkDir = `${realDir}-link`;
    fs.symlinkSync(realDir, linkDir);
    // realpathSync(linkDir) follows the link (and /var->/private), so the in-repo
    // path is matched by the path.resolve(projectDir) form, not the realpath form.
    expect(isPathInRepo(path.join(linkDir, 'sub'), linkDir, linkDir)).toBe(true);
    // A clearly-outside path is rejected against both forms.
    expect(isPathInRepo('/etc/shadow', linkDir, linkDir)).toBe(false);
  });

  it('resolveProjectDir falls back to process.cwd() when no hint and no .claude is found', () => {
    const savedCwd = process.cwd();
    const savedEnv = process.env.CLAUDE_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-cwd-'));
    try {
      process.chdir(tmp);
      expect(resolveProjectDir()).toBe(process.cwd());
    } finally {
      process.chdir(savedCwd);
      if (savedEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedEnv;
    }
  });

  it('settings matcherSet skips null and matcher-less handlers', () => {
    const cmd = { type: 'command', command: 'node x.js' };
    const pre = REQUIRED_PRETOOLUSE_MATCHERS.map((m) => ({ matcher: m, hooks: [cmd, cmd, cmd, cmd, cmd] }));
    pre.push({ hooks: [cmd] }); // handler with no matcher
    pre.push(null); // null handler
    const settings = {
      hooks: {
        SessionStart: [{ hooks: [cmd, cmd] }],
        UserPromptSubmit: [{ hooks: [cmd] }],
        PreToolUse: pre,
        PostToolUse: REQUIRED_POSTTOOLUSE_MATCHERS.map((m) => ({ matcher: m, hooks: [cmd] })),
      },
    };
    expect(validateSettings(settings).valid).toBe(true);
  });

  it('caseFold folds on case-insensitive platforms only', () => {
    expect(caseFold('/ETC/Hosts', 'darwin')).toBe('/etc/hosts');
    expect(caseFold('/ETC/Hosts', 'win32')).toBe('/etc/hosts');
    expect(caseFold('/ETC/Hosts', 'linux')).toBe('/ETC/Hosts');
  });

  it('getWriteContent flattens MultiEdit edits[].new_string', () => {
    const input = { toolInput: { edits: [{ new_string: 'alpha' }, { old_string: 'x' }, null] } };
    expect(getWriteContent(input)).toBe('alpha');
  });
});
