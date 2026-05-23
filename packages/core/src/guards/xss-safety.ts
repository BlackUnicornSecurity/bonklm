/**
 * BonkLM - XSS (Cross-Site Scripting) Safety Guard
 * ==========================================================
 * Detects XSS patterns in content to prevent cross-site scripting attacks.
 *
 * OWASP Coverage:
 * - A03-201: Reflected XSS detection
 * - A03-202: Stored XSS detection
 * - A03-203: DOM-based XSS detection
 * - A03-204: Event handler XSS detection
 * - A03-205: Polyglot XSS detection
 * - A03-206: CSS expression XSS detection
 * - A03-207: SVG XSS detection
 * - A03-208: JavaScript URI XSS detection
 */

import { createResult, Severity as Sev } from '../base/GuardrailResult.js';
import { mergeConfig, type ValidatorConfig } from '../base/ValidatorConfig.js';
import { normalizeText } from '../validators/text-normalizer.js';

// =============================================================================
// TYPES
// =============================================================================

export interface XSSGuardConfig extends ValidatorConfig {
  /**
   * Context for the content (filename, content type)
   */
  context?: string;

  /**
   * Detection mode: 'strict' (block on any) or 'permissive' (block on critical only)
   */
  mode?: 'strict' | 'permissive';
}

export interface XSSDetectionResult {
  hasXSS: boolean;
  severity: Sev;
  patterns: XSSPattern[];
  message: string;
}

export interface XSSPattern {
  pattern: string;
  category: string;
  testId: string;
  line?: number;
}

// =============================================================================
// XSS PATTERN DEFINITIONS
// =============================================================================>

interface XSSPatternDefinition {
  name: string;
  pattern: RegExp;
  severity: Sev;
}

const XSS_PATTERNS: Record<string, XSSPatternDefinition[]> = {
  /**
   * A03-201: Reflected XSS patterns
   */
  reflected: [
    { name: 'script_tag', pattern: /<script[^>]*>[\s\S]*?<\/script>/gi, severity: Sev.CRITICAL },
    { name: 'img_onerror', pattern: /<img[^>]+onerror[^>]*>/gi, severity: Sev.CRITICAL },
    { name: 'img_onload', pattern: /<img[^>]+onload[^>]*>/gi, severity: Sev.CRITICAL },
    { name: 'iframe_javascript', pattern: /<iframe[^>]*src\s*=\s*['"]\s*javascript:/gi, severity: Sev.CRITICAL },
    { name: 'meta_refresh_javascript', pattern: /<meta[^>]*http-equiv\s*=\s*['"]\s*refresh['"][^>]*url\s*=\s*javascript:/gi, severity: Sev.CRITICAL },
    { name: 'form_action_javascript', pattern: /<form[^>]*action\s*=\s*javascript:/gi, severity: Sev.CRITICAL },
  ],

  /**
   * A03-202: Stored XSS patterns
   */
  stored: [
    { name: 'script_with_alert', pattern: /<script[^>]*>[^<]*(?:alert|confirm|prompt|eval|Function)[^<]*<\/script>/gi, severity: Sev.CRITICAL },
    { name: 'event_handler_div', pattern: /<(?:div|span|a|img|body|html)[^>]*\s+on(?:click|load|error|mouseover|focus)\s*=/gi, severity: Sev.CRITICAL },
    { name: 'data_url_html', pattern: /<[^>]+src\s*=\s*['"]\s*data:text\/html/gi, severity: Sev.CRITICAL },
    { name: 'data_url_href', pattern: /<[^>]+href\s*=\s*['"]\s*data:text\/html/gi, severity: Sev.CRITICAL },
  ],

  /**
   * A03-203: DOM-based XSS patterns
   */
  domBased: [
    { name: 'document_write', pattern: /document\.(?:write|writeln)\s*\(/gi, severity: Sev.CRITICAL },
    { name: 'document_open_close', pattern: /document\.(?:open|close)\s*\(/gi, severity: Sev.CRITICAL },
    { name: 'location_href', pattern: /location\s*\.\s*href\s*=/gi, severity: Sev.CRITICAL },
    { name: 'location_assign', pattern: /location\s*\.\s*assign\s*\(/gi, severity: Sev.CRITICAL },
    { name: 'window_location_name', pattern: /window\.(?:location|name)\s*=/gi, severity: Sev.CRITICAL },
    { name: 'eval', pattern: /\beval\s*\(/gi, severity: Sev.CRITICAL },
    { name: 'new_function', pattern: /new\s+Function\s*\(/gi, severity: Sev.CRITICAL },
    { name: 'settimeout_string', pattern: /setTimeout\s*\(\s*['"][^'"]*['"]\s*,/gi, severity: Sev.WARNING },
    { name: 'setinterval_string', pattern: /setInterval\s*\(\s*['"][^'"]*['"]\s*,/gi, severity: Sev.WARNING },
  ],

  /**
   * A03-204: Event handler XSS patterns
   */
  eventHandlers: [
    { name: 'html_event_handler', pattern: /\bon(?:abort|blur|change|click|dblclick|error|focus|keydown|keyup|load|mousedown|mouseenter|mouseleave|mousemove|mouseout|mouseover|mouseup|reset|resize|select|submit|unload)\s*=/gi, severity: Sev.CRITICAL },
    { name: 'svg_event_handler', pattern: /\son(?:begin|end|repeat|load)\s*=/gi, severity: Sev.CRITICAL },
  ],

  /**
   * A03-205: Polyglot XSS patterns
   * SECURITY: ReDoS mitigation - patterns use bounded quantifiers
   */
  polyglot: [
    // FIX: ReDoS mitigation - avoid nested quantifiers that cause catastrophic backtracking
    // Original pattern /<script>[^<]{0,500}<\/script>.*?>.*</ could hang on certain inputs
    { name: 'polyglot_script', pattern: /<script>[^<]{0,500}<\/script>/gi, severity: Sev.CRITICAL },
    { name: 'javascript_uri', pattern: /javascript:\s*[\w\u007f-\uffff]{1,100}/gi, severity: Sev.CRITICAL },
    { name: 'hex_encoded_script', pattern: /%3[Cc]%2[Ff]%73%63%72%69%70%74/gi, severity: Sev.WARNING },
  ],

  /**
   * A03-206: CSS expression XSS patterns
   */
  cssExpression: [
    { name: 'css_expression', pattern: /expression\s*\(\s*[\w\u007f-\uffff]*\)/gi, severity: Sev.WARNING },
    { name: 'css_javascript', pattern: /javascript:\s*[\w\u007f-\uffff]+/gi, severity: Sev.WARNING },
    { name: 'css_behavior_url', pattern: /behavior\s*:\s*url\s*\(\s*['"]?javascript:/gi, severity: Sev.WARNING },
  ],

  /**
   * A03-207: SVG XSS patterns
   */
  svg: [
    { name: 'svg_script', pattern: /<svg[^>]*>[^<]*<script[\s\S]*?<\/script>[\s\S]*?<\/svg>/gi, severity: Sev.CRITICAL },
    { name: 'svg_onload', pattern: /<svg[^>]+onload[^>]*>/gi, severity: Sev.CRITICAL },
    { name: 'svg_onerror', pattern: /<svg[^>]+onerror[^>]*>/gi, severity: Sev.CRITICAL },
    { name: 'svg_animate', pattern: /<svg[^>]+<animate[^>]*>[\s\S]*?<\/animate>[\s\S]*?<\/svg>/gi, severity: Sev.CRITICAL },
    { name: 'foreignobject_script', pattern: /<foreignObject[^>]*>[\s\S]*?<script[\s\S]*?<\/script>[\s\S]*?<\/foreignObject>/gi, severity: Sev.CRITICAL },
  ],

  /**
   * A03-208: JavaScript URI XSS patterns
   */
  javascriptUri: [
    { name: 'a_href_javascript', pattern: /<a\s+[^>]*href\s*=\s*['"]\s*javascript:/gi, severity: Sev.CRITICAL },
    { name: 'img_src_javascript', pattern: /<img\s+[^>]*src\s*=\s*['"]\s*javascript:/gi, severity: Sev.CRITICAL },
    { name: 'iframe_src_javascript', pattern: /<iframe\s+[^>]*src\s*=\s*['"]\s*javascript:/gi, severity: Sev.CRITICAL },
    { name: 'link_href_javascript', pattern: /<link\s+[^>]*href\s*=\s*['"]\s*javascript:/gi, severity: Sev.CRITICAL },
  ],
};

/**
 * Get OWASP test ID for category
 */
function getTestIdForCategory(category: string): string {
  const testIds: Record<string, string> = {
    reflected: 'A03-201',
    stored: 'A03-202',
    domBased: 'A03-203',
    eventHandlers: 'A03-204',
    polyglot: 'A03-205',
    cssExpression: 'A03-206',
    svg: 'A03-207',
    javascriptUri: 'A03-208',
  };
  return testIds[category] || 'A03-GENERIC';
}

/**
 * Check if a line is likely safe based on context
 */
function isLineSafe(line: string, context?: string): boolean {
  if (context?.includes('.test.') || context?.includes('.spec.')) {
    return true;
  }

  if (line.trim().startsWith('```')) {
    return true;
  }

  if (/<div\s+class=['"](alert|toast|message)['"]/.test(line)) {
    return true;
  }

  return false;
}

/**
 * Detect XSS patterns in content
 */
export function detectXSS(content: string, context?: string): XSSDetectionResult {
  if (!content || typeof content !== 'string') {
    return {
      hasXSS: false,
      severity: Sev.INFO,
      patterns: [],
      message: 'No content to check',
    };
  }

  const detected: XSSPattern[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (isLineSafe(line, context)) {
      continue;
    }

    for (const [category, patterns] of Object.entries(XSS_PATTERNS)) {
      for (const patternDef of patterns) {
        // Reset lastIndex for global regexes to ensure consistent matching
        patternDef.pattern.lastIndex = 0;
        if (patternDef.pattern.source && patternDef.pattern.test(line)) {
          detected.push({
            pattern: patternDef.pattern.source,
            category,
            testId: getTestIdForCategory(category),
            line: i + 1,
          });
        }
      }
    }
  }

  if (detected.length === 0) {
    return {
      hasXSS: false,
      severity: Sev.INFO,
      patterns: [],
      message: 'No XSS patterns detected',
    };
  }

  const hasCritical = detected.some((d) =>
    ['script', 'javascript:', 'eval', 'data:text/html', 'onerror', 'onload']
      .some((p) => d.pattern.toLowerCase().includes(p.toLowerCase()))
  );

  const severity: Sev = hasCritical ? Sev.CRITICAL : Sev.WARNING;

  return {
    hasXSS: true,
    severity,
    patterns: detected,
    message: `XSS patterns detected: ${detected.map((d) => d.testId).join(', ')}`,
  };
}

// =============================================================================
// GUARD CLASS
// =============================================================================

/**
 * @public Sprint 26/28 v1.0-RC1 API freeze.
 */
export class XSSGuard {
  private readonly config: Required<Omit<XSSGuardConfig, 'context'>> & { context?: string };

  constructor(config?: XSSGuardConfig) {
    this.config = {
      ...mergeConfig(config),
      context: config?.context,
      mode: config?.mode ?? 'strict',
    } as Required<Omit<XSSGuardConfig, 'context'>> & { context?: string };
  }

  /**
   * Validate content for XSS patterns
   */
  validate(content: string): import('../base/GuardrailResult.js').GuardrailResult {
    if (!content || content.trim().length === 0) {
      return createResult(true, Sev.INFO, []);
    }

    // Normalize before detection — strips zero-width chars, maps confusables.
    // Defeats `<scr​ipt>` and homoglyph bypass.
    const normalized = normalizeText(content);
    const result = detectXSS(normalized, this.config.context);

    if (!result.hasXSS) {
      return createResult(true, Sev.INFO, []);
    }

    const findings = result.patterns.map((p) => ({
      category: `xss_${p.category}`,
      pattern_name: p.testId,
      severity: result.severity,
      match: p.pattern.substring(0, 60),
      description: `[${p.testId}] ${p.category} XSS pattern at line ${p.line ?? '?'}`,
      weight: result.severity === Sev.CRITICAL ? 20 : 10,
    }));

    const shouldBlock =
      this.config.action === 'block' &&
      (this.config.mode === 'strict' || result.severity === Sev.CRITICAL);

    return createResult(
      !shouldBlock,
      result.severity,
      findings
    );
  }

  /**
   * Get detailed XSS report
   */
  getXSSReport(content: string): string {
    // Apply same normalization as validate() — without this, getXSSReport
    // bypasses zero-width/homoglyph defences.
    const result = detectXSS(normalizeText(content), this.config.context);

    if (!result.hasXSS) {
      return 'XSS Check: PASSED - No suspicious patterns detected.';
    }

    let report = `XSS Check: ${result.severity}\n`;
    report += `Message: ${result.message}\n`;

    if (result.patterns.length > 0) {
      report += '\nDetections:\n';
      for (const detection of result.patterns) {
        report += `  Line ${detection.line ?? '?'}: [${detection.testId}] ${detection.category}\n`;
        report += `    Pattern: ${detection.pattern.substring(0, 60)}...\n`;
      }
    }

    return report;
  }

  /**
   * Get the guard's configuration
   */
  getConfig(): XSSGuardConfig {
    return { ...this.config };
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Quick XSS check.
 * @param content - Content to check
 * @param context - Optional context (filename, content type)
 * @returns Validation result
 */
export function checkXSS(
  content: string,
  context?: string
): import('../base/GuardrailResult.js').GuardrailResult {
  const guard = new XSSGuard({ context });
  return guard.validate(content);
}

/**
 * Get XSS report for content.
 * @param content - Content to check
 * @param context - Optional context (filename, content type)
 * @returns Human-readable report
 */
export function getXSSReport(content: string, context?: string): string {
  const guard = new XSSGuard({ context });
  return guard.getXSSReport(content);
}
