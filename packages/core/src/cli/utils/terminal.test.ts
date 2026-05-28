/**
 * Unit tests for terminal capability detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getTerminalCapabilities,
  getDetailedTerminalCapabilities,
  supportsColorLevel,
  getCursorControls,
  colorize,
  colors,
  brand,
  type TerminalCapabilities,
  type DetailedTerminalCapabilities,
  type ColorLevel,
} from './terminal.js';

describe('terminal', () => {
  // Store original environment and stdout properties
  const originalEnv = { ...process.env };
  let originalIsTTY: boolean;
  let originalColumns: number | undefined;
  let originalRows: number | undefined;

  beforeEach(() => {
    // Store original stdout properties
    originalIsTTY = process.stdout.isTTY as boolean;
    originalColumns = process.stdout.columns;
    originalRows = process.stdout.rows;

    // Reset to original environment before each test
    vi.clearAllMocks();
    for (const key in process.env) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  afterEach(() => {
    // Restore original environment and stdout properties
    process.env = originalEnv;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, 'rows', {
      value: originalRows,
      writable: true,
      configurable: true,
    });
  });

  describe('getTerminalCapabilities', () => {
    it('should return terminal capabilities', () => {
      const caps = getTerminalCapabilities();

      expect(caps).toHaveProperty('isTTY');
      expect(caps).toHaveProperty('supportsColor');
      expect(caps).toHaveProperty('width');
      expect(caps).toHaveProperty('height');
    });

    it('should detect TTY from stdout.isTTY', () => {
      const isTTY = Boolean(process.stdout.isTTY);
      const caps = getTerminalCapabilities();

      expect(caps.isTTY).toBe(isTTY);
    });

    it('should default width to 80 when columns is undefined', () => {
      Object.defineProperty(process.stdout, 'columns', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const caps = getTerminalCapabilities();

      expect(caps.width).toBe(80);
    });

    it('should return actual columns when available', () => {
      Object.defineProperty(process.stdout, 'columns', {
        value: 120,
        writable: true,
        configurable: true,
      });

      const caps = getTerminalCapabilities();

      expect(caps.width).toBe(120);
    });

    it('should default height to 24 when rows is undefined', () => {
      Object.defineProperty(process.stdout, 'rows', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const caps = getTerminalCapabilities();

      expect(caps.height).toBe(24);
    });

    it('should return actual rows when available', () => {
      Object.defineProperty(process.stdout, 'rows', {
        value: 50,
        writable: true,
        configurable: true,
      });

      const caps = getTerminalCapabilities();

      expect(caps.height).toBe(50);
    });

    it('should detect supportsColor as true when TTY and FORCE_COLOR is not 0', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });
      delete process.env.FORCE_COLOR;

      const caps = getTerminalCapabilities();

      expect(caps.supportsColor).toBe(true);
    });

    it('should detect supportsColor as false when FORCE_COLOR is 0', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });
      process.env.FORCE_COLOR = '0';

      const caps = getTerminalCapabilities();

      expect(caps.supportsColor).toBe(false);
    });

    it('should detect supportsColor as false when not TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      const caps = getTerminalCapabilities();

      expect(caps.supportsColor).toBe(false);
    });
  });

  describe('getDetailedTerminalCapabilities', () => {
    it('should return detailed capabilities', () => {
      const caps = getDetailedTerminalCapabilities();

      expect(caps).toHaveProperty('isTTY');
      expect(caps).toHaveProperty('supportsColor');
      expect(caps).toHaveProperty('width');
      expect(caps).toHaveProperty('height');
      expect(caps).toHaveProperty('colorLevel');
      expect(caps).toHaveProperty('isCI');
    });

    it('should detect CI environment from CI variable', () => {
      process.env.CI = 'true';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.isCI).toBe(true);
    });

    it('should detect GitHub Actions CI', () => {
      process.env.GITHUB_ACTIONS = 'true';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.isCI).toBe(true);
    });

    it('should detect GitLab CI', () => {
      process.env.GITLAB_CI = 'true';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.isCI).toBe(true);
    });

    it('should detect Jenkins CI', () => {
      process.env.JENKINS_URL = 'http://jenkins.example.com';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.isCI).toBe(true);
    });

    it('should detect Travis CI', () => {
      process.env.TRAVIS = 'true';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.isCI).toBe(true);
    });

    it('should set isTTY to false in CI even if stdout.isTTY is true', () => {
      process.env.CI = 'true';
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });

      const caps = getDetailedTerminalCapabilities();

      expect(caps.isTTY).toBe(false);
    });

    it('should detect color level 3 for truecolor terminals', () => {
      process.env.COLORTERM = 'truecolor';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(3);
    });

    it('should detect color level 3 for 24bit terminals', () => {
      process.env.COLORTERM = '24bit';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(3);
    });

    it('should detect color level 2 for 256color terminals', () => {
      process.env.TERM = 'xterm-256color';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(2);
    });

    it('should detect color level 2 for screen-256color', () => {
      process.env.TERM = 'screen-256color';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(2);
    });

    it('should detect color level 2 for tmux-256color', () => {
      process.env.TERM = 'tmux-256color';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(2);
    });

    it('should detect color level 1 for basic xterm', () => {
      process.env.TERM = 'xterm';
      delete process.env.COLORTERM;

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(1);
    });

    it('should detect color level 1 for screen', () => {
      process.env.TERM = 'screen';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(1);
    });

    it('should detect color level 1 for Apple Terminal', () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      delete process.env.TERM;

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(1);
    });

    it('should detect color level 1 for iTerm2', () => {
      process.env.TERM_PROGRAM = 'iTerm.app';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(1);
    });

    it('should detect color level 0 for dumb terminals', () => {
      process.env.TERM = 'dumb';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(0);
    });

    it('should override color level to 0 when FORCE_COLOR is 0', () => {
      process.env.TERM = 'xterm-256color';
      process.env.FORCE_COLOR = '0';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(0);
    });

    it('should override color level to 1 when FORCE_COLOR is 1', () => {
      process.env.TERM = 'dumb';
      process.env.FORCE_COLOR = '1';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(1);
    });

    it('should override color level to 2 when FORCE_COLOR is 2', () => {
      process.env.TERM = 'dumb';
      process.env.FORCE_COLOR = '2';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(2);
    });

    it('should override color level to 3 when FORCE_COLOR is 3', () => {
      process.env.TERM = 'dumb';
      process.env.FORCE_COLOR = '3';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(3);
    });

    it('should override color level to 3 when FORCE_COLOR is true', () => {
      process.env.TERM = 'dumb';
      process.env.FORCE_COLOR = 'true';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.colorLevel).toBe(3);
    });

    it('should return supportsColor true when colorLevel > 0', () => {
      process.env.TERM = 'xterm';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.supportsColor).toBe(true);
    });

    it('should return supportsColor false when colorLevel is 0', () => {
      process.env.TERM = 'dumb';

      const caps = getDetailedTerminalCapabilities();

      expect(caps.supportsColor).toBe(false);
    });
  });

  describe('supportsColorLevel', () => {
    it('should return true when terminal has higher color level', () => {
      process.env.COLORTERM = 'truecolor';

      expect(supportsColorLevel(2)).toBe(true);
      expect(supportsColorLevel(1)).toBe(true);
      expect(supportsColorLevel(0)).toBe(true);
    });

    it('should return true when terminal has exact color level', () => {
      process.env.COLORTERM = '24bit';

      expect(supportsColorLevel(3)).toBe(true);
    });

    it('should return false when terminal has lower color level', () => {
      process.env.TERM = 'xterm';

      expect(supportsColorLevel(2)).toBe(false);
      expect(supportsColorLevel(3)).toBe(false);
    });

    it('should return false when terminal has no color', () => {
      process.env.TERM = 'dumb';

      expect(supportsColorLevel(1)).toBe(false);
      expect(supportsColorLevel(2)).toBe(false);
      expect(supportsColorLevel(3)).toBe(false);
    });

    it('should return true for level 0 even with no color support', () => {
      process.env.TERM = 'dumb';

      expect(supportsColorLevel(0)).toBe(true);
    });
  });

  describe('getCursorControls', () => {
    it('should return cursor controls', () => {
      const controls = getCursorControls();

      expect(controls).toHaveProperty('up');
      expect(controls).toHaveProperty('down');
      expect(controls).toHaveProperty('left');
      expect(controls).toHaveProperty('right');
      expect(controls).toHaveProperty('clearLine');
      expect(controls).toHaveProperty('clearScreen');
    });

    it('should return ANSI codes when TTY is available', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });

      const controls = getCursorControls();

      expect(controls.up(1)).toBe('\x1b[1A');
      expect(controls.down(2)).toBe('\x1b[2B');
      expect(controls.left(3)).toBe('\x1b[3D');
      expect(controls.right(4)).toBe('\x1b[4C');
      expect(controls.clearLine()).toBe('\x1b[2K');
      expect(controls.clearScreen()).toBe('\x1b[2J\x1b[H');
    });

    it('should return empty strings when TTY is not available', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      const controls = getCursorControls();

      expect(controls.up(1)).toBe('');
      expect(controls.down(2)).toBe('');
      expect(controls.left(3)).toBe('');
      expect(controls.right(4)).toBe('');
      expect(controls.clearLine()).toBe('');
      expect(controls.clearScreen()).toBe('');
    });
  });

  describe('colorize', () => {
    it('should return colored text when color is supported', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });
      delete process.env.FORCE_COLOR;

      const colored = colorize('test', 31);

      expect(colored).toBe('\x1b[31mtest\x1b[0m');
    });

    it('should return plain text when color is not supported', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      const colored = colorize('test', 31);

      expect(colored).toBe('test');
    });

    it('should return plain text when FORCE_COLOR is 0', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });
      process.env.FORCE_COLOR = '0';

      const colored = colorize('test', 31);

      expect(colored).toBe('test');
    });
  });

  describe('colors', () => {
    it('should have all color helper functions', () => {
      expect(colors).toHaveProperty('reset');
      expect(colors).toHaveProperty('bold');
      expect(colors).toHaveProperty('dim');
      expect(colors).toHaveProperty('red');
      expect(colors).toHaveProperty('green');
      expect(colors).toHaveProperty('yellow');
      expect(colors).toHaveProperty('blue');
      expect(colors).toHaveProperty('magenta');
      expect(colors).toHaveProperty('cyan');
      expect(colors).toHaveProperty('gray');
    });

    it('should apply correct color codes', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });

      expect(colors.red('error')).toBe('\x1b[31merror\x1b[0m');
      expect(colors.green('success')).toBe('\x1b[32msuccess\x1b[0m');
      expect(colors.yellow('warning')).toBe('\x1b[33mwarning\x1b[0m');
      expect(colors.blue('info')).toBe('\x1b[34minfo\x1b[0m');
      expect(colors.magenta('debug')).toBe('\x1b[35mdebug\x1b[0m');
      expect(colors.cyan('trace')).toBe('\x1b[36mtrace\x1b[0m');
    });

    it('should apply text formatting', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });

      expect(colors.bold('bold text')).toBe('\x1b[1mbold text\x1b[0m');
      expect(colors.dim('dim text')).toBe('\x1b[2mdim text\x1b[0m');
    });

    it('should return plain text when color is not supported', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      expect(colors.red('error')).toBe('error');
      expect(colors.green('success')).toBe('success');
      expect(colors.bold('bold')).toBe('bold');
    });
  });

  describe('TerminalCapabilities type', () => {
    it('should satisfy TerminalCapabilities interface', () => {
      const caps: TerminalCapabilities = getTerminalCapabilities();

      expect(typeof caps.isTTY).toBe('boolean');
      expect(typeof caps.supportsColor).toBe('boolean');
      expect(typeof caps.width).toBe('number');
      expect(typeof caps.height).toBe('number');
    });
  });

  describe('DetailedTerminalCapabilities type', () => {
    it('should satisfy DetailedTerminalCapabilities interface', () => {
      const caps: DetailedTerminalCapabilities = getDetailedTerminalCapabilities();

      expect(typeof caps.isTTY).toBe('boolean');
      expect(typeof caps.supportsColor).toBe('boolean');
      expect(typeof caps.width).toBe('number');
      expect(typeof caps.height).toBe('number');
      expect(typeof caps.colorLevel).toBe('number');
      expect(typeof caps.isCI).toBe('boolean');
    });

    it('should have valid color level', () => {
      const caps = getDetailedTerminalCapabilities();

      expect([0, 1, 2, 3]).toContain(caps.colorLevel);
    });
  });

  describe('brand palette', () => {
    beforeEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });
    });

    it('should emit truecolor escape for level 3 terminals', () => {
      process.env.COLORTERM = 'truecolor';
      expect(brand.cyan('x')).toBe('\x1b[38;2;28;245;245mx\x1b[0m');
      expect(brand.yellow('x')).toBe('\x1b[38;2;245;245;28mx\x1b[0m');
      expect(brand.amber('x')).toBe('\x1b[38;2;245;196;28mx\x1b[0m');
      expect(brand.red('x')).toBe('\x1b[38;2;255;80;80mx\x1b[0m');
      expect(brand.muted('x')).toBe('\x1b[38;2;107;133;144mx\x1b[0m');
    });

    it('should emit 256-color escape for level 2 terminals', () => {
      delete process.env.COLORTERM;
      process.env.TERM = 'xterm-256color';
      expect(brand.cyan('x')).toBe('\x1b[38;5;51mx\x1b[0m');
      expect(brand.yellow('x')).toBe('\x1b[38;5;226mx\x1b[0m');
      expect(brand.red('x')).toBe('\x1b[38;5;203mx\x1b[0m');
    });

    it('should emit 16-color escape for level 1 terminals', () => {
      delete process.env.COLORTERM;
      process.env.TERM = 'xterm';
      expect(brand.cyan('x')).toBe('\x1b[96mx\x1b[0m');
      expect(brand.yellow('x')).toBe('\x1b[93mx\x1b[0m');
      expect(brand.red('x')).toBe('\x1b[91mx\x1b[0m');
    });

    it('should return plain text when color is not supported', () => {
      delete process.env.COLORTERM;
      process.env.TERM = 'dumb';
      process.env.FORCE_COLOR = '0';
      expect(brand.cyan('x')).toBe('x');
      expect(brand.block('x')).toBe('x');
    });

    it('should map semantic verdict aliases to brand colors', () => {
      process.env.COLORTERM = 'truecolor';
      expect(brand.ok('PASS')).toBe(brand.cyan('PASS'));
      expect(brand.block('BLOCKED')).toBe(brand.yellow('BLOCKED'));
      expect(brand.warn('warn')).toBe(brand.amber('warn'));
      expect(brand.crit('CRITICAL')).toBe(brand.red('CRITICAL'));
    });

    it('should respect FORCE_COLOR=3 override', () => {
      process.env.TERM = 'xterm';
      process.env.FORCE_COLOR = '3';
      expect(brand.cyan('x')).toBe('\x1b[38;2;28;245;245mx\x1b[0m');
    });
  });

  describe('integration tests', () => {
    it('should handle all features together', () => {
      process.env.TERM = 'xterm-256color';
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(process.stdout, 'columns', {
        value: 100,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(process.stdout, 'rows', {
        value: 30,
        writable: true,
        configurable: true,
      });

      const basicCaps = getTerminalCapabilities();
      const detailedCaps = getDetailedTerminalCapabilities();

      expect(basicCaps.isTTY).toBe(true);
      expect(basicCaps.supportsColor).toBe(true);
      expect(basicCaps.width).toBe(100);
      expect(basicCaps.height).toBe(30);

      expect(detailedCaps.colorLevel).toBeGreaterThanOrEqual(1);
      expect(supportsColorLevel(1)).toBe(true);

      const controls = getCursorControls();
      expect(controls.up(1)).toBeTruthy();

      const colored = colors.green('test');
      expect(colored).toContain('\x1b');
    });
  });
});
