import path from 'node:path';

/**
 * Heuristics for "this is an example/placeholder, not a real secret/PII".
 * Used by the secret and pii guards to suppress false positives on fixtures,
 * documentation, and templates — important in this repo, which legitimately
 * carries synthetic attack/secret samples.
 */

const EXAMPLE_INDICATORS = [
  /\bexample\b/i,
  /\bplaceholder\b/i,
  /your[_-]?(?:api[_-]?)?key/i,
  /your[_-]?secret/i,
  /replace[_-]?with/i,
  /\bx{4,}\b/i,
  /\bdummy\b/i,
  /\bfake\b/i,
  /test[_-]?(?:key|token|secret|value)/i,
  /\bsample\b/i,
  /\bredacted\b/i,
  /\bnot[_-]?a[_-]?real\b/i,
  /<your[_-]?/i,
  /\[your[_-]?/i,
];

const EXAMPLE_FILE_BASENAMES = new Set([
  '.env.example',
  '.env.template',
  '.env.sample',
  'example.env',
  'template.env',
  'sample.env',
]);

const EXAMPLE_FILE_SUFFIXES = ['.example', '.template', '.sample', '.dist'];

/**
 * Does a line/snippet read as an example/placeholder (so a matched secret-like
 * token there should not be treated as a real leak)?
 * @param {string} text
 * @returns {boolean}
 */
export function isExampleContext(text) {
  if (!text) return false;
  return EXAMPLE_INDICATORS.some((re) => re.test(text));
}

/**
 * Is this filename an env example/template that is expected to hold sample values?
 * @param {string} filePath
 * @returns {boolean}
 */
export function isExampleFile(filePath) {
  if (!filePath) return false;
  const base = path.basename(filePath).toLowerCase();
  if (EXAMPLE_FILE_BASENAMES.has(base)) return true;
  return EXAMPLE_FILE_SUFFIXES.some((suffix) => base.endsWith(suffix));
}
