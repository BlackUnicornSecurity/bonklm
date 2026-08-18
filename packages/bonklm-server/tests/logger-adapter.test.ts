import { describe, expect, it, vi } from 'vitest';
import { adaptLogger, fastifyLogMessage } from '../src/logger-adapter.js';

describe('Fastify logger adapter', () => {
  it('sanitizes string and Error messages and uses a fixed fallback', () => {
    expect(fastifyLogMessage(['line\nvalue'])).toBe('line\\nvalue');
    expect(fastifyLogMessage([new Error('bad\nvalue')])).toBe('bad\\nvalue');
    expect(fastifyLogMessage([{ detail: 'ignored' }])).toBe('Fastify event');
  });

  it('maps the complete Fastify logger surface to the core logger', () => {
    const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const adapted = adaptLogger(logger);
    adapted.debug('debug');
    adapted.trace('trace');
    adapted.error('error');
    adapted.fatal('fatal');
    adapted.info('info');
    adapted.warn('warn');
    adapted.silent('ignored');

    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith('info');
    expect(logger.warn).toHaveBeenCalledWith('warn');
    expect(adapted.child({})).toBe(adapted);
  });
});
