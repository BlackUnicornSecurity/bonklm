/**
 * BonkLM - Hooks System
 * ==============================
 * Generic hook system for extending validation behavior.
 */

import { createLogger, type Logger } from '../base/GenericLogger.js';
import type { HookSurface } from '../engine/GuardrailEngine.types.js';

// Export HookSandbox
export * from './HookSandbox.js';

// Re-export the canonical surface vocabulary so consumers can import it
// from `@blackunicorn/bonklm/hooks` without reaching into engine internals.
export type { HookSurface } from '../engine/GuardrailEngine.types.js';

/**
 * Hook execution phases
 */
export enum HookPhase {
  BEFORE_VALIDATION = 'before_validation',
  AFTER_VALIDATION = 'after_validation',
  BEFORE_BLOCK = 'before_block',
  AFTER_ALLOW = 'after_allow',
}

/**
 * Story 1.1 (R2-D3 + R2-9 + R2-10): default surface when callers omit
 * `surface` from `registerHook`. Will THROW in 0.5; CHANGELOG marks
 * BREAKING for v0.4 and BREAKING-HARD for v0.5.
 */
export const DEFAULT_HOOK_SURFACE: HookSurface = 'text_input';

/**
 * Hook handler context
 */
export interface HookContext {
  phase: HookPhase;
  /**
   * Story 1.1 (R2-9/R2-10): the surface this hook is firing for.
   *
   * Optional in 0.4 so legacy callers of `executeHooks(...)` still
   * type-check; the surface is also available on the `HookDefinition`
   * (set by `registerHook`) and is the authoritative source. Required
   * in 0.5 once the registerHook default is removed.
   */
  surface?: HookSurface;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Hook handler function
 */
export type HookHandler<TContext = HookContext> = (
  context: TContext,
  execution: HookExecution
) => Promise<HookResult> | HookResult;

/**
 * Hook execution metadata
 */
export interface HookExecution {
  hookId: string;
  timestamp: number;
  attemptNumber: number;
}

/**
 * Hook result
 */
export interface HookResult {
  success: boolean;
  data?: unknown;
  shouldBlock?: boolean;
  message?: string;
}

/**
 * Hook definition
 */
export interface HookDefinition<TContext = HookContext> {
  id: string;
  name: string;
  phase: HookPhase;
  /**
   * Story 1.1 (R2-9/R2-10): the surface this hook applies to.
   * Optional in 0.4 (defaults to `'text_input'` with a deprecation
   * warning); required in 0.5 (the default will be removed).
   */
  surface?: HookSurface;
  handler: HookHandler<TContext>;
  priority: number;
  enabled: boolean;
  timeout?: number;
}

/**
 * Hook manager configuration
 */
export interface HookManagerConfig {
  logger?: Logger;
  defaultTimeout?: number;
  // S011-007: Rate limiting configuration
  rateLimit?: {
    maxCalls: number; // Maximum calls per window
    windowMs: number; // Time window in milliseconds
    perPhase?: boolean; // Separate limits per phase
  };
}

/**
 * Generic Hook Manager
 */
export class HookManager<TContext extends HookContext = HookContext> {
  private readonly hooks: Map<HookPhase, HookDefinition<TContext>[]> = new Map();
  private readonly logger: Logger;
  private readonly defaultTimeout: number;
  // S011-007: Rate limiting state
  private readonly rateLimitConfig?: { maxCalls: number; windowMs: number; perPhase?: boolean };
  private readonly rateLimitTracking: Map<string, number[]> = new Map();
  // Story 1.1 (R2-D3): one-shot deprecation warning when `surface` omitted.
  private surfaceDefaultWarned = false;

  constructor(config: HookManagerConfig = {}) {
    this.logger = config.logger ?? createLogger('console');
    this.defaultTimeout = config.defaultTimeout ?? 30000;
    this.rateLimitConfig = config.rateLimit;
  }

  /**
   * Register a hook
   */
  registerHook(definition: Omit<HookDefinition<TContext>, 'id'>): string {
    const id = `hook_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const surface: HookSurface = definition.surface ?? DEFAULT_HOOK_SURFACE;

    if (definition.surface === undefined && !this.surfaceDefaultWarned) {
      this.surfaceDefaultWarned = true;
      this.logger.warn(
        `[deprecated] registerHook() called without an explicit \`surface\` — ` +
        `defaulting to '${DEFAULT_HOOK_SURFACE}'. This default is REMOVED ` +
        `in BonkLM 0.5 and \`surface\` becomes required. Update your ` +
        `registerHook({phase, surface, handler}) callsites now.`
      );
    }

    const hook: HookDefinition<TContext> = {
      ...definition,
      id,
      surface,
      priority: definition.priority ?? 0,
      enabled: definition.enabled !== false,
    };

    if (!this.hooks.has(hook.phase)) {
      this.hooks.set(hook.phase, []);
    }

    this.hooks.get(hook.phase)!.push(hook);
    this.hooks.get(hook.phase)!.sort((a, b) => a.priority - b.priority);

    this.logger.info('Hook registered', { id, name: hook.name, phase: hook.phase, surface });
    return id;
  }

  /**
   * Unregister a hook
   */
  unregisterHook(hookId: string): boolean {
    for (const hooks of this.hooks.values()) {
      const index = hooks.findIndex((h) => h.id === hookId);
      if (index !== -1) {
        hooks.splice(index, 1);
        this.logger.info('Hook unregistered', { hookId });
        return true;
      }
    }
    return false;
  }

  /**
   * Execute hooks for a specific phase
   */
  async executeHooks(
    phase: HookPhase,
    context: TContext
  ): Promise<HookResult[]> {
    // S011-007: Check rate limit before executing hooks
    if (this.rateLimitConfig && !this.checkRateLimit(phase)) {
      this.logger.warn('Hook execution rate limit exceeded', { phase });
      return [{
        success: false,
        shouldBlock: false,
        message: `Rate limit exceeded for phase: ${phase}`,
      }];
    }

    const hooks = this.hooks.get(phase) || [];
    const results: HookResult[] = [];

    for (const hook of hooks) {
      if (!hook.enabled) {
        continue;
      }

      const execution: HookExecution = {
        hookId: hook.id,
        timestamp: Date.now(),
        attemptNumber: 1,
      };

      try {
        const timeout = hook.timeout ?? this.defaultTimeout;
        const result = await this.executeWithTimeout(hook, context, execution, timeout);
        results.push(result);

        if (result.shouldBlock) {
          this.logger.warn('Hook blocked execution', { hookId: hook.id, name: hook.name });
          // Continue executing other hooks for logging purposes
        }
      } catch (error) {
        this.logger.error('Hook execution failed', {
          hookId: hook.id,
          name: hook.name,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          success: false,
          shouldBlock: false,
          message: `Hook ${hook.name} failed: ${error}`,
        });
      }
    }

    return results;
  }

  /**
   * S011-007: Check if rate limit allows execution
   * @returns true if within rate limit, false if exceeded
   */
  private checkRateLimit(phase: HookPhase): boolean {
    if (!this.rateLimitConfig) return true;

    const now = Date.now();
    const { maxCalls, windowMs, perPhase } = this.rateLimitConfig;
    const key = perPhase ? `rate:${phase}` : 'rate:global';

    // Get existing timestamps or initialize
    let timestamps = this.rateLimitTracking.get(key) || [];

    // Remove timestamps outside the current window
    timestamps = timestamps.filter(ts => now - ts < windowMs);

    // Check if limit exceeded
    if (timestamps.length >= maxCalls) {
      return false;
    }

    // Add current timestamp
    timestamps.push(now);
    this.rateLimitTracking.set(key, timestamps);

    // Cleanup old entries periodically
    if (Math.random() < 0.01) { // 1% chance to cleanup
      this.cleanupRateLimitTracking(now, windowMs);
    }

    return true;
  }

  /**
   * S011-007: Clean up old rate limit tracking entries
   */
  private cleanupRateLimitTracking(now: number, windowMs: number): void {
    for (const [key, timestamps] of this.rateLimitTracking.entries()) {
      const filtered = timestamps.filter(ts => now - ts < windowMs * 2);
      if (filtered.length === 0) {
        this.rateLimitTracking.delete(key);
      } else {
        this.rateLimitTracking.set(key, filtered);
      }
    }
  }

  /**
   * Execute a single hook with timeout
   */
  private async executeWithTimeout(
    hook: HookDefinition<TContext>,
    context: TContext,
    execution: HookExecution,
    timeout: number
  ): Promise<HookResult> {
    return Promise.race([
      hook.handler(context, execution),
      new Promise<HookResult>((resolve) =>
        setTimeout(
          () =>
            resolve({
              success: false,
              shouldBlock: false,
              message: `Hook ${hook.name} timed out after ${timeout}ms`,
            }),
          timeout
        )
      ),
    ]);
  }

  /**
   * Get all registered hooks
   */
  getHooks(): Map<HookPhase, HookDefinition<TContext>[]> {
    return new Map(this.hooks);
  }

  /**
   * Clear all hooks
   */
  clearHooks(): void {
    this.hooks.clear();
    this.logger.info('All hooks cleared');
  }
}

/**
 * Create a simple hook that blocks based on a condition
 */
export function createBlockingHook(
  name: string,
  phase: HookPhase,
  shouldBlockFn: (context: HookContext) => boolean | Promise<boolean>,
  priority: number = 0
): HookDefinition {
  return {
    id: '',
    name,
    phase,
    priority,
    enabled: true,
    handler: async (context) => {
      const shouldBlock = await shouldBlockFn(context);
      return {
        success: true,
        shouldBlock,
        message: shouldBlock ? `Blocked by hook: ${name}` : undefined,
      };
    },
  };
}

/**
 * Create a hook that transforms content before validation
 */
export function createTransformHook(
  name: string,
  phase: HookPhase,
  transformFn: (content: string) => string | Promise<string>,
  priority: number = 0
): HookDefinition {
  return {
    id: '',
    name,
    phase,
    priority,
    enabled: true,
    handler: async (context) => {
      const transformed = await transformFn(context.content);
      return {
        success: true,
        data: { transformed },
      };
    },
  };
}
