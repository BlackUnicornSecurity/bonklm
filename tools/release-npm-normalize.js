import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

// `pnpm pack` rewrites workspace-protocol dependencies concurrently and emits
// them in resolution order, so two packs of the same commit can serialize the
// dependency maps differently. A release rerun then produces bytes that do not
// match the registry's, and publish preflight (correctly) refuses to touch the
// mismatched slots. Re-serializing the packed manifest with sorted dependency
// keys and rebuilding the tarball with fixed metadata makes the bundle bytes
// deterministic.
//
// Determinism is guaranteed for reruns on the same runner family: the deflate
// stream depends on the linked zlib build and the gzip OS byte follows the
// host platform, and extracted file modes pass through the process umask. The
// publish lane always packs and repacks on the same CI image, so this holds;
// do not compare bundle bytes across operating systems.
//
// Extraction is deliberately NOT delegated to a system tar: GNU tar follows
// in-archive symlinks during extraction, and any extractor creates whatever
// entry types the archive names. This reader materializes only plain files and
// directories, so nothing under the stage can ever be a link.

const DEPENDENCY_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
  'peerDependenciesMeta'
];

// npm's reproducible-pack convention (1985-10-26T08:15:00Z): fixed so bundle
// bytes do not depend on when the release ran.
const TAR_MTIME = 499162500;

// Entry names come from the packed archive, so they are archive-influenceable:
// escape anything outside printable ASCII before putting one in an error
// (ADR-0001 log-injection rule; tools stay dependency-free so this inlines the
// escape instead of importing core's sanitizeLogString).
function archiveName(value) {
  const escaped = [...value]
    .map(char => {
      const code = char.codePointAt(0);
      if (char === '\\') return '\\\\';
      if (code >= 0x20 && code <= 0x7e) return char;
      return code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`;
    })
    .join('');
  return escaped.length > 200 ? `${escaped.slice(0, 200)}…[truncated]` : escaped;
}

function sortedObject(record) {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map(key => [key, record[key]])
  );
}

export function normalizeManifestText(text) {
  const manifest = JSON.parse(text);
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];
    if (dependencies === undefined || dependencies === null) continue;
    if (Array.isArray(dependencies) || typeof dependencies !== 'object') continue;
    manifest[field] = sortedObject(dependencies);
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function octal(value, width) {
  const digits = value.toString(8);
  if (digits.length > width - 1) {
    throw new Error(`Value does not fit tar header field of width ${width}: ${value}`);
  }
  return `${digits.padStart(width - 1, '0')}\0`;
}

function tarHeader(name, { size, mode, typeflag }) {
  const buffer = Buffer.alloc(512);
  const prefixSplit = value => {
    if (Buffer.byteLength(value) <= 100) return { name: value, prefix: '' };
    const cut = value.lastIndexOf('/', 155);
    if (cut < 1 || Buffer.byteLength(value.slice(0, cut)) > 155 || Buffer.byteLength(value.slice(cut + 1)) > 100) {
      throw new Error(`Tar entry name too long for ustar: ${archiveName(value)}`);
    }
    return { name: value.slice(cut + 1), prefix: value.slice(0, cut) };
  };
  const { name: shortName, prefix } = prefixSplit(name);
  buffer.write(shortName, 0, 100);
  buffer.write(octal(mode, 8), 100);
  buffer.write(octal(0, 8), 108);
  buffer.write(octal(0, 8), 116);
  buffer.write(octal(size, 12), 124);
  buffer.write(octal(TAR_MTIME, 12), 136);
  buffer.fill(0x20, 148, 156);
  buffer.write(typeflag, 156);
  buffer.write('ustar\0', 257);
  buffer.write('00', 263);
  buffer.write(prefix, 345, 155);
  const checksum = buffer.reduce((sum, byte) => sum + byte, 0);
  buffer.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
  return buffer;
}

function parseOctalField(bytes) {
  const text = bytes.toString('latin1').replace(/[\0 ]+$/, '');
  if (!/^[0-7]+$/.test(text)) throw new Error('Tar header octal field is malformed');
  return parseInt(text, 8);
}

// Decode a header name field to a JS string, rejecting names that do not
// survive a UTF-8 round-trip (invalid bytes would decode to U+FFFD and two
// distinct archive entries could collapse to one filesystem name).
function decodeName(bytes) {
  const end = bytes.indexOf(0);
  const nameBytes = end === -1 ? bytes : bytes.subarray(0, end);
  const name = nameBytes.toString('utf8');
  if (!Buffer.from(name, 'utf8').equals(Buffer.from(nameBytes))) {
    throw new Error(`Tar entry name is not valid UTF-8: ${archiveName(name)}`);
  }
  return name;
}

function entryName(header) {
  const prefixBytes = header.subarray(345, 500);
  const nameBytes = header.subarray(0, 100);
  const hasPrefix = prefixBytes[0] !== 0;
  // A full 155-byte prefix field carries no NUL terminator.
  const prefixEnd = prefixBytes.indexOf(0);
  const joined = hasPrefix
    ? Buffer.concat([prefixBytes.subarray(0, prefixEnd === -1 ? 155 : prefixEnd), Buffer.from('/', 'utf8'), nameBytes])
    : nameBytes;
  return decodeName(joined);
}

function verifyChecksum(header) {
  const stored = parseOctalField(header.subarray(148, 156));
  const sum = header.reduce((acc, byte, index) => (index >= 148 && index < 156 ? acc + 0x20 : acc + byte), 0);
  if (stored !== sum) throw new Error('Tar header checksum mismatch');
}

function assertSafeEntryName(name) {
  // Backslash is rejected outright: a POSIX-only allowlist would traverse on
  // win32, and no npm packer emits it. Control characters are rejected so no
  // downstream fs error can carry them into logs unescaped.
  if (
    name.length === 0 ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.includes('\\') ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(name) ||
    name.split('/').includes('..') ||
    name.split('/').includes('.') ||
    name.includes('//')
  ) {
    throw new Error(`Unsafe tar entry name: ${archiveName(name)}`);
  }
}

// PAX extended headers carry long/non-ASCII names. Only the path override is
// honored — timestamps and ownership are normalized away on rebuild anyway,
// and link targets are rejected with their entry type.
function parsePaxPath(content) {
  let path = null;
  for (let offset = 0; offset < content.length; ) {
    const space = content.indexOf(0x20, offset);
    if (space === -1) throw new Error('Malformed PAX header record');
    const length = parseInt(content.subarray(offset, space).toString('latin1'), 10);
    if (!Number.isInteger(length) || length < 3 || offset + length > content.length) {
      throw new Error('Malformed PAX header record');
    }
    const record = content.subarray(space + 1, offset + length - 1);
    const equals = record.indexOf(0x3d);
    if (equals === -1) throw new Error('Malformed PAX header record');
    if (record.subarray(0, equals).toString('latin1') === 'path') {
      path = decodeName(record.subarray(equals + 1));
    }
    offset += length;
  }
  return path;
}

export function extractTarGz(archive, stage) {
  // 4 GiB decompressed cap: the largest BonkLM package is megabytes, and an
  // unbounded gunzip turns a small hostile .tgz into a memory exhaustion.
  const data = gunzipSync(archive, { maxOutputLength: 4 * 1024 ** 3 });
  const seen = new Set();
  let paxPath = null;
  let gnuLongName = null;
  for (let offset = 0; offset + 512 <= data.length; offset += 512) {
    const header = data.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    verifyChecksum(header);
    const typeflag = String.fromCharCode(header[156]);
    const size = parseOctalField(header.subarray(124, 136));
    if (offset + 512 + size > data.length) throw new Error('Truncated tar entry content');
    const content = data.subarray(offset + 512, offset + 512 + size);
    offset += Math.ceil(size / 512) * 512;
    if (typeflag === 'x') {
      paxPath = parsePaxPath(content);
      continue;
    }
    if (typeflag === 'g') {
      // GNU semantics bind a captured long name to the very next header, so a
      // global header consumes it; PAX paths intentionally persist past 'g'.
      gnuLongName = null;
      continue;
    }
    // GNU long-name/long-link extensions (bsdtar emits PAX instead): capture
    // the name for the next entry; a link entry then fails its type check.
    if (typeflag === 'L') {
      gnuLongName = decodeName(content);
      continue;
    }
    if (typeflag === 'K') continue;
    // PAX wins over a GNU long name when both are set: mixed-extension archives
    // are pathological, and either candidate is validated identically below.
    const name = paxPath ?? gnuLongName ?? entryName(header);
    paxPath = null;
    gnuLongName = null;
    assertSafeEntryName(name);
    if (seen.has(name)) throw new Error(`Duplicate tar entry: ${archiveName(name)}`);
    seen.add(name);
    const target = join(stage, name);
    if (typeflag === '5') {
      mkdirSync(target, { recursive: true });
    } else if (typeflag === '0' || typeflag === '\0') {
      mkdirSync(dirname(target), { recursive: true });
      // Clamped to 0o755: archives never need group/other-writable files, and
      // collectEntries propagates these modes into the rebuilt tarball.
      writeFileSync(target, content, { mode: parseOctalField(header.subarray(100, 108)) & 0o755 });
    } else {
      throw new Error(`Unsupported tar entry type: ${archiveName(name)}`);
    }
  }
}

function collectEntries(stage, dir = 'package', out = []) {
  for (const entry of readdirSync(join(stage, dir), { withFileTypes: true })) {
    const name = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push({ name: `${name}/`, typeflag: '5', mode: 0o755, size: 0 });
      collectEntries(stage, name, out);
    } else if (entry.isFile()) {
      const stat = statSync(join(stage, name));
      out.push({ name, typeflag: '0', mode: stat.mode & 0o777, size: stat.size });
    } else {
      throw new Error(`Unsupported tar entry type: ${archiveName(name)}`);
    }
  }
  return out;
}

// Defense in depth under the pure-reader extraction (which never creates
// links): the root must be a real directory and the manifest a real file.
function assertPlainTree(stage) {
  if (!lstatSync(join(stage, 'package')).isDirectory()) {
    throw new Error('Packed tree root is not a directory');
  }
  collectEntries(stage);
  const manifestPath = join(stage, 'package', 'package.json');
  if (!lstatSync(manifestPath).isFile()) {
    throw new Error('Packed manifest is not a regular file');
  }
  return manifestPath;
}

export function buildDeterministicTarGz(stage) {
  // Default sort is UTF-16 code-unit order; entry names are unique within a
  // directory tree, so a plain key sort is the whole comparator.
  const byName = new Map(collectEntries(stage).map(entry => [entry.name, entry]));
  const entries = [...byName.keys()].sort().map(name => byName.get(name));
  const chunks = [tarHeader('package/', { size: 0, mode: 0o755, typeflag: '5' })];
  for (const entry of entries) {
    chunks.push(tarHeader(entry.name, entry));
    if (entry.typeflag === '0') {
      const content = readFileSync(join(stage, entry.name));
      chunks.push(content);
      const remainder = content.length % 512;
      if (remainder !== 0) chunks.push(Buffer.alloc(512 - remainder));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}

export function normalizePackedTarball(path) {
  const stage = mkdtempSync(join(tmpdir(), 'bonklm-normalize-pack-'));
  const tmpPath = `${path}.tmp`;
  try {
    extractTarGz(readFileSync(path), stage);
    const manifestPath = assertPlainTree(stage);
    writeFileSync(manifestPath, normalizeManifestText(readFileSync(manifestPath, 'utf8')));
    // Write-then-rename inside the same directory so a crash mid-write never
    // leaves a truncated artifact under the bundle's final name.
    writeFileSync(tmpPath, buildDeterministicTarGz(stage));
    renameSync(tmpPath, path);
  } finally {
    rmSync(tmpPath, { force: true });
    rmSync(stage, { recursive: true, force: true });
  }
}
