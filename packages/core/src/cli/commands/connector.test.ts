/**
 * Connector Command Group Tests
 */

import { describe, it, expect } from 'vitest';
import { connectorCommand } from './connector.js';

describe('connector command group', () => {
  it('should be defined', () => {
    expect(connectorCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(connectorCommand.name()).toBe('connector');
  });

  it('should have description', () => {
    expect(connectorCommand.description()).toBeTruthy();
    expect(connectorCommand.description()).toContain('connector');
  });

  it('should have subcommands registered', () => {
    // Commander.js stores subcommands in the commands array
    const commands = connectorCommand.commands;
    expect(commands).toBeDefined();
    expect(commands.length).toBeGreaterThan(0);
  });

  it('should have add subcommand', () => {
    const addCmd = connectorCommand.commands.find(cmd => cmd.name() === 'add');
    expect(addCmd).toBeDefined();
  });

  it('should have remove subcommand', () => {
    const removeCmd = connectorCommand.commands.find(cmd => cmd.name() === 'remove');
    expect(removeCmd).toBeDefined();
  });

  it('should have test subcommand', () => {
    const testCmd = connectorCommand.commands.find(cmd => cmd.name() === 'test');
    expect(testCmd).toBeDefined();
  });
});
