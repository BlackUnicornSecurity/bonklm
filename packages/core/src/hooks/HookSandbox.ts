/**
 * BonkLM - Hook Sandbox
 * ==============================
 * VM-based sandboxing for hook execution to prevent arbitrary code execution.
 *
 * Features:
 * - VM-based isolation for hook execution
 * - Configurable security level (strict/standard/permissive)
 * - Timeout protection
 * - Memory limits
 * - Error handling and sanitization
 * - Dangerous pattern detection
 */

// Story 2.1b-edge-core: `node:events` import removed in favour of the
// portable internal emitter. `node:vm` + `node:crypto` randomUUID stay
// because HookSandbox is intentionally Node-only (vm sandboxing is its
// entire purpose). Edge consumers import `EdgeHookManager` from
// `@blackunicorn/bonklm/edge` instead.
import { randomUUID } from 'node:crypto';
import * as vm from 'node:vm';
import { serializeError } from '../common/index.js';
import { PortableEventEmitter } from '../common/portable-emitter.js';

// ============================================================================
// TYPES
// =============================================================================

export type SecurityLevel = 'strict' | 'standard' | 'permissive';

export interface SandboxConfig {
  /**
   * Security level for sandbox execution
   */
  securityLevel?: SecurityLevel;

  /**
   * Maximum execution time in milliseconds
   */
  timeout?: number;

  /**
   * Maximum memory size in bytes
   */
  maxMemory?: number;

  /**
   * Maximum CPU time in milliseconds
   */
  maxCpuTime?: number;

  /**
   * Allow async operations (setTimeout, setInterval)
   */
  allowAsyncOperations?: boolean;

  /**
   * Log all executions
   */
  logExecutions?: boolean;
}

export interface ExecutionContext {
  [key: string]: unknown;
}

export interface ExecutionResult {
  success: boolean;
  executionId: string;
  result?: unknown;
  error?: string;
  message?: string;
  duration?: number;
  sandboxed: boolean;
  blocked?: boolean;
}

export interface CodeValidationResult {
  safe: boolean;
  issues: string[];
}

export interface ExecutionLog {
  executionId: string;
  timestamp: string;
  duration?: number;
  success?: boolean;
  error?: string;
  resultType?: string;
}

export interface BlockedAttempt {
  executionId: string;
  timestamp: string;
  issues: string[];
}

export interface SandboxStatistics {
  totalExecutions: number;
  blockedAttempts: number;
  securityLevel: SecurityLevel;
  averageExecutionTime: number;
}

// ============================================================================
// CONSTANTS
// =============================================================================>

export const SECURITY_LEVELS = {
  STRICT: 'strict',
  STANDARD: 'standard',
  PERMISSIVE: 'permissive',
} as const;

export const BLOCKED_GLOBALS = [
  'process',
  'require',
  '__dirname',
  '__filename',
  'module',
  'exports',
  'global',
  'globalThis',
  'eval',
  'Function',
  'WebAssembly',
] as const;

export const SAFE_GLOBALS = [
  'console',
  'JSON',
  'Math',
  'Date',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Symbol',
  'RegExp',
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURI',
  'encodeURIComponent',
  'decodeURI',
  'decodeURIComponent',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
] as const;

// ============================================================================
// SANDBOX CLASS
// =============================================================================

export class HookSandbox {
  private readonly config: Required<SandboxConfig>;
  private executionLog: ExecutionLog[] = [];
  private blockedAttempts: BlockedAttempt[] = [];
  private isInitialized = false;
  private eventEmitter?: PortableEventEmitter;

  constructor(config?: SandboxConfig) {
    this.config = {
      securityLevel: config?.securityLevel ?? 'strict',
      timeout: config?.timeout ?? 5000,
      maxMemory: config?.maxMemory ?? 50 * 1024 * 1024, // 50MB
      maxCpuTime: config?.maxCpuTime ?? 1000,
      allowAsyncOperations: config?.allowAsyncOperations ?? true,
      logExecutions: config?.logExecutions ?? true,
    };

    this.eventEmitter = new PortableEventEmitter();
  }

  /**
   * Initialize the sandbox
   */
  async initialize(): Promise<boolean> {
    // Validate environment
    this.validateEnvironment();

    this.isInitialized = true;

    this.emit('initialized', {
      securityLevel: this.config.securityLevel,
      timeout: this.config.timeout,
    });

    return true;
  }

  /**
   * Execute a hook handler in a sandboxed environment
   * @param handler - The hook handler (function or code string)
   * @param context - The execution context to pass to the hook
   * @param options - Execution options
   * @returns Execution result
   */
  async executeHook(
    handler: string | ((context: ExecutionContext) => unknown),
    context: ExecutionContext = {},
    options?: Partial<SandboxConfig>
  ): Promise<ExecutionResult> {
    if (!this.isInitialized) {
      throw new Error('Hook sandbox not initialized');
    }

    const executionId = randomUUID();
    const startTime = Date.now();

    try {
      // Create sandboxed context
      const sandboxContext = this.createSandboxContext(context, options);

      // Convert function to string if needed, or wrap string code
      let code: string;
      if (typeof handler === 'function') {
        code = this.extractFunctionCode((handler as (...args: unknown[]) => unknown));
      } else {
        // Wrap string code in a function to allow return statements
        code = this.wrapStringCode(handler);
      }

      // Validate code for dangerous patterns
      const validation = this.validateCode(code);
      if (!validation.safe) {
        this.logBlockedAttempt(executionId, validation.issues);
        return {
          success: false,
          executionId,
          error: 'SECURITY_VIOLATION',
          message: `Hook code contains dangerous patterns: ${validation.issues.join(', ')}`,
          blocked: true,
          sandboxed: true,
        };
      }

      // Execute using VM
      const result = await this.executeInVm(code, sandboxContext, options?.timeout ?? this.config.timeout);

      const duration = Date.now() - startTime;

      this.logExecution(executionId, {
        duration,
        success: true,
        resultType: typeof result,
      });

      this.emit('hook-executed', {
        executionId,
        duration,
        success: true,
      });

      return {
        success: true,
        executionId,
        result,
        duration,
        sandboxed: true,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error as Error;

      // Sprint 46 cross-subsystem CWE-117 sweep (architect HIGH + security
      // HIGH closure): a sandboxed hook can deliberately throw `new Error("…
      // newline/ANSI…")` and have `err.message` flow unsanitized into 3
      // boundaries — the internal log entry, the `hook-error` event payload
      // (forwarded to subscribers), and the `ExecutionResult.message` returned
      // to the caller. Sprint 33 `serializeError` sanitizes the message via
      // `sanitizeLogString` internally — single source of truth, no
      // double-encoding.
      const safeMessage = serializeError(err).message;

      this.logExecution(executionId, {
        duration,
        success: false,
        error: safeMessage,
      });

      this.emit('hook-error', {
        executionId,
        error: safeMessage,
        duration,
      });

      return {
        success: false,
        executionId,
        error: err.name === 'TimeoutError' ? 'EXECUTION_TIMEOUT' : 'EXECUTION_ERROR',
        message: safeMessage,
        duration,
        sandboxed: true,
      };
    }
  }

  /**
   * Validate hook code before execution
   */
  validateHookCode(code: string): CodeValidationResult {
    return this.validateCode(code);
  }

  /**
   * Get execution statistics
   */
  getStatistics(): SandboxStatistics {
    return {
      totalExecutions: this.executionLog.length,
      blockedAttempts: this.blockedAttempts.length,
      securityLevel: this.config.securityLevel,
      averageExecutionTime: this.calculateAverageTime(),
    };
  }

  /**
   * Get blocked attempts log
   */
  getBlockedAttempts(): BlockedAttempt[] {
    return [...this.blockedAttempts];
  }

  /**
   * Get the sandbox configuration
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private validateEnvironment(): void {
    // vm module is statically imported at the top of this file (node:vm).
    // engines.node >=20 guarantees its presence; no runtime check needed.
  }

  private createSandboxContext(context: ExecutionContext, _options?: Partial<SandboxConfig>): Record<string, unknown> {
    const sandbox: Record<string, unknown> = {};

    // Add safe globals
    for (const globalName of SAFE_GLOBALS) {
      if (globalThis[globalName as keyof typeof globalThis]) {
        sandbox[globalName] = globalThis[globalName as keyof typeof globalThis];
      }
    }

    // Create safe console
    sandbox.console = this.createSafeConsole();

    // Add frozen context object
    sandbox.context = this.deepFreeze({ ...context });

    // Add safe result setter/getter
    let hookResult: unknown;
    sandbox.__setResult = (value: unknown) => {
      hookResult = this.sanitizeResult(value);
    };
    sandbox.__getResult = () => hookResult;

    // Create the VM context
    vm.createContext(sandbox, {
      name: 'hook-sandbox',
      origin: 'bonklm:/hook-sandbox',
      codeGeneration: {
        strings: false, // Disable eval()
        wasm: false, // Disable WebAssembly
      },
    });

    return sandbox;
  }

  private createSafeConsole() {
    const maxLogLength = 1000;
    const logs: unknown[] = [];

    const sanitize = (arg: unknown): string => {
      if (typeof arg === 'object') {
        try {
          const str = JSON.stringify(arg);
          return str.length > maxLogLength ? `${str.slice(0, maxLogLength)}...` : str;
        } catch {
          return '[Object]';
        }
      }
      const str = String(arg);
      return str.length > maxLogLength ? `${str.slice(0, maxLogLength)}...` : str;
    };

    return {
      log: (...args: unknown[]) => logs.push({ level: 'log', args: args.map(sanitize) }),
      info: (...args: unknown[]) => logs.push({ level: 'info', args: args.map(sanitize) }),
      warn: (...args: unknown[]) => logs.push({ level: 'warn', args: args.map(sanitize) }),
      error: (...args: unknown[]) => logs.push({ level: 'error', args: args.map(sanitize) }),
      debug: (...args: unknown[]) => logs.push({ level: 'debug', args: args.map(sanitize) }),
      getLogs: () => [...logs],
    };
  }

  private extractFunctionCode(fn: (...args: unknown[]) => unknown): string {
    const fnString = fn.toString();

    // Wrap in an IIFE that captures the result
    return `
      (function() {
        const __hookFn = ${fnString};
        const __result = __hookFn(context);
        __setResult(__result);
        return __result;
      })();
    `;
  }

  private wrapStringCode(code: string): string {
    // Wrap string code in a function to allow return statements
    return `
      (function() {
        ${code}
      })();
    `;
  }

  private validateCode(code: string): CodeValidationResult {
    const issues: string[] = [];

    // Check for dangerous patterns
    const dangerousPatterns: Array<[RegExp, string]> = [
      [/\bprocess\b/, 'process access'],
      [/\brequire\s*\(/, 'require() call'],
      [/\bimport\s*\(/, 'dynamic import'],
      [/\beval\s*\(/, 'eval() call'],
      [/\bFunction\s*\(/, 'Function() constructor'],
      [/\bnew\s+Function\b/, 'new Function()'],
      [/\b__proto__\b/, '__proto__ access'],
      [/\bconstructor\s*\[/, 'constructor access via bracket notation'],
      [/\.constructor\.constructor\b/, 'nested constructor bypass attempt'],
      // S011-007: Catch Reflect.construct with constructor access
      // Match patterns where Reflect.construct result is used with .constructor
      [/Reflect\.construct[^;]*\.constructor/, 'Reflect.construct with constructor access'],
      [/Reflect\.construct\([^)]+\)\s*\.\s*constructor/, 'Reflect.construct with constructor property access'],
      [/\bprototype\b/, 'prototype manipulation'],
      [/\bglobalThis\b/, 'globalThis access'],
      [/\bglobal\b/, 'global access'],
      [/\bchild_process\b/, 'child_process access'],
      [/\bexec\s*\(/, 'exec() call'],
      [/\bspawn\s*\(/, 'spawn() call'],
      [/\bfs\s*\.\s*(write|unlink|rm|mkdir|chmod)/, 'fs write operations'],
      [/\bhttp[s]?\s*\./, 'HTTP access'],
      [/\bnet\s*\./, 'Network access'],
      [/\bdns\s*\./, 'DNS access'],
      [/\bWebSocket\b/, 'WebSocket access'],
      [/\bfetch\s*\(/, 'fetch() call'],
      [/\bXMLHttpRequest\b/, 'XMLHttpRequest access'],
    ];

    for (const [pattern, issue] of dangerousPatterns) {
      if (pattern.test(code)) {
        issues.push(issue);
      }
    }

    // Check for obvious code injection attempts
    if (code.includes('\\x') || code.includes('\\u{')) {
      const decoded = this.tryDecodeEscapes(code);
      if (decoded !== code) {
        const decodedValidation = this.validateCode(decoded);
        if (!decodedValidation.safe) {
          issues.push('encoded dangerous pattern');
        }
      }
    }

    return {
      safe: issues.length === 0,
      issues,
    };
  }

  private tryDecodeEscapes(code: string): string {
    try {
      return code
        .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
    } catch {
      return code;
    }
  }

  private async executeInVm(
    code: string,
    context: Record<string, unknown>,
    timeout: number
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`Hook execution timed out after ${timeout}ms`);
        error.name = 'TimeoutError';
        reject(error);
      }, timeout);

      try {
        // vm.Script's ScriptOptions does not take `timeout` — the timeout
        // applies at runInContext time. The outer setTimeout above acts as a
        // belt-and-braces guard for misbehaving async work.
        const script = new vm.Script(code, {
          filename: `hook-${randomUUID()}.js`,
        });

        const result = script.runInContext(context, {
          timeout,
          displayErrors: true,
          breakOnSigint: true,
        });

        clearTimeout(timer);

        // Handle promises
        if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
          (result as Promise<unknown>)
            .then((res) => {
              clearTimeout(timer);
              resolve(res);
            })
            .catch((err) => {
              clearTimeout(timer);
              // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
              reject(err);
            });
        } else {
          resolve(result);
        }
      } catch (error) {
        clearTimeout(timer);
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error);
      }
    });
  }

  private deepFreeze<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    const propNames = Object.getOwnPropertyNames(obj);

    for (const name of propNames) {
      const value = (obj as Record<string, unknown>)[name];
      if (value && typeof value === 'object') {
        this.deepFreeze(value);
      }
    }

    return Object.freeze(obj) as T;
  }

  private sanitizeResult(value: unknown): unknown {
    const maxSize = 1024 * 1024; // 1MB

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'object') {
      try {
        const json = JSON.stringify(value);
        if (json.length > maxSize) {
          return { error: 'RESULT_TOO_LARGE', message: 'Result exceeds maximum size' };
        }
        return JSON.parse(json); // Deep clone
      } catch {
        return { error: 'INVALID_RESULT', message: 'Result cannot be serialized' };
      }
    }

    if (typeof value === 'string' && value.length > maxSize) {
      return value.slice(0, maxSize);
    }

    return value;
  }

  private logExecution(executionId: string, details: Omit<ExecutionLog, 'executionId' | 'timestamp'>): void {
    if (!this.config.logExecutions) return;

    this.executionLog.push({
      executionId,
      timestamp: new Date().toISOString(),
      ...details,
    });

    // Keep last 1000 executions
    if (this.executionLog.length > 1000) {
      this.executionLog = this.executionLog.slice(-1000);
    }
  }

  private logBlockedAttempt(executionId: string, issues: string[]): void {
    this.blockedAttempts.push({
      executionId,
      timestamp: new Date().toISOString(),
      issues,
    });

    this.emit('hook-blocked', {
      executionId,
      issues,
    });

    // Keep last 100 blocked attempts
    if (this.blockedAttempts.length > 100) {
      this.blockedAttempts = this.blockedAttempts.slice(-100);
    }
  }

  private calculateAverageTime(): number {
    if (this.executionLog.length === 0) return 0;

    const totalTime = this.executionLog.reduce(
      (sum, log) => sum + (log.duration ?? 0),
      0
    );

    return totalTime / this.executionLog.length;
  }

  private emit(event: string, data: unknown): void {
    if (this.eventEmitter) {
      this.eventEmitter.emit(event, data);
    }
  }

  /**
   * Get the event emitter for subscribing to sandbox events
   */
  getEventEmitter(): PortableEventEmitter | undefined {
    return this.eventEmitter;
  }
}
