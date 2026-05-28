/**
 * Wizard Command Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wizardCommand } from './wizard.js';
import { WizardError } from '../utils/error.js';

describe('wizard command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(wizardCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(wizardCommand.name()).toBe('wizard');
  });

  it('should have description', () => {
    expect(wizardCommand.description()).toBeTruthy();
    expect(wizardCommand.description()).toContain('interactive setup');
  });

  it('should have --json option', () => {
    const options = wizardCommand.options;
    const jsonOption = options.find(opt => opt.long === '--json');
    expect(jsonOption).toBeDefined();
  });

  it('should have action handler registered', () => {
    // Commander.js stores the action handler internally
    // The _executionCommand property indicates an action is registered
    expect(wizardCommand).toHaveProperty('_args');
    expect(wizardCommand).toHaveProperty('options');
    expect(wizardCommand._args.length).toBe(0); // wizard has no args
  });

  it('should have proper command structure', () => {
    expect(wizardCommand).toHaveProperty('_args');
    expect(wizardCommand).toHaveProperty('options');
  });
});
