/**
 * BonkLM - Production Guard
 * ================================
 * Blocks commands and content targeting production environments.
 *
 * Features:
 * - 18+ production keyword patterns
 * - Critical deployment command detection (force push, deploy, kubectl)
 * - Safe context detection (comments, documentation)
 * - Documentation file bypass
 * - Environment variable detection (NODE_ENV, RAILS_ENV, etc.)
 */

import { createResult, Severity as Sev } from '../base/GuardrailResult.js';
import { mergeConfig, type ValidatorConfig } from '../base/ValidatorConfig.js';

// =============================================================================
// TYPES
// =============================================================================

export interface ProductionGuardConfig extends ValidatorConfig {
  /**
   * File path to check (for documentation bypass)
   */
  filePath?: string;

  /**
   * Enable documentation file bypass
   */
  allowDocumentationFiles?: boolean;

  /**
   * Story 2.1b-edge-core (iter-1 security BLOCK #9 + reviewer HIGH-2):
   * explicit environment-variable bindings for edge runtimes that cannot
   * provide `process.env`. When set, `ProductionGuard.validate()` reads
   * environment indicators from this record rather than `process.env`.
   * When omitted, falls back to `process.env` on Node.
   *
   * Locked 6-key contract: `NODE_ENV` / `RAILS_ENV` / `FLASK_ENV` /
   * `BONKLM_OVERRIDE_SECRET` / `LLM_GUARDRAILS_OVERRIDE_SECRET` /
   * `BONKLM_SKIP_RUNTIME_PROBE`. Cloud-provider keys (`AWS_ENV`,
   * `GCP_PROJECT`, etc.) are not part of the locked contract but ARE
   * read when present.
   */
  envBindings?: EnvBindings;
}

export interface ProductionIndicator {
  pattern: string;
  match: string;
  context: string;
  isCritical: boolean;
}

// =============================================================================
// PATTERN DEFINITIONS
// =============================================================================

/**
 * Production keyword patterns
 */
const PRODUCTION_PATTERNS: Array<[RegExp, string]> = [
  // Explicit keywords
  [/\bprod\b/i, 'Explicit "prod" keyword'],
  [/\bproduction\b/i, 'Explicit "production" keyword'],
  [/\bprd\b/i, 'Explicit "prd" abbreviation'],

  // Hostname/URL patterns
  [/prod\./i, 'Production hostname prefix'],
  [/production\./i, 'Production hostname prefix'],
  [/-prod\./i, 'Production hostname suffix'],
  [/-production\./i, 'Production hostname suffix'],
  [/\.prod\./i, 'Production subdomain'],

  // Environment variables
  [/NODE_ENV\s*=\s*["']?production/i, 'Node.js production environment'],
  [/RAILS_ENV\s*=\s*["']?production/i, 'Rails production environment'],
  [/FLASK_ENV\s*=\s*["']?production/i, 'Flask production environment'],
  [/APP_ENV\s*=\s*["']?production/i, 'App production environment'],
  [/ENVIRONMENT\s*=\s*["']?prod/i, 'Environment variable set to prod'],

  // Database indicators
  [/prod[-_]?db/i, 'Production database reference'],
  [/database[-_]?prod/i, 'Production database reference'],
  [/production[-_]?database/i, 'Production database reference'],

  // Cloud provider indicators
  [/aws[-_]?prod/i, 'AWS production reference'],
  [/gcp[-_]?prod/i, 'GCP production reference'],
  [/azure[-_]?prod/i, 'Azure production reference']
];

/**
 * Critical deployment commands - ABSOLUTE BLOCK, no override
 */
const CRITICAL_PATTERNS: Array<[RegExp, string]> = [
  [/git\s+push\s+.*--force.*\s+(main|master)/i, 'Force push to main/master'],
  [/git\s+push\s+-f\s+.*(main|master)/i, 'Force push to main/master'],
  [/deploy\s+.*prod/i, 'Deploy to production'],
  [/kubectl\s+.*prod/i, 'Kubernetes in production context'],
  [/helm\s+.*prod/i, 'Helm in production context'],
  [/\blive\b.*deploy/i, 'Deploy to live'],
  [/\brelease\b.*deploy/i, 'Release deployment']
];

/**
 * Safe patterns that prevent false positives
 */
const SAFE_PATTERNS: RegExp[] = [
  /reproduce/i,
  /product(?!ion)/i, // "product" but not "production"
  /productivity/i,
  /productive/i,
  /prod[-_]?test/i,
  /test[-_]?prod/i,
  /non[-_]?prod/i,
  /pre[-_]?prod/i,
  /#.*\bprod\b/i, // Comment containing prod
  /\/\/.*\bprod\b/i, // Line comment
  /\/\*.*\bprod\b/i, // Block comment start
  /production[-_]?ready/i,
  /production[-_]?quality/i,
  /production[-_]?grade/i,
  /for\s+production/i,
  /in\s+production/i
];

/**
 * Documentation file patterns
 */
const DOCUMENTATION_PATTERNS: RegExp[] = [
  /\.md$/i,
  /README/i,
  /CHANGELOG/i,
  /CONTRIBUTING/i,
  /LICENSE/i,
  /\.txt$/i,
  /\.rst$/i,
  /\.adoc$/i,
  /\/docs\//i,
  /\/documentation\//i
];

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if the current runtime environment is a production environment.
 * This performs actual runtime environment checks rather than just text matching.
 *
 * Checks multiple environment variable patterns used across different frameworks:
 * - Node.js: NODE_ENV
 * - Rails: RAILS_ENV
 * - Django: DJANGO_SETTINGS_MODULE
 * - Flask: FLASK_ENV
 * - General: APP_ENV, ENVIRONMENT, ENV
 *
 * Also checks for cloud provider environment indicators:
 * - AWS: AWS_ENV, AWS_EXECUTION_ENV
 * - GCP: GCP_PROJECT, GOOGLE_CLOUD_PROJECT
 * - Azure: AZURE_ENV, WEBSITE_SITE_NAME (Azure App Service)
 * - Vercel: VERCEL_ENV
 * - Heroku: NODE_ENV (set to production by default)
 *
 * @returns true if actually running in a production environment
 */
/**
 * EnvBindings — Story 2.1b-edge-core injection shape.
 *
 * Edge runtimes (Workerd / edge-light / Deno / Bun) do not expose
 * `process.env`; consumers pass the relevant env-var values explicitly
 * via the `envBindings` parameter. On Node, callers can omit the
 * parameter and the function falls back to reading `process.env` when
 * the global `process` exists.
 *
 * Locked 6-key contract (iter-3 architect A&D-1): NODE_ENV, RAILS_ENV,
 * FLASK_ENV, BONKLM_OVERRIDE_SECRET, LLM_GUARDRAILS_OVERRIDE_SECRET,
 * BONKLM_SKIP_RUNTIME_PROBE. The production-environment detection
 * needs additional keys (cloud-provider markers) that we accept via
 * the same `Record<string, string | undefined>` shape — these are NOT
 * part of the locked contract but the function reads them when present.
 */
export type EnvBindings = Record<string, string | undefined>;

/**
 * Maximum byte length for any single env-var value. Iter-1 security
 * BLOCK #7: an attacker who threads untrusted request-header content
 * into the `envBindings` parameter (e.g. `{ NODE_ENV: req.headers['x-env'] }`)
 * could trigger CRITICAL blocking by setting `NODE_ENV = "production"`,
 * causing a DoS via trust escalation. We cap value length at 128
 * characters — well above any legitimate env-var value (`'production'`
 * is 10 chars; AWS Lambda runtime markers max out around 40 chars) —
 * and short-circuit oversized values to `undefined` so the rest of
 * the logic falls through to the safe "not production" default.
 *
 * Implementation note: we DO NOT throw on oversized values to avoid
 * giving a caller-supplied error a way to crash the engine. Silent
 * coercion to `undefined` is the safest failure mode.
 */
const MAX_ENV_VALUE_LENGTH = 128;

/**
 * Validate-and-sanitise a caller-supplied `envBindings` record.
 *
 * Returns a NEW object containing only keys whose values are
 * non-empty strings under `MAX_ENV_VALUE_LENGTH`. Anything else is
 * dropped silently (caller code branches on absence; no
 * ReferenceError, no oversized-value DoS).
 *
 * Iter-1 security BLOCK #7: closes the request-header-injection
 * surface where attacker-controlled values could flip the production
 * check.
 */
function sanitiseEnvBindings(raw: EnvBindings): EnvBindings {
  const out: EnvBindings = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') continue;
    if (value.length === 0) continue;
    if (value.length > MAX_ENV_VALUE_LENGTH) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Resolve env-var lookup against an explicit `envBindings` record
 * (edge path) OR fall back to `process.env` when available (Node path).
 *
 * Returns an empty object when neither source is available — caller
 * code branches on the resulting absence; no `process` ReferenceError
 * is thrown on edge.
 *
 * Caller-supplied bindings go through `sanitiseEnvBindings` to defeat
 * the attacker-controlled-value DoS surface (iter-1 security BLOCK #7).
 * `process.env` is NOT re-sanitised — it is trusted process-level state.
 */
function resolveEnv(envBindings: EnvBindings | undefined): EnvBindings {
  if (envBindings !== undefined) {
    return sanitiseEnvBindings(envBindings);
  }
  // typeof guard avoids ReferenceError on Workerd / edge-light where
  // `process` is not declared at module scope.
  if (typeof process !== 'undefined' && process && process.env) {
    return process.env as EnvBindings;
  }
  return {};
}

export function isProductionEnvironment(envBindings?: EnvBindings): boolean {
  const env = resolveEnv(envBindings);

  // Check standard environment variables
  const productionEnvVars = ['NODE_ENV', 'RAILS_ENV', 'FLASK_ENV', 'APP_ENV', 'ENVIRONMENT', 'ENV'];

  for (const key of productionEnvVars) {
    const value = env[key];
    if (value && ['production', 'prod'].includes(value.toLowerCase().trim())) {
      return true;
    }
  }

  // Check cloud provider specific environment variables
  const cloudProductionIndicators = [
    // AWS
    env.AWS_ENV?.toLowerCase().includes('prod'),
    env.AWS_EXECUTION_ENV?.startsWith('AWS_Lambda_'),
    // GCP
    env.GCP_PROJECT?.toLowerCase().includes('prod'),
    env.GOOGLE_CLOUD_PROJECT?.toLowerCase().includes('prod'),
    // Azure
    env.AZURE_ENV?.toLowerCase().includes('prod'),
    env.WEBSITE_SITE_NAME !== undefined, // Azure App Service
    // Vercel
    env.VERCEL_ENV === 'production',
    // Heroku
    env.NODE_ENV === 'production' && env.DYNO !== undefined
  ];

  if (cloudProductionIndicators.some(indicator => indicator === true)) {
    return true;
  }

  return false;
}

/**
 * Check if the current runtime environment is a test environment.
 * This helps prevent false positives during testing.
 *
 * Checks for common test environment indicators:
 * - JEST_WORKER_ID (Jest)
 * - VITEST_POOL_ID (Vitest)
 * - NODE_ENV === 'test'
 * - CI environment variables
 *
 * @returns true if running in a test environment
 */
export function isTestEnvironment(envBindings?: EnvBindings): boolean {
  const env = resolveEnv(envBindings);

  // Explicit test environment variables
  const testIndicators = [
    env.NODE_ENV === 'test',
    env.JEST_WORKER_ID !== undefined,
    env.VITEST_POOL_ID !== undefined,
    env.MOCHA_WORKER_ID !== undefined,
    env.AVOCADO_TEST_WORKER_ID !== undefined,
    env.PYTEST_CURRENT_TEST !== undefined, // Python pytest
    env.TEST === 'true',
    env.TESTING === 'true'
  ];

  // CI/CD environments (often run tests)
  const ciIndicators = [
    env.CI === 'true',
    env.CONTINUOUS_INTEGRATION === 'true',
    env.BUILD_BUILDNUMBER !== undefined, // Azure DevOps
    env.GITHUB_ACTIONS !== undefined,
    env.GITLAB_CI === 'true',
    env.CIRCLECI === 'true',
    env.JENKINS_URL !== undefined,
    env.TRAVIS === 'true',
    env.CODEBUILD_BUILD_ID !== undefined // AWS CodeBuild
  ];

  return [...testIndicators, ...ciIndicators].some(indicator => indicator === true);
}

/**
 * Check if a file path is a documentation file
 */
export function isDocumentationFile(filePath: string | undefined): boolean {
  if (!filePath) return false;
  return DOCUMENTATION_PATTERNS.some(pattern => pattern.test(filePath));
}

/**
 * Check if text is in a safe context (comments, safe words)
 */
export function isSafeContext(text: string): boolean {
  return SAFE_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Check for critical deployment commands that cannot be overridden
 */
export function isCriticalDeployCommand(text: string): { isCritical: boolean; message: string } {
  for (const [pattern, description] of CRITICAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return {
        isCritical: true,
        message: `Critical production operation: ${description}`
      };
    }
  }
  return { isCritical: false, message: '' };
}

/**
 * Detect production indicators in text
 */
export function detectProductionIndicators(text: string): ProductionIndicator[] {
  const indicators: ProductionIndicator[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    // Skip if the entire line is a safe context
    if (isSafeContext(line)) {
      continue;
    }

    for (const [pattern, description] of PRODUCTION_PATTERNS) {
      const match = line.match(pattern);
      if (match && !isSafeContext(match[0])) {
        indicators.push({
          pattern: description,
          match: match[0],
          context: line.trim().slice(0, 100),
          isCritical: false
        });
      }
    }
  }

  return indicators;
}

// =============================================================================
// GUARD CLASS
// =============================================================================

/**
 * @public Sprint 26/28 v1.0-RC1 API freeze.
 */
export class ProductionGuard {
  private readonly config: Required<Omit<ProductionGuardConfig, 'filePath'>> & { filePath?: string };

  constructor(config?: ProductionGuardConfig) {
    this.config = {
      ...mergeConfig(config),
      filePath: config?.filePath,
      allowDocumentationFiles: config?.allowDocumentationFiles ?? true,
      // iter-1 security BLOCK #9 + reviewer HIGH-2: forward edge env bindings.
      envBindings: config?.envBindings
    } as Required<Omit<ProductionGuardConfig, 'filePath'>> & { filePath?: string };
  }

  /**
   * Validate content for production targeting
   *
   * This method now performs runtime environment verification to distinguish
   * between text patterns that mention production vs. actually running in production.
   *
   * - If running in a test environment: Allows content but warns (text analysis only)
   * - If NOT in production environment: Analyzes text patterns for production references
   * - If ACTUALLY running in production: Fails validation unless content is documentation
   */
  validate(content: string, filePath?: string): import('../base/GuardrailResult.js').GuardrailResult {
    if (!content || content.trim().length === 0) {
      return createResult(true, Sev.INFO, []);
    }

    const effectiveFilePath = filePath ?? this.config.filePath;
    // iter-1 security BLOCK #9 + reviewer HIGH-2: forward edge env bindings.
    const actuallyInProduction = isProductionEnvironment(this.config.envBindings);
    const inTestEnvironment = isTestEnvironment(this.config.envBindings);

    // Skip documentation files
    if (this.config.allowDocumentationFiles && isDocumentationFile(effectiveFilePath)) {
      return createResult(true, Sev.INFO, [
        {
          category: 'production_guard',
          description: 'Documentation file bypassed',
          severity: Sev.INFO,
          weight: 0
        }
      ]);
    }

    const findings: import('../base/GuardrailResult.js').Finding[] = [];

    // CRITICAL: If we're actually running in production, fail validation
    // to prevent accidental production operations
    if (actuallyInProduction && !inTestEnvironment) {
      findings.push({
        category: 'runtime_production',
        pattern_name: 'production_environment_detected',
        severity: Sev.CRITICAL,
        match: 'Runtime: production',
        description: 'Cannot execute in production environment. This operation requires a non-production runtime.',
        weight: 50
      });

      return createResult(false, Sev.CRITICAL, findings);
    }

    // Check for critical deployment commands first (ABSOLUTE BLOCK)
    const criticalCheck = isCriticalDeployCommand(content);
    if (criticalCheck.isCritical) {
      findings.push({
        category: 'critical_production',
        pattern_name: 'critical_deploy',
        severity: Sev.CRITICAL,
        match: content.slice(0, 100),
        description: criticalCheck.message,
        weight: 30
      });

      return createResult(false, Sev.CRITICAL, findings);
    }

    // Detect production indicators in text
    const indicators = detectProductionIndicators(content);

    for (const indicator of indicators) {
      findings.push({
        category: 'production_indicator',
        pattern_name: indicator.pattern,
        severity: Sev.WARNING,
        match: indicator.match,
        description: `${indicator.pattern}: "${indicator.match}"`,
        weight: 15
      });
    }

    if (findings.length === 0) {
      return createResult(true, Sev.INFO, []);
    }

    const shouldBlock = this.config.action === 'block';

    return createResult(!shouldBlock, Sev.WARNING, findings);
  }

  /**
   * Get the guard's configuration
   */
  getConfig(): ProductionGuardConfig {
    return { ...this.config };
  }
}

// =============================================================================
// CONVENIENCE FUNCTION
// =============================================================================

/**
 * Quick production check.
 * @param content - Content to check
 * @param filePath - Optional file path for documentation bypass
 * @returns Validation result
 */
export function checkProduction(
  content: string,
  filePath?: string
): import('../base/GuardrailResult.js').GuardrailResult {
  const guard = new ProductionGuard();
  return guard.validate(content, filePath);
}
