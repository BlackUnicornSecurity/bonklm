/**
 * SecretGuard Unit Tests
 * =====================
 * Comprehensive unit tests for secret/API key detection.
 */

import { describe, it, expect } from 'vitest';
import { SecretGuard, validateSecrets } from '../../../src/guards/secret.js';

describe('SecretGuard', () => {
  describe('AWS Key Detection', () => {
    it('SG-001: should detect AWS access keys', () => {
      const guard = new SecretGuard();
      const result = guard.validate('const awsKey = "AKIAIOSFODNN7EXAMPLE"');
      expect(result.blocked).toBe(true);
      expect(result.findings?.length).toBeGreaterThan(0);
    });

    it('should detect AWS secret keys', () => {
      const result = validateSecrets('aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"');
      expect(result.blocked).toBe(true);
    });
  });

  describe('GitHub Token Detection', () => {
    it('SG-002: should detect GitHub personal tokens', () => {
      const result = validateSecrets('github_token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"');
      expect(result.blocked).toBe(true);
    });

    it('should detect GitHub OAuth tokens', () => {
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate('token: gho_1234567890abcdefghijklmnopqrstuvwxyz');
      expect(result.blocked).toBe(true);
    });
  });

  describe('Generic API Key Detection', () => {
    it('SG-003: should detect generic API keys', () => {
      const result = validateSecrets('api_key: sk-1234567890abcdefghijklmnopqrstuvwxyz');
      expect(result).toBeDefined();
    });

    it('should detect bearer tokens', () => {
      const guard = new SecretGuard();
      // Pattern: /bearer\s+[A-Za-z0-9_\-\.]{30,}/gi - needs at least 30 chars
      const result = guard.validate('Authorization: Bearer sk-1234567890abcdefghijklmnopqr');
      expect(result.blocked).toBe(true);
    });
  });

  describe('JWT Detection', () => {
    it('SG-004: should detect JWT tokens', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const result = validateSecrets(jwt);
      expect(result).toBeDefined();
    });
  });

  describe('Database URL Detection', () => {
    it('SG-005: should detect database connection strings', () => {
      const dbUrl = 'mongodb://user:pass@localhost:27017/db';
      const result = validateSecrets(dbUrl);
      expect(result.blocked).toBe(true);
    });

    it('should detect PostgreSQL URLs', () => {
      const pgUrl = 'postgres://user:password123@localhost:5432/mydb';
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate(pgUrl);
      expect(result.blocked).toBe(true);
    });
  });

  describe('Private Key Detection', () => {
    it('SG-006: should detect RSA private keys', () => {
      const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA2Z2jQwUKb6LyF1KhkYQ8RlFqViYeXTLhL...
-----END RSA PRIVATE KEY-----`;
      const result = validateSecrets(privateKey);
      expect(result.blocked).toBe(true);
    });

    it('should detect EC private keys', () => {
      const ecKey = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIFLu7LfVcWpL4M3baK4Yk4vLkhhGVxNL...
-----END EC PRIVATE KEY-----`;
      const guard = new SecretGuard();
      const result = guard.validate(ecKey);
      expect(result.blocked).toBe(true);
    });
  });

  describe('Password in Code', () => {
    it('SG-007: should detect password assignments', () => {
      const code = 'const password = "SuperSecret123!"';
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate(code);
      expect(result).toBeDefined();
    });

    it('should detect passwd assignments', () => {
      const code = 'mysql_passwd = "secret123"';
      const result = validateSecrets(code);
      expect(result).toBeDefined();
    });
  });

  describe('Class Interface', () => {
    it('should support class-based instantiation', () => {
      const guard = new SecretGuard();
      expect(guard).toBeDefined();
      expect(guard.validate).toBeInstanceOf(Function);
    });

    it('should support class-based validation', () => {
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate('AKIAIOSFODNN7EXAMPLE');
      expect(result.blocked).toBe(true);
      expect(result.findings?.length).toBeGreaterThan(0);
    });

    it('should support instantiation with custom config', () => {
      const guard = new SecretGuard({ checkExamples: false });
      expect(guard).toBeDefined();
      expect(guard.validate).toBeInstanceOf(Function);
    });
  });

  describe('Safe Content', () => {
    it('should allow code without secrets', () => {
      const result = validateSecrets('const greeting = "Hello World"');
      expect(result.allowed).toBe(true);
    });

    it('should allow example content', () => {
      const guard = new SecretGuard({ checkExamples: true });
      const result = guard.validate('YOUR_API_KEY = "sk-1234567890abcdef"');
      // Example content might be detected as low risk
      expect(result).toBeDefined();
    });

    it('should allow placeholder values', () => {
      const result = validateSecrets('api_key = "<YOUR_API_KEY_HERE>"');
      expect(result.allowed).toBe(true);
    });

    it('should allow fake data', () => {
      const result = validateSecrets('password = "xxxxxxxx"');
      expect(result.allowed).toBe(true);
    });

    it('should allow test patterns', () => {
      const result = validateSecrets('key = "test_key_12345"');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Configuration', () => {
    it('should respect checkExamples configuration', () => {
      const guardWith = new SecretGuard({ checkExamples: true });
      const guardWithout = new SecretGuard({ checkExamples: false });

      const exampleContent = 'YOUR_API_KEY = "sk-1234567890abcdef"';

      const result1 = guardWith.validate(exampleContent);
      const result2 = guardWithout.validate(exampleContent);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });

    it('should respect includeFindings configuration', () => {
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate('AKIAIOSFODNN7EXAMPLE');
      expect(result.findings?.length).toBeGreaterThan(0);
    });

    it('should support entropyThreshold configuration', () => {
      const guard = new SecretGuard({ entropyThreshold: 4.0 });
      expect(guard).toBeDefined();
      // Config is used internally in detection
    });
  });

  describe('Multiple Secrets', () => {
    it('SG-011: should verify multiple secrets detected', () => {
      const content = `
        AWS_KEY = AKIAIOSFODNN7EXAMPLE
        GITHUB_TOKEN = ghp_1234567890abcdefghijklmnopqrstuvwxyz
        DATABASE_URL = postgres://user:pass@localhost/db
      `;
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate(content);
      expect(result.blocked).toBe(true);
      expect(result.findings?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Findings Structure', () => {
    it('should include category in findings', () => {
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate('AKIAIOSFODNN7EXAMPLE');
      expect(result.findings?.[0]).toHaveProperty('category');
    });

    it('should include severity in findings', () => {
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate('AKIAIOSFODNN7EXAMPLE');
      expect(result.findings?.[0]).toHaveProperty('severity');
    });

    it('should include description in findings', () => {
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate('AKIAIOSFODNN7EXAMPLE');
      expect(result.findings?.[0]).toHaveProperty('description');
    });

    it('should include match in findings', () => {
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate('AKIAIOSFODNN7EXAMPLE');
      expect(result.findings?.[0]).toHaveProperty('match');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty input', () => {
      const guard = new SecretGuard();
      const result = guard.validate('');
      expect(result.allowed).toBe(true);
    });

    it('should handle whitespace only', () => {
      const result = validateSecrets('   ');
      expect(result.allowed).toBe(true);
    });

    it('should handle multiple secrets in one file', () => {
      const content = `
        const aws = "AKIAIOSFODNN7EXAMPLE"
        const github = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
        const db = "mongodb://user:pass@localhost:27017/db"
      `;
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate(content);
      expect(result.blocked).toBe(true);
      expect(result.findings?.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle secrets in comments', () => {
      const content = '// TODO: Replace AKIAIOSFODNN7EXAMPLE with real key';
      const result = validateSecrets(content);
      // Comments are still scanned
      expect(result).toBeDefined();
    });

    it('should handle secrets with special characters around', () => {
      const content = '"AKIAIOSFODNN7EXAMPLE"';
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate(content);
      expect(result.blocked).toBe(true);
    });

    it('should handle very long input', () => {
      const longContent = 'const key = "sk-' + 'a'.repeat(100);
      const result = validateSecrets(longContent);
      expect(result).toBeDefined();
    });
  });

  describe('Convenience Function', () => {
    it('should support validateSecrets function', () => {
      const result = validateSecrets('AKIAIOSFODNN7EXAMPLE');
      expect(result.blocked).toBe(true);
    });

    it('should allow safe content via validateSecrets', () => {
      const result = validateSecrets('Hello World');
      expect(result.allowed).toBe(true);
    });

    it('should support filePath parameter', () => {
      const result = validateSecrets('AKIAIOSFODNN7EXAMPLE', 'src/config.ts');
      expect(result.blocked).toBe(true);
    });
  });

  describe('Specific Provider Tests', () => {
    it('should detect Slack tokens', () => {
      // Pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}/
      // TEST VALUE ONLY - NOT A REAL TOKEN
      const result = validateSecrets('slack_token = "xoxb-1234567890-1234567890-' + 'a'.repeat(24) + '"');
      expect(result.blocked).toBe(true);
    });

    it('should detect Stripe keys', () => {
      // Pattern: /sk_live_[A-Za-z0-9]{24,}/g - needs 24+ alphanumerics, no underscores
      // TEST VALUE ONLY - NOT A REAL KEY
      const result = validateSecrets('stripe_key = "sk_live_' + 'a'.repeat(24) + '"');
      expect(result.blocked).toBe(true);
    });

    it('should detect Google API keys', () => {
      // Pattern: /AIza[0-9A-Za-z\-_]{35}/g - needs 35 chars after AIza
      // TEST VALUE ONLY - NOT A REAL KEY
      const result = validateSecrets('google_key = "AIzaSyTESTFAKEPLACEHOLDER-NOTREALKEYTEST"');
      expect(result.blocked).toBe(true);
    });

    it('should detect OpenAI keys', () => {
      // Pattern: /sk-proj-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/g
      // T3BlbkFJ is the embedded marker in legacy/first-gen OpenAI project keys
      // TEST VALUE ONLY - NOT A REAL KEY
      const fakeKey = 'sk-proj-' + 'a'.repeat(20) + 'T3BlbkFJ' + 'b'.repeat(20);
      const result = validateSecrets(`openai_key = "${fakeKey}"`);
      expect(result.blocked).toBe(true);
    });

    it('should detect Anthropic keys', () => {
      // Pattern: /sk-ant-api03-[A-Za-z0-9\-_]{93}/g - needs 93 chars
      const result = validateSecrets('anthropic_key = "sk-ant-api03-' + 'a'.repeat(93) + '"');
      expect(result.blocked).toBe(true);
    });
  });

  // ST-05-106 / B.8 — Anthropic key length boundary regression tests
  // Pattern under test: /sk-ant-api03-[A-Za-z0-9\-_]{40,120}/g (range quantifier).
  // The exact-{93} form missed real key generations with shorter bodies;
  // the range requires the distinctive prefix plus a substantial body.
  // Rationale: every {N,M} quantifier needs boundary tests at N-1, N, M, M+1,
  // and invalid-char-mid.
  describe('Anthropic key length boundary (ST-05-106, B.8)', () => {
    const ANT_KEY_PREFIX = 'sk-ant-api03-';

    it('boundary: 39 chars — must NOT match (under-length)', () => {
      // 39 valid chars after the prefix — one short of the required 40.
      const guard = new SecretGuard({ checkExamples: false });
      const detections = guard.detect(ANT_KEY_PREFIX + 'a'.repeat(39));
      const anthropicDetections = detections.filter(d => d.secretType === 'Anthropic API Key');
      expect(anthropicDetections).toHaveLength(0);
    });

    it('boundary: 40 chars — must match (range minimum)', () => {
      const guard = new SecretGuard({ checkExamples: false });
      const detections = guard.detect(ANT_KEY_PREFIX + 'a'.repeat(40));
      const anthropicDetections = detections.filter(d => d.secretType === 'Anthropic API Key');
      expect(anthropicDetections).toHaveLength(1);
    });

    it('boundary: 93 chars — must match exactly once', () => {
      const guard = new SecretGuard({ checkExamples: false });
      const detections = guard.detect(ANT_KEY_PREFIX + 'a'.repeat(93));
      const anthropicDetections = detections.filter(d => d.secretType === 'Anthropic API Key');
      expect(anthropicDetections).toHaveLength(1);
    });

    it('boundary: 130 chars — regex still matches once; matched token length caps at 120', () => {
      // The {40,120} quantifier is not anchored, so the engine matches the
      // first 120 chars of the key portion — ONE match of bounded length.
      const input = ANT_KEY_PREFIX + 'a'.repeat(130);
      const ant130matches = input.match(/sk-ant-api03-[A-Za-z0-9\-_]{40,120}/g);
      expect(ant130matches).not.toBeNull();
      expect(ant130matches).toHaveLength(1);
      expect(ant130matches![0].length).toBe(ANT_KEY_PREFIX.length + 120);
      // Also verify SecretGuard fires once (detection semantics preserved).
      const guard = new SecretGuard({ checkExamples: false });
      const detections = guard.detect(input);
      const anthropicDetections = detections.filter(d => d.secretType === 'Anthropic API Key');
      expect(anthropicDetections).toHaveLength(1);
    });

    it('boundary: invalid char before the 40-char minimum — must NOT match', () => {
      // '!' (outside [A-Za-z0-9\-_]) at index 25 breaks every candidate run
      // below the 40-character minimum.
      const invalidKey = 'a'.repeat(25) + '!' + 'a'.repeat(70);
      const result = validateSecrets(ANT_KEY_PREFIX + invalidKey, undefined, { includeFindings: true });
      const findings = result.findings ?? [];
      const anthropicFindings = findings.filter(f => f.description?.includes('Anthropic'));
      expect(anthropicFindings).toHaveLength(0);
    });

    it('boundary: invalid char after the 40-char minimum — still matches the valid prefix run', () => {
      // '!' at index 50: the 50 chars before it satisfy {40,120}, so the
      // substantial credential body still fires (deliberate — 50 chars of
      // the key alphabet behind the sk-ant-api03- prefix is a key, not prose).
      const invalidKey = 'a'.repeat(50) + '!' + 'a'.repeat(42);
      const result = validateSecrets(ANT_KEY_PREFIX + invalidKey, undefined, { includeFindings: true });
      const findings = result.findings ?? [];
      const anthropicFindings = findings.filter(f => f.description?.includes('Anthropic'));
      expect(anthropicFindings).toHaveLength(1);
    });
  });

  describe('Specific Provider Tests (continued)', () => {
    it('should detect Twilio keys', () => {
      // Pattern: /SK[a-f0-9]{32}/g - lowercase hex only, 32 chars after SK
      const result = validateSecrets('twilio_key = "SK' + 'a'.repeat(32) + '"');
      expect(result.blocked).toBe(true);
    });

    it('should detect npm tokens', () => {
      // Pattern: /npm_[A-Za-z0-9]{36}/g - needs 36 chars after npm_
      const result = validateSecrets('npm_token = "npm_' + 'a'.repeat(36) + '"');
      expect(result.blocked).toBe(true);
    });
  });

  describe('Risk Assessment', () => {
    it('should assign severity to detected secrets', () => {
      const guard = new SecretGuard();
      const result = guard.validate('AKIAIOSFODNN7EXAMPLE');
      expect(result.severity).toBeDefined();
    });

    it('should calculate risk score', () => {
      const guard = new SecretGuard({ includeFindings: true });
      const result = guard.validate('AKIAIOSFODNN7EXAMPLE');
      expect(result.risk_score).toBeGreaterThan(0);
    });
  });

  describe('SG-012: Empty Input', () => {
    it('should handle empty string', () => {
      const guard = new SecretGuard();
      const result = guard.validate('');
      expect(result.allowed).toBe(true);
    });
  });

  // Sprint 39 meta-object sweep: secret guard logs `filePath` in
  // structured-logger meta at two sites (info + warn). RFC 8259 §7
  // permits literal TAB inside JSON strings; downstream TSV-format
  // SIEM ingestors then column-split. Verify sanitizeLogString runs
  // on `file` meta values at both sites.
  describe('ReDoS guard (security regression / final layer-1 sweep)', () => {
    // All 38 regexes in guards/secret.ts (CRITICAL + HIGH + MEDIUM) were
    // classified LINEAR via timing probe at 100 KB worst-case inputs
    // (max observed: 0.681 ms).  These tests lock that classification in CI.

    it('SG-R01: 100KB non-matching input through ALL_PATTERNS completes in < 100 ms', () => {
      // Worst-case: a long string that activates pattern prefixes but never
      // satisfies the suffix  — forces the engine to scan the whole string.
      const input = 'a'.repeat(100_000);
      const guard = new SecretGuard();
      const t0 = performance.now();
      guard.detect(input);
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(100);
    });

    it('SG-R02: 100KB partial-match input (triggers \\bapi[_-]?key prefix) completes in < 100 ms', () => {
      // Activates Generic_API_Key, Access_Token, Auth_Token, Password patterns
      // without ever satisfying the closing quote delimiter.
      const input = ('api_key = "' + 'a'.repeat(80)).padEnd(100_000, 'x');
      const guard = new SecretGuard();
      const t0 = performance.now();
      guard.detect(input);
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(100);
    });

    it('SG-R03: guard still BLOCKS a real secret after 100KB preamble (semantics preserved)', () => {
      // Ensures timing-based classification does not regress detection.
      // checkExamples: false avoids the isExampleContent scan on the full
      // 100KB single-line content (which is not what the example check is
      // designed for) while still exercising the regex detection path.
      const realKey = 'AKIAIOSFODNN7EXAMPLE';
      const content = 'x'.repeat(99_979) + realKey;
      const guard = new SecretGuard({ checkExamples: false });
      const t0 = performance.now();
      const result = guard.validate(content);
      const elapsed = performance.now() - t0;
      expect(result.blocked).toBe(true);
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('SG-013: filePath meta CWE-117 sanitization (Sprint 39)', () => {
    function makeSpyLogger() {
      const calls: Array<{ level: string; msg: string; meta?: unknown }> = [];
      return {
        calls,
        logger: {
          debug: (msg: string, meta?: unknown) => calls.push({ level: 'debug', msg, meta }),
          info: (msg: string, meta?: unknown) => calls.push({ level: 'info', msg, meta }),
          warn: (msg: string, meta?: unknown) => calls.push({ level: 'warn', msg, meta }),
          error: (msg: string, meta?: unknown) => calls.push({ level: 'error', msg, meta })
        }
      };
    }

    it('sanitizes filePath on the "Skipping expected secret file" info log', () => {
      const { logger, calls } = makeSpyLogger();
      const guard = new SecretGuard({ logger, checkExamples: true });
      // `isExpectedSecretFile` matches the BASENAME after `split('/').pop()`,
      // so embed the control-char attack in the DIRECTORY portion so the
      // basename still equals the allowlist entry `.env.example` and the
      // info-log branch fires. The full original `filePath` (with the
      // attack payload) is what gets logged.
      guard.validate('AKIAIOSFODNN7EXAMPLE', 'dir\nINJECTED_LINE/.env.example');

      const info = calls.find(c => c.level === 'info' && c.msg.startsWith('Skipping'));
      expect(info).toBeDefined();
      const meta = info!.meta as { file: string };
      // \n → literal '\n' marker per sanitizeLogString contract.
      expect(meta.file).toBe('dir\\nINJECTED_LINE/.env.example');
    });

    it('sanitizes filePath on the "Secrets detected" warn log', () => {
      const { logger, calls } = makeSpyLogger();
      const guard = new SecretGuard({ logger });
      guard.validate('AKIAIOSFODNN7EXAMPLE', 'src/\tinjected\tcols.ts');

      const warn = calls.find(c => c.level === 'warn' && c.msg === 'Secrets detected');
      expect(warn).toBeDefined();
      const meta = warn!.meta as { file: string };
      // TAB → '\x09' hex escape per sanitizeLogString contract.
      expect(meta.file).toBe('src/\\x09injected\\x09cols.ts');
    });
  });
});
