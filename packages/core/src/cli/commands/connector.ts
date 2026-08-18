/**
 * Connector Command Group
 *
 * Parent command for all connector-related operations.
 *
 * @module commands/connector
 */

import { Command } from 'commander';
import { connectorAddCommand } from './connector-add.js';
import { connectorRemoveCommand } from './connector-remove.js';
import { connectorTestCommand } from './connector-test.js';

/**
 * Connector command group
 *
 * Groups all connector-related subcommands:
 * - connector add: Add a connector configuration
 * - connector remove: Remove a connector configuration
 * - connector test: Test a connector configuration
 */
export const connectorCommand = new Command('connector')
  .description('Manage connector configurations')
  .addCommand(connectorAddCommand)
  .addCommand(connectorRemoveCommand)
  .addCommand(connectorTestCommand);
