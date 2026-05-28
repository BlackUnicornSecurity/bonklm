/**
 * BonkLM - Adapter Types
 * ===============================
 * Generic adapter interface for framework integrations.
 *
 * This provides a common interface that all adapters should implement,
 * allowing the core guardrails to work with any framework.
 */

import type { GuardrailResult } from '../base/GuardrailResult.js';
import type { GuardrailEngine } from '../engine/GuardrailEngine.js';

// ============================================================================
// TYPES
// =============================================================================

/**
 * Generic input type for adapters
 */
export type AdapterInput<T = unknown> = {
  content: string;
  metadata?: T;
};

/**
 * Generic output type for adapters
 */
export type AdapterOutput<T = unknown> = {
  content?: string;
  allowed: boolean;
  result?: GuardrailResult;
  metadata?: T;
};

/**
 * Adapter configuration
 */
export interface AdapterConfig {
  /**
   * Adapter name (e.g., 'openclaw', 'express', 'vercel-ai')
   */
  name: string;

  /**
   * Adapter version
   */
  version: string;

  /**
   * Enable/disable the adapter
   */
  enabled?: boolean;

  /**
   * Custom logger
   */
  logger?: unknown;
}

/**
 * Framework context passed to adapters
 */
export interface FrameworkContext<T = unknown> {
  /**
   * Framework name (e.g., 'openclaw', 'express', 'nextjs')
   */
  framework: string;

  /**
   * Framework version
   */
  version?: string;

  /**
   * Request/operation metadata
   */
  metadata?: T;

  /**
   * Additional context
   */
  [key: string]: unknown;
}

// ============================================================================
// ADAPTER INTERFACE
// =============================================================================

/**
 * Generic GuardrailAdapter interface
 * All framework adapters should implement this interface
 */
export interface GuardrailAdapter<TInput = unknown, TOutput = unknown, TContext = unknown> {
  /**
   * Adapter name
   */
  readonly name: string;

  /**
   * Adapter version
   */
  readonly version: string;

  /**
   * Initialize the adapter with framework-specific context
   * Can optionally include engine in the context
   */
  initialize?(context: FrameworkContext<TContext> & { engine?: GuardrailEngine }): Promise<void> | void;

  /**
   * Validate input using the guardrail engine
   * @param input - Input to validate
   * @returns Validation result
   */
  validate(input: AdapterInput<TInput>): Promise<GuardrailResult> | GuardrailResult;

  /**
   * Transform the result after validation
   * @param result - Guardrail validation result
   * @param input - Original input
   * @returns Transformed output
   */
  transform?(
    result: GuardrailResult,
    input: AdapterInput<TInput>
  ): Promise<AdapterOutput<TOutput>> | AdapterOutput<TOutput>;

  /**
   * Cleanup and destroy the adapter
   */
  destroy?(): Promise<void> | void;
}

// ============================================================================
// BASE ADAPTER CLASS
// =============================================================================

/**
 * Base adapter class that provides common functionality
 * Extend this class to create custom adapters
 */
export abstract class BaseAdapter<TInput = unknown, TOutput = unknown, TContext = unknown> implements GuardrailAdapter<
  TInput,
  TOutput,
  TContext
> {
  protected readonly config: AdapterConfig;
  protected engine?: GuardrailEngine;
  protected context?: FrameworkContext<TContext>;

  constructor(config: AdapterConfig) {
    this.config = {
      enabled: true,
      ...config
    };
  }

  /**
   * Get the adapter name
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Get the adapter version
   */
  get version(): string {
    return this.config.version;
  }

  /**
   * Initialize the adapter with the guardrail engine and context
   */
  async initialize(context?: FrameworkContext<TContext> & { engine?: GuardrailEngine }): Promise<void> {
    if (context?.engine) {
      this.engine = context.engine;
    }
    this.context = context;
  }

  /**
   * Validate input using the guardrail engine
   */
  async validate(input: AdapterInput<TInput>): Promise<GuardrailResult> {
    if (!this.engine) {
      throw new Error(`Adapter ${this.name} not initialized. Call initialize() first.`);
    }

    const result = await this.engine.validate(input.content);
    // Return the core result properties
    return {
      allowed: result.allowed,
      blocked: result.blocked,
      severity: result.severity,
      risk_level: result.risk_level,
      risk_score: result.risk_score,
      findings: result.findings,
      timestamp: result.timestamp
    };
  }

  /**
   * Transform the result after validation
   * Override this method to provide custom transformation logic
   */
  transform?(result: GuardrailResult, _input: AdapterInput<TInput>): AdapterOutput<TOutput> {
    return {
      allowed: result.allowed,
      result
    } as AdapterOutput<TOutput>;
  }

  /**
   * Cleanup and destroy the adapter
   */
  destroy?(): Promise<void> | void {
    this.engine = undefined;
    this.context = undefined;
  }

  /**
   * Check if the adapter is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled ?? true;
  }

  /**
   * Get the adapter configuration
   */
  getConfig(): AdapterConfig {
    return { ...this.config };
  }
}

// ============================================================================
// ADAPTER BUILDER
// =============================================================================

/**
 * Builder class for creating adapters with a fluent API
 */
export class AdapterBuilder<
  TInput = unknown,
  TOutput = unknown,
  TContext = unknown,
  TAdapter extends BaseAdapter<TInput, TOutput, TContext> = BaseAdapter<TInput, TOutput, TContext>
> {
  private adapterClass: new (config: AdapterConfig) => TAdapter;
  private config: AdapterConfig;
  private engine?: GuardrailEngine;
  private context?: FrameworkContext<TContext>;

  constructor(adapterClass: new (config: AdapterConfig) => TAdapter, name: string, version: string) {
    this.adapterClass = adapterClass;
    this.config = { name, version };
  }

  /**
   * Set the adapter as enabled or disabled
   */
  withEnabled(enabled: boolean): this {
    this.config.enabled = enabled;
    return this;
  }

  /**
   * Set a custom logger
   */
  withLogger(logger: unknown): this {
    this.config.logger = logger;
    return this;
  }

  /**
   * Set the guardrail engine
   */
  withEngine(engine: GuardrailEngine): this {
    this.engine = engine;
    return this;
  }

  /**
   * Set the framework context
   */
  withContext(context: FrameworkContext<TContext>): this {
    this.context = context;
    return this;
  }

  /**
   * Build the adapter instance
   */
  async build(): Promise<TAdapter> {
    const adapter = new this.adapterClass(this.config);

    if (this.engine || this.context) {
      const contextWithEngine: FrameworkContext<TContext> & { engine?: GuardrailEngine } = {
        ...(this.context ?? {}),
        framework: this.context?.framework ?? 'generic',
        engine: this.engine
      };
      await adapter.initialize(contextWithEngine);
    }

    return adapter;
  }
}

/**
 * Create a new adapter builder
 */
export function createAdapterBuilder<
  TInput = unknown,
  TOutput = unknown,
  TContext = unknown,
  TAdapter extends BaseAdapter<TInput, TOutput, TContext> = BaseAdapter<TInput, TOutput, TContext>
>(
  adapterClass: new (config: AdapterConfig) => TAdapter,
  name: string,
  version: string
): AdapterBuilder<TInput, TOutput, TContext, TAdapter> {
  return new AdapterBuilder(adapterClass, name, version);
}

// ============================================================================
// ADAPTER REGISTRY
// =============================================================================

/**
 * Registry for managing multiple adapters
 */
export class AdapterRegistry<TInput = unknown, TOutput = unknown, TContext = unknown> {
  private adapters = new Map<string, GuardrailAdapter<TInput, TOutput, TContext>>();

  /**
   * Register an adapter
   */
  register(adapter: GuardrailAdapter<TInput, TOutput, TContext>): void {
    this.adapters.set(adapter.name, adapter);
  }

  /**
   * Unregister an adapter by name
   */
  unregister(name: string): boolean {
    return this.adapters.delete(name);
  }

  /**
   * Get an adapter by name
   */
  get(name: string): GuardrailAdapter<TInput, TOutput, TContext> | undefined {
    return this.adapters.get(name);
  }

  /**
   * Check if an adapter is registered
   */
  has(name: string): boolean {
    return this.adapters.has(name);
  }

  /**
   * Get all registered adapter names
   */
  getAdapterNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Clear all adapters
   */
  clear(): void {
    this.adapters.clear();
  }

  /**
   * Get the number of registered adapters
   */
  get size(): number {
    return this.adapters.size;
  }
}
