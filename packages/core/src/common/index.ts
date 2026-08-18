/**
 * BonkLM - Common Utilities
 * ===================================
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyRedactionPasses, type RedactionPass } from './redaction.js';

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
 * Low-entropy-by-inspection sequences that still score high on naive
 * Shannon entropy (alphabet runs, keyboard rows, digit runs). A value
 * that is a substring of one of these (or vice versa, at ≥12 chars) is
 * never a real secret regardless of its score.
 */
const COMMON_SEQUENCES: readonly string[] = [
  'abcdefghijklmnopqrstuvwxyz',
  'zyxwvutsrqponmlkjihgfedcba',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '0123456789',
  '9876543210'
];

function isCommonSequence(value: string): boolean {
  if (value.length < 12) return false;
  const lower = value.toLowerCase();
  // A value is "common" only if it IS (essentially) a sequence (or a
  // mash of sequences with a tiny remainder) — a real secret with a
  // keyboard row embedded inside 30 random chars must not be
  // whitelisted, and a random value with 12+ residual chars after
  // stripping every embedded sequence is still treated as a secret.
  for (const seq of COMMON_SEQUENCES) {
    if (seq.includes(lower)) return true;
  }
  let remainder = lower;
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const seq of COMMON_SEQUENCES) {
      // split/join strips ALL non-overlapping occurrences per pass —
      // .replace(seq, '') removed one per call, which is quadratic on
      // sequence-mash spam ('qwertyuiop'.repeat(n): 1.7s @500KB).
      const next = remainder.split(seq).join('');
      if (next !== remainder) {
        remainder = next;
        stripped = true;
      }
    }
  }
  return remainder.length < 8;
}

/**
 * Check if a value has high entropy (likely a real secret).
 */
export function isHighEntropy(value: string, threshold: number = 3.5): boolean {
  if (isCommonSequence(value)) return false;
  const cleanValue = value.replace(/^(sk[-_]|ghp_|gho_|xox[baprs][-_]|AKIA|AIza)/i, '');
  return calculateEntropy(cleanValue) >= threshold;
}

/**
 * Replacement marker substituted for redacted credential material.
 * Bracketed + 8 plain letters, so it is inert under a re-scan (carries no
 * credential shape and no high-entropy run that clears the floor). Distinct
 * from the CLI redactor's `***REDACTED***` marker — see {@link redactSecrets}.
 */
const SECRET_REDACTION_MARKER = '[REDACTED]';

/**
 * High-confidence credential / token shapes. Each is a bounded, linear-time,
 * literal-led run (no nested quantifier over an overlapping class), so the
 * redaction pass stays ReDoS-safe even on adversarial input. JWTs are listed
 * before the generic high-entropy pass runs (see {@link redactSecrets}) so a
 * token is masked whole rather than fragmented. The prefix set mirrors the
 * repo secret scanner's curated list (`.claude/validators-node/lib/validators/
 * secret.js`); none is anchored on a trailing boundary on purpose — partial-word
 * over-matching is the safe failure mode for a redactor.
 */
const CREDENTIAL_TOKEN_SHAPES: readonly RegExp[] = [
  // OpenAI / Anthropic `sk-…` / `sk-ant-…` keys.
  /sk-(?:ant-)?[A-Za-z0-9_\-.+/]{8,}/gi,
  // Stripe secret / restricted keys (`sk_live_…` / `sk_test_…` / `rk_live_…`).
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}/gi,
  // GitHub PAT family (ghp_ / gho_ / ghu_ / ghs_ / ghr_).
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  // GitLab PAT.
  /\bglpat-[A-Za-z0-9_-]{10,}/gi,
  // npm access token.
  /\bnpm_[A-Za-z0-9]{10,}/gi,
  // HashiCorp Vault service / batch tokens (`hvs.…` / `hvb.…` — dot-bearing).
  /\bhv[sb]\.[A-Za-z0-9_-]{8,}/gi,
  // Slack tokens (xoxb- / xoxa- / xoxp- / xoxr- / xoxs-).
  /\bxox[baprs]-[A-Za-z0-9-]{8,}/gi,
  // AWS access-key id.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Google API key.
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  // Bearer tokens.
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // JWT (header.payload.signature).
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g
];

/** URL userinfo (`scheme://<userinfo>@`) — keep scheme, mask the userinfo. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]{1,256}@/gi;

/**
 * Bare high-entropy run not covered by a named shape (provider-agnostic).
 * The `=` in the class means a `key=VALUE` form is captured whole; when the
 * combined run clears the entropy floor the key name is redacted along with the
 * value (acceptable over-redaction). Floor is 16 — short enough to catch most
 * real token bodies, long enough that ordinary single-word prose (which clears
 * the entropy bar only above ~16 mixed chars) is left intact.
 */
const BARE_TOKEN_RUN = /[A-Za-z0-9_\-+/=]{16,}/g;

/**
 * The egress redactor's ordered passes (built once; the global-flag regexes are
 * safe to reuse across calls under `String.prototype.replace`). Order is
 * load-bearing: userinfo first, then the named high-confidence shapes, then the
 * bare high-entropy catch-all so a token already masked by a named shape is not
 * re-examined. Fed to {@link applyRedactionPasses} by {@link redactSecrets}.
 */
const SECRET_REDACTION_PASSES: readonly RedactionPass[] = [
  // (1) URL userinfo — the classic exfil-via-URL channel; keep the scheme,
  // mask the userinfo (mirrors the prior `$1[REDACTED]@` string replacement).
  [URL_USERINFO, (_match, scheme: string) => `${scheme}${SECRET_REDACTION_MARKER}@`],
  // (2) Named high-confidence token shapes.
  ...CREDENTIAL_TOKEN_SHAPES.map((shape): RedactionPass => [shape, SECRET_REDACTION_MARKER]),
  // (3) Bare high-entropy runs not covered by a named shape.
  [BARE_TOKEN_RUN, token => (isHighEntropy(token) ? SECRET_REDACTION_MARKER : token)]
];

/**
 * Redact credential-shaped substrings from a string before it egresses into a
 * finding / telemetry object. Best-effort defense-in-depth, not a proof.
 *
 * Motivated by the indirect-injection exfiltration arms: on a connector
 * boundary (`tool_result` / `retrieved_doc` / …) the region a pattern matches
 * can itself span the secret the attacker is exfiltrating — a credential
 * embedded in a destination URL's userinfo, a query-string token, or a body
 * field captured ahead of its field-name anchor. Storing that raw on
 * `PatternFinding.match` would hand a secret literal to consumer callbacks and
 * telemetry, violating the no-raw-secret-in-findings red line. Callers must
 * apply this BEFORE any length-slice so a secret straddling the cut cannot leak
 * a head fragment.
 *
 * Three linear passes: (1) URL userinfo (any userinfo is masked, incl. a benign
 * `user@` — over-redaction is the safe direction), (2) high-confidence
 * provider/token shapes ({@link CREDENTIAL_TOKEN_SHAPES}), (3) bare high-entropy
 * runs (≥16 chars that clear {@link isHighEntropy}). Ordinary directive prose
 * carries no such run, so an instruction-only match's forensic signal survives.
 *
 * RESIDUAL LIMITATION: a short (<16-char), low-entropy, provider-prefix-free
 * value with no `@`/scheme is NOT caught (e.g. a bespoke 12-char API token). The
 * directive-anchored arms produce short, structured matches where such a bare
 * value is bounded, but this is a known gap — the guarantee is "credential
 * SHAPES are redacted", not "every conceivable secret is".
 *
 * NOTE: deliberately distinct from `redactCredentials` in `cli/utils/error.ts`
 * (the CLI / error-message surface, which adds message-only `api_key=` and
 * quoted catch-alls). The two now share the {@link applyRedactionPasses} apply
 * loop, but each keeps its OWN marker, shape set, and entropy predicate — that
 * divergence is intentional, not drift. Layering stays one way: `cli/` imports
 * this `common/` module, never the reverse.
 *
 * INTERNAL / tactical: barrel-reachable but not part of the frozen v1 surface
 * (see `docs/user/public-api-surface.md`).
 */
export function redactSecrets(input: string): string {
  return applyRedactionPasses(input, SECRET_REDACTION_PASSES);
}

/**
 * Check if content around a match indicates it's an example/placeholder.
 *
 * When `lineNumber` (1-based) is supplied the caller already knows the
 * match's line — the O(content) `split` + `findIndex` scan is skipped
 * (that scan re-ran the full content per match: quadratic on
 * match-dense adversarial input).
 */
export function isExampleContent(content: string, line: string, lineNumber?: number): boolean {
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
    /\[your[_-]/i
  ];

  for (const indicator of EXAMPLE_INDICATORS) {
    if (indicator.test(line)) {
      return true;
    }
  }

  const lines = content.split('\n');
  const lineIndex = lineNumber !== undefined ? lineNumber - 1 : lines.findIndex(l => l.includes(line.trim()));

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
    '.env.production.example'
  ];

  const basename = filePath.split('/').pop()?.toLowerCase() || '';
  return EXPECTED_SECRET_FILES.some(expected => basename === expected.toLowerCase());
}

/**
 * Sanitize a string for safe inclusion in structured-logger output.
 *
 * Defeats CWE-117 log injection: hex-escapes control characters
 * (C0/C1/DEL + TAB), folds newlines / line-separators to a literal `\n`
 * marker, and hex-escapes the Unicode bidi-override/isolate and
 * zero-width/format classes (CWE-1007 visual-spoof + invisible-content
 * smuggle) — so an attacker-controlled string cannot forge log records
 * in downstream aggregators (Datadog, Splunk, ELK, OTel collectors) nor
 * visually spoof / hide content in a Unicode-rendering SIEM UI.
 * Caps output at `maxLen` (default 500 chars).
 *
 * @public extracted from `timeout-wrapper.ts`
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
  // include the C1 control range
  // (U+0080..U+009F) alongside C0 + DEL. C1 lives above 0x7F so the prior class
  // missed it, yet 8-bit-clean terminals (xterm/VTE in UTF-8) interpret U+009B
  // as the Control Sequence Introducer (= `ESC [`) and U+0085 (NEL) as a line
  // terminator in several SIEM ingestors — the same CWE-117/CWE-1007 injection
  // surface as C0 ESC, which was already escaped. Hex-escape the whole range.
  const stripped = input.replace(
    // eslint-disable-next-line no-control-regex
    /[\x00-\x09\x0b-\x1f\x7f-\x9f]/g,
    c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
  );
  // Replace newlines/CRs (most common injection vector) with literal markers.
  // Sprint 39 security-MEDIUM #4: U+2028 (LINE SEPARATOR) + U+2029
  // (PARAGRAPH SEPARATOR) are treated as line terminators by V8's
  // JSON.stringify renderer + several SIEM ingestors, but live above
  // 0x7F so the control-char regex misses them. Bundle them into the
  // newline-replacement pass so the canonical primitive covers the
  // full "line break the log line" attack surface.
  const flat = stripped.replace(/\r\n|\n|\r|\u2028|\u2029/g, '\\n');
  // Hex-escape Unicode bidi-override and
  // bidi-isolate code points (U+202A..U+202E, U+2066..U+2069).
  // These live above 0x7F so the control-char regex above misses them.
  // An attacker who injects U+202E (RIGHT-TO-LEFT OVERRIDE) into a log
  // line can visually reverse subsequent characters in any terminal or
  // SIEM UI that renders Unicode directionality (CWE-1007 visual-spoof).
  // Bidi-isolates (U+2066..U+2069) similarly let an attacker bracket a
  // spoofed segment with a directional isolate, making the rendered text
  // differ arbitrarily from the byte sequence seen by a log parser.
  // Hex-escaping these preserves forensic signal while neutralising the
  // visual-spoof attack surface: a SOC analyst can distinguish a bidi-
  // override attempt from legitimate Unicode in the hex representation.
  //
  // Code points covered:
  //   U+202A  LEFT-TO-RIGHT EMBEDDING
  //   U+202B  RIGHT-TO-LEFT EMBEDDING
  //   U+202C  POP DIRECTIONAL FORMATTING
  //   U+202D  LEFT-TO-RIGHT OVERRIDE
  //   U+202E  RIGHT-TO-LEFT OVERRIDE (classic visual-spoof attack char)
  //   U+2066  LEFT-TO-RIGHT ISOLATE
  //   U+2067  RIGHT-TO-LEFT ISOLATE
  //   U+2068  FIRST STRONG ISOLATE
  //   U+2069  POP DIRECTIONAL ISOLATE
  const bidiSafe = flat.replace(
    /[\u202a-\u202e\u2066-\u2069]/g,
    c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
  // Hex-escape the zero-width / Unicode-format (Cf) class. These code
  // points render as nothing yet survive in the byte stream, so an attacker can
  // smuggle invisible content into a log line (homoglyph / zero-width spoof --
  // e.g. "ad<ZWSP>min" rendering as "admin" while a naive grep for "admin"
  // misses it) or wedge a Unicode-aware parser. They live above 0x7F (missed by
  // the control-char regex) and are disjoint from the bidi override/isolate
  // range escaped above. Hex-escaping to \uNNNN preserves forensic signal -- a
  // SOC analyst sees the smuggle attempt rather than an invisible gap. NOTE:
  // this ESCAPES, unlike the detection-layer text-normalizer which STRIPS the
  // same class before injection matching (a separate sink, different goal).
  //
  // Scope is the BMP Cf subset below; it is intentionally narrower than the
  // detection-layer strip set. The astral TAG block (U+E0000..U+E007F, the
  // "ASCII smuggling" channel) and assorted residual Cf / deprecated-format
  // points are NOT escaped here -- they need a code-point-aware escape and are
  // handled by the astral-aware pass that follows.
  //
  // Code points covered:
  //   U+061C  ARABIC LETTER MARK (bidi-related directional mark)
  //   U+200B  ZERO WIDTH SPACE
  //   U+200C  ZERO WIDTH NON-JOINER
  //   U+200D  ZERO WIDTH JOINER
  //   U+200E  LEFT-TO-RIGHT MARK
  //   U+200F  RIGHT-TO-LEFT MARK
  //   U+2060  WORD JOINER
  //   U+2061  FUNCTION APPLICATION   (invisible math operator)
  //   U+2062  INVISIBLE TIMES
  //   U+2063  INVISIBLE SEPARATOR
  //   U+2064  INVISIBLE PLUS
  //   U+FEFF  ZERO WIDTH NO-BREAK SPACE (BOM)
  //
  // All 12 are BMP, so the shared \uNNNN escape (charCodeAt -> 4 hex) is correct.
  // Extending EITHER \uNNNN pass to astral code points would require codePointAt
  // + a /u-flag regex: charCodeAt returns a lone surrogate for an astral char and
  // would mis-escape.
  const formatSafe = bidiSafe.replace(
    /[\u061c\u200b-\u200f\u2060-\u2064\ufeff]/g,
    c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
  // Sprint 55 / security regression: astral-aware final pass. Escapes the Unicode TAG block
  // (U+E0000..U+E007F) -- the modern "ASCII smuggling" invisible-instruction
  // channel where a full readable ASCII payload is encoded as invisible tag
  // chars that LLMs/renderers process but humans and `grep` never see -- plus
  // the residual Cf / deprecated-format points the detection-layer
  // text-normalizer strips but the BMP passes above intentionally skip.
  //
  // The TAG block is ASTRAL (>= U+10000): charCodeAt returns a lone surrogate
  // and the 4-hex formula above would mis-escape, so this pass iterates by code
  // point (Array.from + codePointAt) and emits the braced code-point form for
  // astral points, the 4-hex form for the BMP residuals. All points below are
  // disjoint from every prior pass (control, newline, bidi, BMP Cf).
  //
  // Code points covered:
  //   U+00AD          SOFT HYPHEN
  //   U+115F, U+1160  HANGUL CHOSEONG / JUNGSEONG FILLER (invisible fillers)
  //   U+180E          MONGOLIAN VOWEL SEPARATOR
  //   U+206A..U+206F  deprecated format (inhibit/activate symmetric+shaping)
  //   U+FFF9..U+FFFB  INTERLINEAR ANNOTATION ANCHOR / SEPARATOR / TERMINATOR
  //   U+E0000..U+E007F  astral TAG block (ASCII-smuggling channel)
  const astralSafe = Array.from(formatSafe, ch => {
    const cp = ch.codePointAt(0) as number;
    const isResidualCf =
      cp === 0x00ad ||
      cp === 0x115f ||
      cp === 0x1160 ||
      cp === 0x180e ||
      (cp >= 0x206a && cp <= 0x206f) ||
      (cp >= 0xfff9 && cp <= 0xfffb);
    if (isResidualCf) return `\\u${cp.toString(16).padStart(4, '0')}`;
    if (cp >= 0xe0000 && cp <= 0xe007f) return `\\u{${cp.toString(16)}}`;
    return ch;
  }).join('');
  return astralSafe.length > maxLen ? `${astralSafe.slice(0, maxLen)}…[truncated]` : astralSafe;
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
 * @public engine error-log hardening.
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
      stack: error.stack
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
    message:
      typeof error === 'object' && error !== null ? '[non-Error object thrown]' : sanitizeLogString(String(error)),
    // Sprint 37 security-MEDIUM M-2: `raw` is also a structured-log
    // field and a custom validator that throws `{ msg: 'x\nfake_log' }`
    // would otherwise inject log lines via the JSON.stringify output.
    // JSON.stringify itself escapes raw newlines to `\\n` (safe), but
    // a consumer object containing a nested object with attacker-
    // controlled keys can still emit unicode line-separators (U+2028)
    // or split-via-tab attacks. sanitizeLogString handles both.
    raw: typeof raw === 'string' ? sanitizeLogString(raw) : raw
  };
}
