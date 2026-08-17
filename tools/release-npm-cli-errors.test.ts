import { describe, expect, it, vi } from 'vitest';
import { runCli } from './release-npm-cli.js';

describe('release npm CLI error boundary', () => {
  it('runs only for its entrypoint and reports Error and non-Error failures generically', () => {
    expect(runCli({ argv1: '/other', scriptPath: '/script', run: vi.fn(), exit: vi.fn() })).toBe(false);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.fn();
    for (const failure of [new Error('\u001b[31mboom\nsecret\u202e' + 'x'.repeat(600)), 'bad\nsecret']) {
      expect(
        runCli({
          argv1: '/script',
          scriptPath: '/script',
          run: () => {
            throw failure;
          },
          exit
        })
      ).toBe(true);
    }
    expect(exit).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenNthCalledWith(1, 'release-npm: release command failed');
    expect(error).toHaveBeenNthCalledWith(2, 'release-npm: release command failed');
    error.mockRestore();
  });
});
