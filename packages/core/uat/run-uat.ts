#!/usr/bin/env node
/**
 * UAT Test Runner for @blackunicorn/bonklm
 * ================================================
 *
 * CLI interface for running UAT tests.
 *
 * Usage:
 *   tsx team/uat/run-uat.ts [options]
 *
 * Options:
 *   --category <name>    Run specific category only
 *   --verbose            Show detailed output
 *   --json               Output results as JSON
 *   --report             Generate HTML report
 *   --list               List all test cases
 */

import { UATSuite } from './uat-suite.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ============================================
// CLI Options
// ============================================

interface CLIOptions {
  category?: string;
  verbose?: boolean;
  json?: boolean;
  report?: boolean;
  list?: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--category':
      case '-c':
        options.category = args[++i];
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--json':
      case '-j':
        options.json = true;
        break;
      case '--report':
      case '-r':
        options.report = true;
        break;
      case '--list':
      case '-l':
        options.list = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
UAT Test Runner for @blackunicorn/bonklm
================================================

Usage:
  tsx team/uat/run-uat.ts [options]

Options:
  --category, -c <name>    Run specific category only
  --verbose, -v            Show detailed output
  --json, -j               Output results as JSON
  --report, -r             Generate HTML report
  --list, -l               List all test cases
  --help, -h               Show this help message

Categories:
  happy-path       - Happy path scenarios (5 tests)
  security         - Security detection tests (10 tests)
  edge-cases       - Edge case handling (7 tests)
  error-handling   - Error handling (5 tests)
  performance      - Performance tests (6 tests)
  integration      - Integration scenarios (7 tests)
  configuration    - Configuration variants (7 tests)

Examples:
  # Run all tests
  tsx team/uat/run-uat.ts

  # Run security tests only
  tsx team/uat/run-uat.ts --category security

  # Run with verbose output
  tsx team/uat/run-uat.ts --verbose

  # Output JSON results
  tsx team/uat/run-uat.ts --json

  # Generate HTML report
  tsx team/uat/run-uat.ts --report
`);
}

// ============================================
// Test Listing
// ============================================

const allTests = {
  'happy-path': [
    'UAT-HP-001: Basic Simple API Usage',
    'UAT-HP-002: GuardrailEngine with Multiple Validators',
    'UAT-HP-003: Streaming Validation with Safe Content',
    'UAT-HP-004: Configuration Profile Variations',
    'UAT-HP-005: Integration with Framework Examples',
  ],
  security: [
    'UAT-SEC-001: Direct Prompt Injection Attacks',
    'UAT-SEC-002: Jailbreak Pattern Detection',
    'UAT-SEC-003: Secret and Credential Detection',
    'UAT-SEC-004: Multi-Layer Encoding Attacks',
    'UAT-SEC-005: Reformulation Detection',
    'UAT-SEC-006: Boundary Manipulation Detection',
    'UAT-SEC-007: PII Detection',
    'UAT-SEC-008: Bash Safety Detection',
    'UAT-SEC-009: XSS Pattern Detection',
    'UAT-SEC-010: Multilingual Detection',
  ],
  'edge-cases': [
    'UAT-EDGE-001: Empty and Null Input Handling',
    'UAT-EDGE-002: Very Long Content',
    'UAT-EDGE-003: Special Characters and Unicode',
    'UAT-EDGE-004: Mixed Safe and Unsafe Content',
    'UAT-EDGE-005: Boundary Value Testing',
    'UAT-EDGE-006: Fake Data Exclusion',
    'UAT-EDGE-007: Session Edge Cases',
  ],
  'error-handling': [
    'UAT-ERR-001: Invalid Configuration Handling',
    'UAT-ERR-002: Type Coercion and Invalid Types',
    'UAT-ERR-003: Broken Validators in Engine',
    'UAT-ERR-004: Circular Reference Prevention',
    'UAT-ERR-005: Resource Exhaustion Prevention',
  ],
  performance: [
    'UAT-PERF-001: Large Payload Processing',
    'UAT-PERF-002: Streaming Performance',
    'UAT-PERF-003: Multi-Validator Performance',
    'UAT-PERF-004: Sequential vs Parallel Execution',
    'UAT-PERF-005: Memory Usage',
    'UAT-PERF-006: Cache Performance',
  ],
  integration: [
    'UAT-INT-001: Full Stack Protection',
    'UAT-INT-002: Session-Based Multi-Turn Protection',
    'UAT-INT-003: Short-Circuit vs Full Validation',
    'UAT-INT-004: Dynamic Validator Management',
    'UAT-INT-005: Override Token Bypass',
    'UAT-INT-006: Streaming with Multiple Validators',
    'UAT-INT-007: Framework Integration Pattern',
  ],
  configuration: [
    'UAT-CONF-001: Sensitivity Levels',
    'UAT-CONF-002: Action Modes',
    'UAT-CONF-003: Include/Exclude Findings',
    'UAT-CONF-004: Custom Logger Configuration',
    'UAT-CONF-005: Max Decode Depth Configuration',
    'UAT-CONF-006: Guard-Specific Configurations',
    'UAT-CONF-007: Engine-Level vs Validator-Level Config',
  ],
};

function listTests(): void {
  console.log('\n📋 Available UAT Tests\n');

  let totalTests = 0;
  for (const [category, tests] of Object.entries(allTests)) {
    console.log(`\n${category.toUpperCase()} (${tests.length} tests):`);
    for (const test of tests) {
      console.log(`  • ${test}`);
      totalTests++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total: ${totalTests} test cases`);
}

// ============================================
// Report Generation
// ============================================

function generateHTMLReport(report: any, outputPath: string): void {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UAT Report - @blackunicorn/bonklm</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      font-size: 28px;
      margin-bottom: 10px;
    }
    .header p {
      opacity: 0.9;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      padding: 30px;
      background: #f9f9f9;
    }
    .metric {
      background: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .metric-value {
      font-size: 36px;
      font-weight: bold;
      color: #667eea;
    }
    .metric-label {
      color: #666;
      font-size: 14px;
      margin-top: 5px;
    }
    .metric.pass .metric-value { color: #10b981; }
    .metric.fail .metric-value { color: #ef4444; }
    .categories {
      padding: 30px;
    }
    .category {
      margin-bottom: 20px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .category-header {
      background: #f3f4f6;
      padding: 15px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
    }
    .category-name {
      font-weight: 600;
      color: #1f2937;
    }
    .category-badge {
      background: #667eea;
      color: white;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .category-badge.pass { background: #10b981; }
    .category-badge.fail { background: #ef4444; }
    .test-list {
      display: none;
    }
    .test-list.show { display: block; }
    .test-item {
      padding: 12px 20px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
    }
    .test-status {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 15px;
      font-size: 12px;
      font-weight: bold;
    }
    .test-status.pass {
      background: #10b981;
      color: white;
    }
    .test-status.fail {
      background: #ef4444;
      color: white;
    }
    .test-info {
      flex: 1;
    }
    .test-name {
      font-weight: 500;
      color: #1f2937;
    }
    .test-error {
      color: #ef4444;
      font-size: 13px;
      margin-top: 4px;
    }
    .test-duration {
      color: #9ca3af;
      font-size: 12px;
    }
    .footer {
      padding: 20px 30px;
      text-align: center;
      color: #9ca3af;
      font-size: 14px;
      border-top: 1px solid #e5e7eb;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>UAT Test Report</h1>
      <p>@blackunicorn/bonklm</p>
      <p>Generated: ${new Date().toISOString()}</p>
    </div>

    <div class="summary">
      <div class="metric">
        <div class="metric-value">${report.totalTests}</div>
        <div class="metric-label">Total Tests</div>
      </div>
      <div class="metric pass">
        <div class="metric-value">${report.totalPassed}</div>
        <div class="metric-label">Passed</div>
      </div>
      <div class="metric fail">
        <div class="metric-value">${report.totalFailed}</div>
        <div class="metric-label">Failed</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.passRate.toFixed(1)}%</div>
        <div class="metric-label">Pass Rate</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.duration}ms</div>
        <div class="metric-label">Duration</div>
      </div>
    </div>

    <div class="categories">
      <h2 style="margin-bottom: 20px; color: #1f2937;">Test Categories</h2>
      ${report.categories.map((cat: any) => `
        <div class="category">
          <div class="category-header" onclick="toggleList(this)">
            <span class="category-name">${cat.name}</span>
            <span class="category-badge ${cat.failed === 0 ? 'pass' : 'fail'}">
              ${cat.passed}/${cat.total}
            </span>
          </div>
          <div class="test-list">
            ${cat.tests.map((test: any) => `
              <div class="test-item">
                <div class="test-status ${test.passed ? 'pass' : 'fail'}">
                  ${test.passed ? '✓' : '✗'}
                </div>
                <div class="test-info">
                  <div class="test-name">${test.id}: ${test.name}</div>
                  ${!test.passed ? `<div class="test-error">${test.error}</div>` : ''}
                </div>
                <div class="test-duration">${test.duration}ms</div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="footer">
      Generated by UAT Test Suite for @blackunicorn/bonklm
    </div>
  </div>

  <script>
    function toggleList(header) {
      const list = header.nextElementSibling;
      list.classList.toggle('show');
    }
    // Show all test lists by default for failed categories
    document.querySelectorAll('.category-badge.fail').forEach(badge => {
      const list = badge.closest('.category').querySelector('.test-list');
      if (list) list.classList.add('show');
    });
  </script>
</body>
</html>`;

  writeFileSync(outputPath, html);
  console.log(`\n📄 HTML report saved to: ${outputPath}`);
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const options = parseArgs();

  // Handle list option
  if (options.list) {
    listTests();
    return;
  }

  const suite = new UATSuite();
  let report;

  // Run tests
  if (options.category) {
    console.log(`Running category: ${options.category}\n`);
    const categoryResult = await suite.runCategory(options.category);

    // Build full report structure from single category
    report = {
      totalTests: categoryResult.total,
      totalPassed: categoryResult.passed,
      totalFailed: categoryResult.failed,
      passRate: categoryResult.total > 0
        ? (categoryResult.passed / categoryResult.total) * 100
        : 0,
      categories: [categoryResult],
      duration: 0,
    };
  } else {
    report = await suite.runAll();
  }

  // Output results
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    suite.printReport(report);
  }

  // Generate HTML report if requested
  if (options.report) {
    const reportsDir = join(process.cwd(), 'team', 'uat', 'reports');
    if (!existsSync(reportsDir)) {
      mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = join(reportsDir, `uat-report-${timestamp}.html`);
    generateHTMLReport(report, outputPath);
  }

  // Exit with appropriate code
  const exitCode = report.totalFailed > 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
