#!/usr/bin/env node
/**
 * Simple validation example for @blackunicorn-llmguardrails
 *
 * Usage:
 *   npx tsx validate.ts <file>
 */

import { readFileSync } from 'node:fs';
import { validatePromptInjection, validateSecrets } from '@blackunicorn/bonklm';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node validate.js <file>');
  console.error('');
  console.error('Example:');
  console.error('  node validate.js user-input.txt');
  console.error('  node validate.js config.ts');
  process.exit(1);
}

let content: string;

try {
  content = readFileSync(filePath, 'utf-8');
} catch (error) {
  console.error(`Error reading file: ${error}`);
  process.exit(1);
}

console.log(`Validating: ${filePath}`);
console.log('='.repeat(50));

// Test 1: Prompt Injection Detection
console.log('\n🔍 Testing for Prompt Injection...');
const injectionResult = validatePromptInjection(content);

if (injectionResult.allowed) {
  console.log('   ✅ No prompt injection patterns detected');
} else {
  console.log(`   ❌ Prompt Injection Detected`);
  console.log(`   Severity: ${injectionResult.severity}`);
  console.log(`   Risk Level: ${injectionResult.risk_level}`);
  console.log(`   Reason: ${injectionResult.reason}`);

  if (injectionResult.findings.length > 0) {
    console.log(`   Findings (${injectionResult.findings.length}):`);
    injectionResult.findings.slice(0, 5).forEach(finding => {
      console.log(`     - ${finding.description} [${finding.severity}]`);
      if (finding.match) {
        console.log(`       Match: "${finding.match.slice(0, 50)}..."`);
      }
    });
  }
}

// Test 2: Secret Detection
console.log('\n🔐 Testing for Secrets...');
const secretResult = validateSecrets(content, filePath);

if (secretResult.allowed) {
  console.log('   ✅ No secrets detected');
} else {
  console.log(`   ❌ Secrets Detected`);
  console.log(`   Severity: ${secretResult.severity}`);
  console.log(`   Risk Level: ${secretResult.risk_level}`);

  if (secretResult.findings.length > 0) {
    console.log(`   Findings (${secretResult.findings.length}):`);
    secretResult.findings.slice(0, 5).forEach(finding => {
      console.log(`     - ${finding.description} at line ${finding.line_number}`);
    });
  }
}

// Summary
console.log('\n' + '='.repeat(50));
if (injectionResult.allowed && secretResult.allowed) {
  console.log('✅ All validations passed - content is safe');
  process.exit(0);
} else {
  console.log('❌ Validation failed - content was blocked');
  process.exit(1);
}
