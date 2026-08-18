import type { FastifyBaseLogger } from 'fastify';
import { sanitizeLogString } from '@blackunicorn/bonklm';
import type { Logger } from '@blackunicorn/bonklm';

export function fastifyLogMessage(values: readonly unknown[]): string {
  const text = values.find(value => typeof value === 'string');
  if (typeof text === 'string') return sanitizeLogString(text);
  const error = values.find(value => value instanceof Error);
  return error instanceof Error ? sanitizeLogString(error.message) : 'Fastify event';
}

export function adaptLogger(logger: Logger): FastifyBaseLogger {
  const forward =
    (level: keyof Pick<Logger, 'debug' | 'error' | 'info' | 'warn'>) =>
    (...values: unknown[]): void =>
      logger[level](fastifyLogMessage(values));
  const adapted: FastifyBaseLogger = {
    level: 'info',
    debug: forward('debug'),
    error: forward('error'),
    fatal: forward('error'),
    info: forward('info'),
    silent: () => undefined,
    trace: forward('debug'),
    warn: forward('warn'),
    child: () => adapted
  };
  return adapted;
}
