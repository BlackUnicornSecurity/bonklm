/**
 * TCP port reachability check
 *
 * Extracted from `detection/services.ts` so the connector `tcp` probe
 * (`connectors/descriptor.ts`) shares the same hardened implementation instead
 * of opening its own sockets. Keeping one checker also keeps one place where
 * the port/host/timeout bounds are enforced.
 *
 * SECURITY:
 * - Validates port range (1-65535) and host length (max 253 chars, RFC 1035)
 * - Caps the timeout so a hostile or black-holed host cannot hang the CLI
 * - Always destroys the socket, on every exit path
 *
 * @module detection/port
 */

import { createConnection, type Socket } from 'net';

/** Maximum port number (IANA registered ports range) */
const MAX_PORT = 65535;

/** Minimum valid port number */
const MIN_PORT = 1;

/** Maximum hostname length (RFC 1035) */
const MAX_HOSTNAME_LENGTH = 253;

/** Default port check timeout in milliseconds */
export const DEFAULT_PORT_TIMEOUT = 1000;

/** Maximum timeout for any port check */
const MAX_PORT_TIMEOUT = 2000;

/** Minimum timeout for any port check */
const MIN_PORT_TIMEOUT = 100;

/**
 * Validates a port number.
 *
 * @param port - Port to validate
 * @returns True if port is an integer within 1-65535
 */
export function isValidPort(port: number): boolean {
  return typeof port === 'number' && Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/**
 * Validates a hostname.
 *
 * @param host - Hostname to validate
 * @returns True if host is a non-empty string within the RFC 1035 length limit
 */
export function isValidHost(host: string): boolean {
  return typeof host === 'string' && host.length > 0 && host.length <= MAX_HOSTNAME_LENGTH;
}

/**
 * Checks whether a TCP port accepts a connection.
 *
 * Returns false — never throws — for invalid input, refused connections,
 * socket errors, and timeouts, so callers can treat detection as best-effort.
 *
 * @param host - Hostname or IP address
 * @param port - Port number to check
 * @param timeout - Timeout in milliseconds (default 1000, clamped to 100-2000)
 * @returns True if the port is open
 */
export async function checkPort(host: string, port: number, timeout = DEFAULT_PORT_TIMEOUT): Promise<boolean> {
  if (!isValidPort(port) || !isValidHost(host)) {
    return false;
  }

  // Cap timeout to prevent long hangs
  const effectiveTimeout = Math.min(Math.max(timeout, MIN_PORT_TIMEOUT), MAX_PORT_TIMEOUT);

  return new Promise<boolean>(resolve => {
    const socket: Socket = createConnection(port, host);

    const cleanup = () => {
      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(false);
    }, effectiveTimeout);

    socket.on('connect', () => {
      clearTimeout(timeoutId);
      cleanup();
      resolve(true);
    });

    socket.on('timeout', () => {
      clearTimeout(timeoutId);
      cleanup();
      resolve(false);
    });

    socket.on('error', () => {
      clearTimeout(timeoutId);
      cleanup();
      resolve(false);
    });

    // Set socket timeout (additional safety)
    socket.setTimeout(effectiveTimeout);
  });
}
