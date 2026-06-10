/**
 * Build a RegExp character class from numeric Unicode code-point ranges.
 *
 * The source stays pure-ASCII (no literal control/bidi characters embedded in a
 * regex literal), so the patterns are reviewable and survive copy/transit intact.
 * The actual code points are materialized via String.fromCharCode at module load.
 * All inputs are BMP code points (<= 0xFFFF); no surrogate handling is needed.
 *
 * @param {Array<[number, number?]>} ranges - Inclusive [lo, hi] ranges; a single
 *   element [lo] matches one code point.
 * @param {string} [flags='g'] - RegExp flags.
 * @returns {RegExp}
 */
export function charClassRegex(ranges, flags = 'g') {
  const body = ranges
    .map(([lo, hi]) =>
      hi === undefined
        ? String.fromCharCode(lo)
        : `${String.fromCharCode(lo)}-${String.fromCharCode(hi)}`,
    )
    .join('');
  return new RegExp(`[${body}]`, flags);
}
