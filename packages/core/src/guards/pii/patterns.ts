/**
 * BonkLM - PII Patterns
 * ==============================
 * Pattern definitions for detecting PII in content.
 * Includes US, EU, and common international patterns.
 */

import * as validators from './validators.js';

// ============================================================================
// TYPES
// ============================================================================

export type PiiSeverity = 'critical' | 'warning' | 'info';

export interface PiiPattern {
  name: string;
  regex: RegExp;
  severity: PiiSeverity;
  validator?: (value: string) => boolean;
  contextRequired: boolean;
  /**
   * When `contextRequired` is true, restrict the surrounding-context scan to
   * these patterns INSTEAD of the broad {@link SENSITIVE_CONTEXT_PATTERNS}.
   * Used to give a format-ambiguous pattern (e.g. BIC_SWIFT, which collides
   * with all-caps English words) a domain-specific context gate.
   */
  contextPatterns?: RegExp[];
  redactionMask?: string;
}

// ============================================================================
// DOMAIN-SPECIFIC CONTEXT PATTERNS
// ============================================================================

/**
 * Banking-specific context for the BIC_SWIFT pattern. A real BIC always appears
 * alongside payment terminology; requiring it (instead of the broad
 * {@link SENSITIVE_CONTEXT_PATTERNS}) stops the 8/11-char uppercase shape from
 * matching ordinary all-caps English words in non-financial sensitive prose.
 */
export const BIC_CONTEXT_PATTERNS: RegExp[] = [
  /\b(?:swift|bic)(?:\s*(?:\/\s*bic|code|number|address))?\b/i,
  /\b(?:iban|sepa|sort\s*code|bank\s*code|bank\s*identifier|routing\s*(?:number|no|aba))\b/i,
  /\b(?:beneficiary|correspondent|intermediary)\s+bank\b/i,
  /\b(?:wire|bank)\s+transfer\b/i,
  /\b(?:remittance|payee\s+bank|account\s+with\s+institution)\b/i
];

// ============================================================================
// US PATTERNS
// ============================================================================

export const US_PATTERNS: PiiPattern[] = [
  {
    // Two alternatives so a bare 9-digit integer (request counters, token
    // totals, byte sizes) is NOT treated as an SSN, WITHOUT losing the common
    // labelled-but-unformatted form (`SSN: 123456789`):
    //   1. Separator-delimited form `AAA-GG-SSSS` / `AAA GG SSSS` — separators
    //      are MANDATORY (`[-\s]`, not `[-\s]?`).
    //   2. Unformatted 9-digit run, but ONLY when preceded by an explicit SSN
    //      keyword (ssn / social security / tax id) within a short non-digit
    //      window via lookbehind — so `SSN: 123456789`, `SSN is 123456789`,
    //      `tax id no. 123456789` are caught while bare numeric data is not.
    //      The `[^\d\n]{0,16}` gap allows a short connector but cannot span a
    //      line or another number.
    // Both keep the valid-SSN area/group/serial constraints (no 000/666/9xx
    // area, no 00 group, no 0000 serial).
    name: 'SSN',
    regex:
      /\b(?!000|666|9\d{2})\d{3}[-\s](?!00)\d{2}[-\s](?!0000)\d{4}\b|(?<=(?:\bssn\b|\bsocial[\s-]*security(?:[\s-]*(?:number|no|num|#))?\b|\btax[\s-]*id(?:entification)?(?:[\s-]*(?:number|no|num|#))?\b)[^\d\n]{0,16})(?!000|666|9\d{2})\d{3}(?!00)\d{2}(?!0000)\d{4}\b/gi,
    severity: 'critical',
    contextRequired: false,
    redactionMask: '***-**-****'
  },
  {
    name: 'US_Phone',
    regex: /\b(?:\+1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    severity: 'warning',
    contextRequired: true,
    redactionMask: '(***) ***-****'
  },
  {
    name: 'Drivers_License_CA',
    regex: /\b[A-Z]\d{7}\b/g,
    severity: 'warning',
    contextRequired: true
  },
  {
    name: 'US_Passport',
    regex: /\b[A-Z]\d{8}\b/g,
    severity: 'critical',
    contextRequired: true
  },
  {
    name: 'ABA_Routing',
    regex: /\b(?:0[1-9]|[1-2]\d|3[0-2])\d{7}\b/g,
    severity: 'critical',
    validator: validators.validateAbaRouting,
    contextRequired: true
  },
  {
    name: 'Medicare_ID',
    regex: /\b[1-9][A-Z][A-Z0-9]\d-?[A-Z][A-Z0-9]\d-?[A-Z]{2}\d{2}\b/g,
    severity: 'critical',
    contextRequired: false
  },
  {
    name: 'ITIN',
    regex: /\b9\d{2}[-\s]?[78]\d[-\s]?\d{4}\b/g,
    severity: 'critical',
    contextRequired: false
  }
];

// ============================================================================
// EU PATTERNS
// ============================================================================

export const EU_PATTERNS: PiiPattern[] = [
  {
    name: 'IBAN',
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g,
    severity: 'critical',
    validator: validators.validateIban,
    contextRequired: false
  },
  {
    // The loose `[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}` shape matches any 8/11-char
    // uppercase token (e.g. the English word "INFORMATION"). Two precision
    // gates: `validateBicSwift` enforces the ISO 9362 invariant (positions 5-6
    // are a real ISO 3166-1 country code, plus a common-word denylist for words
    // whose bigram coincidentally is a country code, e.g. INSTRUCTION→RU); and
    // `contextPatterns` requires BANKING-specific context (SWIFT/IBAN/bank
    // code…) rather than the broad sensitive-context list, since a real BIC
    // never appears without payment context.
    name: 'BIC_SWIFT',
    regex: /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g,
    severity: 'warning',
    validator: validators.validateBicSwift,
    contextRequired: true,
    contextPatterns: BIC_CONTEXT_PATTERNS
  },
  {
    name: 'UK_NINO',
    regex: /\b[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi,
    severity: 'critical',
    contextRequired: false
  },
  {
    name: 'UK_NHS',
    regex: /\b\d{3}[-\s]?\d{3}[-\s]?\d{4}\b/g,
    severity: 'critical',
    validator: validators.validateNhsNumber,
    contextRequired: true
  },
  {
    name: 'German_Tax_ID',
    regex: /\b\d{11}\b/g,
    severity: 'critical',
    validator: validators.validateGermanTaxId,
    contextRequired: true
  },
  {
    name: 'German_Social_Insurance',
    regex: /\b\d{2}[0-3]\d[0-1]\d{2}\d[A-Z]\d{3}\d\b/g,
    severity: 'critical',
    contextRequired: false
  },
  {
    name: 'French_NIR',
    regex: /\b[12]\s?\d{2}\s?(?:0[1-9]|1[0-2]|[2-9]\d)\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g,
    severity: 'critical',
    contextRequired: false
  },
  {
    name: 'Spanish_DNI',
    regex: /\b\d{8}[A-Z]\b/gi,
    severity: 'critical',
    validator: validators.validateSpanishDni,
    contextRequired: false
  },
  {
    name: 'Spanish_NIE',
    regex: /\b[XYZ]\d{7}[A-Z]\b/gi,
    severity: 'critical',
    validator: validators.validateSpanishNie,
    contextRequired: false
  },
  {
    name: 'Italian_Codice_Fiscale',
    regex: /\b[A-Z]{6}\d{2}[A-EHLMPRST][0-3]\d[A-Z]\d{3}[A-Z]\b/gi,
    severity: 'critical',
    contextRequired: false
  },
  {
    name: 'Dutch_BSN',
    regex: /\b\d{9}\b/g,
    severity: 'critical',
    validator: validators.validateDutchBsn,
    contextRequired: true
  },
  {
    name: 'Belgian_National',
    regex: /\b\d{2}[.\s]?\d{2}[.\s]?\d{2}[-.\s]?\d{3}[-.\s]?\d{2}\b/g,
    severity: 'critical',
    contextRequired: false
  },
  {
    name: 'Polish_PESEL',
    regex: /\b\d{11}\b/g,
    severity: 'critical',
    validator: validators.validatePolishPesel,
    contextRequired: true
  },
  {
    name: 'Portuguese_NIF',
    regex: /\b[1-9]\d{8}\b/g,
    severity: 'critical',
    validator: validators.validatePortugueseNif,
    contextRequired: true
  },
  {
    name: 'Austrian_Social_Insurance',
    regex: /\b\d{4}[0-3]\d[01]\d{2}\d\b/g,
    severity: 'critical',
    contextRequired: true
  },
  {
    name: 'Swedish_Personnummer',
    regex: /\b\d{6}[-+]?\d{4}\b/g,
    severity: 'critical',
    validator: validators.validateSwedishPersonnummer,
    contextRequired: false
  },
  {
    name: 'Finnish_HETU',
    regex: /\b\d{6}[-+A]\d{3}[0-9A-Y]\b/gi,
    severity: 'critical',
    contextRequired: false
  },
  {
    name: 'EU_VAT',
    regex:
      /\b(?:ATU|BE0?|BG|CY|CZ|DE|DK|EE|EL|ES[A-Z]?|FI|FR[A-Z0-9]{2}|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[0-9A-Z]{8,12}\b/g,
    severity: 'warning',
    contextRequired: true
  }
];

// ============================================================================
// COMMON PATTERNS
// ============================================================================

export const COMMON_PATTERNS: PiiPattern[] = [
  {
    name: 'Credit_Card',
    regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    severity: 'critical',
    validator: validators.validateLuhn,
    contextRequired: false,
    redactionMask: '**** **** **** ****'
  },
  {
    name: 'Email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    severity: 'info',
    contextRequired: true
  },
  {
    name: 'IP_Address',
    regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    severity: 'info',
    contextRequired: true
  },
  {
    name: 'DOB',
    regex: /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12][0-9]|3[01])[-/](?:19|20)\d{2}\b/g,
    severity: 'warning',
    contextRequired: true
  },
  {
    name: 'MAC_Address',
    regex: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,
    severity: 'info',
    contextRequired: true
  }
];

// ============================================================================
// COMBINED PATTERNS
// ============================================================================

export const ALL_PATTERNS: PiiPattern[] = [...US_PATTERNS, ...EU_PATTERNS, ...COMMON_PATTERNS];

// ============================================================================
// CONTEXT DETECTION PATTERNS
// ============================================================================

/** Patterns that indicate sensitive context */
export const SENSITIVE_CONTEXT_PATTERNS: RegExp[] = [
  /\b(?:personal|private|confidential|sensitive)\b/i,
  /(?:patient|client|customer|employee|user)\s+(?:data|info|record|detail)/i,
  /(?:medical|health|financial|banking)\s+(?:record|data|info)/i,
  /(?:ssn|social\s*security|tax\s*id|national\s*id)/i,
  /(?:passport|driver.?s?\s*licen[sc]e|birth\s*date|dob)\b/i,
  /(?:credit\s*card|bank\s*account|routing\s*number|iban)\b/i,
  /(?:address|phone|email|contact)\s+(?:info|detail|list)/i,
  /(?:gdpr|pii|hipaa|pci[-\s]?dss)\b/i
];

/** Patterns that indicate fake/test data */
export const FAKE_DATA_INDICATORS: RegExp[] = [
  /\b(?:fake|test|mock|dummy|sample|example|placeholder)\b/i,
  /\b(?:john\s*doe|jane\s*doe|test\s*user)\b/i,
  /\b(?:xxx+|000-00-0000|123-45-6789)\b/i,
  /\b(?:your[-_]?(?:ssn|id|number))\b/i,
  /(?:<replace>|<your[-_]|insert[-_]here)/i
];

/** Path indicators for test files */
export const TEST_FILE_INDICATORS: string[] = [
  'test_data',
  'mock_data',
  'sample_data',
  'fixtures',
  'seeds',
  '.example',
  '.sample',
  '.template',
  'fake_',
  '_fake',
  'dummy_',
  '_dummy'
];
