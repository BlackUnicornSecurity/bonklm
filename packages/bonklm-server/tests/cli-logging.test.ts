import { describe, expect, it } from 'vitest';
import { formatCliError, formatListenMessage } from '../src/bin/logging.js';

describe('server CLI logging boundary', () => {
  it('sanitizes the configured host before interpolation', () => {
    const message = formatListenMessage('127.0.0.1\nINJECTED', 4123);
    expect(message).toBe('bonklm-server listening on http://127.0.0.1\\nINJECTED:4123');
    expect(message).not.toContain('\nINJECTED');
  });

  it('serializes and sanitizes caught values', () => {
    expect(formatCliError(new Error('boom\nINJECTED'))).toEqual(
      expect.objectContaining({ name: 'Error', message: 'boom\\nINJECTED' })
    );
    expect(formatCliError('plain\nINJECTED')).toEqual({ message: 'plain\\nINJECTED' });
  });
});
