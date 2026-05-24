/**
 * Configuration Validator
 *
 * Provides utilities for validating configuration objects.
 *
 * @package @blackunicorn/bonklm
 */

/**
 * Config validation error
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Config validation result
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
}

/**
 * Validation rule
 */
export interface ValidationRule {
  /** Validate a value */
  validate(value: unknown, path?: string): ConfigValidationError | undefined;
}

/**
 * Number range rule
 */
export class NumberRangeRule implements ValidationRule {
  constructor(
    private readonly min?: number,
    private readonly max?: number,
    private readonly inclusive: boolean = true
  ) {}

  validate(value: unknown, path?: string): ConfigValidationError | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return new ConfigValidationError(
        `Value must be a number`,
        path,
        value
      );
    }

    if (this.min !== undefined) {
      const valid = this.inclusive ? value >= this.min : value > this.min;
      if (!valid) {
        return new ConfigValidationError(
          `Value must be ${this.inclusive ? '>=' : '>'} ${this.min}`,
          path,
          value
        );
      }
    }

    if (this.max !== undefined) {
      const valid = this.inclusive ? value <= this.max : value < this.max;
      if (!valid) {
        return new ConfigValidationError(
          `Value must be ${this.inclusive ? '<=' : '<'} ${this.max}`,
          path,
          value
        );
      }
    }

    return undefined;
  }
}

/**
 * Type rule
 */
export class TypeRule implements ValidationRule {
  constructor(private readonly expectedType: string) {}

  validate(value: unknown, path?: string): ConfigValidationError | undefined {
    const actualType = Array.isArray(value) ? 'array' : typeof value;

    if (actualType !== this.expectedType) {
      return new ConfigValidationError(
        `Value must be of type ${this.expectedType}`,
        path,
        value
      );
    }

    return undefined;
  }
}

/**
 * Enum rule
 */
export class EnumRule implements ValidationRule {
  constructor(private readonly allowedValues: readonly unknown[]) {}

  validate(value: unknown, path?: string): ConfigValidationError | undefined {
    if (!this.allowedValues.includes(value)) {
      return new ConfigValidationError(
        `Value must be one of: ${this.allowedValues.join(', ')}`,
        path,
        value
      );
    }

    return undefined;
  }
}

/**
 * Function rule
 */
export class FunctionRule implements ValidationRule {
  validate(value: unknown, path?: string): ConfigValidationError | undefined {
    if (typeof value !== 'function') {
      return new ConfigValidationError(
        `Value must be a function`,
        path,
        value
      );
    }

    return undefined;
  }
}

/**
 * Sprint 29 — Validator-instance rule.
 *
 * Accepts either:
 *   - A callable function (legacy bare-function validator shape), OR
 *   - An object exposing a `.validate` method (current `Validator` /
 *     `Guard` interface from `engine/GuardrailEngine.types.ts`).
 *
 * Background: Sprint 28 close uncovered a pre-existing tooling miss
 * in express-middleware / fastify-plugin / nestjs-module config
 * schemas — they used `Validators.function` (= `FunctionRule`) for
 * the `validators` / `guards` arrays, which rejected the current
 * canonical `Validator` instance shape (class instances are objects,
 * not functions). 57+ tests failed across the three packages despite
 * the runtime path handling instances correctly.
 *
 * Fix lives at the core schema layer (NOT per-connector) so future
 * connectors that mirror the same pattern automatically pick up the
 * canonical shape.
 *
 * @public Sprint 29 v1.0-RC2 stabilization. Object-shape contract:
 * `{ validate: function, name?: string }` — frozen for v1.0.
 */
export class ValidatorInstanceRule implements ValidationRule {
  validate(value: unknown, path?: string): ConfigValidationError | undefined {
    // Path A — bare function (legacy).
    if (typeof value === 'function') {
      return undefined;
    }
    // Path B — object with `.validate` method (current canonical).
    if (
      value !== null &&
      typeof value === 'object' &&
      typeof (value as { validate?: unknown }).validate === 'function'
    ) {
      return undefined;
    }
    return new ConfigValidationError(
      `Value must be a Validator (function, or object with a \`.validate\` method)`,
      path,
      value
    );
  }
}

/**
 * Sprint 29 — AttackLogger-instance rule.
 *
 * Accepts an object exposing `getInterceptCallback()` (the canonical
 * `AttackLogger` shape from `@blackunicorn/bonklm-logger`). Defensive
 * preventive fix from audit IMPORTANT-2: connector schemas previously
 * used `Validators.function` for the `attackLogger` config field, which
 * would reject the canonical class-instance shape — same root cause as
 * the `validator` / `logger` shape mismatch.
 *
 * @public Sprint 29 v1.0-RC2 stabilization.
 */
export class AttackLoggerInstanceRule implements ValidationRule {
  validate(value: unknown, path?: string): ConfigValidationError | undefined {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return new ConfigValidationError(
        `Value must be an AttackLogger (object with a \`getInterceptCallback\` method)`,
        path,
        value
      );
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.getInterceptCallback !== 'function') {
      return new ConfigValidationError(
        `Value must be an AttackLogger (missing or non-callable \`getInterceptCallback\` method)`,
        path,
        value
      );
    }
    return undefined;
  }
}

/**
 * Sprint 29 — Logger-instance rule.
 *
 * Accepts an object exposing the canonical `Logger` interface methods:
 * `debug` / `info` / `warn` / `error` (all callable). This matches the
 * `Logger` interface in `core/src/base/GenericLogger.ts`.
 *
 * Background: Sprint 28 close uncovered that the connector schemas
 * also used `Validators.function` for the `logger` config field. The
 * canonical `Logger` shape is an OBJECT with methods, not a callable.
 *
 * @public Sprint 29 v1.0-RC2 stabilization. Logger contract is the
 * `{ debug, info, warn, error }` 4-method shape — frozen for v1.0.
 */
export class LoggerInstanceRule implements ValidationRule {
  validate(value: unknown, path?: string): ConfigValidationError | undefined {
    // Sprint 29 audit (code-reviewer MEDIUM): arrays are objects, so
    // exclude them explicitly — matches the `ObjectRule.validate()`
    // precedent and produces a clearer error message than `missing
    // .debug method` (which is technically true but unhelpful).
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return new ConfigValidationError(
        `Value must be a Logger (object with debug/info/warn/error methods)`,
        path,
        value
      );
    }
    const obj = value as Record<string, unknown>;
    for (const method of ['debug', 'info', 'warn', 'error']) {
      if (typeof obj[method] !== 'function') {
        return new ConfigValidationError(
          `Value must be a Logger (missing or non-callable \`${method}\` method)`,
          path,
          value
        );
      }
    }
    return undefined;
  }
}

/**
 * Array rule
 */
export class ArrayRule implements ValidationRule {
  constructor(
    private readonly itemRule?: ValidationRule,
    private readonly minLength?: number,
    private readonly maxLength?: number
  ) {}

  validate(value: unknown, path?: string): ConfigValidationError | undefined {
    if (!Array.isArray(value)) {
      return new ConfigValidationError(
        `Value must be an array`,
        path,
        value
      );
    }

    if (this.minLength !== undefined && value.length < this.minLength) {
      return new ConfigValidationError(
        `Array must have at least ${this.minLength} items`,
        path,
        value
      );
    }

    if (this.maxLength !== undefined && value.length > this.maxLength) {
      return new ConfigValidationError(
        `Array must have at most ${this.maxLength} items`,
        path,
        value
      );
    }

    // Validate array items
    if (this.itemRule) {
      for (let i = 0; i < value.length; i++) {
        const error = this.itemRule.validate(
          value[i],
          path ? `${path}[${i}]` : `[${i}]`
        );
        if (error) {
          return error;
        }
      }
    }

    return undefined;
  }
}

/**
 * Object rule
 */
export class ObjectRule implements ValidationRule {
  constructor(
    private readonly properties?: Record<string, ValidationRule>,
    private readonly allowUnknown: boolean = true
  ) {}

  validate(value: unknown, path?: string): ConfigValidationError | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return new ConfigValidationError(
        `Value must be an object`,
        path,
        value
      );
    }

    // Validate known properties
    if (this.properties) {
      for (const [key, rule] of Object.entries(this.properties)) {
        const error = rule.validate(
          (value as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key
        );
        if (error) {
          return error;
        }
      }
    }

    // Check for unknown properties
    if (!this.allowUnknown && this.properties) {
      const unknownKeys = Object.keys(value).filter(
        (key) => !(key in (this.properties || {}))
      );
      if (unknownKeys.length > 0) {
        return new ConfigValidationError(
          `Unknown properties: ${unknownKeys.join(', ')}`,
          path,
          value
        );
      }
    }

    return undefined;
  }
}

/**
 * Optional rule - allows undefined (NOT null).
 *
 * Sprint 29 audit (architect IMPORTANT-3): historically this also
 * short-circuited on `null`, which meant `{ logger: null }` passed
 * schema validation but then crashed at `this.logger.debug(...)` at
 * runtime because the destructuring default `logger = DEFAULT_LOGGER`
 * doesn't kick in for `null` (only `undefined`).
 *
 * Behaviour change rationale: `undefined` is the JS-canonical "absent
 * value" sentinel — callers that omit a key get `undefined`, and the
 * inner rule should NOT run. `null` is an EXPLICIT value supplied by
 * the caller; it should flow into the inner rule for type-check. If
 * a caller genuinely wants to clear a field, they should `delete` it
 * or pass `undefined`.
 *
 * Impact: the only known consumer that passed `null` was test code
 * that should have been passing `undefined` or omitting the key.
 */
export class OptionalRule implements ValidationRule {
  constructor(private readonly rule: ValidationRule) {}

  validate(value: unknown, path?: string): ConfigValidationError | undefined {
    if (value === undefined) {
      return undefined;
    }

    return this.rule.validate(value, path);
  }
}

/**
 * Custom rule
 */
export class CustomRule implements ValidationRule {
  constructor(
    private readonly validator: (value: unknown, path?: string) => ConfigValidationError | undefined
  ) {}

  validate(value: unknown, path?: string): ConfigValidationError | undefined {
    return this.validator(value, path);
  }
}

/**
 * Schema - combines multiple rules for validation
 */
export class Schema {
  constructor(private readonly rules: Record<string, ValidationRule>) {}

  /**
   * Validate a configuration object
   */
  validate(config: Record<string, unknown>): ConfigValidationResult {
    const errors: ConfigValidationError[] = [];

    for (const [key, rule] of Object.entries(this.rules)) {
      const error = rule.validate(config[key], key);
      if (error) {
        errors.push(error);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate and throw if invalid
   */
  validateOrThrow(config: Record<string, unknown>): void {
    const result = this.validate(config);

    if (!result.valid) {
      const messages = result.errors.map(
        (e) => `${e.field ? `${e.field  }: ` : ''}${e.message}${e.value !== undefined ? ` (received: ${JSON.stringify(e.value)})` : ''}`
      );

      throw new ConfigValidationError(
        `Configuration validation failed:\n  - ${messages.join('\n  - ')}`
      );
    }
  }
}

/**
 * Pre-defined validators for common config options
 */
export const Validators = {
  /**
   * Positive number with optional explicit minimum.
   *
   * Sprint 31 cumulative audit (security LOW-2 closure): the prior
   * `min === 0 ? undefined : min` short-circuit silently turned
   * `Validators.positiveNumber(0)` into an UNBOUNDED rule (accepts
   * negatives). `maxContentLength: positiveNumber(0)` would have
   * accepted `-1024` and disabled the size limit. Now `min` is
   * always honoured; pass `min = 0` for "≥ 0" semantics explicitly.
   */
  positiveNumber: (min: number = 0) =>
    new NumberRangeRule(min, undefined),

  /** Percentage (0-100) */
  percentage: new NumberRangeRule(0, 100),

  /**
   * Timeout (ms) — must be strictly positive (≥ 1).
   *
   * Sprint 31 cumulative audit (arch HIGH-1 + sec HIGH-1 closure):
   * the prior `NumberRangeRule(0, ...)` was inclusive-zero, which
   * conflicted with `validateWithTimeoutSecure` (throws TypeError on
   * `timeoutMs ≤ 0`). An operator passing `validationTimeout: 0`
   * (e.g. `parseInt('')` from a broken env-var) would pass schema
   * validation, then crash the worker on EVERY request with an
   * uncaught TypeError. The schema is now the FIRST defense-in-depth
   * layer — 0 is rejected at config-load time with a clear error.
   * Max 1 hour preserved.
   */
  timeout: new NumberRangeRule(1, 3600000),

  /** Boolean */
  boolean: new TypeRule('boolean'),

  /** String */
  string: new TypeRule('string'),

  /** Number */
  number: new TypeRule('number'),

  /** Function */
  function: new FunctionRule(),

  /**
   * Validator instance — accepts a bare callable OR an object with a
   * `.validate` method. Sprint 29: use this for `validators` / `guards`
   * config-array entries; the canonical interface is the object-shape.
   * Plain callable-only rule rejects class instances.
   */
  validatorInstance: new ValidatorInstanceRule(),

  /**
   * Logger instance — accepts an object with the canonical 4-method
   * `Logger` shape (debug/info/warn/error). Sprint 29: use this for
   * `logger` config fields; the canonical interface is object-shape.
   */
  loggerInstance: new LoggerInstanceRule(),

  /**
   * AttackLogger instance — accepts an object with a
   * `getInterceptCallback` method. Sprint 29: use this for the
   * `attackLogger` config field in connector middleware schemas.
   */
  attackLoggerInstance: new AttackLoggerInstanceRule(),

  /** Array */
  array: (itemRule?: ValidationRule, minLength?: number, maxLength?: number) =>
    new ArrayRule(itemRule, minLength, maxLength),

  /** Object */
  object: (properties?: Record<string, ValidationRule>, allowUnknown?: boolean) =>
    new ObjectRule(properties, allowUnknown),

  /** Enum */
  enum: (values: readonly unknown[]) => new EnumRule(values),

  /** Optional */
  optional: (rule: ValidationRule) => new OptionalRule(rule),

  /** Custom */
  custom: (validator: (value: unknown, path?: string) => ConfigValidationError | undefined) =>
    new CustomRule(validator),
};
