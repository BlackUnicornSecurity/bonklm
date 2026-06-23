/**
 * IndirectInjectionValidator — D-065 §7-step-2.b PR-A
 * ===================================================
 * A provenance-gated validator that scans connector-boundary content
 * (retrieved docs, composed context, tool-call args, memory writes) against
 * {@link INDIRECT_INJECTION_PATTERNS}. It is the unified Path-1 class the
 * cross-home synthesis selected (PROPOSALS.md §1.1): ONE class with
 * per-pattern `requiresProvenance` surface tags, composed into the existing
 * connector-validator factories — NOT three sibling classes, and NEVER added
 * to the user-text `PromptInjectionValidator` bar.
 *
 * Surface resolution:
 *  - A bare `string` (the composition path, where a connector factory runs
 *    this validator over already-extracted leaf content via
 *    `runValidatorChain`) uses the constructor's `surface`.
 *  - A `ValidatorInput` object derives its surface STRICTLY from `kind`
 *    (`retrieved_docs`→retrieved_doc, `composed_context`→composed_context,
 *    `tool_call`→tool_result, `memory_write`→memory_write). `text` and
 *    `audio_partial` carry NO connector provenance → the scan is skipped
 *    (the (c) provenance-gate-false branch) regardless of `surface`, so raw
 *    user text is never matched against the stricter arms.
 */
import type { Validator, ValidatorInput } from '../engine/GuardrailEngine.types.js';
import { createResult, type Finding, type GuardrailResult, Severity } from '../base/GuardrailResult.js';
import type { ProvenanceBoundary } from './provenance.js';
import { detectIndirectInjection } from './pattern-engine.js';

export interface IndirectInjectionConfig {
  /**
   * Connector surface this instance gates. Applied ONLY when `validate`
   * receives a bare string (the composition path). Object-kind
   * `ValidatorInput` derives its surface from `kind`.
   */
  surface?: ProvenanceBoundary;
  /**
   * `'block'` (default) blocks on any block-eligible finding; `'warn'`
   * surfaces findings without blocking (telemetry / shadow mode).
   */
  action?: 'block' | 'warn';
}

const SEVERITY_RANK: Record<Severity, number> = {
  [Severity.INFO]: 0,
  [Severity.WARNING]: 1,
  [Severity.BLOCKED]: 2,
  [Severity.CRITICAL]: 3
};

// Audit-loop fix: map severity → finding weight so a CRITICAL indirect hit
// contributes a meaningful `risk_score` when the composite factories sum
// per-leaf/per-doc results (a weightless finding defaults to `weight: 1` in
// createResult, scoring a CRITICAL exfil identically to a WARNING tripwire and
// landing below the MEDIUM risk threshold). Mirrors the catalogue's weighted
// findings elsewhere; the block decision stays severity-driven (see below).
const SEVERITY_WEIGHT: Record<Severity, number> = {
  [Severity.INFO]: 1,
  [Severity.WARNING]: 8,
  [Severity.BLOCKED]: 20,
  [Severity.CRITICAL]: 25
};

/** Strict surface derivation from a ValidatorInput kind. */
function surfaceForInput(input: ValidatorInput): ProvenanceBoundary | null {
  switch (input.kind) {
    case 'retrieved_docs':
      return 'retrieved_doc';
    case 'composed_context':
      return 'composed_context';
    case 'tool_call':
      return 'tool_result';
    case 'memory_write':
      return 'memory_write';
    default:
      // 'text', 'audio_partial' — genuine user text, no connector provenance.
      return null;
  }
}

function contentForInput(input: ValidatorInput): string {
  switch (input.kind) {
    case 'text':
      return input.content;
    case 'retrieved_docs':
      return input.docs.map(d => d.content).join('\n');
    case 'composed_context':
      return input.entries.join('\n');
    case 'tool_call':
      return typeof input.args === 'string' ? input.args : safeStringify(input.args);
    case 'memory_write':
      return input.payload.content;
    case 'audio_partial':
      return input.content;
    default:
      return '';
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

export class IndirectInjectionValidator implements Validator {
  readonly name = 'IndirectInjectionValidator';

  constructor(private readonly config: IndirectInjectionConfig = {}) {}

  validate(input: string | ValidatorInput): GuardrailResult {
    let content: string;
    let surface: ProvenanceBoundary | null;

    if (typeof input === 'string') {
      content = input;
      surface = this.config.surface ?? null;
    } else {
      content = contentForInput(input);
      surface = surfaceForInput(input);
    }

    // (c) provenance-gate-false branch — no connector surface → never scan.
    if (!surface) {
      return createResult(true, Severity.INFO, []);
    }

    const patternFindings = detectIndirectInjection(content, surface);
    if (patternFindings.length === 0) {
      // (b) benign-allow branch.
      return createResult(true, Severity.INFO, []);
    }

    // (a) block branch — any block-eligible, non-INFO finding blocks unless
    // the instance is configured warn-only.
    const shouldBlock =
      this.config.action !== 'warn' &&
      patternFindings.some(f => f.blockEligible !== false && f.severity !== Severity.INFO);

    const maxSeverity = patternFindings.reduce<Severity>(
      (acc, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc),
      Severity.INFO
    );

    const findings: Finding[] = patternFindings.map(f => ({
      category: f.category,
      pattern_name: f.pattern_name,
      severity: f.severity,
      match: f.match,
      description: f.description,
      line_number: f.line_number,
      weight: SEVERITY_WEIGHT[f.severity]
    }));

    return createResult(!shouldBlock, maxSeverity, findings);
  }
}

export function createIndirectInjectionValidator(config?: IndirectInjectionConfig): IndirectInjectionValidator {
  return new IndirectInjectionValidator(config);
}
