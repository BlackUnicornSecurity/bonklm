/**
 * Connector Test Command Tests
 */

import { describe, it, expect } from 'vitest';
import { connectorTestCommand } from './connector-test.js';

describe('connector test command', () => {
  it('should be defined', () => {
    expect(connectorTestCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(connectorTestCommand.name()).toBe('test');
  });

  it('should have description', () => {
    expect(connectorTestCommand.description()).toBeTruthy();
    expect(connectorTestCommand.description()).toContain('connector');
  });

  it('should have --json option', () => {
    const options = connectorTestCommand.options;
    const jsonOption = options.find(opt => opt.long === '--json');
    expect(jsonOption).toBeDefined();
  });

  it('should be properly configured', () => {
    expect(connectorTestCommand).toHaveProperty('_args');
    expect(connectorTestCommand).toHaveProperty('options');
  });
});
