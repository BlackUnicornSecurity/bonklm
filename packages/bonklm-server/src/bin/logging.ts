import { sanitizeLogString, serializeError, type SerializedError } from '@blackunicorn/bonklm';

export function formatListenMessage(host: string, port: number): string {
  return `bonklm-server listening on http://${sanitizeLogString(host)}:${port}`;
}

export function formatCliError(error: unknown): SerializedError {
  return serializeError(error);
}
