/**
 * ConfigValidator Unit Tests
 * =========================
 * Comprehensive unit tests for configuration validation.
 */

import { describe, it, expect } from 'vitest';
import {
  ConfigValidationError,
  NumberRangeRule,
  TypeRule,
  EnumRule,
  FunctionRule,
  ArrayRule,
  ObjectRule,
  OptionalRule,
  CustomRule,
  Schema,
  Validators,
  type ConfigValidationResult
} from '../../../src/validation/ConfigValidator.js';

describe('ConfigValidationError', () => {
  it('should create error with message', () => {
    const error = new ConfigValidationError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('ConfigValidationError');
    expect(error.field).toBeUndefined();
    expect(error.value).toBeUndefined();
  });

  it('should create error with field', () => {
    const error = new ConfigValidationError('Test error', 'testField');
    expect(error.field).toBe('testField');
  });

  it('should create error with value', () => {
    const error = new ConfigValidationError('Test error', 'testField', 42);
    expect(error.value).toBe(42);
  });
});

describe('NumberRangeRule', () => {
  it('should validate number within range', () => {
    const rule = new NumberRangeRule(0, 100);
    const result = rule.validate(50);
    expect(result).toBeUndefined();
  });

  it('should reject number below min', () => {
    const rule = new NumberRangeRule(10, 100);
    const result = rule.validate(5);
    expect(result).toBeInstanceOf(ConfigValidationError);
    expect(result?.message).toContain('>=');
  });

  it('should reject number above max', () => {
    const rule = new NumberRangeRule(0, 100);
    const result = rule.validate(150);
    expect(result).toBeInstanceOf(ConfigValidationError);
    expect(result?.message).toContain('<=');
  });

  it('should reject non-number', () => {
    const rule = new NumberRangeRule(0, 100);
    const result = rule.validate('not a number');
    expect(result).toBeInstanceOf(ConfigValidationError);
  });

  it('should reject NaN', () => {
    const rule = new NumberRangeRule(0, 100);
    const result = rule.validate(NaN);
    expect(result).toBeInstanceOf(ConfigValidationError);
  });

  it('should reject Infinity', () => {
    const rule = new NumberRangeRule(0, 100);
    const result = rule.validate(Infinity);
    expect(result).toBeInstanceOf(ConfigValidationError);
  });

  it('should handle exclusive min', () => {
    const rule = new NumberRangeRule(10, undefined, false);
    const result = rule.validate(10);
    expect(result).toBeInstanceOf(ConfigValidationError);
  });

  it('should handle exclusive max', () => {
    const rule = new NumberRangeRule(undefined, 100, false);
    const result = rule.validate(100);
    expect(result).toBeInstanceOf(ConfigValidationError);
  });

  it('should handle no bounds', () => {
    const rule = new NumberRangeRule();
    expect(rule.validate(-1000)).toBeUndefined();
    expect(rule.validate(0)).toBeUndefined();
    expect(rule.validate(1000)).toBeUndefined();
  });

  it('should include field in error', () => {
    const rule = new NumberRangeRule(0, 100);
    const result = rule.validate(150, 'maxItems');
    expect(result?.field).toBe('maxItems');
  });
});

describe('TypeRule', () => {
  it('should validate correct type', () => {
    const rule = new TypeRule('string');
    expect(rule.validate('hello')).toBeUndefined();
  });

  it('should reject incorrect type', () => {
    const rule = new TypeRule('string');
    const result = rule.validate(123);
    expect(result).toBeInstanceOf(ConfigValidationError);
    expect(result?.message).toContain('string');
  });

  it('should validate array type', () => {
    const rule = new TypeRule('array');
    expect(rule.validate([1, 2, 3])).toBeUndefined();
  });

  it('should reject array for non-array type', () => {
    const rule = new TypeRule('object');
    const result = rule.validate([1, 2, 3]);
    expect(result).toBeInstanceOf(ConfigValidationError);
  });
});

describe('EnumRule', () => {
  it('should validate allowed value', () => {
    const rule = new EnumRule(['red', 'green', 'blue']);
    expect(rule.validate('red')).toBeUndefined();
    expect(rule.validate('green')).toBeUndefined();
    expect(rule.validate('blue')).toBeUndefined();
  });

  it('should reject disallowed value', () => {
    const rule = new EnumRule(['red', 'green', 'blue']);
    const result = rule.validate('yellow');
    expect(result).toBeInstanceOf(ConfigValidationError);
    expect(result?.message).toContain('red, green, blue');
  });

  it('should handle numbers', () => {
    const rule = new EnumRule([1, 2, 3]);
    expect(rule.validate(2)).toBeUndefined();
    expect(rule.validate(5)).toBeInstanceOf(ConfigValidationError);
  });

  it('should handle mixed types', () => {
    const rule = new EnumRule([1, 'two', null]);
    expect(rule.validate(1)).toBeUndefined();
    expect(rule.validate('two')).toBeUndefined();
    expect(rule.validate(null)).toBeUndefined();
    expect(rule.validate(3)).toBeInstanceOf(ConfigValidationError);
  });
});

describe('FunctionRule', () => {
  it('should validate function', () => {
    const rule = new FunctionRule();
    expect(rule.validate(() => {})).toBeUndefined();
    expect(rule.validate(function () {})).toBeUndefined();
  });

  it('should reject non-function', () => {
    const rule = new FunctionRule();
    expect(rule.validate('not a function')).toBeInstanceOf(ConfigValidationError);
    expect(rule.validate(123)).toBeInstanceOf(ConfigValidationError);
    expect(rule.validate({})).toBeInstanceOf(ConfigValidationError);
  });

  it('should accept async function', () => {
    const rule = new FunctionRule();
    expect(rule.validate(async () => {})).toBeUndefined();
  });
});

describe('ArrayRule', () => {
  it('should validate array', () => {
    const rule = new ArrayRule();
    expect(rule.validate([1, 2, 3])).toBeUndefined();
  });

  it('should reject non-array', () => {
    const rule = new ArrayRule();
    const result = rule.validate('not an array');
    expect(result).toBeInstanceOf(ConfigValidationError);
  });

  it('should validate min length', () => {
    const rule = new ArrayRule(undefined, 2);
    expect(rule.validate([1, 2])).toBeUndefined();
    expect(rule.validate([1])).toBeInstanceOf(ConfigValidationError);
  });

  it('should validate max length', () => {
    const rule = new ArrayRule(undefined, undefined, 2);
    expect(rule.validate([1, 2])).toBeUndefined();
    expect(rule.validate([1, 2, 3])).toBeInstanceOf(ConfigValidationError);
  });

  it('should validate array items', () => {
    const itemRule = new TypeRule('string');
    const rule = new ArrayRule(itemRule);
    expect(rule.validate(['a', 'b'])).toBeUndefined();
    expect(rule.validate(['a', 1])).toBeInstanceOf(ConfigValidationError);
  });

  it('should build path for item errors', () => {
    const itemRule = new TypeRule('string');
    const rule = new ArrayRule(itemRule);
    const result = rule.validate([1], 'items');
    expect(result?.field).toBe('items[0]');
  });

  it('should handle nested path', () => {
    const itemRule = new TypeRule('number');
    const rule = new ArrayRule(itemRule);
    const result = rule.validate(['a'], 'config.nested');
    expect(result?.field).toBe('config.nested[0]');
  });
});

describe('ObjectRule', () => {
  it('should validate object', () => {
    const rule = new ObjectRule();
    expect(rule.validate({})).toBeUndefined();
    expect(rule.validate({ a: 1 })).toBeUndefined();
  });

  it('should reject non-object', () => {
    const rule = new ObjectRule();
    expect(rule.validate('string')).toBeInstanceOf(ConfigValidationError);
    expect(rule.validate(123)).toBeInstanceOf(ConfigValidationError);
    expect(rule.validate(null)).toBeInstanceOf(ConfigValidationError);
    expect(rule.validate([1, 2, 3])).toBeInstanceOf(ConfigValidationError);
  });

  it('should validate properties', () => {
    const rule = new ObjectRule({
      name: new TypeRule('string'),
      age: new TypeRule('number')
    });
    expect(rule.validate({ name: 'John', age: 30 })).toBeUndefined();
  });

  it('should reject invalid property', () => {
    const rule = new ObjectRule({
      age: new TypeRule('number')
    });
    const result = rule.validate({ age: 'thirty' });
    expect(result).toBeInstanceOf(ConfigValidationError);
    expect(result?.field).toBe('age');
  });

  it('should allow unknown properties by default', () => {
    const rule = new ObjectRule({
      name: new TypeRule('string')
    });
    expect(rule.validate({ name: 'John', extra: 'data' })).toBeUndefined();
  });

  it('should reject unknown properties when disabled', () => {
    const rule = new ObjectRule(
      {
        name: new TypeRule('string')
      },
      false
    );
    const result = rule.validate({ name: 'John', extra: 'data' });
    expect(result).toBeInstanceOf(ConfigValidationError);
    expect(result?.message).toContain('Unknown properties');
  });

  it('should build nested path', () => {
    const rule = new ObjectRule({
      name: new TypeRule('string')
    });
    const result = rule.validate({ name: 123 }, 'config');
    expect(result?.field).toBe('config.name');
  });
});

describe('OptionalRule', () => {
  it('should allow undefined', () => {
    const rule = new OptionalRule(new TypeRule('string'));
    expect(rule.validate(undefined)).toBeUndefined();
  });

  // Sprint 29 behaviour change (architect IMPORTANT-3): OptionalRule
  // now ONLY short-circuits on `undefined`. Explicit `null` flows into
  // the inner rule for type-check. Prevents the footgun where
  // `{ logger: null }` passed schema then crashed at `logger.debug(...)`
  // because the destructuring default only fires for `undefined`.
  it('should reject explicit null (Sprint 29: undefined-only short-circuit)', () => {
    const rule = new OptionalRule(new TypeRule('string'));
    const result = rule.validate(null);
    expect(result).toBeInstanceOf(ConfigValidationError);
  });

  it('should validate defined value', () => {
    const rule = new OptionalRule(new TypeRule('string'));
    expect(rule.validate('hello')).toBeUndefined();
  });

  it('should reject invalid defined value', () => {
    const rule = new OptionalRule(new TypeRule('string'));
    const result = rule.validate(123);
    expect(result).toBeInstanceOf(ConfigValidationError);
  });
});

describe('CustomRule', () => {
  it('should use custom validator', () => {
    const rule = new CustomRule(value => {
      if (typeof value === 'string' && value.length < 3) {
        return new ConfigValidationError('Too short');
      }
      return undefined;
    });
    expect(rule.validate('hello')).toBeUndefined();
    expect(rule.validate('hi')).toBeInstanceOf(ConfigValidationError);
  });

  it('should pass path to custom validator', () => {
    const rule = new CustomRule((value, path) => {
      return new ConfigValidationError(`Failed at ${path}`);
    });
    const result = rule.validate('test', 'myField');
    expect(result?.message).toContain('myField');
  });
});

describe('Schema', () => {
  it('should validate valid config', () => {
    const schema = new Schema({
      name: new TypeRule('string'),
      age: new TypeRule('number')
    });
    const result = schema.validate({ name: 'John', age: 30 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should collect all errors', () => {
    const schema = new Schema({
      name: new TypeRule('string'),
      age: new TypeRule('number'),
      email: new TypeRule('string')
    });
    const result = schema.validate({ name: 123, age: '30' });
    expect(result.valid).toBe(false);
    // We get 3 errors: name (wrong type), age (wrong type), email (undefined is not a string)
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('should ignore extra properties', () => {
    const schema = new Schema({
      name: new TypeRule('string')
    });
    const result = schema.validate({ name: 'John', extra: 'data' });
    expect(result.valid).toBe(true);
  });

  it('should not throw for valid config in validateOrThrow', () => {
    const schema = new Schema({
      name: new TypeRule('string')
    });
    expect(() => schema.validateOrThrow({ name: 'John' })).not.toThrow();
  });

  it('should throw for invalid config in validateOrThrow', () => {
    const schema = new Schema({
      name: new TypeRule('string'),
      age: new TypeRule('number')
    });
    expect(() => schema.validateOrThrow({ name: 123 })).toThrow(ConfigValidationError);
    expect(() => schema.validateOrThrow({ name: 123 })).toThrow('Configuration validation failed');
  });

  it('should include value in error message', () => {
    const schema = new Schema({
      port: new NumberRangeRule(1, 65535)
    });
    expect(() => schema.validateOrThrow({ port: 70000 })).toThrow('70000');
  });
});

describe('Validators', () => {
  it('should provide positiveNumber validator', () => {
    expect(Validators.positiveNumber().validate(10)).toBeUndefined();
    expect(Validators.positiveNumber(5).validate(10)).toBeUndefined();
    expect(Validators.positiveNumber(5).validate(3)).toBeInstanceOf(ConfigValidationError);
  });

  it('should provide percentage validator', () => {
    expect(Validators.percentage.validate(50)).toBeUndefined();
    expect(Validators.percentage.validate(0)).toBeUndefined();
    expect(Validators.percentage.validate(100)).toBeUndefined();
    expect(Validators.percentage.validate(-1)).toBeInstanceOf(ConfigValidationError);
    expect(Validators.percentage.validate(101)).toBeInstanceOf(ConfigValidationError);
  });

  it('should provide timeout validator (Sprint 31: strictly positive)', () => {
    expect(Validators.timeout.validate(5000)).toBeUndefined();
    // Sprint 31 cumulative audit: 0 is REJECTED to align with
    // validateWithTimeoutSecure (throws on timeoutMs ≤ 0). Defense-in-depth.
    expect(Validators.timeout.validate(0)).toBeInstanceOf(ConfigValidationError);
    expect(Validators.timeout.validate(1)).toBeUndefined();
    expect(Validators.timeout.validate(3600000)).toBeUndefined();
    expect(Validators.timeout.validate(-1)).toBeInstanceOf(ConfigValidationError);
    expect(Validators.timeout.validate(3600001)).toBeInstanceOf(ConfigValidationError);
  });

  it('should provide boolean validator', () => {
    expect(Validators.boolean.validate(true)).toBeUndefined();
    expect(Validators.boolean.validate(false)).toBeUndefined();
    expect(Validators.boolean.validate('true')).toBeInstanceOf(ConfigValidationError);
  });

  it('should provide string validator', () => {
    expect(Validators.string.validate('hello')).toBeUndefined();
    expect(Validators.string.validate(123)).toBeInstanceOf(ConfigValidationError);
  });

  it('should provide number validator', () => {
    expect(Validators.number.validate(123)).toBeUndefined();
    expect(Validators.number.validate('123')).toBeInstanceOf(ConfigValidationError);
  });

  it('should provide function validator', () => {
    expect(Validators.function.validate(() => {})).toBeUndefined();
    expect(Validators.function.validate({})).toBeInstanceOf(ConfigValidationError);
  });

  it('should provide array validator factory', () => {
    const validator = Validators.array(new TypeRule('string'), 1, 3);
    expect(validator.validate(['a', 'b'])).toBeUndefined();
    expect(validator.validate([])).toBeInstanceOf(ConfigValidationError);
    expect(validator.validate(['a', 'b', 'c', 'd'])).toBeInstanceOf(ConfigValidationError);
    expect(validator.validate([1, 2])).toBeInstanceOf(ConfigValidationError);
  });

  it('should provide object validator factory', () => {
    const validator = Validators.object(
      {
        name: Validators.string
      },
      false
    );
    expect(validator.validate({ name: 'John' })).toBeUndefined();
    expect(validator.validate({ name: 'John', extra: 'data' })).toBeInstanceOf(ConfigValidationError);
  });

  it('should provide enum validator factory', () => {
    const validator = Validators.enum(['a', 'b', 'c']);
    expect(validator.validate('b')).toBeUndefined();
    expect(validator.validate('d')).toBeInstanceOf(ConfigValidationError);
  });

  it('should provide optional validator factory', () => {
    const validator = Validators.optional(Validators.string);
    expect(validator.validate(undefined)).toBeUndefined();
    // Sprint 29: explicit null is rejected (was: accepted). See OptionalRule.
    expect(validator.validate(null)).toBeInstanceOf(ConfigValidationError);
    expect(validator.validate('hello')).toBeUndefined();
    expect(validator.validate(123)).toBeInstanceOf(ConfigValidationError);
  });

  it('should provide custom validator factory', () => {
    const validator = Validators.custom(value => {
      if (typeof value === 'string' && value.startsWith('bad')) {
        return new ConfigValidationError('Bad prefix');
      }
      return undefined;
    });
    expect(validator.validate('good')).toBeUndefined();
    expect(validator.validate('bad')).toBeInstanceOf(ConfigValidationError);
  });
});
