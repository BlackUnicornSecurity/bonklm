/**
 * Sprint 20 cumulative audit closure (architect B1) — regression
 * sentinel asserting that every exported core validator class
 * declares a stable `.name` property. Future additions that omit
 * `.name` break `cachedValidate` (B2 guard) at the first use in
 * restate-middleware / temporal-middleware / etc.
 */
import { describe, it, expect } from 'vitest';
import {
  PromptInjectionValidator,
  JailbreakValidator,
  AudioStreamValidator,
  CodeInjectionValidator,
  PathTraversalValidator,
  MultilingualDetector,
} from '../../src/validators/index.js';

describe('validator-name sentinel — every core validator declares .name', () => {
  it('PromptInjectionValidator.name = "prompt-injection"', () => {
    expect(new PromptInjectionValidator().name).toBe('prompt-injection');
  });

  it('JailbreakValidator.name = "jailbreak" (Sprint 20 audit B1 closure)', () => {
    expect(new JailbreakValidator().name).toBe('jailbreak');
  });

  it('AudioStreamValidator.name = "audio_stream"', () => {
    expect(new AudioStreamValidator().name).toBe('audio_stream');
  });

  it('CodeInjectionValidator.name = "code_injection"', () => {
    expect(new CodeInjectionValidator().name).toBe('code_injection');
  });

  it('PathTraversalValidator.name = "path_traversal"', () => {
    expect(new PathTraversalValidator({ cwd: '/x' }).name).toBe('path_traversal');
  });

  it('MultilingualDetector.name = "multilingual"', () => {
    expect(new MultilingualDetector().name).toBe('multilingual');
  });
});
