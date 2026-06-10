import { charClassRegex } from './char-class.js';

/**
 * Lightweight text normalization to defeat obfuscation before pattern matching.
 *
 * Deliberately minimal (no full confusable table): NFKC folds fullwidth/compat
 * forms, zero-width characters are stripped, and whitespace is collapsed. Used by
 * the content guards (jailbreak / prompt-injection) so spacing/zero-width tricks
 * do not trivially bypass a pattern.
 */

// Zero-width space/ZWNJ/ZWJ (U+200B-U+200D), word joiner (U+2060), BOM (U+FEFF).
const ZERO_WIDTH = charClassRegex([
  [0x200b, 0x200d],
  [0x2060],
  [0xfeff],
]);

/**
 * Normalize text for detection.
 *
 * @param {unknown} value - Raw text (coerced to string).
 * @returns {string} Normalized, lower-cased text with collapsed whitespace.
 */
export function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
