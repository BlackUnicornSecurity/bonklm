import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareBundle } from './release-npm.js';
import {
  buildDeterministicTarGz,
  extractTarGz,
  normalizeManifestText,
  normalizePackedTarball
} from './release-npm-normalize.js';
import { fixture } from './release-npm-test-helpers.js';

const roots = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

function stage(manifest, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bonklm-normalize-test-'));
  roots.push(dir);
  mkdirSync(join(dir, 'package', 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package', 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(dir, 'package', 'dist', 'index.js'), 'export const fixture = true;\n');
  for (const [name, content] of Object.entries(extra)) {
    writeFileSync(join(dir, 'package', name), content);
  }
  return dir;
}

function packWith(manifest, out) {
  const source = stage(manifest);
  execFileSync('tar', ['-czf', out, '-C', source, 'package']);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const baseManifest = dependencies => ({
  name: '@blackunicorn/fixture',
  version: '1.0.0',
  license: 'Apache-2.0',
  dependencies
});

describe('normalizeManifestText', () => {
  it('sorts dependency maps and preserves everything else', () => {
    const input = JSON.stringify(
      {
        name: '@blackunicorn/fixture',
        dependencies: { zed: '1.0.0', alpha: '1.0.0', mid: '2.0.0' },
        optionalDependencies: { zed: '1.0.0', alpha: '1.0.0' },
        peerDependencies: { zed: '>=1', alpha: '>=1' },
        devDependencies: { zed: '1.0.0', alpha: '1.0.0' },
        peerDependenciesMeta: { zed: { optional: true }, alpha: { optional: false } },
        scripts: { build: 'tsc', clean: 'rm -rf dist' }
      },
      null,
      2
    );
    const normalized = JSON.parse(normalizeManifestText(input));
    expect(Object.keys(normalized.dependencies)).toEqual(['alpha', 'mid', 'zed']);
    expect(Object.keys(normalized.optionalDependencies)).toEqual(['alpha', 'zed']);
    expect(Object.keys(normalized.peerDependencies)).toEqual(['alpha', 'zed']);
    expect(Object.keys(normalized.devDependencies)).toEqual(['alpha', 'zed']);
    expect(Object.keys(normalized.peerDependenciesMeta)).toEqual(['alpha', 'zed']);
    expect(Object.keys(normalized.scripts)).toEqual(['build', 'clean']);
    expect(normalizeManifestText(input).endsWith('\n')).toBe(true);
  });

  it('leaves manifests without dependency maps untouched', () => {
    const input = JSON.stringify({ name: 'x', version: '1.0.0' });
    expect(JSON.parse(normalizeManifestText(input))).toEqual({ name: 'x', version: '1.0.0' });
  });

  it('ignores null and non-object dependency fields', () => {
    const manifest = { name: 'x', dependencies: null };
    expect(JSON.parse(normalizeManifestText(JSON.stringify(manifest))).dependencies).toBeNull();
    const arrayValued = { name: 'x', dependencies: ['not', 'a', 'map'] };
    expect(JSON.parse(normalizeManifestText(JSON.stringify(arrayValued))).dependencies).toEqual(['not', 'a', 'map']);
  });
});

describe('normalizePackedTarball', () => {
  it('makes tarball bytes independent of dependency serialization order', () => {
    // Regression: pnpm pack emits workspace deps in resolution order, so two
    // packs of one commit produced different bytes and publish preflight
    // refused the rerun. Remove normalization and this pair stays distinct.
    const out = mkdtempSync(join(tmpdir(), 'bonklm-normalize-out-'));
    roots.push(out);
    const first = join(out, 'first.tgz');
    const second = join(out, 'second.tgz');
    packWith(baseManifest({ '@blackunicorn/b': '1.0.0', '@blackunicorn/a': '1.0.0' }), first);
    packWith(baseManifest({ '@blackunicorn/a': '1.0.0', '@blackunicorn/b': '1.0.0' }), second);
    expect(sha256(first)).not.toBe(sha256(second));
    normalizePackedTarball(first);
    normalizePackedTarball(second);
    expect(sha256(first)).toBe(sha256(second));
  });

  it('is idempotent', () => {
    const out = mkdtempSync(join(tmpdir(), 'bonklm-normalize-out-'));
    roots.push(out);
    const target = join(out, 'pkg.tgz');
    packWith(baseManifest({ b: '1.0.0', a: '1.0.0' }), target);
    normalizePackedTarball(target);
    const once = sha256(target);
    normalizePackedTarball(target);
    expect(sha256(target)).toBe(once);
  });

  it('preserves file contents and modes', () => {
    const out = mkdtempSync(join(tmpdir(), 'bonklm-normalize-out-'));
    roots.push(out);
    const target = join(out, 'pkg.tgz');
    packWith(baseManifest({ b: '1.0.0', a: '1.0.0' }), target);
    normalizePackedTarball(target);
    const read = execFileSync('tar', ['-xzOf', target, 'package/dist/index.js'], { encoding: 'utf8' });
    expect(read).toBe('export const fixture = true;\n');
    const manifest = JSON.parse(execFileSync('tar', ['-xzOf', target, 'package/package.json'], { encoding: 'utf8' }));
    expect(Object.keys(manifest.dependencies)).toEqual(['a', 'b']);
  });

  it('round-trips the executable bit', () => {
    const out = mkdtempSync(join(tmpdir(), 'bonklm-normalize-out-'));
    roots.push(out);
    const target = join(out, 'pkg.tgz');
    const source = stage(baseManifest({}));
    chmodSync(join(source, 'package', 'dist', 'index.js'), 0o755);
    execFileSync('tar', ['-czf', target, '-C', source, 'package']);
    normalizePackedTarball(target);
    const extract = mkdtempSync(join(tmpdir(), 'bonklm-normalize-extract-'));
    roots.push(extract);
    execFileSync('tar', ['-xzf', target, '-C', extract]);
    expect(statSync(join(extract, 'package', 'dist', 'index.js')).mode & 0o777).toBe(0o755);
  });

  it('refuses a symlinked manifest before writing anything', () => {
    const out = mkdtempSync(join(tmpdir(), 'bonklm-normalize-out-'));
    roots.push(out);
    const target = join(out, 'pkg.tgz');
    const victim = join(out, 'victim.json');
    writeFileSync(victim, '{"untouched": true}\n');
    const source = stage(baseManifest({}));
    rmSync(join(source, 'package', 'package.json'));
    execFileSync('ln', ['-s', victim, join(source, 'package', 'package.json')]);
    execFileSync('tar', ['-czf', target, '-C', source, 'package']);
    expect(() => normalizePackedTarball(target)).toThrow(/Unsupported tar entry type/);
    expect(readFileSync(victim, 'utf8')).toBe('{"untouched": true}\n');
  });

  it('rejects entry names that overflow ustar fields in bytes, not chars', () => {
    const out = mkdtempSync(join(tmpdir(), 'bonklm-normalize-out-'));
    roots.push(out);
    const target = join(out, 'pkg.tgz');
    // 50 two-byte chars + .js = 103 bytes in the name field: passes a
    // char-count check (53 units), overflows the 100-byte name field.
    const source = stage(baseManifest({}));
    const multibyte = `dist/${'é'.repeat(50)}.js`;
    writeFileSync(join(source, 'package', multibyte), 'x');
    execFileSync('tar', ['-czf', target, '-C', source, 'package']);
    expect(() => normalizePackedTarball(target)).toThrow(/too long for ustar/);
  });

  it('refuses a manifest that is not a regular file', () => {
    const out = mkdtempSync(join(tmpdir(), 'bonklm-normalize-out-'));
    roots.push(out);
    const target = join(out, 'pkg.tgz');
    const source = mkdtempSync(join(tmpdir(), 'bonklm-normalize-test-'));
    roots.push(source);
    mkdirSync(join(source, 'package', 'package.json'), { recursive: true });
    execFileSync('tar', ['-czf', target, '-C', source, 'package']);
    expect(() => normalizePackedTarball(target)).toThrow(/not a regular file/);
  });
});

describe('buildDeterministicTarGz', () => {
  it('rejects entry types it cannot serialize deterministically', () => {
    const dir = stage({ name: 'x', version: '1.0.0' });
    execFileSync('ln', ['-s', 'dist/index.js', join(dir, 'package', 'link.js')]);
    expect(() => buildDeterministicTarGz(dir)).toThrow(/Unsupported tar entry type/);
  });

  it('rejects names too long for ustar', () => {
    const dir = stage({ name: 'x', version: '1.0.0' });
    writeFileSync(join(dir, 'package', 'dist', `${'f'.repeat(120)}.js`), 'x');
    expect(() => buildDeterministicTarGz(dir)).toThrow(/too long for ustar/);
  });

  it('emits long names via the ustar prefix field', () => {
    const dir = stage({ name: 'x', version: '1.0.0' });
    const longName = `dist/${'mod-'.repeat(20)}index.js`;
    writeFileSync(join(dir, 'package', longName), 'x');
    const buffer = buildDeterministicTarGz(dir);
    const out = join(dir, 'out.tgz');
    writeFileSync(out, buffer);
    const listing = execFileSync('tar', ['-tzf', out], { encoding: 'utf8' });
    expect(listing).toContain(`package/${longName}`);
  });

  it('pads only files whose size is not a 512 multiple', () => {
    const dir = stage({ name: 'x', version: '1.0.0' });
    writeFileSync(join(dir, 'package', 'dist', 'aligned.bin'), Buffer.alloc(512));
    const buffer = buildDeterministicTarGz(dir);
    const out = join(dir, 'out.tgz');
    writeFileSync(out, buffer);
    const read = execFileSync('tar', ['-xzOf', out, 'package/dist/aligned.bin']);
    expect(read.length).toBe(512);
  });

  it('rejects files too large for the ustar size field', () => {
    const dir = stage({ name: 'x', version: '1.0.0' });
    const huge = join(dir, 'package', 'dist', 'huge.bin');
    writeFileSync(huge, 'x');
    // Sparse 9 GiB: stat reports the size, the header writer must fail before
    // any read, and no real disk is consumed on APFS/ext4.
    truncateSync(huge, 9 * 1024 ** 3);
    expect(() => buildDeterministicTarGz(dir)).toThrow(/does not fit tar header field/);
  });

  it('sorts entries by name regardless of creation order', () => {
    const dir = stage({ name: 'x', version: '1.0.0' });
    writeFileSync(join(dir, 'package', 'zzz.txt'), 'z');
    writeFileSync(join(dir, 'package', 'aaa.txt'), 'a');
    const out = join(dir, 'out.tgz');
    writeFileSync(out, buildDeterministicTarGz(dir));
    const listing = execFileSync('tar', ['-tzf', out], { encoding: 'utf8' }).trim().split('\n');
    expect(listing).toEqual([
      'package/',
      'package/aaa.txt',
      'package/dist/',
      'package/dist/index.js',
      'package/package.json',
      'package/zzz.txt'
    ]);
  });
});

function tarEntry(nameBytes, typeflag, content = Buffer.alloc(0)) {
  const header = Buffer.alloc(512);
  Buffer.from(nameBytes).copy(header, 0);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000001234\0', 136);
  header.fill(0x20, 148, 156);
  header.write(typeflag, 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding]);
}

function resignHeader(archive) {
  archive.fill(0x20, 148, 156);
  const checksum = archive.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
  archive.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
  return archive;
}

function archiveOf(...entries) {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

describe('extractTarGz', () => {
  it('rejects a symlinked tree root (round-2 repro)', () => {
    // A tarball whose 'package' entry is a symlink defeated the leaf-level
    // lstat guard: the walk followed it and read/wrote files outside the
    // stage. The reader never materializes links at all.
    const out = mkdtempSync(join(tmpdir(), 'bonklm-normalize-out-'));
    roots.push(out);
    const victim = join(out, 'victim');
    mkdirSync(victim);
    writeFileSync(join(victim, 'package.json'), '{"untouched": true}\n');
    const source = mkdtempSync(join(tmpdir(), 'bonklm-evil-src-'));
    roots.push(source);
    execFileSync('ln', ['-s', victim, join(source, 'package')]);
    const target = join(out, 'evil.tgz');
    execFileSync('tar', ['-czf', target, '-C', source, 'package']);
    expect(() => normalizePackedTarball(target)).toThrow(/Unsupported tar entry type/);
    expect(readFileSync(join(victim, 'package.json'), 'utf8')).toBe('{"untouched": true}\n');
  });

  it('rejects invalid-UTF-8 entry names instead of colliding on U+FFFD', () => {
    const stage = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(stage);
    const archive = archiveOf(tarEntry([0x61, 0xff], '0', Buffer.from('x')));
    expect(() => extractTarGz(archive, stage)).toThrow(/not valid UTF-8/);
  });

  it('rejects duplicate entries', () => {
    const stage = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(stage);
    const archive = archiveOf(
      tarEntry('package/a.txt', '0', Buffer.from('x')),
      tarEntry('package/a.txt', '0', Buffer.from('y'))
    );
    expect(() => extractTarGz(archive, stage)).toThrow(/Duplicate tar entry/);
  });

  it('rejects absolute, drive-letter, and dot-dot entry names', () => {
    const stage = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(stage);
    for (const name of ['/abs.txt', 'C:/win.txt', 'package/../evil.txt']) {
      expect(() => extractTarGz(archiveOf(tarEntry(name, '0', Buffer.from('x'))), stage)).toThrow(
        /Unsafe tar entry name/
      );
    }
  });

  it('honors a PAX path override and rejects malformed PAX records', () => {
    const stage = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(stage);
    const path = 'package/dist/a-very-long-name-that-needs-pax.txt';
    const record = Buffer.from(`${Buffer.byteLength(path) + 9} path=${path}\n`, 'utf8');
    const archive = archiveOf(
      tarEntry('PaxHeader/pkg', 'x', record),
      tarEntry('package/dist/short', '0', Buffer.from('payload'))
    );
    extractTarGz(archive, stage);
    expect(readFileSync(join(stage, path), 'utf8')).toBe('payload');
    expect(() => extractTarGz(archiveOf(tarEntry('PaxHeader/pkg', 'x', Buffer.from('garbage'))), stage)).toThrow(
      /Malformed PAX header record/
    );
    expect(() => extractTarGz(archiveOf(tarEntry('PaxHeader/pkg', 'x', Buffer.from('999 path=x\n'))), stage)).toThrow(
      /Malformed PAX header record/
    );
    expect(() => extractTarGz(archiveOf(tarEntry('PaxHeader/pkg', 'x', Buffer.from('10 novalue\n'))), stage)).toThrow(
      /Malformed PAX header record/
    );
  });

  it('rejects a tree root that is not a directory', () => {
    const out = mkdtempSync(join(tmpdir(), 'bonklm-normalize-out-'));
    roots.push(out);
    const target = join(out, 'flat.tgz');
    writeFileSync(target, archiveOf(tarEntry('package', '0', Buffer.from('not a dir'))));
    expect(() => normalizePackedTarball(target)).toThrow(/not a directory/);
  });

  it('ignores global PAX headers', () => {
    const stage = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(stage);
    const archive = archiveOf(
      tarEntry('PaxGlobalHeader', 'g', Buffer.from('30 comment=global-metadata\n')),
      tarEntry('package/a.txt', '0', Buffer.from('x'))
    );
    extractTarGz(archive, stage);
    expect(readFileSync(join(stage, 'package', 'a.txt'), 'utf8')).toBe('x');
  });

  it('round-trips ustar prefix-field names through its own writer', () => {
    const dir = stage({ name: 'x', version: '1.0.0' });
    const longName = `dist/${'mod-'.repeat(20)}index.js`;
    writeFileSync(join(dir, 'package', longName), 'long-content');
    const reextract = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(reextract);
    extractTarGz(buildDeterministicTarGz(dir), reextract);
    expect(readFileSync(join(reextract, 'package', longName), 'utf8')).toBe('long-content');
  });

  it('rejects entries with a malformed size field', () => {
    const stage = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(stage);
    const entry = tarEntry('package/a.txt', '0', Buffer.from('x'));
    entry.write('not-octal!', 124);
    resignHeader(entry);
    expect(() => extractTarGz(archiveOf(entry), stage)).toThrow(/octal field is malformed/);
  });

  it('escapes backslashes and astral code points in error messages', () => {
    const stage = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(stage);
    expect(() =>
      extractTarGz(
        archiveOf(tarEntry('package/../back\\slash\u2028emoji\ud83d\ude00.txt', '0', Buffer.from('x'))),
        stage
      )
    ).toThrow(/\\\\.*\\u2028.*\\u1f600/);
  });

  it('rejects dot segments, duplicate separators, and backslashes', () => {
    const stage = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(stage);
    for (const name of ['package/./x.txt', 'package//x.txt', 'package\\evil.txt']) {
      expect(() => extractTarGz(archiveOf(tarEntry(name, '0', Buffer.from('x'))), stage)).toThrow(
        /Unsafe tar entry name/
      );
    }
  });

  it('rejects truncated content and bad checksums', () => {
    const stage = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(stage);
    // Declared size exceeds the archive body: header survives (gzip intact),
    // the reader must refuse rather than clamp.
    const oversized = tarEntry('package/a.txt', '0', Buffer.from('x'));
    oversized.write('77777777777\0', 124);
    resignHeader(oversized);
    expect(() => extractTarGz(archiveOf(oversized), stage)).toThrow(/Truncated tar entry content/);
    const badChecksum = tarEntry('package/a.txt', '0', Buffer.from('x'));
    badChecksum.write('0000000\0 ', 148);
    expect(() => extractTarGz(archiveOf(badChecksum), stage)).toThrow(/checksum mismatch/);
  });

  it('round-trips a full 155-byte prefix field', () => {
    const dir = stage({ name: 'x', version: '1.0.0' });
    const longDir = `dist/${'d'.repeat(142)}`;
    mkdirSync(join(dir, 'package', longDir), { recursive: true });
    writeFileSync(join(dir, 'package', longDir, 'f.txt'), 'deep');
    const reextract = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(reextract);
    extractTarGz(buildDeterministicTarGz(dir), reextract);
    expect(readFileSync(join(reextract, 'package', longDir, 'f.txt'), 'utf8')).toBe('deep');
  });

  it('honors GNU long-name entries and rejects unsafe long names', () => {
    const stage = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(stage);
    // GNU tar encodes an over-100-byte name as an 'L' entry whose content is
    // the NUL-terminated name, followed by the real entry with a short stub.
    const longName = `package/dist/${'g'.repeat(110)}.js`;
    const archive = archiveOf(
      tarEntry('././@LongLink', 'L', Buffer.from(`${longName}\0`)),
      tarEntry('package/dist/stub', '0', Buffer.from('gnu-payload'))
    );
    extractTarGz(archive, stage);
    expect(readFileSync(join(stage, longName), 'utf8')).toBe('gnu-payload');
    const evil = archiveOf(
      tarEntry('././@LongLink', 'L', Buffer.from('package/../evil\0')),
      tarEntry('package/dist/stub', '0', Buffer.from('x'))
    );
    expect(() => extractTarGz(evil, stage)).toThrow(/Unsafe tar entry name/);
  });

  it('rejects link entries even behind a GNU long-link header', () => {
    const stage = mkdtempSync(join(tmpdir(), 'bonklm-extract-test-'));
    roots.push(stage);
    const archive = archiveOf(
      tarEntry('././@LongLink', 'K', Buffer.from('/etc/passwd\0')),
      tarEntry('package/link', '2', Buffer.alloc(0))
    );
    expect(() => extractTarGz(archive, stage)).toThrow(/Unsupported tar entry type/);
  });
});

describe('prepareBundle integration', () => {
  it('normalizes dependency order emitted by the packer', () => {
    // Integration half of the regression: if the prepareBundle hook is
    // removed, the packed manifest keeps the packer's unsorted order and the
    // recorded integrity matches the unnormalized bytes.
    const root = fixture();
    roots.push(root);
    const dir = join(root, 'bundle');
    const unsortedPack = (command, args) => {
      expect(command).toBe('pnpm');
      const packageDir = args[1];
      const outputDir = args[args.indexOf('--pack-destination') + 1];
      const stageDir = mkdtempSync(join(tmpdir(), 'bonklm-unsorted-pack-'));
      roots.push(stageDir);
      const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
      manifest.dependencies = { zed: '1.0.0', alpha: '1.0.0' };
      mkdirSync(join(stageDir, 'package', 'dist'), { recursive: true });
      writeFileSync(join(stageDir, 'package', 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
      writeFileSync(join(stageDir, 'package', 'dist', 'index.js'), 'export {};\n');
      const name = packageDir.split('/').pop();
      execFileSync('tar', ['-czf', join(outputDir, `${name}.tgz`), '-C', stageDir, 'package']);
      return '';
    };
    prepareBundle({
      root,
      outputDir: dir,
      version: '1.0.1',
      scope: 'family',
      sourceSha: 'a'.repeat(40),
      expectedFamilySize: 2,
      run: unsortedPack
    });
    const packed = JSON.parse(
      execFileSync('tar', ['-xzOf', join(dir, 'a.tgz'), 'package/package.json'], { encoding: 'utf8' })
    );
    expect(Object.keys(packed.dependencies)).toEqual(['alpha', 'zed']);
  });
});
