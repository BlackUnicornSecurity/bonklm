/**
 * Guardrail Result Types
 * ======================
 * Unified result types across all validators and guards.
 */

export enum Severity {
  INFO = 'info',
  WARNING = 'warning',
  BLOCKED = 'blocked',
  CRITICAL = 'critical',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export interface Finding {
  category: string;
  pattern_name?: string;
  severity: Severity;
  weight?: number;
  match?: string;
  description: string;
  line_number?: number;
  confidence?: 'critical' | 'high' | 'medium' | 'low';
}

export interface GuardrailResult {
  allowed: boolean;
  blocked: boolean;
  reason?: string;
  severity: Severity;
  risk_level: RiskLevel;
  risk_score: number;
  findings: Finding[];
  timestamp: number;
  /**
   * Story 1.1 (R2-8): optional per-sub-input breakdown.
   *
   * Used by composite validators (tool-call args, retrieved-doc batch,
   * composed-context) to expose the underlying decision per key (string
   * leaf identifier, document id, entry index, etc.) without inventing a
   * bespoke result schema. Top-level `blocked`/`severity` still
   * summarize the aggregate; consumers needing detail consult `subResults`.
   *
   * **Double-count warning** (audit-loop): the top-level `findings`
   * array already aggregates all per-leaf findings from
   * `subResults[*].result.findings`. Consumers iterating both for
   * telemetry, scoring, or display MUST pick ONE source — either the
   * flat `findings` list OR `subResults[*].result.findings`, never sum
   * across them.
   */
  subResults?: Array<{ key: string; result: GuardrailResult }>;

  /**
   * Story 1.3: optional surface-specific metadata.
   *
   * Carries lightweight context that downstream consumers (audit trail,
   * OTel telemetry) correlate the result against. Examples:
   *  - `{ memorySessionId, userId }` for `memory_write` surface
   *  - `{ documentId, indexName }` for `retrieved_doc` surface
   *  - `{ toolName, toolCallId }` for `tool_call` surface
   *
   * Do NOT use this field to smuggle large payloads through the result —
   * keep entries primitive and bounded. Composite validators are
   * responsible for populating their own keys.
   */
  metadata?: Record<string, unknown>;
}

export interface ValidationResult extends GuardrailResult {
  validator_name: string;
}

export function createResult(
  allowed: boolean,
  severity: Severity = Severity.INFO,
  findings: Finding[] = []
): GuardrailResult {
  const riskScore = findings.reduce((sum, f) => sum + (f.weight ?? 1), 0);
  let riskLevel: RiskLevel = RiskLevel.LOW;
  if (riskScore >= 25) {
    riskLevel = RiskLevel.HIGH;
  } else if (riskScore >= 10) {
    riskLevel = RiskLevel.MEDIUM;
  }

  return {
    allowed,
    blocked: !allowed,
    reason: findings.length > 0 ? findings[0].description : undefined,
    severity,
    risk_level: riskLevel,
    risk_score: riskScore,
    findings,
    timestamp: Date.now(),
  };
}

export function mergeResults(...results: GuardrailResult[]): GuardrailResult {
  const allFindings = results.flatMap((r) => r.findings);
  const totalRiskScore = results.reduce((sum, r) => sum + r.risk_score, 0);
  const anyBlocked = results.some((r) => r.blocked);
  const maxSeverity = results.reduce((max, r) => {
    const severityOrder: Record<Severity, number> = {
      [Severity.INFO]: 0,
      [Severity.WARNING]: 1,
      [Severity.BLOCKED]: 2,
      [Severity.CRITICAL]: 3,
    };
    return severityOrder[r.severity] > severityOrder[max] ? r.severity : max;
  }, Severity.INFO);

  let riskLevel: RiskLevel = RiskLevel.LOW;
  if (totalRiskScore >= 25) {
    riskLevel = RiskLevel.HIGH;
  } else if (totalRiskScore >= 10) {
    riskLevel = RiskLevel.MEDIUM;
  }

  // Story 1.3 — propagate per-input `metadata` into the merged result.
  // Later inputs win on key collision (documented contract).
  let mergedMetadata: Record<string, unknown> | undefined;
  for (const r of results) {
    if (r.metadata) {
      mergedMetadata = { ...(mergedMetadata ?? {}), ...r.metadata };
    }
  }

  return {
    allowed: !anyBlocked,
    blocked: anyBlocked,
    reason: anyBlocked ? results.find((r) => r.blocked)?.reason : undefined,
    severity: maxSeverity,
    risk_level: riskLevel,
    risk_score: totalRiskScore,
    findings: allFindings,
    ...(mergedMetadata !== undefined ? { metadata: mergedMetadata } : {}),
    timestamp: Date.now(),
  };
}
