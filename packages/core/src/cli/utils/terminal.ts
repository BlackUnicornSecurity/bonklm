/**
 * Terminal capability detection for the BonkLM Installation Wizard
 *
 * This module provides utilities to detect terminal capabilities such as:
 * - TTY availability (interactive terminal)
 * - Color support
 * - Terminal width
 *
 * These capabilities are used to adapt the UI for different environments.
 */

/**
 * Terminal capabilities interface
 *
 * Describes the detected capabilities of the current terminal.
 */
export interface TerminalCapabilities {
  /** True if running in an interactive terminal (TTY) */
  isTTY: boolean;
  /** True if the terminal supports ANSI color codes */
  supportsColor: boolean;
  /** Terminal width in columns (default 80 if not detectable) */
  width: number;
  /** Terminal height in rows (default 24 if not detectable) */
  height: number;
}

/**
 * Color level for more granular color support detection
 */
export type ColorLevel = 0 | 1 | 2 | 3;

/**
 * Detailed terminal information with color level
 */
export interface DetailedTerminalCapabilities extends TerminalCapabilities {
  /** Color support level (0=none, 1=16, 2=256, 3=16m) */
  colorLevel: ColorLevel;
  /** True if running in a CI environment */
  isCI: boolean;
}

/**
 * Detects if running in a CI environment
 *
 * Checks common CI environment variables.
 */
function detectCI(): boolean {
  const ciVars = [
    'CI',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'JENKINS_URL',
    'TRAVIS',
    'CIRCLECI',
    'APPVEYOR',
    'BUILDKITE',
    'GO_PIPELINE_LABEL'
  ];

  return ciVars.some(varName => process.env[varName] !== undefined);
}

/**
 * Detects the color support level
 *
 * Based on the COLORTERM environment variable and common terminal detection.
 */
function detectColorLevel(): ColorLevel {
  const { env } = process;

  // Explicit check for truecolor/24-bit support
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') {
    return 3;
  }

  // Check TERM variable
  const term = env.TERM || '';

  // 256-color terminals
  if (
    term.includes('256color') ||
    term === 'xterm-256color' ||
    term === 'screen-256color' ||
    term === 'tmux-256color'
  ) {
    return 2;
  }

  // Basic color support (16 colors)
  if (
    term.includes('color') ||
    term === 'xterm' ||
    term === 'screen' ||
    term === 'tmux' ||
    env.TERM_PROGRAM === 'Apple_Terminal' ||
    env.TERM_PROGRAM === 'iTerm.app'
  ) {
    return 1;
  }

  // No color support
  return 0;
}

/**
 * Gets basic terminal capabilities
 *
 * Detects TTY, color support, and dimensions for the current terminal.
 *
 * @returns Terminal capabilities object
 */
export function getTerminalCapabilities(): TerminalCapabilities {
  return {
    isTTY: Boolean(process.stdout.isTTY),
    supportsColor: process.env.FORCE_COLOR !== '0' && Boolean(process.stdout.isTTY),
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24
  };
}

/**
 * Gets detailed terminal capabilities
 *
 * Provides more detailed information including color level and CI detection.
 *
 * @returns Detailed terminal capabilities object
 */
export function getDetailedTerminalCapabilities(): DetailedTerminalCapabilities {
  const isCI = detectCI();
  const colorLevel = detectColorLevel();

  // In CI, disable TTY detection (most CI environments fake TTY)
  const isTTY = isCI ? false : Boolean(process.stdout.isTTY);

  // FORCE_COLOR can override color level detection
  const forceColor = process.env.FORCE_COLOR;
  let effectiveColorLevel = colorLevel;

  if (forceColor !== undefined) {
    if (forceColor === '0') {
      effectiveColorLevel = 0;
    } else if (forceColor === '1') {
      effectiveColorLevel = 1;
    } else if (forceColor === '2') {
      effectiveColorLevel = 2;
    } else if (forceColor === '3' || forceColor === 'true') {
      effectiveColorLevel = 3;
    }
  }

  return {
    isTTY,
    supportsColor: effectiveColorLevel > 0,
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
    colorLevel: effectiveColorLevel,
    isCI
  };
}

/**
 * Checks if the terminal supports a specific color level
 *
 * @param level - Minimum color level required
 * @returns True if terminal supports at least the specified color level
 */
export function supportsColorLevel(level: ColorLevel): boolean {
  const caps = getDetailedTerminalCapabilities();
  return caps.colorLevel >= level;
}

/**
 * Gets the appropriate cursor control codes for the terminal
 *
 * Returns ANSI escape sequences for cursor movement if supported.
 *
 * @returns Object with cursor control functions or no-ops if not supported
 */
export function getCursorControls(): {
  up: (lines: number) => string;
  down: (lines: number) => string;
  left: (cols: number) => string;
  right: (cols: number) => string;
  clearLine: () => string;
  clearScreen: () => string;
} {
  const caps = getTerminalCapabilities();

  if (!caps.isTTY) {
    // Return no-op functions for non-TTY environments
    return {
      up: () => '',
      down: () => '',
      left: () => '',
      right: () => '',
      clearLine: () => '',
      clearScreen: () => ''
    };
  }

  return {
    up: (lines: number) => `\x1b[${lines}A`,
    down: (lines: number) => `\x1b[${lines}B`,
    left: (cols: number) => `\x1b[${cols}D`,
    right: (cols: number) => `\x1b[${cols}C`,
    clearLine: () => '\x1b[2K',
    clearScreen: () => '\x1b[2J\x1b[H'
  };
}

/**
 * Formats text with color if supported
 *
 * @param text - Text to color
 * @param color - ANSI color code (e.g., 31 for red, 32 for green)
 * @returns Text with color codes or plain text if not supported
 */
export function colorize(text: string, color: number): string {
  const caps = getTerminalCapabilities();

  if (!caps.supportsColor) {
    return text;
  }

  return `\x1b[${color}m${text}\x1b[0m`;
}

/**
 * Color helper functions
 */
export const colors = {
  reset: (text: string) => colorize(text, 0),
  bold: (text: string) => colorize(text, 1),
  dim: (text: string) => colorize(text, 2),
  red: (text: string) => colorize(text, 31),
  green: (text: string) => colorize(text, 32),
  yellow: (text: string) => colorize(text, 33),
  blue: (text: string) => colorize(text, 34),
  magenta: (text: string) => colorize(text, 35),
  cyan: (text: string) => colorize(text, 36),
  gray: (text: string) => colorize(text, 90)
} as const;

/**
 * BonkLM brand palette for CLI output.
 *
 * Source of truth: the `ansi` block of the canonical design-system
 * `tokens.json`, whose rule is "hex values map to nearest 256-color slot at
 * terminal-render time". Truecolor (level 3) carries the locked brand hexes
 * verbatim; the 256-color (level 2) and 16-color (level 1) fallbacks are each
 * the nearest xterm cube slot / nearest ANSI-16 code for that hex. The
 * nearest-cube method is pinned by the cyan/yellow/red assertions in
 * `terminal.test.ts`.
 *
 * Brand hexes: cyan #1cf5f5 (28,245,245), yellow #f5f51c (245,245,28),
 * amber #f5c41c (245,196,28), red #ff5050 (255,80,80), muted #6b8590
 * (107,133,144).
 */
interface BrandColorCodes {
  /** 24-bit truecolor SGR parameters (color level 3) */
  truecolor: string;
  /** 256-color SGR parameters (color level 2) */
  ansi256: string;
  /** 16-color SGR parameters (color level 1) */
  ansi16: string;
}

/**
 * Renders text with the level-appropriate brand escape, or plain text when the
 * terminal has no color support (level 0). Keys off the FORCE_COLOR-aware
 * effective color level from {@link getDetailedTerminalCapabilities}.
 */
function brandColorize(text: string, codes: BrandColorCodes): string {
  const { colorLevel } = getDetailedTerminalCapabilities();

  switch (colorLevel) {
    case 3:
      return `\x1b[${codes.truecolor}m${text}\x1b[0m`;
    case 2:
      return `\x1b[${codes.ansi256}m${text}\x1b[0m`;
    case 1:
      return `\x1b[${codes.ansi16}m${text}\x1b[0m`;
    default:
      return text;
  }
}

const BRAND_CYAN: BrandColorCodes = { truecolor: '38;2;28;245;245', ansi256: '38;5;51', ansi16: '96' };
const BRAND_YELLOW: BrandColorCodes = { truecolor: '38;2;245;245;28', ansi256: '38;5;226', ansi16: '93' };
const BRAND_AMBER: BrandColorCodes = { truecolor: '38;2;245;196;28', ansi256: '38;5;220', ansi16: '33' };
const BRAND_RED: BrandColorCodes = { truecolor: '38;2;255;80;80', ansi256: '38;5;203', ansi16: '91' };
const BRAND_MUTED: BrandColorCodes = { truecolor: '38;2;107;133;144', ansi256: '38;5;66', ansi16: '90' };

/**
 * BonkLM brand-colored text helpers + semantic verdict aliases.
 *
 * - `cyan` / `yellow` / `amber` / `red` / `muted` — direct palette colors.
 * - `ok` → cyan, `block` → yellow, `warn` → amber, `crit` → red — semantic
 *   aliases for guardrail verdict rendering.
 */
export const brand = {
  cyan: (text: string) => brandColorize(text, BRAND_CYAN),
  yellow: (text: string) => brandColorize(text, BRAND_YELLOW),
  amber: (text: string) => brandColorize(text, BRAND_AMBER),
  red: (text: string) => brandColorize(text, BRAND_RED),
  muted: (text: string) => brandColorize(text, BRAND_MUTED),
  ok: (text: string) => brandColorize(text, BRAND_CYAN),
  block: (text: string) => brandColorize(text, BRAND_YELLOW),
  warn: (text: string) => brandColorize(text, BRAND_AMBER),
  crit: (text: string) => brandColorize(text, BRAND_RED)
} as const;
