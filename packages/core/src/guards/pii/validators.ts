/**
 * BonkLM - PII Validators
 * ================================
 * Algorithmic validators for various PII formats.
 * These validate that detected patterns are actually valid IDs,
 * not just strings that happen to match the pattern.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface RedactionResult {
  original: string;
  redacted: string;
  patternName: string;
}

// ============================================================================
// PII REDACTION FUNCTIONS
// ============================================================================

/**
 * Redact a PII value while preserving its format.
 * Shows first 2 characters and last 4 characters with asterisks in between.
 * If the value is too short, shows format-preserving partial redaction.
 *
 * @param value - The PII value to redact
 * @param patternName - Optional pattern name for custom redaction formats
 * @returns Redacted value
 *
 * @example
 * redactPIIValue('123-45-6789', 'SSN') // '***-**-****'
 * redactPIIValue('john.doe@example.com', 'Email') // 'jo****@example.com'
 * redactPIIValue('AB') // 'A*'
 */
export function redactPIIValue(value: string, patternName?: string): string {
  if (!value || value.length <= 1) {
    return '*'.repeat(value.length || 1);
  }

  // Pattern-specific redaction formats
  const patternRedactions: Record<string, (v: string) => string> = {
    SSN: () => '***-**-****',
    US_Phone: () => '(***) ***-****',
    Credit_Card: () => '**** **** **** ****',
    Email: (v: string) => {
      const parts = v.split('@');
      if (parts.length === 2) {
        const local = parts[0];
        const domain = parts[1];
        const localLen = local.length;
        if (localLen <= 2) {
          return `${'*'.repeat(localLen)}@${domain}`;
        }
        return `${local.slice(0, 2)}${'*'.repeat(Math.min(localLen - 2, 8))}@${domain}`;
      }
      return redactGeneric(value);
    },
    IP_Address: () => '*.***.***.***'
  };

  if (patternName && patternRedactions[patternName]) {
    return patternRedactions[patternName](value);
  }

  // Generic format-preserving redaction
  return redactGeneric(value);
}

/**
 * Generic format-preserving redaction.
 * Shows first 2 chars and last 4 chars with exactly 4 asterisks in between.
 * If value is shorter than 6 chars, shows appropriate number of asterisks.
 */
function redactGeneric(value: string): string {
  const len = value.length;

  if (len <= 2) {
    return value[0] + '*'.repeat(len - 1);
  }

  if (len <= 6) {
    return value.slice(0, 2) + '*'.repeat(len - 2);
  }

  // Show first 2, exactly 4 asterisks, and last 4
  // For values longer than 10 chars, still show only 4 asterisks
  if (len > 10) {
    return `${value.slice(0, 2)}****${value.slice(-4)}`;
  }

  // For values 7-10 chars, show first 2, last 4, with asterisks for middle
  return `${value.slice(0, 2)}${'*'.repeat(len - 6)}${value.slice(-4)}`;
}

/**
 * Redact all PII values in a string using pattern matching.
 * Replaces detected PII with format-preserving redactions.
 *
 * @param content - The content to redact PII from
 * @returns Content with PII redacted
 */
export async function redactPIIInString(content: string): Promise<string> {
  if (!content) return content;

  let redacted = content;

  // Import patterns dynamically to avoid circular dependency
  const patterns = await getRedactionPatterns();

  for (const { regex, name, redactionMask } of patterns) {
    regex.lastIndex = 0;
    redacted = redacted.replace(regex, match => {
      return redactionMask || redactPIIValue(match, name);
    });
  }

  return redacted;
}

/**
 * Get patterns for redaction (cached to avoid repeated imports).
 */
let cachedRedactionPatterns: Array<{ regex: RegExp; name: string; redactionMask?: string }> | null = null;
let redactionPatternsPromise: Promise<Array<{ regex: RegExp; name: string; redactionMask?: string }>> | null = null;

async function getRedactionPatterns(): Promise<Array<{ regex: RegExp; name: string; redactionMask?: string }>> {
  if (cachedRedactionPatterns) {
    return cachedRedactionPatterns;
  }

  // Return existing promise if already loading
  if (redactionPatternsPromise) {
    return redactionPatternsPromise;
  }

  // Create promise and cache it
  redactionPatternsPromise = (async () => {
    // Dynamic import for ESM compatibility
    const patternsModule = await import('./patterns.js');
    const { ALL_PATTERNS } = patternsModule;

    cachedRedactionPatterns = ALL_PATTERNS.map((p: any) => ({
      regex: new RegExp(p.regex.source, p.regex.flags),
      name: p.name,
      redactionMask: p.redactionMask
    }));

    return cachedRedactionPatterns;
  })();

  return redactionPatternsPromise;
}

/**
 * Synchronous version of redactPIIInString.
 * Note: This requires patterns to be loaded first via async call.
 *
 * @param content - The content to redact PII from
 * @returns Content with PII redacted (or original if patterns not loaded)
 */
export function redactPIIInStringSync(content: string): string {
  if (!content) return content;
  if (!cachedRedactionPatterns) {
    // Patterns not loaded yet, return original content
    // In production, this would log a warning
    return content;
  }

  let redacted = content;

  for (const { regex, name, redactionMask } of cachedRedactionPatterns) {
    regex.lastIndex = 0;
    redacted = redacted.replace(regex, match => {
      return redactionMask || redactPIIValue(match, name);
    });
  }

  return redacted;
}

/**
 * Redact PII values in an object recursively.
 * Handles nested objects and arrays.
 *
 * @param obj - The object to redact PII from
 * @returns Object with PII values redacted
 */
export function redactPIIInObject(obj: Record<string, unknown>): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const redacted: Record<string, unknown> = { ...obj };

  for (const key of Object.keys(redacted)) {
    const value = redacted[key];

    if (typeof value === 'string') {
      // Redact PII in string values (use sync version)
      redacted[key] = redactPIIInStringSync(value);
    } else if (Array.isArray(value)) {
      // Recursively redact array elements
      redacted[key] = value.map(item =>
        typeof item === 'string'
          ? redactPIIInStringSync(item)
          : typeof item === 'object' && item !== null
            ? redactPIIInObject(item as Record<string, unknown>)
            : item
      );
    } else if (typeof value === 'object' && value !== null) {
      // Recursively redact nested objects
      redacted[key] = redactPIIInObject(value as Record<string, unknown>);
    }
  }

  return redacted;
}

/**
 * Luhn algorithm for credit cards and Swedish personnummer.
 * Validates the checksum of a number.
 */
export function validateLuhn(number: string): boolean {
  if (!number || typeof number !== 'string') {
    return false;
  }
  const digits = number.replace(/\D/g, '').split('').map(Number);

  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let checksum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits[i];
    if ((digits.length - 1 - i) % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    checksum += digit;
  }

  return checksum % 10 === 0;
}

/**
 * IBAN MOD 97-10 validation.
 * International Bank Account Number validation.
 */
export function validateIban(iban: string): boolean {
  if (!iban || typeof iban !== 'string') {
    return false;
  }
  const cleaned = iban.replace(/\s/g, '').toUpperCase();

  if (cleaned.length < 15 || cleaned.length > 34) {
    return false;
  }

  // Move first 4 chars to end
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);

  // Convert letters to numbers (A=10, B=11, etc.)
  let converted = '';
  for (const char of rearranged) {
    if (char >= '0' && char <= '9') {
      converted += char;
    } else if (char >= 'A' && char <= 'Z') {
      converted += (char.charCodeAt(0) - 55).toString();
    } else {
      return false; // Invalid character
    }
  }

  // Calculate modulo 97 on the large number
  // Process in chunks to avoid overflow
  let remainder = 0;
  for (let i = 0; i < converted.length; i += 7) {
    const chunk = converted.slice(i, i + 7);
    remainder = parseInt(remainder.toString() + chunk, 10) % 97;
  }

  return remainder === 1;
}

/**
 * ABA Routing Number validation.
 * US bank routing number with weighted checksum.
 */
export function validateAbaRouting(routing: string): boolean {
  const digits = routing.replace(/\D/g, '');

  if (digits.length !== 9) {
    return false;
  }

  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let total = 0;

  for (let i = 0; i < 9; i++) {
    total += parseInt(digits[i], 10) * weights[i];
  }

  return total % 10 === 0;
}

/**
 * UK NHS Number validation (MOD 11).
 * 10-digit number with weighted checksum.
 */
export function validateNhsNumber(nhs: string): boolean {
  const digits = nhs.replace(/\D/g, '');

  if (digits.length !== 10) {
    return false;
  }

  const weights = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  let total = 0;

  for (let i = 0; i < 9; i++) {
    total += parseInt(digits[i], 10) * weights[i];
  }

  const remainder = total % 11;
  const checkDigit = remainder === 0 ? 0 : 11 - remainder;

  // Check digit must be less than 10 and match the 10th digit
  if (checkDigit >= 10) {
    return false;
  }

  return checkDigit === parseInt(digits[9], 10);
}

/**
 * German Tax ID (Steuer-ID) validation.
 * 11 digits, first digit non-zero, at least one digit appears 2+ times in first 10.
 */
export function validateGermanTaxId(taxId: string): boolean {
  const digits = taxId.replace(/\D/g, '');

  if (digits.length !== 11) {
    return false;
  }

  // First digit cannot be 0
  if (digits[0] === '0') {
    return false;
  }

  // Count frequency of each digit in first 10 digits
  const freq = new Map<string, number>();
  for (let i = 0; i < 10; i++) {
    const d = digits[i];
    freq.set(d, (freq.get(d) || 0) + 1);
  }

  // At least one digit must appear 2+ times
  let hasDoubleOrTriple = false;
  for (const count of freq.values()) {
    if (count >= 2) {
      hasDoubleOrTriple = true;
      break;
    }
  }

  return hasDoubleOrTriple;
}

/**
 * Spanish DNI validation.
 * 8 digits + control letter.
 */
export function validateSpanishDni(dni: string): boolean {
  const cleaned = dni.toUpperCase();
  const match = cleaned.match(/^(\d{8})([A-Z])$/);

  if (!match) {
    return false;
  }

  const number = parseInt(match[1], 10);
  const letter = match[2];

  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  const expectedLetter = letters[number % 23];

  return letter === expectedLetter;
}

/**
 * Spanish NIE validation.
 * X/Y/Z + 7 digits + control letter.
 */
export function validateSpanishNie(nie: string): boolean {
  const cleaned = nie.toUpperCase();
  const match = cleaned.match(/^([XYZ])(\d{7})([A-Z])$/);

  if (!match) {
    return false;
  }

  const prefix = match[1];
  const number = match[2];
  const letter = match[3];

  // Map prefix to digit
  const prefixMap: Record<string, string> = { X: '0', Y: '1', Z: '2' };
  const fullNumber = parseInt(prefixMap[prefix] + number, 10);

  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  const expectedLetter = letters[fullNumber % 23];

  return letter === expectedLetter;
}

/**
 * Dutch BSN (Burgerservicenummer) validation.
 * 9 digits with "11-proof" checksum.
 */
export function validateDutchBsn(bsn: string): boolean {
  const digits = bsn.replace(/\D/g, '');

  if (digits.length !== 9) {
    return false;
  }

  const weights = [9, 8, 7, 6, 5, 4, 3, 2, -1];
  let total = 0;

  for (let i = 0; i < 9; i++) {
    total += parseInt(digits[i], 10) * weights[i];
  }

  return total % 11 === 0;
}

/**
 * Polish PESEL validation.
 * 11 digits with weighted checksum.
 */
export function validatePolishPesel(pesel: string): boolean {
  const digits = pesel.replace(/\D/g, '');

  if (digits.length !== 11) {
    return false;
  }

  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let total = 0;

  for (let i = 0; i < 10; i++) {
    total += parseInt(digits[i], 10) * weights[i];
  }

  const checkDigit = (10 - (total % 10)) % 10;

  return checkDigit === parseInt(digits[10], 10);
}

/**
 * Portuguese NIF validation.
 * 9 digits with weighted checksum.
 */
export function validatePortugueseNif(nif: string): boolean {
  const digits = nif.replace(/\D/g, '');

  if (digits.length !== 9) {
    return false;
  }

  // First digit must be 1, 2, 5, 6, 8, or 9
  if (!['1', '2', '5', '6', '8', '9'].includes(digits[0])) {
    return false;
  }

  const weights = [9, 8, 7, 6, 5, 4, 3, 2];
  let total = 0;

  for (let i = 0; i < 8; i++) {
    total += parseInt(digits[i], 10) * weights[i];
  }

  const remainder = total % 11;
  const checkDigit = remainder < 2 ? 0 : 11 - remainder;

  return checkDigit === parseInt(digits[8], 10);
}

/**
 * Swedish Personnummer validation.
 * 10 digits (after removing separator) validated with Luhn.
 */
export function validateSwedishPersonnummer(pn: string): boolean {
  // Remove separators (- or +)
  const digits = pn.replace(/[-+]/g, '');

  if (digits.length !== 10) {
    return false;
  }

  // Use Luhn algorithm on 10 digits
  let checksum = 0;
  for (let i = 0; i < 10; i++) {
    let digit = parseInt(digits[i], 10);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    checksum += digit;
  }

  return checksum % 10 === 0;
}

/**
 * ISO 3166-1 alpha-2 country codes. Positions 5-6 of a valid BIC/SWIFT code are
 * one of these — see {@link validateBicSwift}. Includes the officially-assigned
 * set plus `XK` (Kosovo), which is user-assigned in ISO 3166-1 but is used by
 * SWIFT for Kosovan BICs, so omitting it would reject genuine identifiers.
 */
const ISO_3166_ALPHA2 = new Set<string>(
  (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS ' +
    'BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE ' +
    'EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM ' +
    'HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC ' +
    'LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA ' +
    'NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
    'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO ' +
    'TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW ' +
    'XK'
  ).split(' ')
);

/** Full ISO 9362 BIC shape: 4-letter institution + 2-letter country + 2-char location + optional 3-char branch. */
const BIC_SHAPE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

/**
 * BIC / SWIFT validation (ISO 9362).
 *
 * The pattern that surfaces candidates (`[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(...)?`)
 * matches any 8- or 11-character uppercase token, including ordinary English
 * words such as "INFORMATION". A genuine BIC embeds a 2-letter ISO 3166-1
 * country code in positions 5-6; validating it against the official code set
 * rejects the word collisions while accepting every real bank identifier
 * (whose country code is valid by construction).
 */
export function validateBicSwift(bic: string): boolean {
  if (!bic || typeof bic !== 'string') {
    return false;
  }
  const value = bic.toUpperCase();
  // Enforce the full ISO 9362 shape (not just length) so the validator is correct
  // when called standalone, not only behind the surfacing pattern.
  if (!BIC_SHAPE.test(value)) {
    return false;
  }
  return ISO_3166_ALPHA2.has(value.slice(4, 6));
}
