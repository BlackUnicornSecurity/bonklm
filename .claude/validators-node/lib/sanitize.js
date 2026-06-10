import { charClassRegex } from './char-class.js';

/**
 * Output sanitization for hook stderr messages (CWE-117 log-injection defense).
 *
 * Block messages interpolate attacker-influenced text (file content, commands,
 * prompts). That text is written to stderr, which Claude Code surfaces and which
 * may be captured into logs/transcripts. Strip control characters and bidi
 * overrides so a crafted payload cannot forge log lines or reorder displayed
 * text. Mirrors the range hardened in the library's own `sanitizeLogString`
 * (C0/C1 + Unicode bidi + line/paragraph separators).
 */

// C0 controls (incl. tab/newline/CR), DEL (U+007F), and C1 controls (U+0080-U+009F).
const CONTROL_CHARS = charClassRegex([
  [0x00, 0x1f],
  [0x7f, 0x9f],
]);
// Bidi embeddings/overrides (U+202A-U+202E), isolates (U+2066-U+2069),
// and line/paragraph separators (U+2028-U+2029).
const BIDI_AND_SEPARATORS = charClassRegex([
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0x2028, 0x2029],
]);

/**
 * Neutralize a single line of untrusted text for safe stderr/log output.
 *
 * @param {unknown} value - Untrusted text (coerced to string).
 * @param {number} [maxLength=200] - Hard cap; longer input is truncated with a marker.
 * @returns {string}
 */
export function sanitizeForLog(value, maxLength = 200) {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value).replace(CONTROL_CHARS, ' ').replace(BIDI_AND_SEPARATORS, '');
  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength)}...[truncated]`;
  }
  return text;
}
