/**
 * Status Command Tests
 */

import { describe, it, expect } from 'vitest';
import { statusCommand } from './status.js';

describe('status command', () => {
  it('should be defined', () => {
    expect(statusCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(statusCommand.name()).toBe('status');
  });

  it('should have description', () => {
    expect(statusCommand.description()).toBeTruthy();
  });

  it('should have --json option', () => {
    const options = statusCommand.options;
    const jsonOption = options.find(opt => opt.long === '--json');
    expect(jsonOption).toBeDefined();
  });

  it('should be properly configured', () => {
    expect(statusCommand).toHaveProperty('options');
  });
});
