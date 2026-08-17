import { Severity } from '../../../base/GuardrailResult.js';
import type { PatternDefinition } from '../types.js';

/**
 * Pattern engine — encoded payload patterns
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
/**
 * Category D: Encoded Payload Patterns
 * Attempts to hide malicious content via encoding.
 */
export const ENCODED_PAYLOAD_PATTERNS: PatternDefinition[] = [
  {
    name: 'base64_encoded_content',
    pattern: /(?:eval|decode|execute|run)\s*\(\s*["']?[A-Za-z0-9+/=]{30,}["']?\s*\)/i,
    severity: Severity.WARNING,
    description: 'Base64 encoded payload with execution'
  },
  {
    name: 'hex_encoded_strings',
    pattern: /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){10,}/,
    severity: Severity.WARNING,
    description: 'Hex encoded string sequence'
  },
  {
    name: 'unicode_escape_sequences',
    pattern: /(?:\\u[0-9a-fA-F]{4}){5,}/,
    severity: Severity.WARNING,
    description: 'Unicode escape sequence obfuscation'
  }
];
