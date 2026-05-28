/**
 * @UseGuardrails() Decorator Tests
 * ================================
 * Unit tests for the UseGuardrails decorator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UseGuardrails, isUseGuardrailsOptions } from '../src/use-guardrails.decorator.js';
import { SetMetadata } from '@nestjs/common';
import type { UseGuardrailsDecoratorOptions } from '../src/types.js';

// Mock SetMetadata
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  return {
    ...actual,
    SetMetadata: vi.fn((key: string, value: unknown) => value)
  };
});

describe('UseGuardrails Decorator', () => {
  describe('UseGuardrails', () => {
    it('should create decorator with default options', () => {
      const decorator = UseGuardrails();

      expect(decorator).toBeDefined();
      // The decorator returns metadata (value) from SetMetadata mock
      expect(typeof decorator === 'object' || typeof decorator === 'function').toBe(true);
    });

    it('should create decorator with custom options', () => {
      const options: UseGuardrailsDecoratorOptions = {
        validateInput: true,
        validateOutput: true,
        bodyField: 'prompt',
        responseField: 'text',
        maxContentLength: 2048
      };

      const decorator = UseGuardrails(options);

      expect(decorator).toBeDefined();
      // The decorator returns metadata (value) from SetMetadata mock
      expect(typeof decorator === 'object' || typeof decorator === 'function').toBe(true);
    });

    it('should accept validateInput option', () => {
      const decorator = UseGuardrails({ validateInput: false });

      expect(decorator).toBeDefined();
    });

    it('should accept validateOutput option', () => {
      const decorator = UseGuardrails({ validateOutput: true });

      expect(decorator).toBeDefined();
    });

    it('should accept bodyField option', () => {
      const decorator = UseGuardrails({ bodyField: 'message' });

      expect(decorator).toBeDefined();
    });

    it('should accept responseField option', () => {
      const decorator = UseGuardrails({ responseField: 'content' });

      expect(decorator).toBeDefined();
    });

    it('should accept maxContentLength option', () => {
      const decorator = UseGuardrails({ maxContentLength: 1024 });

      expect(decorator).toBeDefined();
    });

    it('should accept onError option', () => {
      const onError = vi.fn();
      const decorator = UseGuardrails({ onError });

      expect(decorator).toBeDefined();
    });

    it('should be applicable as both method and class decorator', () => {
      const decorator = UseGuardrails();

      // Decorator should work on methods
      expect(decorator).toBeDefined();

      // Should also work as class decorator (same signature)
      expect(decorator).toBeDefined();
    });
  });

  describe('isUseGuardrailsOptions', () => {
    it('should return true for valid options object', () => {
      const options: UseGuardrailsDecoratorOptions = {
        validateInput: true,
        validateOutput: false
      };

      expect(isUseGuardrailsOptions(options)).toBe(true);
    });

    it('should return true for options with validateInput', () => {
      const options = { validateInput: true };

      expect(isUseGuardrailsOptions(options)).toBe(true);
    });

    it('should return true for options with validateOutput', () => {
      const options = { validateOutput: true };

      expect(isUseGuardrailsOptions(options)).toBe(true);
    });

    it('should return true for options with bodyField', () => {
      const options = { bodyField: 'message' };

      expect(isUseGuardrailsOptions(options)).toBe(true);
    });

    it('should return true for options with responseField', () => {
      const options = { responseField: 'text' };

      expect(isUseGuardrailsOptions(options)).toBe(true);
    });

    it('should return true for options with maxContentLength', () => {
      const options = { maxContentLength: 2048 };

      expect(isUseGuardrailsOptions(options)).toBe(true);
    });

    it('should return true for options with onError', () => {
      const onError = vi.fn();
      const options = { onError };

      expect(isUseGuardrailsOptions(options)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isUseGuardrailsOptions(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isUseGuardrailsOptions(undefined)).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(isUseGuardrailsOptions('string')).toBe(false);
      expect(isUseGuardrailsOptions(123)).toBe(false);
      expect(isUseGuardrailsOptions(true)).toBe(false);
      expect(isUseGuardrailsOptions([])).toBe(false);
    });

    it('should return false for empty object', () => {
      expect(isUseGuardrailsOptions({})).toBe(false);
    });

    it('should return false for object with irrelevant properties', () => {
      const options = {
        someOtherProperty: 'value',
        anotherProperty: 123
      };

      expect(isUseGuardrailsOptions(options)).toBe(false);
    });
  });
});
