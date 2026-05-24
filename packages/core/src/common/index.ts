/**
 * BonkLM - Common Utilities
 * ===================================
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Calculate Shannon entropy of a string.
 * Higher entropy indicates more randomness (likely a real secret).
 */
export function calculateEntropy(s: string): number {
  if (!s.length) return 0;

  const freq = new Map<string, number>();
  for (const char of s) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Check if a value has high entropy (likely a real secret).
 */
export function isHighEntropy(value: string, threshold: number = 3.5): boolean {
  const cleanValue = value.replace(/^(sk[-_]|ghp_|gho_|xox[baprs][-_]|AKIA|AIza)/i, '');
  return calculateEntropy(cleanValue) >= threshold;
}

/**
 * Check if content around a match indicates it's an example/placeholder.
 */
export function isExampleContent(content: string, line: string): boolean {
  const EXAMPLE_INDICATORS = [
    /\bexample\b/i,
    /\bplaceholder\b/i,
    /your[_-]?api[_-]?key/i,
    /your[_-]?secret/i,
    /replace[_-]?with/i,
    /xxx+/i,
    /\bdummy\b/i,
    /\bfake\b/i,
    /test[_-]?key/i,
    /\bsample\b/i,
    /todo:?\s*replace/i,
    /insert[_-]?your/i,
    /<your[_-]/i,
    /\[your[_-]/i,
  ];

  for (const indicator of EXAMPLE_INDICATORS) {
    if (indicator.test(line)) {
      return true;
    }
  }

  const lines = content.split('\n');
  const lineIndex = lines.findIndex((l) => l.includes(line.trim()));

  if (lineIndex !== -1) {
    const start = Math.max(0, lineIndex - 5);
    const end = Math.min(lines.length, lineIndex + 6);
    const context = lines.slice(start, end).join('\n');

    for (const indicator of EXAMPLE_INDICATORS) {
      if (indicator.test(context)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Read file content helper
 */
export function readFileContent(filePath: string): string {
  try {
    return readFileSync(resolve(filePath), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Check if file path is an expected example file.
 *
 * Defensive: non-string inputs (object / undefined / null / number)
 * return `false` rather than throwing. The canonical Guard interface
 * declares `context?: string` (see `GuardrailEngine.types.ts`); a caller
 * passing a non-string is a contract violation but should not crash the
 * detection pipeline. Sprint 33 closure (benchmark-bug surfacing).
 */
export function isExpectedSecretFile(filePath: string): boolean {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return false;
  }

  const EXPECTED_SECRET_FILES = [
    '.env.example',
    '.env.template',
    '.env.sample',
    'example.env',
    'template.env',
    '.env.development.example',
    '.env.production.example',
  ];

  const basename = filePath.split('/').pop()?.toLowerCase() || '';
  return EXPECTED_SECRET_FILES.some((expected) => basename === expected.toLowerCase());
}

/**
 * Sanitize a string for safe inclusion in structured-logger output.
 *
 * Defeats CWE-117 log injection: strips control characters
 * (`\x00-\x08 \x0b-\x1f \x7f`) and escapes newlines to literal `\n`
 * markers so an attacker-controlled string cannot forge log records in
 * downstream aggregators (Datadog, Splunk, ELK, OTel collectors).
 * Caps output at `maxLen` (default 500 chars).
 *
 * @public Sprint 33 — extracted from `timeout-wrapper.ts` (Sprint 31)
 * to share the sanitization across `serializeError` + connector
 * timeout primitives. Single source of truth for log-string hygiene.
 */
const DEFAULT_MAX_LOG_STRING_LEN = 500;

export function sanitizeLogString(input: string, maxLen: number = DEFAULT_MAX_LOG_STRING_LEN): string {
  // Sprint 37 security-MEDIUM M-1: include TAB (\x09) in the control-
  // char strip set. TSV-format log ingestors (Splunk
  // `sourcetype=syslog`, Datadog TCP syslog, several OTel exporters)
  // treat TAB as a column delimiter — leaving it unencoded allows a
  // CWE-117 column-injection attack where an attacker's error
  // message contains `\t` to spawn a phantom column.
  // eslint-disable-next-line no-control-regex
  const stripped = input.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, (c) =>
    `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
  );
  // Replace newlines/CRs (most common injection vector) with literal markers.
  const flat = stripped.replace(/\r\n|\n|\r/g, '\\n');
  return flat.length > maxLen ? `${flat.slice(0, maxLen)}…[truncated]` : flat;
}

/**
 * Serialize an unknown error value into a plain, enumerable object so
 * it survives JSON serialization in structured loggers.
 *
 * `Error` instances have non-enumerable `message` / `stack` / `name`
 * properties, so `JSON.stringify(new Error('x'))` produces `"{}"` and
 * `{ error }` log meta renders as `error={}` — opacity that defeats
 * observability. This helper extracts the salient fields explicitly
 * and runs `message` through `sanitizeLogString` to defeat log
 * injection (CWE-117) if the caller's `Error` was constructed with
 * user-controlled input (e.g. `new Error(\`bad: \${userInput}\`)`).
 *
 * @public Sprint 33 — engine error-log hardening.
 *
 * **SIEM contract**: `stack` contains file paths from the install
 * location and is intended for server-side debug logs only. Callers
 * that forward log payloads to third-party SIEM / client-facing APIs
 * MUST strip the `stack` field at the transport layer.
 */
export interface SerializedError {
  /** Sanitized error message. Safe for inclusion in structured log lines. */
  message: string;
  name?: string;
  /**
   * Raw stack trace. Contains install-path fragments — DO NOT forward
   * to client-facing APIs or untrusted SIEM destinations. Strip at the
   * transport layer if the log payload leaves the trust boundary.
   */
  stack?: string;
  /** Stringified representation for non-Error throws (strings / objects / primitives). */
  raw?: string;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    // Sprint 37 security-LOW L-1: sanitize `name` too. In practice
    // `.name` is set at class definition time (e.g. `TypeError`), but
    // a consumer subclass that derives `name` from caught user input
    // (anti-pattern, but observed in the wild) would otherwise leak
    // raw control chars into structured logs.
    return {
      message: sanitizeLogString(error.message),
      name: sanitizeLogString(error.name),
      stack: error.stack,
    };
  }
  if (typeof error === 'string') {
    return { message: sanitizeLogString(error) };
  }
  // Non-Error throw: capture a best-effort string representation.
  // `JSON.stringify(undefined)` returns the value `undefined` (not the
  // string `'undefined'`), so defend the type before the sanitize step.
  let raw: string | undefined;
  try {
    raw = JSON.stringify(error);
  } catch {
    // JSON.stringify throws on circular structures, getter throws,
    // BigInt values, etc. Use an explicit marker rather than falling
    // back to `String(error)` (which produces the misleading
    // `'[object Object]'` for plain objects).
    raw = '[circular or non-serialisable]';
  }
  return {
    message: typeof error === 'object' && error !== null
      ? '[non-Error object thrown]'
      : sanitizeLogString(String(error)),
    // Sprint 37 security-MEDIUM M-2: `raw` is also a structured-log
    // field and a custom validator that throws `{ msg: 'x\nfake_log' }`
    // would otherwise inject log lines via the JSON.stringify output.
    // JSON.stringify itself escapes raw newlines to `\\n` (safe), but
    // a consumer object containing a nested object with attacker-
    // controlled keys can still emit unicode line-separators (U+2028)
    // or split-via-tab attacks. sanitizeLogString handles both.
    raw: typeof raw === 'string' ? sanitizeLogString(raw) : raw,
  };
}
