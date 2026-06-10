import { gatherText } from '../input.js';
import { normalizeText } from '../normalize.js';

/**
 * Prompt-injection guard — surfaces classic injection markers in prompts and in
 * content being written.
 *
 * Posture: WARN (advisory, non-blocking). The developer's own prompt is trusted,
 * and this repo legitimately writes injection payloads into test fixtures, so a
 * hard block would brick normal work. The guard still provides real value:
 * visibility when injection markers appear (e.g. if `prompt`/content were ever
 * populated from an untrusted source). All patterns are anchored/bounded.
 */

const INJECTION_PATTERNS = [
  { re: /\bignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|context)\b/, name: 'ignore-previous-instructions' },
  { re: /\b(?:new|updated|revised)\s+(?:system\s+)?instructions?\s*:/, name: 'instruction-override' },
  { re: /\bsystem\s*(?:prompt|message)\s*:/, name: 'system-prompt-marker' },
  { re: /\b(?:you are now|from now on,?\s+you)\b/, name: 'persona-reset' },
  { re: /<\s*\/?\s*(?:system|important|admin|instructions)\s*>/, name: 'pseudo-tag-injection' },
  { re: /\bdisregard\s+(?:your\s+)?(?:guidelines|rules|instructions|safety|training)\b/, name: 'disregard-guidelines' },
];

/**
 * @param {string} text
 * @returns {string[]} names of matched injection patterns.
 */
export function detectInjection(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const hits = [];
  for (const { re, name } of INJECTION_PATTERNS) {
    if (re.test(normalized)) hits.push(name);
  }
  return hits;
}

/**
 * @param {object} input - parsed hook input
 * @returns {object|null}
 */
export function validatePromptInjection(input) {
  const hits = detectInjection(gatherText(input));
  if (hits.length === 0) return null;
  return {
    warn: true,
    reason: `possible prompt-injection pattern(s): ${hits.slice(0, 3).join(', ')} — advisory (content guards do not block in this repo)`,
  };
}
