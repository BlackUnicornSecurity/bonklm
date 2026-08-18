/**
 * Barrel export surface.
 *
 * `connectors/index.ts` and `detection/index.ts` are pure re-export modules: no
 * test imported them, so a rename or a dropped export shipped silently and the
 * files never appeared in coverage at all. This suite imports both and asserts
 * the surface each one promises.
 *
 * @module cli/module-exports.test
 */

import { describe, it, expect } from 'vitest';
import * as connectors from './connectors/index.js';
import * as detection from './detection/index.js';

describe('connectors barrel', () => {
  it('re-exports the registry accessors', () => {
    for (const name of [
      'getConnector',
      'getAllConnectors',
      'getConnectorsByCategory',
      'hasConnector',
      'getConnectorIds',
      'getCategories'
    ] as const) {
      expect(typeof connectors[name], name).toBe('function');
    }
  });

  it('re-exports the detection-signal aggregators', () => {
    for (const name of [
      'getDetectionPackages',
      'getDetectionEnvVars',
      'getDetectionPorts',
      'getDetectionDockerPatterns'
    ] as const) {
      expect(typeof connectors[name], name).toBe('function');
    }
  });

  it('re-exports the descriptor factory, the catalog and the type guards', () => {
    expect(typeof connectors.defineConnector).toBe('function');
    expect(Array.isArray(connectors.CONNECTOR_CATALOG)).toBe(true);
    expect(connectors.CONNECTOR_CATALOG.length).toBeGreaterThan(0);
    expect(connectors.CONNECTOR_CATEGORIES).toContain('llm');
    expect(typeof connectors.isConnectorDefinition).toBe('function');
    expect(typeof connectors.isConnectorCategory).toBe('function');
    expect(typeof connectors.isTestResult).toBe('function');
  });

  it('re-exports the credential helpers and the reference connectors', () => {
    expect(typeof connectors.isOptionalEnvVar).toBe('function');
    expect(typeof connectors.validateCredentialFormat).toBe('function');
    expect(connectors.openaiConnector.id).toBe('openai');
    expect(connectors.anthropicConnector.id).toBe('anthropic');
    expect(connectors.ollamaConnector.id).toBe('ollama');
    expect(connectors.expressConnector.id).toBe('express');
    expect(connectors.langchainConnector.id).toBe('langchain');
  });
});

describe('detection barrel', () => {
  it('re-exports the three detectors', () => {
    expect(typeof detection.detectFrameworks).toBe('function');
    expect(typeof detection.detectServices).toBe('function');
    expect(typeof detection.detectCredentials).toBe('function');
  });

  it('re-exports the shared project-deps reader', () => {
    expect(typeof detection.readProjectDependencies).toBe('function');
    expect(typeof detection.lookupDependency).toBe('function');
    expect(detection.MAX_PACKAGE_JSON_SIZE).toBeGreaterThan(0);
  });

  it('re-exports the shared port checker', () => {
    expect(typeof detection.checkPort).toBe('function');
    expect(detection.isValidPort(6333)).toBe(true);
    expect(detection.isValidHost('localhost')).toBe(true);
    expect(detection.DEFAULT_PORT_TIMEOUT).toBeGreaterThan(0);
  });

  it('re-exports the convenience helpers and the timeout wrapper', () => {
    for (const name of [
      'isFrameworkDetected',
      'getFrameworkVersion',
      'isOllamaAvailable',
      'getVectorDbContainers',
      'isCredentialPresent',
      'getCredentialMasked',
      'getPresentCredentials',
      'getSupportedCredentialNames',
      'detectWithTimeout',
      'createTimeoutPromise'
    ] as const) {
      expect(typeof detection[name], name).toBe('function');
    }
    expect(detection.DETECTION_TIMEOUTS).toBeTruthy();
  });
});
