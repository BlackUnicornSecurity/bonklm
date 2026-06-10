import { gatherText } from '../input.js';
import { normalizeText } from '../normalize.js';

/**
 * Jailbreak guard — detects attempts to disable model safeguards.
 *
 * Posture (this repo authors/discusses attack strings, so it is tuned tight):
 *   - HARD BLOCK only on UNAMBIGUOUS named-jailbreak templates / explicit
 *     "enable X mode" — phrasings no one types in normal development.
 *   - WARN (advisory, non-blocking) on softer patterns (ignore-previous,
 *     unrestricted-roleplay, prompt-extraction) that a security developer may
 *     legitimately type while working on detection itself.
 * Input is normalized (NFKC + zero-width strip + lowercase) before matching.
 */

const BLOCK_PATTERNS = [
  { re: /\b(?:dan|do anything now)\b[^.\n]{0,40}\b(?:mode|enabled|activated|jailbreak|jailbroken)\b/, name: 'DAN mode' },
  { re: /\b(?:stan|dude|aim|ucar|apophis)\s+(?:mode|persona|personality)\b/, name: 'named jailbreak persona' },
  { re: /\benable\s+(?:developer|dan|god|unrestricted)\s+mode\b/, name: 'enable special mode' },
];

const WARN_PATTERNS = [
  { re: /\bignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|messages?|context|rules?)\b/, name: 'ignore-previous-instructions' },
  { re: /\bdisregard\s+(?:all\s+)?(?:previous|prior|above|your)\s+(?:instructions?|rules?|guidelines?)\b/, name: 'disregard-instructions' },
  { re: /\b(?:you are|act as|roleplay as|pretend to be)\b[^.\n]{0,30}\b(?:unrestricted|unfiltered|uncensored|jailbroken)\b/, name: 'unrestricted-persona roleplay' },
  { re: /\b(?:reveal|show|print|repeat|display|output)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:system\s+)?(?:prompt|instructions)\b/, name: 'system-prompt extraction' },
];

/**
 * @param {string} text
 * @returns {{action:'block'|'warn'|'allow', name?:string}}
 */
export function analyzeJailbreak(text) {
  const normalized = normalizeText(text);
  if (!normalized) return { action: 'allow' };
  for (const { re, name } of BLOCK_PATTERNS) {
    if (re.test(normalized)) return { action: 'block', name };
  }
  for (const { re, name } of WARN_PATTERNS) {
    if (re.test(normalized)) return { action: 'warn', name };
  }
  return { action: 'allow' };
}

/**
 * @param {object} input - parsed hook input
 * @returns {object|null}
 */
export function validateJailbreak(input) {
  const text = gatherText(input);
  if (!text) return null;

  const result = analyzeJailbreak(text);
  if (result.action === 'block') {
    return {
      block: true,
      title: 'JAILBREAK ATTEMPT BLOCKED',
      reason: `Input matches a high-confidence jailbreak template (${result.name}).`,
      target: '(prompt/content)',
      recommendations: ['This pattern is associated with attempts to disable model safeguards.'],
    };
  }
  if (result.action === 'warn') {
    return { warn: true, reason: `possible jailbreak pattern (${result.name}) — advisory only` };
  }
  return null;
}
