/**
 * Framework / integration detection for the BonkLM Installation Wizard
 *
 * Detects which of BonkLM's connectors are relevant to the current project by
 * matching the project's `package.json` dependencies against the package names
 * every connector declares in `detection.packageJson`.
 *
 * The list of package names is derived from the connector registry rather than
 * hardcoded here: a hardcoded table covered 4 frameworks while the registry
 * shipped dozens of connectors, so every connector added after the table was
 * written was invisible to the wizard. See connectors/registry.ts.
 *
 * The hardened `package.json` read (path-traversal, prototype-pollution and
 * file-size guards) lives in detection/project-deps.ts and is shared with the
 * connector `installed` probe.
 */

import { getDetectionPackages } from '../connectors/registry.js';
import { lookupDependency, type ProjectDepsOptions, readProjectDependencies } from './project-deps.js';

/**
 * A detected integration.
 *
 * `name` is the id of the connector the match belongs to; `package` is the
 * dependency that actually matched, which is what connectors declare and what
 * the wizard compares against.
 */
export interface DetectedFramework {
  /** Connector id the match belongs to (e.g. 'express', 'nestjs') */
  name: string;
  /** The project dependency that matched (e.g. '@nestjs/core') */
  package?: string;
  /** Version range from package.json (if available) */
  version?: string;
}

/**
 * Connector id accepted by {@link isFrameworkDetected} / {@link getFrameworkVersion}.
 *
 * Widened from a closed union to `string` when detection moved to the registry:
 * the valid ids are now whatever the registry contains, not a compile-time list.
 */
export type FrameworkId = string;

/**
 * Framework detection options
 *
 * Optional configuration for framework detection behavior.
 */
export type FrameworkDetectionOptions = ProjectDepsOptions;

/**
 * Detects which connectors' packages are present in the current project.
 *
 * Best-effort: a missing or unparseable `package.json` yields an empty list.
 * Path traversal, oversized files and prototype pollution still throw — see
 * {@link readProjectDependencies}.
 *
 * @param options - Optional detection configuration
 * @returns Array of detected integrations, one entry per matched dependency
 *
 * @throws {WizardError} If package.json is outside working directory (path traversal)
 * @throws {WizardError} If package.json exceeds the size limit
 * @throws {WizardError} `DETECTION_TIMEOUT` if the read does not complete in time
 *   (a package.json replaced by a FIFO blocks `open(2)` indefinitely)
 *
 * @example
 * ```ts
 * const frameworks = await detectFrameworks();
 * // [{ name: 'express', package: 'express', version: '^4.18.0' }]
 * ```
 */
export async function detectFrameworks(options: FrameworkDetectionOptions = {}): Promise<DetectedFramework[]> {
  // The read is bounded inside readProjectDependencies, so every caller of the
  // shared reader gets the same protection.
  const deps = await readProjectDependencies(options);

  // One entry per connector, not per matched dependency: a NestJS project
  // declares both @nestjs/core and @nestjs/common, and reporting the same
  // connector twice would double it up in `bonklm status` and the wizard.
  const detected: DetectedFramework[] = [];
  const claimed = new Set<string>();
  for (const signal of getDetectionPackages()) {
    if (claimed.has(signal.connectorId)) {
      continue;
    }
    const version = lookupDependency(deps, signal.value);
    if (version !== undefined) {
      claimed.add(signal.connectorId);
      detected.push({ name: signal.connectorId, package: signal.value, version });
    }
  }

  return detected;
}

/**
 * Checks if a specific framework is detected in the current project
 *
 * @param frameworkId - The framework ID to check
 * @param options - Optional detection configuration
 * @returns True if the framework is detected
 *
 * @example
 * ```ts
 * if (await isFrameworkDetected('express')) {
 *   // Use Express-specific code
 * }
 * ```
 */
export async function isFrameworkDetected(
  frameworkId: FrameworkId,
  options?: FrameworkDetectionOptions
): Promise<boolean> {
  const frameworks = await detectFrameworks(options);
  return frameworks.some(f => f.name === frameworkId);
}

/**
 * Gets version of a specific framework if detected
 *
 * @param frameworkId - The framework ID to check
 * @param options - Optional detection configuration
 * @returns Version string or undefined if not detected
 *
 * @example
 * ```ts
 * const expressVersion = await getFrameworkVersion('express');
 * // '^4.18.0' or undefined
 * ```
 */
export async function getFrameworkVersion(
  frameworkId: FrameworkId,
  options?: FrameworkDetectionOptions
): Promise<string | undefined> {
  const frameworks = await detectFrameworks(options);
  return frameworks.find(f => f.name === frameworkId)?.version;
}
