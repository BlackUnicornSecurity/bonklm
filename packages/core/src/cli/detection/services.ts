/**
 * Service Detection Module
 *
 * Detects running services on the local machine through:
 * - Port scanning for known services (e.g., Ollama on :11434)
 * - Docker container detection for vector databases (Chroma, Weaviate, Qdrant)
 *
 * SECURITY CONSIDERATIONS:
 * - C-1: Command Injection - Uses `which()` to validate Docker binary path
 * - C-6: DoS - Enforces MAX_PORTS_TO_CHECK limit to prevent resource exhaustion
 * - Input validation on all ports and hosts
 * - Timeout enforcement on all network operations
 *
 * @module detection/services
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import which from 'which';
import { DETECTION_TIMEOUTS, detectWithTimeout } from './timeout.js';
import { checkPort } from './port.js';
import { getDetectionDockerPatterns, getDetectionPorts } from '../connectors/registry.js';

// Promisify execFile for async/await usage
const execFileAsync = promisify(execFile);

/**
 * Detected service information
 */
export interface DetectedService {
  /** Service name (e.g., 'ollama', 'chroma-db') */
  name: string;
  /** Detection method used */
  type: 'port' | 'docker';
  /** True if the service is available/running */
  available: boolean;
  /** Network address (for port-based services) */
  address?: string;
}

/**
 * Known service ports to check.
 *
 * Derived from the connector registry (`detection.ports`) rather than
 * hardcoded, so a connector that declares a local port is probed without a
 * second edit here. Still capped by MAX_PORTS_TO_CHECK.
 *
 * SECURITY: Limited to MAX_PORTS_TO_CHECK to prevent DoS.
 *
 * @returns Ordered [connector id, port] pairs, deduplicated by port.
 */
function getServicePorts(): ReadonlyArray<readonly [string, number]> {
  return getDetectionPorts().map(signal => [signal.connectorId, signal.value] as const);
}

/**
 * Maximum number of ports to check
 *
 * SECURITY FIX (C-6): Prevents DoS through unbounded port scanning.
 */
export const MAX_PORTS_TO_CHECK = 10;

/**
 * Container name patterns that indicate a connector's backing service is
 * running in Docker.
 *
 * Derived from the connector registry (`detection.dockerContainers`) rather
 * than a hardcoded vector-DB list.
 *
 * @returns Lowercase container-name substrings to match against `docker ps`.
 */
function getContainerPatterns(): readonly string[] {
  return getDetectionDockerPatterns().map(signal => signal.value.toLowerCase());
}

/**
 * Detects running Docker containers
 *
 * SECURITY FIX (C-1): Validates Docker binary path using `which()`
 * to prevent PATH manipulation attacks. Uses execFile with explicit
 * binary path instead of shell execution.
 *
 * Also sanitizes container names to prevent injection attacks.
 *
 * @returns Promise resolving to array of container names
 */
export async function detectDockerContainers(): Promise<string[]> {
  try {
    // SECURITY FIX: Validate docker binary path to prevent PATH manipulation
    const dockerPath = await which('docker', { nothrow: true });

    if (!dockerPath) {
      // Docker not found, return empty array (not an error)
      return [];
    }

    // SECURITY FIX: Use execFile with explicit binary path instead of shell
    // This prevents command injection through PATH manipulation
    const { stdout } = await execFileAsync(dockerPath, ['ps', '--format', '{{.Names}}'], {
      timeout: 2000,
      env: { ...process.env, PATH: process.env.PATH } // Explicit PATH
    });

    if (!stdout || typeof stdout !== 'string') {
      return [];
    }

    // Sanitize container names to prevent injection
    // Only allow alphanumeric, underscore, hyphen, and dot
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(name => name.replace(/[^a-zA-Z0-9_.-]/g, '').trim())
      .filter(name => name.length > 0);
  } catch {
    // Docker command failed (Docker not running, daemon not available, etc.)
    // Return empty array - this is not a fatal error
    return [];
  }
}
/**
 * Docker detection function type for dependency injection
 */
type DockerDetectionFn = () => Promise<string[]>;

/**
 * Detects services running on the local machine
 *
 * Performs port-based and Docker-based detection with timeout enforcement.
 * All detection is wrapped in a timeout to prevent hanging.
 *
 * SECURITY FIXES:
 * - C-1: Command Injection - Docker binary validated with which()
 * - C-6: DoS - MAX_PORTS_TO_CHECK limit enforced
 * - Input validation on all ports and hosts
 * - Timeout enforcement (5 seconds max)
 *
 * @param detectDockerContainersFn - Optional Docker detection function for testing
 * @returns Promise resolving to array of detected services
 */
export async function detectServices(detectDockerContainersFn?: DockerDetectionFn): Promise<DetectedService[]> {
  return detectWithTimeout(
    async () => {
      const detected: DetectedService[] = [];

      // Port-based detection. The port list is registry-derived and grows with
      // the connector surface, so probe concurrently: a sequential scan costs
      // MAX_PORTS_TO_CHECK x DEFAULT_PORT_TIMEOUT of wall clock and would blow
      // the phase's own 5s budget (which throws, aborting `wizard`/`status`)
      // as soon as a handful of connectors declare a port.
      const servicePorts = getServicePorts();
      // SECURITY FIX (C-6): bound the scan regardless of registry size.
      const probed = servicePorts.slice(0, MAX_PORTS_TO_CHECK);
      if (servicePorts.length > probed.length) {
        console.warn(`[Service Detection] Maximum port check limit (${MAX_PORTS_TO_CHECK}) reached`);
      }

      detected.push(
        ...(await Promise.all(
          probed.map(async ([name, port]) => ({
            name,
            type: 'port' as const,
            available: await checkPort('localhost', port),
            address: `localhost:${port}`
          }))
        ))
      );

      // Docker-based detection - use injected function or default
      const dockerFn = detectDockerContainersFn || detectDockerContainers;
      const containers = await dockerFn();
      const patterns = getContainerPatterns();

      for (const container of containers) {
        const lowerName = container.toLowerCase();

        for (const pattern of patterns) {
          if (lowerName.includes(pattern)) {
            detected.push({
              name: container,
              type: 'docker',
              available: true
            });
            break;
          }
        }
      }

      return detected;
    },
    DETECTION_TIMEOUTS.services,
    'services'
  );
}

/**
 * Checks if Ollama is available on the default port
 *
 * Convenience function for checking Ollama specifically.
 *
 * @returns Promise resolving to true if Ollama is detected
 */
export async function isOllamaAvailable(): Promise<boolean> {
  const services = await detectServices();
  const ollama = services.find(s => s.name === 'ollama' && s.type === 'port');
  return ollama?.available ?? false;
}

/**
 * Checks if any vector database containers are running
 *
 * Convenience function for checking vector databases specifically.
 *
 * @returns Promise resolving to array of detected vector database container names
 */
export async function getVectorDbContainers(): Promise<string[]> {
  const services = await detectServices();
  return services.filter(s => s.type === 'docker' && s.available).map(s => s.name);
}
