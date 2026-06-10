import { gatherText } from '../input.js';
import { isExampleContext } from '../example-content.js';

/**
 * PII guard — blocks writing high-confidence, high-harm personal data.
 *
 * Posture: HARD BLOCK on a US SSN (with invalid-range exclusions) or a
 * brand-prefixed, Luhn-valid payment card number. Deliberately conservative:
 * emails and phone numbers are NOT flagged (far too common in code/docs to block
 * safely). Example/placeholder lines are skipped.
 */

// SSN with invalid-area / group / serial exclusions to cut false positives.
const SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/;

// Candidate payment-card numbers: known brand prefixes, 13-19 digits in 2-3 groups.
// Global so a line with several candidates (e.g. an invalid one before a valid one)
// is fully scanned, not just the first match.
const CC_CANDIDATE =
  /\b(?:4[0-9]{3}|5[1-5][0-9]{2}|2(?:22[1-9]|2[3-9][0-9]|[3-6][0-9]{2}|7[01][0-9]|720)|3[47][0-9]{2}|6(?:011|5[0-9]{2}))(?:[ -]?[0-9]{4}){2,3}\b/g;

// Universally-published test card numbers (Visa/MC/Amex/Discover). These are not
// real PANs; this repo legitimately writes them into payment-detection fixtures, so
// they must not trip the guard. Synthetic only — no real card data.
const KNOWN_TEST_PANS = new Set([
  '4111111111111111', '4012888888881881', '4222222222222', '4242424242424242',
  '5555555555554444', '5105105105105100', '2223003122003222',
  '378282246310005', '371449635398431', '6011111111111117', '6011000990139424',
]);

/**
 * Luhn checksum + length gate (13-19 digits).
 * @param {string} digits - digits only.
 * @returns {boolean}
 */
export function luhnValid(digits) {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * @param {string} text
 * @returns {{type:string, line:number}|null}
 */
export function findPii(text) {
  if (!text) return null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isExampleContext(line)) continue;
    if (SSN.test(line)) {
      return { type: 'US Social Security Number', line: i + 1 };
    }
    for (const match of line.matchAll(CC_CANDIDATE)) {
      const digits = match[0].replace(/[ -]/g, '');
      if (luhnValid(digits) && !KNOWN_TEST_PANS.has(digits)) {
        return { type: 'payment card number', line: i + 1 };
      }
    }
  }
  return null;
}

/**
 * @param {object} input - parsed hook input
 * @returns {object|null}
 */
export function validatePii(input) {
  const found = findPii(gatherText(input));
  if (!found) return null;
  return {
    block: true,
    title: 'PII DETECTED',
    reason: `Possible ${found.type} on line ${found.line} of the content.`,
    target: '(content)',
    recommendations: [
      'Remove or redact personal data before writing it to a file.',
      'If this is synthetic/sample data, mark the line as an example.',
    ],
  };
}
