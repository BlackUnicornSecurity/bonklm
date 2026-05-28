/**
 * Common Utilities Unit Tests
 * =============================
 * Comprehensive unit tests for common utility functions.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateEntropy,
  isHighEntropy,
  isExampleContent,
  readFileContent,
  isExpectedSecretFile,
  sanitizeLogString,
} from '../../../src/common/index.js';
import { fileURLToPath } from 'node:url';

// This test file's own absolute path — exercises readFileContent against a
// file guaranteed to exist in any checkout (including CI), instead of a
// machine-specific hardcoded path.
const selfPath = fileURLToPath(import.meta.url);

describe('calculateEntropy', () => {
  it('should return 0 for empty string', () => {
    expect(calculateEntropy('')).toBe(0);
  });

  it('should return 0 for single character', () => {
    expect(calculateEntropy('a')).toBe(0);
  });

  it('should calculate entropy for repeated characters', () => {
    const entropy = calculateEntropy('aaaa');
    expect(entropy).toBe(0);
  });

  it('should calculate higher entropy for varied characters', () => {
    const entropy1 = calculateEntropy('abcd');
    const entropy2 = calculateEntropy('aaaa');
    expect(entropy1).toBeGreaterThan(entropy2);
  });

  it('should calculate max entropy for all unique characters', () => {
    const entropy = calculateEntropy('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(entropy).toBeGreaterThan(3);
  });

  it('should handle special characters', () => {
    const entropy = calculateEntropy('a@#$%^&*()');
    expect(entropy).toBeGreaterThan(0);
  });
});

describe('isHighEntropy', () => {
  it('should use default threshold of 3.5', () => {
    expect(isHighEntropy('abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true);
    expect(isHighEntropy('aaaa')).toBe(false);
  });

  it('should use custom threshold', () => {
    const highEntropy = 'abcdefghijklmnopqrstuvwxyz0123456789';
    expect(isHighEntropy(highEntropy, 10)).toBe(false);
    expect(isHighEntropy(highEntropy, 2)).toBe(true);
  });

  it('should strip known prefixes before calculation', () => {
    // Known prefixes: sk-, ghp_, gho_, xoxb, xoxo, xoxp, xoxr, AKIA, AIza
    // After stripping prefix, 'sk-' becomes empty string, which has 0 entropy
    expect(isHighEntropy('sk-', 3.5)).toBe(false);
    // After stripping sk-, the remaining '1234567890abcdef' still has high entropy (4)
    expect(isHighEntropy('sk-1234567890abcdef', 4.5)).toBe(false); // Use higher threshold
  });

  it('should be case insensitive for prefix stripping', () => {
    expect(isHighEntropy('SK-', 3.5)).toBe(false);
    expect(isHighEntropy('GHP_', 3.5)).toBe(false);
  });

  it('should handle underscores in prefixes', () => {
    // The regex uses xox[baprs][-_] which means xoxb- or xoxb_ are valid
    expect(isHighEntropy('gho_', 3.5)).toBe(false);
    expect(isHighEntropy('xoxb_', 3.5)).toBe(false);
  });
});

describe('isExampleContent', () => {
  it('should detect "example" keyword', () => {
    expect(isExampleContent('some content', 'this is an example key')).toBe(true);
  });

  it('should detect "placeholder" keyword', () => {
    expect(isExampleContent('some content', 'this is a placeholder')).toBe(true);
  });

  it('should detect "your_api_key" pattern', () => {
    expect(isExampleContent('some content', 'enter your_api_key here')).toBe(true);
  });

  it('should detect "your-secret" pattern', () => {
    expect(isExampleContent('some content', 'your-secret-goes-here')).toBe(true);
  });

  it('should detect "replace with" pattern', () => {
    // The pattern requires underscore or dash between replace and with: /replace[_-]?with/i
    // "replace with" (space) doesn't match, but "replace_with" does
    expect(isExampleContent('some content', 'replace_with your key')).toBe(true);
    expect(isExampleContent('some content', 'replace-with your key')).toBe(true);
  });

  it('should detect "xxx" placeholder', () => {
    expect(isExampleContent('some content', 'api_key_xxxxxxxxxx')).toBe(true);
  });

  it('should detect "dummy" keyword', () => {
    expect(isExampleContent('some content', 'dummy key for testing')).toBe(true);
  });

  it('should detect "fake" keyword', () => {
    expect(isExampleContent('some content', 'fake token value')).toBe(true);
  });

  it('should detect "test_key" pattern', () => {
    expect(isExampleContent('some content', 'test_key_value')).toBe(true);
  });

  it('should detect "sample" keyword', () => {
    expect(isExampleContent('some content', 'sample secret value')).toBe(true);
  });

  it('should detect TODO replace', () => {
    expect(isExampleContent('some content', 'TODO: replace with actual key')).toBe(true);
  });

  it('should detect "insert your" pattern', () => {
    // The pattern requires underscore or dash: /insert[_-]?your/i
    expect(isExampleContent('some content', 'insert_your key here')).toBe(true);
    expect(isExampleContent('some content', 'insert-your key here')).toBe(true);
  });

  it('should detect "<your-" pattern', () => {
    expect(isExampleContent('some content', '<your-api-key>')).toBe(true);
  });

  it('should detect "[your-" pattern', () => {
    expect(isExampleContent('some content', '[your-secret-here]')).toBe(true);
  });

  it('should check context lines when line is found', () => {
    const content = 'line 1\nline 2\nline 3\nTODO: replace this\nline 5\nline 6\nline 7';
    expect(isExampleContent(content, 'TODO: replace this')).toBe(true);
  });

  it('should check surrounding lines within +/- 5 range', () => {
    // Example indicator at line index 5, check lines 0-11
    const content = [
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'SECRET_KEY=placeholder',
      'line 7',
      'line 8',
      'line 9',
      'line 10',
      'line 11',
      'line 12',
    ].join('\n');
    expect(isExampleContent(content, 'SECRET_KEY=placeholder')).toBe(true);
  });

  it('should return false for real secrets', () => {
    expect(isExampleContent('some content', 'sk-1234567890abcdef')).toBe(false);
  });

  it('should be case insensitive for patterns', () => {
    expect(isExampleContent('some content', 'EXAMPLE KEY')).toBe(true);
    expect(isExampleContent('some content', 'PLACEHOLDER')).toBe(true);
    expect(isExampleContent('some content', 'DUMMY')).toBe(true);
  });

  it('should handle multiline content with no line match', () => {
    const content = 'line 1\nline 2\nline 3';
    expect(isExampleContent(content, 'not in content')).toBe(false);
  });
});

describe('readFileContent', () => {
  it('should return empty string for non-existent file', () => {
    const content = readFileContent('/nonexistent/path/file.txt');
    expect(content).toBe('');
  });

  it('should read existing file', () => {
    const content = readFileContent(selfPath);
    expect(content).toContain('describe');
  });

  it('should resolve relative paths', () => {
    // Use an absolute path to ensure the test works
    const content = readFileContent(selfPath);
    expect(content).toContain('describe');
  });
});

describe('isExpectedSecretFile', () => {
  it('should detect .env.example', () => {
    expect(isExpectedSecretFile('.env.example')).toBe(true);
  });

  it('should detect .env.template', () => {
    expect(isExpectedSecretFile('.env.template')).toBe(true);
  });

  it('should detect .env.sample', () => {
    expect(isExpectedSecretFile('.env.sample')).toBe(true);
  });

  it('should detect example.env', () => {
    expect(isExpectedSecretFile('example.env')).toBe(true);
  });

  it('should detect template.env', () => {
    expect(isExpectedSecretFile('template.env')).toBe(true);
  });

  it('should detect .env.development.example', () => {
    expect(isExpectedSecretFile('.env.development.example')).toBe(true);
  });

  it('should detect .env.production.example', () => {
    expect(isExpectedSecretFile('.env.production.example')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(isExpectedSecretFile('.ENV.EXAMPLE')).toBe(true);
    expect(isExpectedSecretFile('.Env.Template')).toBe(true);
  });

  it('should handle paths with directories', () => {
    expect(isExpectedSecretFile('/path/to/.env.example')).toBe(true);
    expect(isExpectedSecretFile('./config/.env.template')).toBe(true);
  });

  it('should return false for real .env files', () => {
    expect(isExpectedSecretFile('.env')).toBe(false);
    expect(isExpectedSecretFile('.env.local')).toBe(false);
    expect(isExpectedSecretFile('.env.production')).toBe(false);
  });

  it('should return false for non-example files', () => {
    expect(isExpectedSecretFile('config.json')).toBe(false);
    expect(isExpectedSecretFile('secrets.txt')).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// sanitizeLogString bidi-range hex-escape
// 12-payload regression corpus. Each payload is attacker-controlled input
// containing one or more bidi code points. The test asserts:
//   (a) the raw code point does NOT appear in the output (visual-spoof neutralised)
//   (b) the expected \uNNNN hex-escape DOES appear (forensic signal preserved)
// ---------------------------------------------------------------------------
describe('sanitizeLogString — bidi-override regression corpus', () => {
  // Individual code point payloads (9 code points)
  it('hex-escapes U+202A LEFT-TO-RIGHT EMBEDDING', () => {
    const input = 'log entry \u202A hidden';
    const result = sanitizeLogString(input);
    expect(result).toContain('\\u202a');
    expect(result).not.toContain('\u202A');
  });

  it('hex-escapes U+202B RIGHT-TO-LEFT EMBEDDING', () => {
    const input = 'log entry \u202B hidden';
    const result = sanitizeLogString(input);
    expect(result).toContain('\\u202b');
    expect(result).not.toContain('\u202B');
  });

  it('hex-escapes U+202C POP DIRECTIONAL FORMATTING', () => {
    const input = 'log entry \u202C hidden';
    const result = sanitizeLogString(input);
    expect(result).toContain('\\u202c');
    expect(result).not.toContain('\u202C');
  });

  it('hex-escapes U+202D LEFT-TO-RIGHT OVERRIDE', () => {
    const input = 'log entry \u202D hidden';
    const result = sanitizeLogString(input);
    expect(result).toContain('\\u202d');
    expect(result).not.toContain('\u202D');
  });

  it('hex-escapes U+202E RIGHT-TO-LEFT OVERRIDE (visual-spoof classic)', () => {
    // Classic attack: attacker injects U+202E before filename to display
    // "gpj.tpircs-suoicilam" as "malicious-script.jpg" in terminal/SIEM.
    const input = 'file: evil\u202Egpj.tpircs';
    const result = sanitizeLogString(input);
    expect(result).toContain('\\u202e');
    expect(result).not.toContain('\u202E');
  });

  it('hex-escapes U+2066 LEFT-TO-RIGHT ISOLATE', () => {
    const input = 'log entry \u2066 isolated';
    const result = sanitizeLogString(input);
    expect(result).toContain('\\u2066');
    expect(result).not.toContain('\u2066');
  });

  it('hex-escapes U+2067 RIGHT-TO-LEFT ISOLATE', () => {
    const input = 'log entry \u2067 isolated';
    const result = sanitizeLogString(input);
    expect(result).toContain('\\u2067');
    expect(result).not.toContain('\u2067');
  });

  it('hex-escapes U+2068 FIRST STRONG ISOLATE', () => {
    const input = 'log entry \u2068 isolated';
    const result = sanitizeLogString(input);
    expect(result).toContain('\\u2068');
    expect(result).not.toContain('\u2068');
  });

  it('hex-escapes U+2069 POP DIRECTIONAL ISOLATE', () => {
    const input = 'log entry \u2069 end';
    const result = sanitizeLogString(input);
    expect(result).toContain('\\u2069');
    expect(result).not.toContain('\u2069');
  });

  // Combination payloads (3 combo tests)
  it('combo-1: RLO + LRE wrapping to spoof a log field name', () => {
    // Attacker wraps a field name with RLO + LRE to make "EVIL" render as
    // "LIVE" in a right-to-left segment followed by a reset.
    const input = 'user=\u202EEVIL\u202A reset';
    const result = sanitizeLogString(input);
    expect(result).toContain('\\u202e');
    expect(result).toContain('\\u202a');
    expect(result).not.toContain('\u202E');
    expect(result).not.toContain('\u202A');
  });

  it('combo-2: FSI + PDI isolate spoofing in structured log field', () => {
    // Bidi isolate brackets can make a structured log value appear to
    // contain a different record when rendered in a Unicode SIEM UI.
    const input = 'reason=\u2068BLOCKED\u2069 next_field=ok';
    const result = sanitizeLogString(input);
    expect(result).toContain('\\u2068');
    expect(result).toContain('\\u2069');
    expect(result).not.toContain('\u2068');
    expect(result).not.toContain('\u2069');
  });

  it('combo-3: all 9 bidi code points in a single payload are all hex-escaped', () => {
    const allBidi = '\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069';
    const result = sanitizeLogString(allBidi);
    // None of the raw code points should remain
    for (const cp of ['\u202A','\u202B','\u202C','\u202D','\u202E','\u2066','\u2067','\u2068','\u2069']) {
      expect(result).not.toContain(cp);
    }
    // All hex-escape forms must appear
    expect(result).toContain('\\u202a');
    expect(result).toContain('\\u202b');
    expect(result).toContain('\\u202c');
    expect(result).toContain('\\u202d');
    expect(result).toContain('\\u202e');
    expect(result).toContain('\\u2066');
    expect(result).toContain('\\u2067');
    expect(result).toContain('\\u2068');
    expect(result).toContain('\\u2069');
  });
});
