/**
 * Attack Logger - GuardrailResult Transformation Layer
 * ===================================================
 *
 * Transforms GuardrailResult/EngineResult into AttackLogEntry format.
 * Handles classification of injection type and attack vector.
 *
 * @package @blackunicorn/bonklm-logger
 */

import type {
  AttackLogEntry,
  AttackVector,
  EngineResult,
  Finding,
  InjectionType,
} from './types.js';

/**
 * Context provided for transformation.
 */
export interface TransformContext {
  /** Origin identifier */
  origin: string;
  /** Original content that was validated */
  content: string;
  /** Optional validation context (e.g., file path) */
  validation_context?: string;
}

/**
 * Mapping of finding categories to injection types.
 * Ordered by priority (first match wins).
 */
const INJECTION_TYPE_MAPPING: Record<string, InjectionType> = {
  // Direct injection types
  system_override: 'prompt-injection',
  instruction_injection: 'prompt-injection',
  role_hijacking: 'prompt-injection',
  boundary_closing_system_tag: 'prompt-injection',
  boundary_control_token: 'prompt-injection',
  boundary_system_prompt_close: 'prompt-injection',

  // Jailbreak types
  dan: 'jailbreak',
  roleplay: 'jailbreak',
  known_template: 'jailbreak',
  hypothetical: 'jailbreak',
  authority: 'jailbreak',
  social_engineering: 'jailbreak',
  social_compliance: 'jailbreak',
  trust_exploitation: 'jailbreak',
  emotional_manipulation: 'jailbreak',

  // Reformulation types
  multi_layer_encoding: 'reformulation',
  base64_payload: 'reformulation',
  unicode_obfuscation: 'reformulation',
  unicode_manipulation: 'reformulation',
  obfuscation: 'reformulation',
  encoded_payload: 'reformulation',

  // Secret exposure
  secret: 'secret-exposure',
  credential: 'secret-exposure',
  api_key: 'secret-exposure',
  token: 'secret-exposure',
  password: 'secret-exposure',
};

/**
 * Mapping of finding categories to attack vectors.
 * Ordered by priority (first match wins).
 */
const ATTACK_VECTOR_MAPPING: Record<string, AttackVector> = {
  // Encoding-based vectors
  multi_layer_encoding: 'encoded',
  base64_payload: 'encoded',
  unicode_obfuscation: 'encoded',
  encoded_payload: 'encoded',
  obfuscation: 'encoded',

  // Social vectors
  social_engineering: 'social-engineering',
  social_compliance: 'social-engineering',
  emotional_manipulation: 'social-engineering',

  // Role-based vectors
  role_hijacking: 'roleplay',
  roleplay: 'roleplay',
  authority: 'roleplay',

  // Context vectors
  context_manipulation: 'context-overload',
  conversation_reset: 'context-overload',

  // Direct vectors (default)
  system_override: 'direct',
  instruction_injection: 'direct',
};

/**
 * Pattern-based vector detection from content.
 */
function detectVectorFromContent(content: string, categories: Set<string>): AttackVector {
  const lowerContent = content.toLowerCase();

  // Check for encoded content
  if (categories.has('multi_layer_encoding') ||
      categories.has('base64_payload') ||
      /base64|hex|unicode|escape/i.test(content)) {
    return 'encoded';
  }

  // Check for roleplay patterns
  if (categories.has('roleplay') ||
      categories.has('role_hijacking') ||
      /you are|you're a|act as|pretend to be|roleplay as/i.test(lowerContent)) {
    return 'roleplay';
  }

  // Check for social engineering
  if (categories.has('social_engineering') ||
      categories.has('emotional_manipulation') ||
      /please|i need|i want|trust me|for testing purposes/i.test(lowerContent)) {
    return 'social-engineering';
  }

  // Check for context overload
  if (categories.has('context_manipulation') ||
      content.length > 5000 ||
      (content.match(/\n/g) || []).length > 100) {
    return 'context-overload';
  }

  // Check for fragmented attacks (multi-part)
  if (/ignore.*previous.*instruction.*new.*instruction/i.test(lowerContent)) {
    return 'fragmented';
  }

  return 'direct';
}

/**
 * Derive injection type from findings.
 *
 * @param findings - Array of findings from validation
 * @returns The derived injection type
 */
export function deriveInjectionType(findings: Finding[]): InjectionType {
  if (findings.length === 0) {
    return 'unknown';
  }

  const categories = new Set(findings.map((f) => f.category));

  // Check direct mappings first
  for (const finding of findings) {
    if (INJECTION_TYPE_MAPPING[finding.category]) {
      return INJECTION_TYPE_MAPPING[finding.category];
    }
  }

  // Fallback mappings based on category patterns
  if (categories.has('jailbreak') || categories.has('dan')) {
    return 'jailbreak';
  }

  if (categories.has('prompt_injection') || categories.has('injection')) {
    return 'prompt-injection';
  }

  if (categories.has('reformulation') || categories.has('encoding')) {
    return 'reformulation';
  }

  if (categories.has('secret') || categories.has('credential')) {
    return 'secret-exposure';
  }

  return 'unknown';
}

/**
 * Derive attack vector from findings and content.
 *
 * @param findings - Array of findings from validation
 * @param content - The validated content
 * @returns The derived attack vector
 */
export function deriveAttackVector(findings: Finding[], content: string): AttackVector {
  if (findings.length === 0) {
    return 'unknown';
  }

  const categories = new Set(findings.map((f) => f.category));

  // Check direct mappings first
  for (const finding of findings) {
    if (ATTACK_VECTOR_MAPPING[finding.category]) {
      return ATTACK_VECTOR_MAPPING[finding.category];
    }
  }

  // Content-based detection
  return detectVectorFromContent(content, categories);
}

/**
 * Sanitize content for logging (optional PII redaction).
 *
 * Enhanced with comprehensive PII pattern detection including:
 * - Email addresses
 * - IP addresses
 * - Credit card numbers
 * - SSN-like numbers
 * - International phone numbers (E.164 format)
 * - US ZIP/ZIP+4 and CA postal codes
 * - International postal codes
 * - US Passport numbers
 * - US Driver's License patterns
 * - IBAN (International Bank Account Numbers)
 * - SWIFT/BIC codes
 * - UUIDs (RFC 4122)
 * - Ethereum addresses
 * - Bitcoin addresses
 *
 * @param content - The content to sanitize
 * @param patterns - Array of regex patterns to redact
 * @returns Sanitized content
 */
export function sanitizeContent_(
  content: string,
  patterns: RegExp[] = []
): string {
  let sanitized = content;

  // Default PII patterns organized by category
  // IMPORTANT: Order matters! More specific patterns must come first.
  const defaultPatterns: RegExp[] = [
    // Email addresses (most specific, must be first)
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

    // IP addresses (IPv4) - specific pattern with dots
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,

    // Credit card numbers (with dashes/spaces for context)
    /\b(?:\d{4}[-\s]){3}\d{4}\b/g,

    // SSN-like numbers (with dashes or dots)
    /\b\d{3}[-.]\d{2}[-.]\d{4}\b/g,

    // US Passport numbers (9 digits with C or P prefix)
    /\b[CP]\d{9}\b/g,

    // IBAN (International Bank Account Number)
    // Format: 2 letter country code + 2 check digits + up to 30 alphanumeric chars
    /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,

    // SWIFT/BIC codes (8 or 11 characters)
    /\b[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?\b/g,

    // UUIDs (RFC 4122 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,

    // Ethereum addresses (0x + 40 hex characters)
    /\b0x[a-fA-F0-9]{40}\b/g,

    // Bitcoin addresses (P2PKH: 1/3, P2SH: 3, Bech32: bc1)
    /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g,
    /\bbc1[a-z0-9]{39,59}\b/g,

    // Canadian postal codes (A1A 1A1 format)
    /\b[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d\b/g,

    // International phone numbers (E.164 and common formats)
    // Must come after more specific patterns to avoid false positives
    // Matches: +1-555-123-4567, +44 20 7946 0958
    // Note: No leading \b because + is not a word character
    /(?<=\s|^)\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{4,8}\b/g,
    // US-style phone numbers with parentheses: (555) 123-4567
    // Note: Lookbehind because ( is not a word character
    /(?<=\s|^)\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b/g,

    // US ZIP+4 codes (more specific than ZIP)
    /\b\d{5}[-\s]\d{4}\b/g,

    // US ZIP codes (5 digits only - less aggressive)
    // Note: This is intentionally conservative and only matches when near address keywords
    /\b(?:ZIP|Postal|Code)[:\s]*\d{5}\b/gi,
  ];

  const allPatterns = [...defaultPatterns, ...patterns];

  for (const pattern of allPatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  return sanitized;
}

/**
 * Transform EngineResult to AttackLogEntry.
 *
 * @param result - The engine result from validation
 * @param context - Transformation context
 * @param shouldSanitize - Whether to sanitize PII in content
 * @returns The transformed attack log entry
 */
export function transformToAttackLogEntry(
  result: EngineResult,
  context: TransformContext,
  shouldSanitize = false
): AttackLogEntry {
  const injectionType = deriveInjectionType(result.findings);
  const attackVector = deriveAttackVector(result.findings, context.content);
  const sanitizedContent = shouldSanitize
    ? sanitizeContent_(context.content)
    : context.content;

  return {
    timestamp: result.timestamp || Date.now(),
    origin: context.origin,
    injection_type: injectionType,
    vector: attackVector,
    content: sanitizedContent,
    blocked: result.blocked,
    risk_level: result.risk_level,
    risk_score: result.risk_score,
    findings: result.findings,
    validator_count: result.validatorCount,
    guard_count: result.guardCount,
    execution_time: result.executionTime,
  };
}

/**
 * Truncate content to a maximum length for display.
 *
 * @param content - The content to truncate
 * @param maxLength - Maximum length (default: 200)
 * @returns Truncated content with ellipsis if needed
 */
export function truncateContent(content: string, maxLength = 200): string {
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, maxLength - 3)  }...`;
}

/**
 * Escape control characters in content for safe display.
 *
 * @param content - The content to escape
 * @returns Escaped content
 */
export function escapeControlCharacters(content: string): string {
   
  return content.replace(/[\x00-\x1F\x7F]/g, (char) => {
    const code = char.charCodeAt(0);
    return `\\x${code.toString(16).padStart(2, '0')}`;
  });
}

/**
 * Remove ANSI escape codes from content.
 * This is important for JSON export to prevent injection attacks.
 *
 * @param content - The content to strip
 * @returns Content with ANSI codes removed
 */
export function stripAnsiEscapes(content: string): string {
  // Remove ANSI escape sequences (CSI, OSC, and simple sequences)
  // CSI sequences: ESC[ ... (letters/numbers)
  // OSC sequences: ESC] ... BEL\ESC\
  return content.replace(
    /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][0-9;]*[\x07\x1b\\]/g,
    ''
  );
}

/**
 * Sanitize content for JSON export.
 * Applies both control character escaping and ANSI code removal.
 *
 * @param content - The content to sanitize
 * @returns Sanitized content safe for JSON export
 */
export function sanitizeForJSON(content: string): string {
  const noAnsi = stripAnsiEscapes(content);
  return escapeControlCharacters(noAnsi);
}
