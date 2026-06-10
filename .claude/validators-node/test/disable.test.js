import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDisabled } from '../lib/disable.js';

function tmpProject(withSentinel) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dis-'));
  if (withSentinel) {
    const dir = path.join(root, '.claude', 'validators-node', 'state');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'DISABLED'), '');
  }
  return root;
}

describe('isDisabled', () => {
  const saved = process.env.BONKLM_VALIDATORS_DISABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.BONKLM_VALIDATORS_DISABLED;
    else process.env.BONKLM_VALIDATORS_DISABLED = saved;
  });

  it('is true when the env var is truthy', () => {
    process.env.BONKLM_VALIDATORS_DISABLED = '1';
    expect(isDisabled(tmpProject(false))).toBe(true);
  });

  it('is false for "0" / "false" / unset env and no sentinel', () => {
    const project = tmpProject(false);
    process.env.BONKLM_VALIDATORS_DISABLED = '0';
    expect(isDisabled(project)).toBe(false);
    process.env.BONKLM_VALIDATORS_DISABLED = 'false';
    expect(isDisabled(project)).toBe(false);
    delete process.env.BONKLM_VALIDATORS_DISABLED;
    expect(isDisabled(project)).toBe(false);
  });

  it('is true when the sentinel file exists', () => {
    delete process.env.BONKLM_VALIDATORS_DISABLED;
    expect(isDisabled(tmpProject(true))).toBe(true);
  });

  it('is false (caught) when projectDir is not a valid path', () => {
    delete process.env.BONKLM_VALIDATORS_DISABLED;
    expect(isDisabled(123)).toBe(false);
  });
});
