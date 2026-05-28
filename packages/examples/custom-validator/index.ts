#!/usr/bin/env node
/**
 * Custom Validator Example
 * ========================
 *
 * This example demonstrates how to create a custom validator that extends
 * the base types and integrates with the GuardrailEngine.
 *
 * Usage:
 *   npx tsx index.ts
 */

import { readFileSync } from 'node:fs';
import {
  GuardrailResult,
  Severity,
  RiskLevel,
  Finding,
  Validator,
  GuardrailEngine,
  createLogger,
  LogLevel
} from '@blackunicorn/bonklm';

/**
 * Custom Profanity Filter Configuration
 */
interface ProfanityFilterConfig {
  /**
   * Custom list of words to block
   */
  blockedWords?: Set<string>;

  /**
   * Whether to use the default blocklist
   */
  useDefaults?: boolean;

  /**
   * Action mode
   */
  action?: 'block' | 'sanitize' | 'log';
}

/**
 * Custom Profanity Filter Validator
 *
 * This validator demonstrates how to create your own validator class
 * that works with the GuardrailEngine.
 */
class ProfanityFilter implements Validator {
  name = 'ProfanityFilter';

  private readonly blockedWords: Set<string>;
  private readonly action: 'block' | 'sanitize' | 'log';

  constructor(config: ProfanityFilterConfig = {}) {
    this.action = config.action ?? 'block';

    // Default blocklist (demonstration purposes)
    const defaultBlocked = new Set(['badword', 'offensive', 'inappropriate']);

    this.blockedWords = new Set([
      ...(config.useDefaults !== false ? Array.from(defaultBlocked) : []),
      ...(config.blockedWords ?? [])
    ]);

    const logger = createLogger('console', LogLevel.INFO);
    logger.debug(`ProfanityFilter initialized with ${this.blockedWords.size} blocked words`);
  }

  /**
   * Validate content for profanity
   */
  validate(content: string): GuardrailResult {
    const findings: Finding[] = [];
    const normalizedContent = content.toLowerCase();

    // Check for blocked words
    for (const word of this.blockedWords) {
      if (normalizedContent.includes(word.toLowerCase())) {
        findings.push({
          category: 'profanity',
          severity: Severity.WARNING,
          weight: 5,
          match: word,
          description: `Blocked word detected: "${word}"`,
          confidence: 'high'
        });
      }
    }

    // Determine if content should be blocked
    const blocked = findings.length > 0 && this.action === 'block';
    const riskScore = findings.reduce((sum, f) => sum + (f.weight ?? 1), 0);

    let riskLevel: RiskLevel = RiskLevel.LOW;
    if (riskScore >= 25) {
      riskLevel = RiskLevel.HIGH;
    } else if (riskScore >= 10) {
      riskLevel = RiskLevel.MEDIUM;
    }

    return {
      allowed: !blocked,
      blocked,
      severity: findings.length > 0 ? Severity.WARNING : Severity.INFO,
      risk_level: riskLevel,
      risk_score: riskScore,
      findings,
      timestamp: Date.now()
    };
  }

  /**
   * Sanitize content by replacing blocked words
   */
  sanitize(content: string): string {
    let sanitized = content;
    for (const word of this.blockedWords) {
      const regex = new RegExp(word, 'gi');
      sanitized = sanitized.replace(regex, '*'.repeat(word.length));
    }
    return sanitized;
  }
}

/**
 * Custom PII Detector Validator
 *
 * This validator detects Personally Identifiable Information (PII)
 * such as email addresses, phone numbers, and SSNs.
 */
class PIIDetector implements Validator {
  name = 'PIIDetector';

  // Patterns for common PII
  private readonly patterns = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
    creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    ipAddress: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g
  };

  validate(content: string): GuardrailResult {
    const findings: Finding[] = [];

    // Check for emails
    const emails = content.match(this.patterns.email);
    if (emails) {
      findings.push({
        category: 'pii',
        severity: Severity.WARNING,
        weight: 3,
        description: `Email address detected: ${emails.length} found`,
        confidence: 'high'
      });
    }

    // Check for phone numbers
    const phones = content.match(this.patterns.phone);
    if (phones) {
      findings.push({
        category: 'pii',
        severity: Severity.WARNING,
        weight: 3,
        description: `Phone number detected: ${phones.length} found`,
        confidence: 'medium'
      });
    }

    // Check for SSNs
    const ssns = content.match(this.patterns.ssn);
    if (ssns) {
      findings.push({
        category: 'pii',
        severity: Severity.CRITICAL,
        weight: 10,
        description: `Social Security Number detected: ${ssns.length} found`,
        confidence: 'high'
      });
    }

    // Check for credit cards
    const cards = content.match(this.patterns.creditCard);
    if (cards) {
      findings.push({
        category: 'pii',
        severity: Severity.CRITICAL,
        weight: 10,
        description: `Credit card number detected: ${cards.length} found`,
        confidence: 'medium'
      });
    }

    // Check for IP addresses
    const ips = content.match(this.patterns.ipAddress);
    if (ips) {
      findings.push({
        category: 'pii',
        severity: Severity.INFO,
        weight: 2,
        description: `IP address detected: ${ips.length} found`,
        confidence: 'medium'
      });
    }

    const blocked = findings.some(f => f.severity === Severity.CRITICAL);
    const riskScore = findings.reduce((sum, f) => sum + (f.weight ?? 1), 0);

    let riskLevel: RiskLevel = RiskLevel.LOW;
    if (riskScore >= 25) {
      riskLevel = RiskLevel.HIGH;
    } else if (riskScore >= 10) {
      riskLevel = RiskLevel.MEDIUM;
    }

    return {
      allowed: !blocked,
      blocked,
      severity: findings.length > 0 ? Severity.WARNING : Severity.INFO,
      risk_level: riskLevel,
      risk_score: riskScore,
      findings,
      timestamp: Date.now()
    };
  }
}

// ============================================
// Demo: Using Custom Validators
// ============================================

async function main() {
  console.log('🔧 Custom Validator Example');
  console.log('='.repeat(60));

  // Demo 1: Using a custom validator directly
  console.log('\n📝 Demo 1: Using ProfanityFilter directly');
  console.log('-'.repeat(60));

  const profanityFilter = new ProfanityFilter({
    useDefaults: true,
    action: 'block'
  });

  const testMessages = [
    'Hello, how are you today?',
    'This message contains a badword',
    'Multiple offensive and inappropriate words here'
  ];

  for (const msg of testMessages) {
    const result = profanityFilter.validate(msg);
    console.log(`\nMessage: "${msg}"`);
    console.log(`Allowed: ${result.allowed ? '✅' : '❌'}`);
    if (result.findings.length > 0) {
      console.log(`Findings: ${result.findings.map(f => f.description).join(', ')}`);
    }
  }

  // Demo 2: Sanitizing content
  console.log('\n\n📝 Demo 2: Sanitizing content with ProfanityFilter');
  console.log('-'.repeat(60));

  const sanitizeFilter = new ProfanityFilter({ action: 'sanitize' });
  const dirtyContent = 'This has a badword that should be filtered.';
  const cleanContent = sanitizeFilter.sanitize(dirtyContent);

  console.log(`Original:  "${dirtyContent}"`);
  console.log(`Sanitized: "${cleanContent}"`);

  // Demo 3: Using custom validators with GuardrailEngine
  console.log('\n\n📝 Demo 3: Integrating with GuardrailEngine');
  console.log('-'.repeat(60));

  const engine = new GuardrailEngine({
    validators: [profanityFilter, new PIIDetector()],
    shortCircuit: false
  });

  const complexMessage = 'Contact me at john@example.com or call 555-123-4567. This is badword!';
  const engineResult = await engine.validate(complexMessage);

  console.log(`Message: "${complexMessage}"`);
  console.log(`\nAllowed: ${engineResult.allowed ? '✅' : '❌'}`);
  console.log(`Risk Score: ${engineResult.risk_score}`);
  console.log(`Risk Level: ${engineResult.risk_level}`);
  console.log(`Severity: ${engineResult.severity}`);

  if (engineResult.results.length > 0) {
    console.log('\nIndividual Validator Results:');
    for (const result of engineResult.results) {
      console.log(`\n  ${result.validatorName}:`);
      console.log(`    Blocked: ${result.blocked ? '❌' : '✅'}`);
      console.log(`    Findings: ${result.findings.length}`);
      result.findings.forEach(f => {
        console.log(`      - ${f.description} [${f.severity}]`);
      });
    }
  }

  // Demo 4: Extending with custom configuration
  console.log('\n\n📝 Demo 4: Custom configuration');
  console.log('-'.repeat(60));

  const customFilter = new ProfanityFilter({
    blockedWords: new Set(['custom', 'blocked', 'word']),
    useDefaults: false,
    action: 'block'
  });

  const customResult = customFilter.validate('This contains a custom blocked word');
  console.log(`Message: "This contains a custom blocked word"`);
  console.log(`Allowed: ${customResult.allowed ? '✅' : '❌'}`);

  console.log('\n' + '='.repeat(60));
  console.log('✅ Custom Validator Example Complete!');
  console.log('\nKey Takeaways:');
  console.log('  1. Create a class implementing the Validator interface');
  console.log('  2. Implement the validate(content: string): GuardrailResult method');
  console.log('  3. Return a GuardrailResult with allowed/blocked and findings');
  console.log('  4. Add custom validators to GuardrailEngine');
  console.log('  5. Extend with custom configuration and methods');
}

// Run the demo
main().catch(console.error);
