/**
 * Commands Module
 *
 * Exports all CLI commands for the wizard.
 *
 * @module commands
 */

export { wizardCommand } from './wizard.js';
export { connectorCommand } from './connector.js';
export { connectorAddCommand } from './connector-add.js';
export { connectorRemoveCommand } from './connector-remove.js';
export { connectorTestCommand } from './connector-test.js';
export { statusCommand } from './status.js';
// Sprint 50: only the user-facing surface re-exports through the
// barrel. The fs-shaped helpers `resolveHooksPath` /
// `readConfiguredPreCommit` are test-only; consumers should import
// them directly from `./doctor.js`. Keeps the barrel surface tight
// per code-review NIT 7.
export { doctorCommand, runDoctor, type DoctorCheckResult, type DoctorReport } from './doctor.js';
