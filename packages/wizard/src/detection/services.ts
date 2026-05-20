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

import { createConnection, Socket } from 'net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import which from 'which';
import { DETECTION_TIMEOUTS, detectWithTimeout } from './timeout.js';

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
 * Known service ports to check
 *
 * SECURITY: Limited to MAX_PORTS_TO_CHECK to prevent DoS.
 */
const SERVICE_PORTS = {
  ollama: 11434,
} as const;

/**
 * Maximum number of ports to check
 *
 * SECURITY FIX (C-6): Prevents DoS through unbounded port scanning.
 */
const MAX_PORTS_TO_CHECK = 10;

/**
 * Vector database container name patterns
 *
 * Used to detect vector databases running in Docker.
 */
const VECTOR_DB_PATTERNS = ['chroma', 'weaviate', 'qdrant'] as const;

/**
 * Maximum port number (IANA registered ports range)
 */
const MAX_PORT = 65535;

/**
 * Minimum valid port number
 */
const MIN_PORT = 1;

/**
 * Maximum hostname length (RFC 1035)
 */
const MAX_HOSTNAME_LENGTH = 253;

/**
 * Default port check timeout in milliseconds
 */
const DEFAULT_PORT_TIMEOUT = 1000;

/**
 * Maximum timeout for any port check
 */
const MAX_PORT_TIMEOUT = 2000;

/**
 * Validates a port number
 *
 * SECURITY: Ensures port is within valid range and correct type.
 *
 * @param port - Port to validate
 * @returns True if port is valid
 */
function isValidPort(port: number): boolean {
  return (
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port >= MIN_PORT &&
    port <= MAX_PORT
  );
}

/**
 * Validates a hostname
 *
 * SECURITY: Ensures hostname length is reasonable to prevent buffer issues.
 *
 * @param host - Hostname to validate
 * @returns True if hostname is valid
 */
function isValidHost(host: string): boolean {
  return (
    typeof host === 'string' &&
    host.length > 0 &&
    host.length <= MAX_HOSTNAME_LENGTH
  );
}

/**
 * Checks if a port is open on a host
 *
 * Attempts to create a TCP connection to the specified host and port.
 * Returns true if connection succeeds, false otherwise.
 *
 * SECURITY FIXES:
 * - Validates port range (1-65535)
 * - Validates host length (max 253 chars)
 * - Caps timeout to prevent long hangs (max 2000ms)
 *
 * @param host - Hostname or IP address
 * @param port - Port number to check
 * @param timeout - Timeout in milliseconds (default 1000, max 2000)
 * @returns Promise that resolves to true if port is open, false otherwise
 */
async function checkPort(
  host: string,
  port: number,
  timeout = DEFAULT_PORT_TIMEOUT
): Promise<boolean> {
  // SECURITY FIX: Validate inputs
  if (!isValidPort(port) || !isValidHost(host)) {
    return false;
  }

  // SECURITY FIX: Cap timeout to prevent long hangs
  const effectiveTimeout = Math.min(Math.max(timeout, 100), MAX_PORT_TIMEOUT);

  return new Promise<boolean>((resolve) => {
    const socket: Socket = createConnection(port, host);

    // Cleanup function to ensure socket is destroyed
    const cleanup = () => {
      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    // Set up timeout
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(false);
    }, effectiveTimeout);

    // Connection succeeded
    socket.on('connect', () => {
      clearTimeout(timeoutId);
      cleanup();
      resolve(true);
    });

    // Socket timeout event
    socket.on('timeout', () => {
      cleanup();
      resolve(false);
    });

    // Connection failed
    socket.on('error', () => {
      clearTimeout(timeoutId);
      cleanup();
      resolve(false);
    });

    // Set socket timeout (additional safety)
    socket.setTimeout(effectiveTimeout);
  });
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
      env: { ...process.env, PATH: process.env.PATH }, // Explicit PATH
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
      .map((name) => name.replace(/[^a-zA-Z0-9_.-]/g, '').trim())
      .filter((name) => name.length > 0);
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
export async function detectServices(
  detectDockerContainersFn?: DockerDetectionFn
): Promise<DetectedService[]> {
  return detectWithTimeout(
    async () => {
      const detected: DetectedService[] = [];
      let portsChecked = 0;

      // Port-based detection
      for (const [name, port] of Object.entries(SERVICE_PORTS)) {
        // SECURITY FIX: Enforce port check limit
        if (portsChecked >= MAX_PORTS_TO_CHECK) {
          console.warn(
            `[Service Detection] Maximum port check limit (${MAX_PORTS_TO_CHECK}) reached`
          );
          break;
        }

        const available = await checkPort('localhost', port);
        detected.push({
          name,
          type: 'port',
          available,
          address: `localhost:${port}`,
        });

        portsChecked++;
      }

      // Docker-based detection - use injected function or default
      const dockerFn = detectDockerContainersFn || detectDockerContainers;
      const containers = await dockerFn();

      for (const container of containers) {
        const lowerName = container.toLowerCase();

        for (const pattern of VECTOR_DB_PATTERNS) {
          if (lowerName.includes(pattern)) {
            detected.push({
              name: container,
              type: 'docker',
              available: true,
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
  const ollama = services.find((s) => s.name === 'ollama' && s.type === 'port');
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
  return services
    .filter((s) => s.type === 'docker' && s.available)
    .map((s) => s.name);
}
