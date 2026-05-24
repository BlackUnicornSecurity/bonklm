/**
 * OpenClaw Adapter - Middleware
 * ===============================
 * Integration layer for using BonkLM with OpenClaw.
 *
 * This middleware provides pre-action hooks for OpenClaw's agent system
 * to validate user input and tool execution against prompt injection,
 * jailbreak, and content security threats.
 */

import type {
  Logger,
  PromptInjectionConfig,
  SecretGuardConfig,
} from '@blackunicorn/bonklm';
import {
  createLogger,
  createResult,
  type GuardrailResult,
  PromptInjectionValidator,
  sanitizeMeta,
  SecretGuard,
  Severity,
} from '@blackunicorn/bonklm';
import type {
  OpenClawAdapterConfig,
  OpenClawGuardrailResult,
  OpenClawMessageContext,
  OpenClawToolContext,
} from './types.js';

const DEFAULT_CONFIG: Required<Omit<OpenClawAdapterConfig, 'logger'>> = {
  validateMessages: true,
  validateTools: true,
  blockThreshold: 'warning',
  logResults: true,
};

/**
 * OpenClaw Guardrails Middleware
 *
 * Integrates with OpenClaw's hook system to provide security validation
 * for messages and tool executions.
 */
export class OpenClawGuardrailsMiddleware {
  private readonly config: Required<OpenClawAdapterConfig>;
  private readonly logger: Logger;
  private readonly promptInjectionValidator: PromptInjectionValidator;
  private readonly secretGuard: SecretGuard;

  constructor(
    config: OpenClawAdapterConfig = {},
    validators?: {
      promptInjection?: PromptInjectionConfig;
      secret?: SecretGuardConfig;
    }
  ) {
    // Use the shared Logger contract from core instead of a local
    // class-with-console-log so consumers can pass in their structured
    // logger (e.g. pino, winston) via config.logger.
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      logger: config.logger ?? createLogger('console'),
    } as Required<OpenClawAdapterConfig>;
    this.logger = this.config.logger as unknown as Logger;

    this.promptInjectionValidator = new PromptInjectionValidator(validators?.promptInjection);
    this.secretGuard = new SecretGuard(validators?.secret);
  }

  /**
   * Validate an OpenClaw message before processing
   */
  async validateMessage(context: OpenClawMessageContext): Promise<OpenClawGuardrailResult> {
    if (!this.config.validateMessages) {
      return {
        ...createResult(true),
        allowed: true,
        originalContent: context.content,
      };
    }

    // Sprint 40 connector CWE-117 sweep: `messageId` / `sessionId` /
    // `channel` flow in from the incoming OpenClaw message context.
    // `channel` in particular is attacker-controlled per Sprint 39
    // security audit. Sanitize at the meta boundary so downstream
    // SIEM ingestors cannot be tricked into column-splitting via TAB
    // or line-breaking via U+2028 / U+2029.
    //
    // Sprint 40 audit closure (code-reviewer HIGH): `OpenClawMessageContext`
    // types these three fields as non-nullable `string`, so the `?? ''`
    // chain was unreachable under TS strict mode. The `String(...)`
    // coercion stays as belt-and-braces against a JS caller bypassing
    // the type contract (passing a non-string symbol / number / object).
    this.logger.info('Validating OpenClaw message', {
      messageId: sanitizeMeta(context.messageId),
      sessionId: sanitizeMeta(context.sessionId),
      channel: sanitizeMeta(context.channel),
    });

    // Run validators
    const promptInjectionResult = this.promptInjectionValidator.validate(context.content);
    const secretResult = this.secretGuard.validate(context.content);

    // Merge results
    const combined = this.mergeResults([promptInjectionResult, secretResult]);

    const result: OpenClawGuardrailResult = {
      ...combined,
      allowed: combined.allowed,
      blockedBy: !combined.allowed ? this.getBlockingValidator([promptInjectionResult, secretResult]) : undefined,
      originalContent: context.content,
    };

    if (this.config.logResults) {
      if (result.allowed) {
        this.logger.info('Message validation passed', {
          // Sprint 40 connector CWE-117 sweep — same rationale as line 88.
          messageId: sanitizeMeta(context.messageId),
          findings_count: result.findings.length,
        });
      } else {
        this.logger.warn('Message validation blocked', {
          messageId: sanitizeMeta(context.messageId),
          // `blocked_by` is library-controlled (one of the validator
          // class names) but defensive sanitization is cheap and
          // future-proofs against custom validator naming.
          blocked_by: result.blockedBy ? sanitizeMeta(result.blockedBy) : undefined,
          severity: result.severity,
          findings_count: result.findings.length,
        });
      }
    }

    return result;
  }

  /**
   * Validate an OpenClaw tool execution
   */
  async validateTool(context: OpenClawToolContext): Promise<OpenClawGuardrailResult> {
    if (!this.config.validateTools) {
      return {
        ...createResult(true),
        allowed: true,
      };
    }

    // Sprint 40 connector CWE-117 sweep — `toolName` + `sessionId`
    // both flow in from caller context (MCP-style tool dispatch can
    // surface attacker-named tools).
    this.logger.info('Validating OpenClaw tool execution', {
      toolName: sanitizeMeta(context.toolName),
      sessionId: sanitizeMeta(context.sessionId),
    });

    // Get content from tool input
    const content = this.extractContentFromToolInput(context.toolInput);

    if (!content) {
      return {
        ...createResult(true),
        allowed: true,
      };
    }

    // Run validators
    const promptInjectionResult = this.promptInjectionValidator.validate(content);
    const secretResult = this.secretGuard.validate(content);

    // Merge results
    const combined = this.mergeResults([promptInjectionResult, secretResult]);

    const result: OpenClawGuardrailResult = {
      ...combined,
      allowed: combined.allowed,
      blockedBy: !combined.allowed ? this.getBlockingValidator([promptInjectionResult, secretResult]) : undefined,
    };

    if (this.config.logResults) {
      if (result.allowed) {
        this.logger.info('Tool validation passed', {
          // Sprint 40 connector CWE-117 sweep — same rationale as line 138.
          toolName: sanitizeMeta(context.toolName),
          findings_count: result.findings.length,
        });
      } else {
        this.logger.warn('Tool validation blocked', {
          toolName: sanitizeMeta(context.toolName),
          blocked_by: result.blockedBy ? sanitizeMeta(result.blockedBy) : undefined,
          severity: result.severity,
        });
      }
    }

    return result;
  }

  /**
   * Create an OpenClaw pre-action hook function
   * This can be registered with OpenClaw's hook system
   */
  createPreActionHook() {
    return async (context: OpenClawMessageContext | OpenClawToolContext): Promise<{
      allowed: boolean;
      blockedBy?: string;
      reason?: string;
    }> => {
      const result = await this.validate(
        'messageId' in context ? context : (context as unknown as OpenClawMessageContext)
      );

      return {
        allowed: result.allowed,
        blockedBy: result.blockedBy,
        reason: result.findings[0]?.description,
      };
    };
  }

  /**
   * Generic validate method that routes to the appropriate validator
   */
  private async validate(context: OpenClawMessageContext): Promise<OpenClawGuardrailResult>;
  private async validate(context: OpenClawToolContext): Promise<OpenClawGuardrailResult>;
  private async validate(
    context: OpenClawMessageContext | OpenClawToolContext
  ): Promise<OpenClawGuardrailResult> {
    if ('content' in context) {
      return this.validateMessage(context);
    } else {
      return this.validateTool(context);
    }
  }

  /**
   * Merge multiple validation results
   */
  private mergeResults(results: GuardrailResult[]): GuardrailResult {
    const allFindings = results.flatMap((r) => r.findings);
    results.reduce((sum, r) => sum + r.risk_score, 0);
    const anyBlocked = results.some((r) => r.blocked);

    const severityOrder: Record<Severity, number> = {
      [Severity.INFO]: 0,
      [Severity.WARNING]: 1,
      [Severity.BLOCKED]: 2,
      [Severity.CRITICAL]: 3,
    };

    const maxSeverity = results.reduce((max, r) => {
      return severityOrder[r.severity] > severityOrder[max] ? r.severity : max;
    }, Severity.INFO);

    return createResult(
      !anyBlocked,
      maxSeverity,
      allFindings
    );
  }

  /**
   * Get the name of the validator that blocked the request
   */
  private getBlockingValidator(results: GuardrailResult[]): string {
    for (const result of results) {
      if (result.blocked) {
        return 'validator';
      }
    }
    return 'unknown';
  }

  /**
   * Extract content from tool input
   */
  private extractContentFromToolInput(toolInput: Record<string, unknown>): string {
    const fields = ['content', 'prompt', 'text', 'query', 'message', 'input'];

    for (const field of fields) {
      const value = toolInput[field];
      if (typeof value === 'string') {
        return value;
      }
    }

    return JSON.stringify(toolInput);
  }
}

/**
 * Create a configured middleware instance
 */
export function createOpenClawGuardrails(
  config?: OpenClawAdapterConfig,
  validators?: {
    promptInjection?: PromptInjectionConfig;
    secret?: SecretGuardConfig;
  }
): OpenClawGuardrailsMiddleware {
  return new OpenClawGuardrailsMiddleware(config, validators);
}

/**
 * Default export for convenience
 */
export default OpenClawGuardrailsMiddleware;
