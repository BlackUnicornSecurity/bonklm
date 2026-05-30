/**
 * `bonklm-doctor` CLI logic — Story 1.8 Construct D wiring (Sprint 12).
 * ====================================================================
 *
 * The runnable entry is `src/bin/doctor.ts` (a shebang shim that only wires
 * `process.argv` / `process.exit`); ALL behaviour lives here so it stays
 * unit-testable without spawning a subprocess. Mirrors the way
 * `@blackunicorn/bonklm`'s `src/bin/run.ts` delegates to its command modules.
 *
 * Scope (Phase-1, matches `README.md` Construct D + the `doctor.ts` header):
 * a STATIC audit of a character file (+ optional plugin list). The
 * `--runtime` HTTP probe is deferred to Phase-2 (the capability already exists
 * as the exported `runDoctorRuntime` library function; only the CLI flag is
 * intentionally not wired here).
 *
 * Exit-code matrix (documented in {@link USAGE}):
 *   0  audit ran, no CRITICAL findings.
 *   1  audit ran, >= 1 CRITICAL finding — the unsuppressable-CRITICAL contract
 *      (audit-loop BC4); CI MUST surface this and never `|| true` it.
 *   2  could not run: bad usage, or unreadable / oversized / too-deep / invalid input.
 *
 * Note on exit `2`: this tool deliberately reserves `1` for "a CRITICAL finding
 * exists" (the signal CI gates on) and routes ALL operational failures (bad
 * usage, IO, parse) to `2`. That keeps `1` unambiguous, and differs on purpose
 * from `@blackunicorn/bonklm`'s general CLI where user-input errors exit `1`.
 *
 * Security posture:
 *  - All untrusted JSON (character + plugins + own package.json) is parsed with
 *    `secure-json-parse` (`protoAction`/`constructorAction: 'remove'`) — the
 *    house rule for JSON at a trust boundary (cf. core `cli/commands/doctor.ts`).
 *  - Every attacker-influenced string that reaches stdout/stderr (finding
 *    descriptions embed plugin names + character field paths; error messages
 *    embed the supplied path) is run through `sanitizeLogString` first — closes
 *    the CWE-117 / CWE-1007 terminal-injection surface (ADR-0001 alignment).
 *  - Inputs are capped by BYTES ({@link MAX_INPUT_BYTES}) before reading AND by
 *    nesting DEPTH ({@link MAX_INPUT_DEPTH}) after parsing, so neither a huge nor
 *    a pathologically-deep file can OOM or stack-overflow the audit.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as secureJsonParse } from 'secure-json-parse';
import { sanitizeLogString } from '@blackunicorn/bonklm/common';
import { runDoctor } from './doctor.js';
import type { DoctorFinding, DoctorReport, PluginLike } from './types.js';

/** Hard ceiling on a single input file (5 MiB). Character/plugin files are KBs. */
export const MAX_INPUT_BYTES = 5 * 1024 * 1024;

/**
 * Max object/array nesting depth accepted from an input file. The audit walk in
 * `runDoctor` is recursive, so an unbounded depth would overflow the stack on a
 * ~20 KB hostile file; 100 is far beyond any real character/plugins document.
 */
export const MAX_INPUT_DEPTH = 100;

/** Max plugin-name length considered (npm caps package names at 214). */
export const MAX_PLUGIN_NAME_LENGTH = 256;

/** Help text + the exit-code contract. Static (never interpolated with input). */
export const USAGE = [
  'bonklm-doctor — ElizaOS deployment static audit',
  '',
  'Usage:',
  '  bonklm-doctor <character.json> [plugins.json] [options]',
  '',
  'Arguments:',
  '  character.json   ElizaOS character file to audit (required)',
  '  plugins.json     Optional plugin list — a JSON array of names/objects,',
  '                   or an object with a "plugins" array',
  '',
  'Options:',
  '  --json           Emit the report as JSON',
  '  -h, --help       Show this help and exit',
  '  -V, --version    Print the connector version and exit',
  '  --               Treat all following arguments as file paths',
  '',
  'Exit codes:',
  '  0  audit ran, no CRITICAL findings',
  '  1  audit ran, at least one CRITICAL finding (never suppress with `|| true`)',
  '  2  could not run (bad usage, or unreadable / invalid input)'
].join('\n');

/**
 * Injectable IO seam. The real implementation ({@link defaultIo}) touches the
 * filesystem and `process` streams; tests pass an in-memory double so the CLI
 * logic is exercised without real files, real stdout, or `process.exit`.
 */
export interface CliIo {
  /** Read a file's full UTF-8 text, or throw. */
  readFileText(path: string): string;
  /** Byte size of a regular file, or throw (incl. when the path is not a file). */
  fileSize(path: string): number;
  /** Write to stdout. */
  write(text: string): void;
  /** Write to stderr. */
  writeError(text: string): void;
}

/**
 * Parsed command line — a discriminated union over the four invocation modes.
 *
 * NOTE: `error.message` may contain raw, attacker-controlled argv bytes; it is
 * sanitised with `sanitizeLogString` at the write boundary in {@link main}.
 * Any other consumer of `parseArgs` MUST sanitise before rendering it.
 */
export type ParsedArgs =
  | { kind: 'run'; characterPath: string; pluginsPath: string | undefined; json: boolean }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

/** A recoverable, user-facing input error → exit code 2. */
export class CliInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliInputError';
  }
}

/** Real filesystem + stream IO. */
export const defaultIo: CliIo = {
  readFileText: path => readFileSync(path, 'utf8'),
  fileSize: path => {
    // `statSync` follows symlinks by design — a user pointing the CLI at a
    // symlinked character file is legitimate. This is a LOCAL user-run tool, so
    // it inherits the caller's own filesystem permissions; the size read here is
    // a resource guard, not a trust boundary (no escalation is possible).
    const stat = statSync(path);
    if (!stat.isFile()) {
      throw new CliInputError(`${sanitizeLogString(path)} is not a regular file.`);
    }
    return stat.size;
  },
  write: text => {
    process.stdout.write(text);
  },
  writeError: text => {
    process.stderr.write(text);
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? sanitizeLogString(error.message) : 'unknown error';
}

/**
 * Reject pathologically deep input BEFORE it reaches the recursive audit walk in
 * `runDoctor`. Implemented ITERATIVELY on purpose — a recursive depth check would
 * hit the very stack limit it is meant to guard.
 */
function assertWithinDepth(root: unknown, max: number): void {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    if (entry.depth > max) {
      throw new CliInputError(`input nesting exceeds the safe depth limit (${max}).`);
    }
    const node = entry.node;
    if (Array.isArray(node)) {
      for (const child of node) stack.push({ node: child, depth: entry.depth + 1 });
    } else if (node !== null && typeof node === 'object') {
      for (const child of Object.values(node)) stack.push({ node: child, depth: entry.depth + 1 });
    }
  }
}

/**
 * Parse `argv` (already sliced past `node script`). Scanned left-to-right:
 * `--help` / `--version` short-circuit as soon as they are seen (so they win over
 * positionals and `--json`, though a malformed option encountered earlier errors
 * first); `--` ends option parsing (everything after is a path); unknown flags and
 * bad positional counts are reported as `kind: 'error'`.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let json = false;
  let endOfOptions = false;
  const positionals: string[] = [];
  for (const arg of argv) {
    if (!endOfOptions) {
      if (arg === '--') {
        endOfOptions = true;
        continue;
      }
      if (arg === '--help' || arg === '-h') return { kind: 'help' };
      if (arg === '--version' || arg === '-V') return { kind: 'version' };
      if (arg === '--json') {
        json = true;
        continue;
      }
      // A lone '-' is a conventional path token, not an option.
      if (arg.startsWith('-') && arg !== '-') {
        return { kind: 'error', message: `Unknown option: ${arg}` };
      }
    }
    positionals.push(arg);
  }
  if (positionals.length === 0) {
    return { kind: 'error', message: 'Missing required <character.json> argument.' };
  }
  if (positionals.length > 2) {
    return { kind: 'error', message: `Too many arguments (expected at most 2, got ${positionals.length}).` };
  }
  return { kind: 'run', characterPath: positionals[0], pluginsPath: positionals[1], json };
}

/**
 * Normalise a parsed plugins file into {@link PluginLike}[]. Accepts an array of
 * package-name strings, an array of `{ name }` objects, or an object with a
 * `plugins` array. Entries without a string `name`, or with a name longer than
 * {@link MAX_PLUGIN_NAME_LENGTH} (not a real package, and a CPU guard for the
 * per-name typo-squat distance pass), are skipped; a wholly wrong shape throws.
 */
export function normalizePlugins(raw: unknown): PluginLike[] {
  const list: unknown[] | null = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.plugins)
      ? (raw.plugins as unknown[])
      : null;
  if (list === null) {
    throw new CliInputError('plugins file must be a JSON array or an object with a "plugins" array.');
  }
  const plugins: PluginLike[] = [];
  for (const entry of list) {
    let name: string | undefined;
    if (typeof entry === 'string') name = entry;
    else if (isRecord(entry) && typeof entry.name === 'string') name = entry.name;
    if (name === undefined || name.length > MAX_PLUGIN_NAME_LENGTH) continue;
    plugins.push({ name });
  }
  return plugins;
}

/** Read the connector version from the package's own package.json; never throws. */
export function readVersion(io: CliIo): string {
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const parsed = secureJsonParse(io.readFileText(pkgPath), null, {
      protoAction: 'remove',
      constructorAction: 'remove'
    }) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function sanitizeFinding(finding: DoctorFinding): DoctorFinding {
  // `severity` is a compile-time-enforced literal union set only by hardcoded
  // audit code (never from input), so it needs no sanitisation. The remaining
  // fields embed attacker-influenced text (plugin names, field paths) → sanitise.
  return {
    severity: finding.severity,
    category: sanitizeLogString(finding.category),
    description: sanitizeLogString(finding.description),
    ...(finding.file !== undefined ? { file: sanitizeLogString(finding.file) } : {}),
    ...(finding.pluginName !== undefined ? { pluginName: sanitizeLogString(finding.pluginName) } : {})
  };
}

/** Render the report as pretty JSON (every string field sanitised first). */
export function renderJson(report: DoctorReport): string {
  const safe: DoctorReport = {
    findings: report.findings.map(sanitizeFinding),
    criticalCount: report.criticalCount,
    exitCode: report.exitCode
  };
  return `${JSON.stringify(safe, null, 2)}\n`;
}

/** Render the report as a human-readable, terminal-injection-safe summary. */
export function renderHuman(report: DoctorReport): string {
  const lines: string[] = ['BonkLM Doctor — ElizaOS static audit', '===================================='];
  lines.push('');
  if (report.findings.length === 0) {
    lines.push('✓ No findings.');
  } else {
    for (const raw of report.findings) {
      const finding = sanitizeFinding(raw);
      lines.push(`[${finding.severity}] ${finding.category}`);
      lines.push(`  ${finding.description}`);
      if (finding.file !== undefined) lines.push(`  file: ${finding.file}`);
      if (finding.pluginName !== undefined) lines.push(`  plugin: ${finding.pluginName}`);
      lines.push('');
    }
  }
  const noun = report.findings.length === 1 ? 'finding' : 'findings';
  lines.push(
    `Summary: ${report.findings.length} ${noun} (${report.criticalCount} CRITICAL). exitCode=${report.exitCode}.`
  );
  return `${lines.join('\n')}\n`;
}

function readJsonFile(path: string, io: CliIo): unknown {
  let size: number;
  try {
    size = io.fileSize(path);
  } catch (error) {
    throw new CliInputError(`cannot read ${sanitizeLogString(path)}: ${describeError(error)}`);
  }
  if (size > MAX_INPUT_BYTES) {
    throw new CliInputError(`${sanitizeLogString(path)} is too large (${size} bytes > ${MAX_INPUT_BYTES}-byte limit).`);
  }
  let text: string;
  try {
    text = io.readFileText(path);
  } catch (error) {
    throw new CliInputError(`cannot read ${sanitizeLogString(path)}: ${describeError(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = secureJsonParse(text, null, { protoAction: 'remove', constructorAction: 'remove' }) as unknown;
  } catch {
    throw new CliInputError(`${sanitizeLogString(path)} is not valid JSON.`);
  }
  assertWithinDepth(parsed, MAX_INPUT_DEPTH);
  return parsed;
}

/**
 * Run the CLI. Returns the process exit code (never calls `process.exit` itself
 * — the shebang shim does that). `io` defaults to the real filesystem/stream
 * implementation; tests inject a double.
 */
export async function main(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.kind === 'help') {
    io.write(`${USAGE}\n`);
    return 0;
  }
  if (parsed.kind === 'version') {
    io.write(`${sanitizeLogString(readVersion(io))}\n`);
    return 0;
  }
  if (parsed.kind === 'error') {
    io.writeError(`bonklm-doctor: ${sanitizeLogString(parsed.message)}\n\n${USAGE}\n`);
    return 2;
  }

  try {
    const characterRaw = readJsonFile(parsed.characterPath, io);
    if (!isRecord(characterRaw)) {
      io.writeError(
        `bonklm-doctor: ${sanitizeLogString(parsed.characterPath)} must contain a JSON object (character file).\n`
      );
      return 2;
    }
    const plugins = parsed.pluginsPath === undefined ? [] : normalizePlugins(readJsonFile(parsed.pluginsPath, io));
    const report = runDoctor({
      character: characterRaw,
      characterFilePath: parsed.characterPath,
      plugins
    });
    io.write(parsed.json ? renderJson(report) : renderHuman(report));
    return report.exitCode;
  } catch (error) {
    if (error instanceof CliInputError) {
      io.writeError(`bonklm-doctor: ${sanitizeLogString(error.message)}\n`);
      return 2;
    }
    throw error;
  }
}
