/**
 * GuardrailResult Unit Tests
 * ==========================
 * Comprehensive unit tests for result creation and structure.
 */

import { describe, it, expect } from 'vitest';
import {
  createResult,
  mergeResults,
  Severity,
  RiskLevel,
  type GuardrailResult,
  type Finding
} from '../../../src/base/GuardrailResult.js';

describe('GuardrailResult', () => {
  describe('GR-001: Create Result', () => {
    it('should create basic result', () => {
      const result = createResult(true, Severity.INFO, []);
      expect(result.allowed).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.severity).toBe(Severity.INFO);
    });
  });

  describe('GR-002: Allowed True', () => {
    it('should set allowed=true', () => {
      const result = createResult(true, Severity.INFO, []);
      expect(result.allowed).toBe(true);
      expect(result.blocked).toBe(false);
    });
  });

  describe('GR-003: Allowed False', () => {
    it('should set allowed=false', () => {
      const result = createResult(false, Severity.CRITICAL, [
        { category: 'test', severity: Severity.CRITICAL, description: 'Blocked', weight: 20 }
      ]);
      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
    });
  });

  describe('Severity Levels', () => {
    it('GR-004: should set INFO severity', () => {
      const result = createResult(true, Severity.INFO, []);
      expect(result.severity).toBe(Severity.INFO);
      expect(result.risk_level).toBe('LOW');
    });

    it('GR-005: should set WARNING severity', () => {
      const finding: Finding = { category: 'test', severity: Severity.WARNING, description: 'Warning', weight: 10 };
      const result = createResult(false, Severity.WARNING, [finding]);
      expect(result.severity).toBe(Severity.WARNING);
      expect(result.risk_level).toBe('MEDIUM');
    });

    it('GR-006: should set CRITICAL severity', () => {
      const finding: Finding = { category: 'test', severity: Severity.CRITICAL, description: 'Critical', weight: 20 };
      const result = createResult(false, Severity.CRITICAL, [finding]);
      expect(result.severity).toBe(Severity.CRITICAL);
      // Weight 20 is below HIGH threshold (25), so it's MEDIUM
      expect(result.risk_level).toBe('MEDIUM');
    });
  });

  describe('Risk Level Calculation', () => {
    it('GR-007: should set LOW risk for low weight', () => {
      const findings: Finding[] = [{ category: 'test', severity: Severity.INFO, description: 'Test', weight: 1 }];
      const result = createResult(true, Severity.INFO, findings);
      expect(result.risk_level).toBe('LOW');
      expect(result.risk_score).toBe(1);
    });

    it('GR-008: should set MEDIUM risk for medium weight', () => {
      const findings: Finding[] = [
        { category: 'test', severity: Severity.WARNING, description: 'Warning', weight: 15 }
      ];
      const result = createResult(false, Severity.WARNING, findings);
      expect(result.risk_level).toBe('MEDIUM');
      expect(result.risk_score).toBe(15);
    });

    it('GR-009: should set HIGH risk for high weight', () => {
      const findings: Finding[] = [
        { category: 'test', severity: Severity.CRITICAL, description: 'Critical', weight: 30 }
      ];
      const result = createResult(false, Severity.CRITICAL, findings);
      expect(result.risk_level).toBe('HIGH');
      expect(result.risk_score).toBe(30);
    });
  });

  describe('GR-010: Findings Array', () => {
    it('should add findings to result', () => {
      const findings: Finding[] = [
        { category: 'test1', severity: Severity.WARNING, description: 'Test 1', weight: 10 },
        { category: 'test2', severity: Severity.INFO, description: 'Test 2', weight: 5 }
      ];
      const result = createResult(false, Severity.WARNING, findings);
      expect(result.findings).toHaveLength(2);
      expect(result.findings[0].category).toBe('test1');
      expect(result.findings[1].category).toBe('test2');
    });
  });

  describe('GR-011: Timestamp', () => {
    it('should auto-generate timestamp', () => {
      const before = Date.now();
      const result = createResult(true, Severity.INFO, []);
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('GR-012: Weight Calculation', () => {
    it('should calculate total weight from findings', () => {
      const findings: Finding[] = [
        { category: 'test1', severity: Severity.WARNING, description: 'Test 1', weight: 10 },
        { category: 'test2', severity: Severity.INFO, description: 'Test 2', weight: 5 },
        { category: 'test3', severity: Severity.CRITICAL, description: 'Test 3', weight: 20 }
      ];
      const result = createResult(false, Severity.CRITICAL, findings);
      expect(result.risk_score).toBe(35); // 10 + 5 + 20
    });
  });

  describe('GR-013: Empty Findings', () => {
    it('should handle no findings scenario', () => {
      const result = createResult(true, Severity.INFO, []);
      expect(result.allowed).toBe(true);
      expect(result.findings).toHaveLength(0);
      expect(result.risk_score).toBe(0);
      expect(result.risk_level).toBe('LOW');
    });
  });

  describe('GR-014: Multiple Findings', () => {
    it('should aggregate multiple findings', () => {
      const findings: Finding[] = Array.from({ length: 10 }, (_, i) => ({
        category: `test${i}`,
        severity: i % 2 === 0 ? Severity.WARNING : Severity.INFO,
        description: `Test ${i}`,
        weight: 10
      }));
      const result = createResult(false, Severity.WARNING, findings);
      expect(result.findings).toHaveLength(10);
      expect(result.risk_score).toBe(100);
    });
  });

  describe('Finding Structure', () => {
    it('should include all required finding fields', () => {
      const finding: Finding = {
        category: 'injection',
        severity: Severity.CRITICAL,
        description: 'Prompt injection detected',
        weight: 20,
        pattern_name: 'ignore_instructions',
        match: 'Ignore all instructions',
        line_number: 1
      };

      const result = createResult(false, Severity.CRITICAL, [finding]);

      expect(result.findings[0].category).toBe('injection');
      expect(result.findings[0].severity).toBe(Severity.CRITICAL);
      expect(result.findings[0].description).toBe('Prompt injection detected');
      expect(result.findings[0].weight).toBe(20);
      expect(result.findings[0].pattern_name).toBe('ignore_instructions');
      expect(result.findings[0].match).toBe('Ignore all instructions');
      expect(result.findings[0].line_number).toBe(1);
    });
  });

  describe('Result Immutability', () => {
    it('should use same reference (not cloned)', () => {
      const findings: Finding[] = [{ category: 'test', severity: Severity.WARNING, description: 'Test', weight: 10 }];
      const result = createResult(false, Severity.WARNING, findings);

      // Modify original array
      findings.push({ category: 'test2', severity: Severity.INFO, description: 'Test 2', weight: 5 });

      // Result is affected (same reference - this is current behavior)
      expect(result.findings).toHaveLength(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero weight findings', () => {
      const findings: Finding[] = [{ category: 'test', severity: Severity.INFO, description: 'Test', weight: 0 }];
      const result = createResult(true, Severity.INFO, findings);
      expect(result.risk_score).toBe(0);
      expect(result.risk_level).toBe('LOW');
    });

    it('should handle very high weight', () => {
      const findings: Finding[] = [
        { category: 'test', severity: Severity.CRITICAL, description: 'Test', weight: 1000 }
      ];
      const result = createResult(false, Severity.CRITICAL, findings);
      expect(result.risk_score).toBe(1000);
      expect(result.risk_level).toBe('HIGH');
    });

    it('should handle negative weight (should not happen but test)', () => {
      const findings: Finding[] = [{ category: 'test', severity: Severity.INFO, description: 'Test', weight: -10 }];
      const result = createResult(true, Severity.INFO, findings);
      expect(result.risk_score).toBe(-10);
    });
  });

  describe('Severity Enum', () => {
    it('should have correct severity values', () => {
      expect(Severity.INFO).toBe('info');
      expect(Severity.WARNING).toBe('warning');
      expect(Severity.BLOCKED).toBe('blocked');
      expect(Severity.CRITICAL).toBe('critical');
    });
  });

  describe('RiskLevel Enum', () => {
    it('should have correct risk level values', () => {
      expect(RiskLevel.LOW).toBe('LOW');
      expect(RiskLevel.MEDIUM).toBe('MEDIUM');
      expect(RiskLevel.HIGH).toBe('HIGH');
    });
  });

  describe('mergeResults', () => {
    it('GR-015: should merge single result', () => {
      const findings: Finding[] = [{ category: 'test', severity: Severity.CRITICAL, description: 'Test', weight: 10 }];
      const result = createResult(false, Severity.CRITICAL, findings);
      const merged = mergeResults(result);

      expect(merged.allowed).toBe(false);
      expect(merged.blocked).toBe(true);
      expect(merged.risk_score).toBe(10);
      expect(merged.findings).toHaveLength(1);
    });

    it('GR-016: should merge multiple allowed results', () => {
      const result1 = createResult(true, Severity.INFO, []);
      const result2 = createResult(true, Severity.INFO, []);
      const merged = mergeResults(result1, result2);

      expect(merged.allowed).toBe(true);
      expect(merged.blocked).toBe(false);
      expect(merged.risk_score).toBe(0);
      expect(merged.findings).toHaveLength(0);
    });

    it('GR-017: should merge multiple results with some blocked', () => {
      const findings: Finding[] = [
        { category: 'test', severity: Severity.CRITICAL, description: 'Blocked', weight: 10 }
      ];
      const result1 = createResult(true, Severity.INFO, []);
      const result2 = createResult(false, Severity.CRITICAL, findings);
      const merged = mergeResults(result1, result2);

      expect(merged.allowed).toBe(false);
      expect(merged.blocked).toBe(true);
      expect(merged.reason).toBe('Blocked');
    });

    it('GR-018: should aggregate findings from all results', () => {
      const findings1: Finding[] = [
        { category: 'test1', severity: Severity.WARNING, description: 'Warning 1', weight: 5 }
      ];
      const findings2: Finding[] = [{ category: 'test2', severity: Severity.INFO, description: 'Info', weight: 3 }];
      const result1 = createResult(true, Severity.INFO, findings1);
      const result2 = createResult(true, Severity.INFO, findings2);
      const merged = mergeResults(result1, result2);

      expect(merged.findings).toHaveLength(2);
      expect(merged.findings[0].category).toBe('test1');
      expect(merged.findings[1].category).toBe('test2');
    });

    it('GR-019: should sum risk scores from all results', () => {
      const findings1: Finding[] = [
        { category: 'test1', severity: Severity.WARNING, description: 'Warning 1', weight: 10 }
      ];
      const findings2: Finding[] = [
        { category: 'test2', severity: Severity.CRITICAL, description: 'Critical', weight: 15 }
      ];
      const result1 = createResult(true, Severity.INFO, findings1);
      const result2 = createResult(true, Severity.INFO, findings2);
      const merged = mergeResults(result1, result2);

      expect(merged.risk_score).toBe(25); // 10 + 15
      expect(merged.risk_level).toBe(RiskLevel.HIGH);
    });

    it('GR-020: should determine max severity correctly', () => {
      const result1 = createResult(true, Severity.INFO, []);
      const result2 = createResult(true, Severity.WARNING, []);
      const result3 = createResult(false, Severity.CRITICAL, []);
      const merged = mergeResults(result1, result2, result3);

      expect(merged.severity).toBe(Severity.CRITICAL);
    });

    it('GR-021: should handle severity order: INFO < WARNING < BLOCKED < CRITICAL', () => {
      const result1 = createResult(true, Severity.INFO, []);
      const result2 = createResult(true, Severity.WARNING, []);
      const result3 = createResult(false, Severity.BLOCKED, []);
      const result4 = createResult(false, Severity.CRITICAL, []);

      expect(mergeResults(result1).severity).toBe(Severity.INFO);
      expect(mergeResults(result1, result2).severity).toBe(Severity.WARNING);
      expect(mergeResults(result1, result2, result3).severity).toBe(Severity.BLOCKED);
      expect(mergeResults(result1, result2, result3, result4).severity).toBe(Severity.CRITICAL);
    });

    it('GR-022: should calculate MEDIUM risk level correctly (10-24)', () => {
      const findings: Finding[] = [
        { category: 'test', severity: Severity.WARNING, description: 'Warning', weight: 10 }
      ];
      const result = createResult(false, Severity.WARNING, findings);
      const merged = mergeResults(result);

      expect(merged.risk_level).toBe(RiskLevel.MEDIUM);
    });

    it('GR-023: should calculate HIGH risk level correctly (25+)', () => {
      const findings: Finding[] = [
        { category: 'test', severity: Severity.CRITICAL, description: 'Critical', weight: 25 }
      ];
      const result = createResult(false, Severity.CRITICAL, findings);
      const merged = mergeResults(result);

      expect(merged.risk_level).toBe(RiskLevel.HIGH);
    });

    it('GR-024: should generate new timestamp for merged result', () => {
      const result = createResult(true, Severity.INFO, []);
      const before = Date.now();
      const merged = mergeResults(result);
      const after = Date.now();

      expect(merged.timestamp).toBeGreaterThanOrEqual(before);
      expect(merged.timestamp).toBeLessThanOrEqual(after);
    });

    it('GR-025: should get reason from first blocked result', () => {
      const findings1: Finding[] = [
        { category: 'test1', severity: Severity.CRITICAL, description: 'First blocked', weight: 10 }
      ];
      const findings2: Finding[] = [
        { category: 'test2', severity: Severity.CRITICAL, description: 'Second blocked', weight: 10 }
      ];
      const result1 = createResult(true, Severity.INFO, []);
      const result2 = createResult(false, Severity.CRITICAL, findings1);
      const result3 = createResult(false, Severity.CRITICAL, findings2);
      const merged = mergeResults(result1, result2, result3);

      expect(merged.reason).toBe('First blocked');
    });

    it('GR-026: should handle empty results array', () => {
      const merged = mergeResults();

      expect(merged.allowed).toBe(true);
      expect(merged.blocked).toBe(false);
      expect(merged.risk_score).toBe(0);
      expect(merged.findings).toHaveLength(0);
      expect(merged.risk_level).toBe(RiskLevel.LOW);
      expect(merged.severity).toBe(Severity.INFO);
    });
  });
});
