/**
 * Connector Add Command Tests
 */

import { describe, it, expect } from 'vitest';
import { connectorAddCommand } from './connector-add.js';

describe('connector add command', () => {
  it('should be defined', () => {
    expect(connectorAddCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(connectorAddCommand.name()).toBe('add');
  });

  it('should have description', () => {
    expect(connectorAddCommand.description()).toBeTruthy();
    expect(connectorAddCommand.description()).toContain('connector');
  });

  it('should have id argument', () => {
    // Commander exposes registered arguments via the public `registeredArguments`
    // accessor (the internal `_args` it replaced predates commander 11).
    const args = connectorAddCommand.registeredArguments;
    expect(args).toBeDefined();
    expect(args.length).toBe(1);
  });

  it('should have --force option', () => {
    const options = connectorAddCommand.options;
    const forceOption = options.find(opt => opt.long === '--force');
    expect(forceOption).toBeDefined();
  });

  it('should be properly configured', () => {
    expect(connectorAddCommand).toHaveProperty('registeredArguments');
    expect(connectorAddCommand).toHaveProperty('options');
  });
});
