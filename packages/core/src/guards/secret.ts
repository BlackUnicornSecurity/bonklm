/**
 * BonkLM - Secret Guard
 * ==============================
 * Detects and blocks hardcoded secrets, API keys, and credentials.
 *
 * Features:
 * - 38 patterns covering 37 unique credential types
 *   (27 critical / 9 high / 2 medium)
 * - Shannon entropy validation for generic secrets
 * - Example/placeholder content detection
 */

import { createResult, Finding, type GuardrailResult, RiskLevel, Severity } from '../base/GuardrailResult.js';
import type { SecretGuardConfig, ValidatorConfig } from '../base/ValidatorConfig.js';
import { createLogger, type Logger } from '../base/GenericLogger.js';
import { isExampleContent, isExpectedSecretFile, isHighEntropy, sanitizeLogString } from '../common/index.js';
import { normalizeText } from '../validators/text-normalizer.js';

const DEFAULT_CONFIG: Required<Pick<SecretGuardConfig, 'checkExamples' | 'entropyThreshold'>> = {
  checkExamples: true,
  entropyThreshold: 3.5
};

type Confidence = 'critical' | 'high' | 'medium';

interface SecretPattern {
  pattern: RegExp;
  secretType: string;
  confidence: Confidence;
}

interface SecretDetection {
  secretType: string;
  match: string;
  line: string;
  lineNumber: number;
  confidence: Confidence;
}

/**
 * Critical patterns - always block
 */
const CRITICAL_PATTERNS: SecretPattern[] = [
  // AWS
  { pattern: /AKIA[0-9A-Z]{16}/g, secretType: 'AWS Access Key ID', confidence: 'critical' },
  {
    pattern: /aws_secret_access_key\s*=\s*["'][A-Za-z0-9/+=]{40}["']/gi,
    secretType: 'AWS Secret Access Key',
    confidence: 'critical'
  },

  // GitHub
  { pattern: /ghp_[A-Za-z0-9]{36}/g, secretType: 'GitHub Personal Access Token', confidence: 'critical' },
  { pattern: /gho_[A-Za-z0-9]{36}/g, secretType: 'GitHub OAuth Token', confidence: 'critical' },
  { pattern: /ghu_[A-Za-z0-9]{36}/g, secretType: 'GitHub User Token', confidence: 'critical' },
  { pattern: /ghs_[A-Za-z0-9]{36}/g, secretType: 'GitHub Server Token', confidence: 'critical' },
  { pattern: /ghr_[A-Za-z0-9]{36}/g, secretType: 'GitHub Refresh Token', confidence: 'critical' },

  // Slack
  {
    pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}/g,
    secretType: 'Slack Token',
    confidence: 'critical'
  },

  // Stripe
  { pattern: /sk_live_[A-Za-z0-9]{24,}/g, secretType: 'Stripe Secret Key', confidence: 'critical' },
  { pattern: /sk_test_[A-Za-z0-9]{24,}/g, secretType: 'Stripe Secret Key', confidence: 'critical' },
  { pattern: /rk_live_[A-Za-z0-9]{24,}/g, secretType: 'Stripe Restricted Key', confidence: 'critical' },

  // Google
  { pattern: /AIza[0-9A-Za-z\-_]{35}/g, secretType: 'Google API Key', confidence: 'critical' },

  // OpenAI — legacy keys carry the T3BlbkFJ infix; 2024+ sk-proj- keys do not.
  // The modern pattern uses a negative lookahead so a legacy key isn't reported twice.
  {
    pattern: /sk-proj-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/g,
    secretType: 'OpenAI Project Key (legacy format)',
    confidence: 'critical'
  },
  { pattern: /sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/g, secretType: 'OpenAI Legacy Key', confidence: 'critical' },
  { pattern: /sk-proj-(?!.*T3BlbkFJ)[A-Za-z0-9_-]{40,}/g, secretType: 'OpenAI Project Key', confidence: 'critical' },

  // Anthropic
  { pattern: /sk-ant-api03-[A-Za-z0-9\-_]{93}/g, secretType: 'Anthropic API Key', confidence: 'critical' },

  // Twilio
  { pattern: /SK[a-f0-9]{32}/g, secretType: 'Twilio API Key', confidence: 'critical' },

  // SendGrid
  { pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g, secretType: 'SendGrid API Key', confidence: 'critical' },

  // Mailgun — require a Mailgun-adjacent identifier within 120 chars OR a
  // credential-noun (key/token/secret/auth/api) on the same line so we
  // tolerate naming variations (MAILGUN_TOKEN, MG_AUTH_KEY, yaml `mailgun:\n  key: …`)
  // without flagging every bare `key-…` 32-char identifier.
  {
    pattern: /\bmailgun[\w-]*\s*[:=]?[\s\S]{0,120}?key-[A-Za-z0-9]{32}\b/gi,
    secretType: 'Mailgun API Key (named)',
    confidence: 'critical'
  },
  {
    pattern:
      /\b(?:api[_-]?key|api[_-]?token|secret|auth[_-]?key|auth[_-]?token|token|mg[_-]?[\w-]*key|mg[_-]?[\w-]*token)\b[\s\S]{0,40}?["']?key-[A-Za-z0-9]{32}\b/gi,
    secretType: 'Mailgun API Key (credential context)',
    confidence: 'critical'
  },

  // Azure
  {
    pattern: /SharedAccessSignature\s+sr=[^\s&]+&sig=[A-Za-z0-9%+/=]+&/g,
    secretType: 'Azure Shared Access Signature',
    confidence: 'critical'
  },

  // GitLab
  { pattern: /glpat-[A-Za-z0-9\-_]{20,}/g, secretType: 'GitLab Personal Access Token', confidence: 'critical' },
  { pattern: /gldt-[A-Za-z0-9\-_]{20,}/g, secretType: 'GitLab Deploy Token', confidence: 'critical' },

  // npm
  { pattern: /npm_[A-Za-z0-9]{36}/g, secretType: 'npm Access Token', confidence: 'critical' },

  // Private Keys
  {
    pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g,
    secretType: 'Private Key',
    confidence: 'critical'
  },
  { pattern: /-----BEGIN\s+PGP\s+PRIVATE\s+KEY\s+BLOCK-----/g, secretType: 'PGP Private Key', confidence: 'critical' },

  // Database URLs with credentials
  {
    pattern: /(mongodb|postgres|mysql|redis|mariadb):\/\/[^\s:]+:[^\s@]+@[^\s]+/gi,
    secretType: 'Database Connection URL',
    confidence: 'critical'
  }
];

/**
 * High confidence patterns
 */
const HIGH_PATTERNS: SecretPattern[] = [
  { pattern: /pk_live_[A-Za-z0-9]{24,}/g, secretType: 'Stripe Publishable Key', confidence: 'high' },
  { pattern: /AC[a-f0-9]{32}/g, secretType: 'Twilio Account SID', confidence: 'high' },
  { pattern: /api[_-]?key\s*=\s*["'][A-Za-z0-9_\-]{20,}["']/gi, secretType: 'Generic API Key', confidence: 'high' },
  {
    pattern: /secret[_-]?key\s*=\s*["'][A-Za-z0-9_\-]{20,}["']/gi,
    secretType: 'Generic Secret Key',
    confidence: 'high'
  },
  { pattern: /access[_-]?token\s*=\s*["'][A-Za-z0-9_\-]{20,}["']/gi, secretType: 'Access Token', confidence: 'high' },
  { pattern: /auth[_-]?token\s*=\s*["'][A-Za-z0-9_\-]{20,}["']/gi, secretType: 'Auth Token', confidence: 'high' },
  { pattern: /bearer\s+[A-Za-z0-9_\-\.]{30,}/gi, secretType: 'Bearer Token', confidence: 'high' },
  {
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    secretType: 'JWT Token',
    confidence: 'high'
  },
  {
    pattern: /firebase[_-]?api[_-]?key\s*=\s*["'][A-Za-z0-9_\-]{30,}["']/gi,
    secretType: 'Firebase API Key',
    confidence: 'high'
  }
];

/**
 * Medium confidence patterns - require entropy validation
 */
const MEDIUM_PATTERNS: SecretPattern[] = [
  { pattern: /(password|passwd|pwd)\s*=\s*["'][^"']{12,}["']/gi, secretType: 'Password', confidence: 'medium' },
  {
    pattern: /(token|secret|credential|private[_-]?key)\s*=\s*["'][A-Za-z0-9+/=]{40,}["']/gi,
    secretType: 'Generic Secret',
    confidence: 'medium'
  }
];

const ALL_PATTERNS = [...CRITICAL_PATTERNS, ...HIGH_PATTERNS, ...MEDIUM_PATTERNS];

/**
 * Secret Guard class.
 *
 * @public Sprint 26/28 v1.0-RC1 API freeze. Detection categories
 * frozen. Adding a new pattern is patch-level; renaming/removing a
 * category is major.
 */
export class SecretGuard {
  private readonly config: Required<SecretGuardConfig> & ValidatorConfig;
  private readonly logger: Logger;

  constructor(config: SecretGuardConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<SecretGuardConfig> & ValidatorConfig;
    this.logger = this.config.logger ?? createLogger('console', this.config.logLevel);
  }

  /**
   * Detect secrets in content.
   */
  detect(content: string, filePath: string = ''): SecretDetection[] {
    const detections: SecretDetection[] = [];
    // Normalize before detection — defeats zero-width-char and homoglyph splitting.
    content = normalizeText(content);
    const lines = content.split('\n');

    // Skip if this is an expected example file
    if (this.config.checkExamples && isExpectedSecretFile(filePath)) {
      // Sprint 39 meta-object sweep: `filePath` is caller-supplied and
      // attacker-influenceable (document-upload pipelines, MCP plugins
      // scanning user-named files). Structured loggers JSON-stringify
      // meta, but RFC 8259 §7 permits literal TAB inside JSON strings
      // — Splunk/Datadog/OTel TSV exporters then column-split. Apply
      // sanitizeLogString at the boundary.
      this.logger.info('Skipping expected secret file', { file: sanitizeLogString(filePath) });
      return [];
    }

    for (const secretPattern of ALL_PATTERNS) {
      secretPattern.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = secretPattern.pattern.exec(content)) !== null) {
        const matchText = match[0];

        let charCount = 0;
        let lineNumber = 0;
        let matchLine = '';

        for (let i = 0; i < lines.length; i++) {
          const lineLength = lines[i].length + 1;
          if (charCount + lineLength > (match.index || 0)) {
            lineNumber = i + 1;
            matchLine = lines[i]!;
            break;
          }
          charCount += lineLength;
        }

        // For medium confidence, validate entropy
        if (secretPattern.confidence === 'medium') {
          const valueMatch = matchText.match(/["']([^"']+)["']/);
          if (valueMatch) {
            const value = valueMatch[1];
            if (!isHighEntropy(value, this.config.entropyThreshold)) {
              continue;
            }
          }
        }

        // Check if this looks like example/placeholder content
        if (this.config.checkExamples && isExampleContent(content, matchLine)) {
          continue;
        }

        // Redact the matched substring from the line context too — otherwise
        // logs would carry e.g. `MAILGUN_API_KEY="key-abcdef…"` verbatim.
        const redactedLine = matchLine.split(matchText).join('[REDACTED]');
        detections.push({
          secretType: secretPattern.secretType,
          match: '[REDACTED]', // Redact matches entirely to prevent partial credential leakage
          line: redactedLine.trim().slice(0, 100),
          lineNumber,
          confidence: secretPattern.confidence
        });
      }
    }

    return detections;
  }

  /**
   * Story 1.2 — redact secrets in place.
   *
   * Used by `createRetrievedDocValidator({ onPerDocFailure: 'redact' })`
   * when a retrieved document carries a credential. Because
   * `Finding.match` is deliberately masked to `'[REDACTED]'` (so the
   * Finding objects themselves don't carry the secret through logs /
   * telemetry), the standard "substring-replace Finding.match" path
   * cannot redact secrets in the original content — only this method
   * can, because it re-runs the same patterns and replaces what it
   * matches.
   *
   * **Normalisation parity (audit-loop CRITICAL fix)**: `detect()`
   * applies `normalizeText` before pattern matching so confusable /
   * zero-width / homoglyph-mangled secrets still get flagged. This
   * method MUST apply the same normalisation, otherwise a homoglyph-
   * prefixed key would be detected (and routed into redact mode) but
   * the raw-string pattern run here would fail to match — the secret
   * would survive in the returned content. Returning the normalised
   * + redacted form is the correct behaviour for RAG content reaching
   * an LLM (the LLM sees the same normalised characters anyway).
   *
   * **Replacement string safety (audit-loop BLOCK fix)**: uses a
   * replacer function rather than `String.replace(regex, string)` so
   * a caller-supplied `replacement` containing `$1` / `$&` /
   * `$<name>` is treated literally rather than being interpreted as
   * a regex backreference. Without this, an attacker who controlled
   * the replacement string could inject captured groups.
   *
   * @param content     - Original content to redact.
   * @param replacement - Substitution string. @default '[REDACTED]'
   * @returns The content with each detected secret replaced (and the
   *   text normalised — see note above).
   */
  redactContent(content: string, replacement: string = '[REDACTED]'): string {
    if (!content) return content;
    let out = normalizeText(content);
    const replacer = (): string => replacement;
    for (const secretPattern of ALL_PATTERNS) {
      secretPattern.pattern.lastIndex = 0;
      out = out.replace(secretPattern.pattern, replacer);
    }
    return out;
  }

  /**
   * Validate content for secrets.
   */
  validate(content: string, filePath: string = ''): GuardrailResult {
    if (!content) {
      return createResult(true);
    }

    const detections = this.detect(content, filePath);

    if (detections.length === 0) {
      return createResult(true);
    }

    const findings: Finding[] = detections.map(d => ({
      category: 'secret_detection',
      pattern_name: d.secretType.toLowerCase().replace(/\s+/g, '_'),
      severity:
        d.confidence === 'critical' ? Severity.CRITICAL : d.confidence === 'high' ? Severity.WARNING : Severity.INFO,
      match: d.match,
      description: `${d.secretType} detected at line ${d.lineNumber}`,
      line_number: d.lineNumber,
      weight: d.confidence === 'critical' ? 10 : d.confidence === 'high' ? 5 : 2
    }));

    const riskScore = findings.reduce((sum, f) => sum + (f.weight ?? 1), 0);

    let riskLevel: RiskLevel = RiskLevel.LOW;
    if (riskScore >= 25) {
      riskLevel = RiskLevel.HIGH;
    } else if (riskScore >= 10) {
      riskLevel = RiskLevel.MEDIUM;
    }

    const criticalCount = detections.filter(d => d.confidence === 'critical').length;
    const allowed = this.config.action === 'allow' || (this.config.action === 'log' && criticalCount === 0);

    // Sprint 39 security-audit MEDIUM #1 — meta-shape safety note:
    // every other field in this object is library-controlled
    // (`count`/`critical_count`/`risk_score` are numbers;
    // `risk_level` is a `RiskLevel` enum string literal; `blocked`
    // is a boolean derived from `this.config.action`). The ONLY
    // attacker-influenceable string field is `file`, which is
    // sanitized below. If a future change adds a detection-derived
    // string field (e.g. `secret_type` from a user-extended pattern
    // catalog), it MUST also route through `sanitizeLogString`.
    this.logger.warn('Secrets detected', {
      count: detections.length,
      critical_count: criticalCount,
      risk_score: riskScore,
      risk_level: riskLevel,
      file: sanitizeLogString(filePath),
      blocked: !allowed
    });

    return createResult(allowed, findings[0]?.severity ?? Severity.WARNING, findings);
  }
}

/**
 * Convenience function to validate content for secrets.
 */
export function validateSecrets(content: string, filePath?: string, config?: SecretGuardConfig): GuardrailResult {
  const guard = new SecretGuard(config);
  return guard.validate(content, filePath);
}
