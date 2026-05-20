/**
 * OpenClaw Adapter - Type Definitions
 * =====================================
 */

import type { GuardrailResult } from '@blackunicorn/bonklm';

/**
 * OpenClaw message context
 */
export interface OpenClawMessageContext {
  messageId: string;
  sessionId: string;
  userId?: string;
  channel: string;
  timestamp: number;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * OpenClaw tool execution context
 */
export interface OpenClawToolContext {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
}

/**
 * Guardrail validation result for OpenClaw
 */
export interface OpenClawGuardrailResult extends GuardrailResult {
  allowed: boolean;
  blockedBy?: string;
  originalContent?: string;
}

/**
 * OpenClaw adapter configuration
 */
export interface OpenClawAdapterConfig {
  /**
   * Enable/disable message validation
   */
  validateMessages?: boolean;

  /**
   * Enable/disable tool validation
   */
  validateTools?: boolean;

  /**
   * Block on severity threshold
   */
  blockThreshold?: 'info' | 'warning' | 'critical';

  /**
   * Log validation results
   */
  logResults?: boolean;

  /**
   * Custom logger
   */
  logger?: {
    info?: (message: string, context?: Record<string, unknown>) => void;
    warn?: (message: string, context?: Record<string, unknown>) => void;
    error?: (message: string, context?: Record<string, unknown>) => void;
  };
}
