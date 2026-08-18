/**
 * BonkLM — EdgeHookManager
 * =========================
 * Function-handler-only variant of `HookSandbox` shipping via
 * `@blackunicorn/bonklm/edge` (edge-core).
 *
 * Workerd / edge-light / Deno / Bun do NOT all ship `node:vm`. The
 * Node-only `HookSandbox` accepts both function and string handlers; on
 * the edge subpath we expose a sibling class that refuses string handlers
 * at the execute boundary with a clear `ConnectorValidationError` so
 * misconfigured deployments fail loud, NOT silently.
 *
 * The public API surface mirrors `HookSandbox.executeHook` /
 * `initialize` / `getStatistics` so consumers can swap between the two
 * by import path. Function handlers execute directly (no VM sandbox);
 * string handlers throw.
 *
 * Story 2.1b deferred: HMAC unified async migration ships from
 * `security/override-token.ts` in a follow-on commit (coordinated
 * v0.5 release breaking change). The `executeWithTimeout` semantics
 * of `HookSandbox` are NOT preserved here — edge handlers run to
 * completion under the natural microtask scheduler.
 *
 * @package @blackunicorn/bonklm
 */

import { ConnectorValidationError } from '../connector-utils/errors.js';
import { portableRandomUUID } from '../common/edge-codec.js';
import { serializeError } from '../common/index.js';

/**
 * Edge-compatible execution context (mirrors HookSandbox.ExecutionContext).
 */
export interface EdgeExecutionContext {
  [key: string]: unknown;
}

/**
 * Edge-compatible execution result.
 *
 * `sandboxed: false` distinguishes edge execution from VM-sandboxed
 * Node execution. Consumers reading the result CAN tell whether the
 * handler ran inside a VM (Node) or directly (edge).
 */
export interface EdgeExecutionResult {
  success: boolean;
  executionId: string;
  result?: unknown;
  error?: string;
  message?: string;
  duration?: number;
  /** Always false on edge — no VM isolation available. */
  sandboxed: false;
  /** True when the handler was rejected before execution (string handler). */
  blocked?: boolean;
}

/**
 * Statistics for edge hook execution.
 */
export interface EdgeHookStatistics {
  totalExecutions: number;
  blockedAttempts: number;
  averageExecutionTime: number;
}

interface EdgeExecutionLogEntry {
  executionId: string;
  timestamp: number;
  duration?: number;
  success?: boolean;
  error?: string;
}

interface EdgeBlockedAttempt {
  executionId: string;
  timestamp: number;
  reason: string;
}

/**
 * EdgeHookManager — function-handler-only sandbox replacement for edge.
 *
 * Construction is cheap; call `initialize()` once before invoking
 * `executeHook` to mirror `HookSandbox`'s lifecycle.
 */
/**
 * Iter-1 security + code-reviewer BLOCK: unbounded log arrays were a
 * memory-exhaustion DoS on long-running Workers / Deno isolates that
 * reuse a single EdgeHookManager across many requests. Mirrors the
 * caps applied by HookSandbox (`logExecution` 1000, `logBlockedAttempt` 100).
 */
const MAX_EXECUTION_LOG = 1000;
const MAX_BLOCKED_ATTEMPTS = 100;

export class EdgeHookManager {
  private executionLog: EdgeExecutionLogEntry[] = [];
  private blockedAttempts: EdgeBlockedAttempt[] = [];
  private isInitialized = false;

  /**
   * Initialize the edge hook manager. Mirrors `HookSandbox.initialize`
   * for API parity; edge has no environment validation step so this
   * is a no-op aside from setting the readiness flag.
   */
  async initialize(): Promise<boolean> {
    this.isInitialized = true;
    return true;
  }

  /**
   * Execute a function hook handler. String handlers are REJECTED with
   * `ConnectorValidationError('configuration_error')` — `node:vm` is
   * not available on Workerd / edge-light / Deno / Bun, and even where
   * it IS available, edge consumers SHOULD NOT depend on it.
   *
   * @throws {ConnectorValidationError} when `handler` is a string.
   * @throws {Error} when called before `initialize()`.
   */
  async executeHook(
    handler: ((context: EdgeExecutionContext) => unknown) | string,
    context: EdgeExecutionContext = {}
  ): Promise<EdgeExecutionResult> {
    if (!this.isInitialized) {
      throw new Error('EdgeHookManager not initialized; call initialize() first');
    }

    const executionId = portableRandomUUID();
    const startTime = Date.now();

    // String handler rejection — the headline edge constraint.
    if (typeof handler === 'string') {
      const reason =
        'EdgeHookManager refuses string-handler hooks: node:vm is not ' +
        'available in edge runtimes (Workerd / edge-light / Deno / Bun). ' +
        'Register a function handler instead, or import HookSandbox from ' +
        'the Node-only root package `@blackunicorn/bonklm` if your ' +
        'deployment is Node-only.';
      this.blockedAttempts.push({
        executionId,
        timestamp: startTime,
        reason
      });
      // Cap blockedAttempts to defeat memory-exhaustion DoS in long-lived
      // edge isolates that reuse a single EdgeHookManager across requests.
      if (this.blockedAttempts.length > MAX_BLOCKED_ATTEMPTS) {
        this.blockedAttempts = this.blockedAttempts.slice(-MAX_BLOCKED_ATTEMPTS);
      }
      throw new ConnectorValidationError(reason, 'configuration_error');
    }

    try {
      const result = await handler(context);
      const duration = Date.now() - startTime;

      this.executionLog.push({
        executionId,
        timestamp: startTime,
        duration,
        success: true
      });
      if (this.executionLog.length > MAX_EXECUTION_LOG) {
        this.executionLog = this.executionLog.slice(-MAX_EXECUTION_LOG);
      }

      return {
        success: true,
        executionId,
        result,
        duration,
        sandboxed: false
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error as Error;

      // Sprint 46 cross-subsystem CWE-117 sweep (architect HIGH + security
      // HIGH closure): edge-runtime sister of HookSandbox.ts:282. Function-
      // only handlers can throw crafted errors; `err.message` flowed raw
      // into the executionLog AND the EdgeExecutionResult.message returned
      // to caller. `serializeError` sanitizes via sanitizeLogString.
      const safeMessage = serializeError(err).message;

      this.executionLog.push({
        executionId,
        timestamp: startTime,
        duration,
        success: false,
        error: safeMessage
      });
      if (this.executionLog.length > MAX_EXECUTION_LOG) {
        this.executionLog = this.executionLog.slice(-MAX_EXECUTION_LOG);
      }

      return {
        success: false,
        executionId,
        error: 'EXECUTION_ERROR',
        message: safeMessage,
        duration,
        sandboxed: false
      };
    }
  }

  /**
   * Get execution statistics. Mirrors `HookSandbox.getStatistics` shape
   * (minus `securityLevel`, which is N/A on edge).
   */
  getStatistics(): EdgeHookStatistics {
    const total = this.executionLog.length;
    const sumDuration = this.executionLog.reduce((sum, e) => sum + (e.duration ?? 0), 0);
    return {
      totalExecutions: total,
      blockedAttempts: this.blockedAttempts.length,
      averageExecutionTime: total === 0 ? 0 : sumDuration / total
    };
  }

  /**
   * Get the list of blocked attempts for audit / telemetry forwarding.
   */
  getBlockedAttempts(): readonly EdgeBlockedAttempt[] {
    return [...this.blockedAttempts];
  }
}
