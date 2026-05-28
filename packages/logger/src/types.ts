/**
 * Attack Logger - Type Definitions
 * =================================
 *
 * Complete TypeScript type definitions for the Attack Logger system.
 * These types provide full IntelliSense support and compile-time safety.
 *
 * @package @blackunicorn/bonklm-logger
 */

/**
 * Injection type classification for detected attacks.
 * Derived from finding categories in GuardrailResult.
 */
export type InjectionType = 'prompt-injection' | 'jailbreak' | 'reformulation' | 'secret-exposure' | 'unknown';

/**
 * Attack vector classification for how the attack was delivered.
 * Derived from pattern analysis and content inspection.
 */
export type AttackVector =
  | 'direct'
  | 'encoded'
  | 'roleplay'
  | 'social-engineering'
  | 'context-overload'
  | 'fragmented'
  | 'unknown';

/**
 * Risk level classification.
 * Maps directly from GuardrailResult.risk_level.
 */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Origin type for log entry identification.
 * Determines how the origin identifier is generated.
 */
export type OriginType = 'sessionId' | 'custom' | 'none';

/**
 * Display format options for the CLI output.
 */
export type DisplayFormat = 'table' | 'json' | 'summary';

/**
 * Individual finding from validation result.
 * Preserved from GuardrailResult for detailed analysis.
 */
export interface Finding {
  /** Category of the detection */
  category: string;
  /** Specific pattern name that matched */
  pattern_name?: string;
  /** Severity level of the finding */
  severity: 'info' | 'warning' | 'blocked' | 'critical';
  /** Weight of the finding for risk calculation */
  weight?: number;
  /** Matched content snippet */
  match?: string;
  /** Human-readable description */
  description: string;
  /** Line number where found (for code guards) */
  line_number?: number;
  /** Confidence level of the detection */
  confidence?: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Attack log entry representing a single intercepted attack.
 */
export interface AttackLogEntry {
  /** Unix timestamp of when the attack was logged */
  timestamp: number;
  /** Origin identifier for the source of the attack */
  origin: string;
  /** Type of injection detected */
  injection_type: InjectionType;
  /** Attack vector used */
  vector: AttackVector;
  /** The content that was validated */
  content: string;
  /** Whether the content was blocked */
  blocked: boolean;
  /** Risk level of the attack */
  risk_level: RiskLevel;
  /** Numeric risk score (0-100+) */
  risk_score: number;
  /** Individual findings from validation */
  findings: Finding[];
  /** Number of validators run */
  validator_count?: number;
  /** Number of guards run */
  guard_count?: number;
  /** Execution time in milliseconds */
  execution_time?: number;
}

/**
 * Configuration options for the AttackLogger.
 */
export interface AttackLoggerConfig {
  /**
   * Maximum number of log entries to store.
   * When limit is reached, oldest entries are evicted (LRU).
   * @default 1000
   */
  max_logs?: number;

  /**
   * Time-to-live for log entries in milliseconds.
   * Entries older than this are automatically removed.
   * @default 2592000000 (30 days)
   */
  ttl?: number;

  /**
   * Whether the logger is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * Origin type for log entries.
   * Determines how origin identifiers are generated.
   * @default 'sessionId'
   */
  origin_type?: OriginType;

  /**
   * Custom origin string to use when origin_type is 'custom'.
   * If origin_type is 'custom' and this is not provided, defaults to 'custom'.
   */
  custom_origin?: string;

  /**
   * Whether to warn before clearing entries that are approaching TTL.
   * @default true
   */
  warn_before_ttl_clear?: boolean;

  /**
   * Whether to sanitize PII in log entries.
   * @default true
   * @deprecated Setting to false is deprecated and will be removed in a future version.
   */
  sanitize_pii?: boolean;

  /**
   * Maximum size in bytes for individual log content.
   * Content exceeding this limit will be truncated before storage.
   * @default 1048576 (1MB)
   */
  max_content_size?: number;
}

/**
 * Filter options for retrieving log entries.
 * All filters are optional and applied with AND logic.
 */
export interface LogFilter {
  /** Filter by injection type(s) */
  injection_type?: InjectionType | InjectionType[];

  /** Filter by attack vector(s) */
  vector?: AttackVector | AttackVector[];

  /** Filter by risk level(s) */
  risk_level?: RiskLevel | RiskLevel[];

  /** Filter by blocked status */
  blocked?: boolean;

  /** Filter by entries since this timestamp (inclusive) */
  since?: number;

  /** Filter by entries until this timestamp (inclusive) */
  until?: number;

  /** Filter by origin string */
  origin?: string;

  /** Maximum number of entries to return */
  limit?: number;
}

/**
 * Display options for the show() method.
 */
export interface DisplayOptions {
  /** Display format */
  format?: DisplayFormat;

  /** Whether to use colors in output */
  color?: boolean;

  /** Maximum number of entries to display */
  limit?: number;

  /** Filter options to apply before display */
  filter?: LogFilter;
}

/**
 * Export options for the exportJSON() method.
 */
export interface ExportOptions {
  /** Whether to sanitize PII in export */
  sanitize_pii?: boolean;

  /** Whether to include color codes (should be false for JSON) */
  include_metadata?: boolean;
}

/**
 * Statistics summary for the executive summary display.
 */
export interface AttackSummary {
  /** Total number of logged attacks */
  total_count: number;

  /** Number of blocked attacks */
  blocked_count: number;

  /** Number of allowed attacks */
  allowed_count: number;

  /** Breakdown by injection type */
  by_injection_type: Record<InjectionType, number>;

  /** Breakdown by attack vector */
  by_attack_vector: Record<AttackVector, number>;

  /** Breakdown by risk level */
  by_risk_level: Record<RiskLevel, number>;

  /** Entry with the highest risk score */
  highest_risk_entry: AttackLogEntry | null;
}

/**
 * Callback function type for intercept events.
 * Called by GuardrailEngine when validation completes.
 */
export type InterceptCallback = (
  result: EngineResult,
  context: {
    content: string;
    validation_context?: string;
  }
) => void | Promise<void>;

/**
 * Engine result from GuardrailEngine.
 * This is a simplified version - the actual type comes from @blackunicorn/bonklm.
 */
export interface EngineResult {
  /** Whether content is allowed */
  allowed: boolean;
  /** Whether content is blocked */
  blocked: boolean;
  /** Human-readable reason for block */
  reason?: string;
  /** Severity level */
  severity: 'info' | 'warning' | 'blocked' | 'critical';
  /** Risk level */
  risk_level: RiskLevel;
  /** Numeric risk score */
  risk_score: number;
  /** Individual findings */
  findings: Finding[];
  /** Unix timestamp */
  timestamp: number;
  /** Individual validator results */
  results?: ValidatorResult[];
  /** Number of validators run */
  validatorCount?: number;
  /** Number of guards run */
  guardCount?: number;
  /** Execution time in milliseconds */
  executionTime?: number;
}

/**
 * Individual validator result.
 */
export interface ValidatorResult {
  /** Whether content is allowed */
  allowed: boolean;
  /** Whether content is blocked */
  blocked: boolean;
  /** Reason for block */
  reason?: string;
  /** Severity level */
  severity: 'info' | 'warning' | 'blocked' | 'critical';
  /** Risk level */
  risk_level: RiskLevel;
  /** Numeric risk score */
  risk_score: number;
  /** Individual findings */
  findings: Finding[];
  /** Unix timestamp */
  timestamp: number;
  /** Name of the validator */
  validatorName: string;
}
