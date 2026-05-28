/**
 * Connector Remove Command Tests
 */

import { describe, it, expect } from 'vitest';
import { connectorRemoveCommand } from './connector-remove.js';

describe('connector remove command', () => {
  it('should be defined', () => {
    expect(connectorRemoveCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(connectorRemoveCommand.name()).toBe('remove');
  });

  it('should have description', () => {
    expect(connectorRemoveCommand.description()).toBeTruthy();
    expect(connectorRemoveCommand.description()).toContain('connector');
  });

  it('should have --yes option', () => {
    const options = connectorRemoveCommand.options;
    const yesOption = options.find(opt => opt.long === '--yes');
    expect(yesOption).toBeDefined();
  });

  it('should be properly configured', () => {
    expect(connectorRemoveCommand).toHaveProperty('_args');
    expect(connectorRemoveCommand).toHaveProperty('options');
  });
});
