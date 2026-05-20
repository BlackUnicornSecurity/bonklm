/**
 * Generic Logger Interface
 * ========================
 * Pluggable logging abstraction for BonkLM.
 * Supports console, pino, winston, or custom loggers.
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

/**
 * Console-based logger implementation (default)
 */
export class ConsoleLogger implements Logger {
  private readonly level: LogLevel;
  private readonly levelPriority: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3,
  };

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.level];
  }

  private formatMessage(message: string, context?: LogContext): string {
    if (!context || Object.keys(context).length === 0) {
      return message;
    }
    const contextStr = Object.entries(context)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');
    return `${message} ${contextStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(`[DEBUG] ${this.formatMessage(message, context)}`);
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(`[INFO] ${this.formatMessage(message, context)}`);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(`[WARN] ${this.formatMessage(message, context)}`);
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(`[ERROR] ${this.formatMessage(message, context)}`);
    }
  }
}

/**
 * Null logger for disabling output
 */
export class NullLogger implements Logger {
   
  debug(_message: string, _context?: LogContext): void {}
   
  info(_message: string, _context?: LogContext): void {}
   
  warn(_message: string, _context?: LogContext): void {}
   
  error(_message: string, _context?: LogContext): void {}
}

/**
 * Create a logger instance based on configuration
 */
export function createLogger(
  type: 'console' | 'null' | 'custom' = 'console',
  level: LogLevel = LogLevel.INFO,
  customLogger?: Logger
): Logger {
  switch (type) {
    case 'console':
      return new ConsoleLogger(level);
    case 'null':
      return new NullLogger();
    case 'custom':
      return customLogger ?? new ConsoleLogger(level);
    default:
      return new ConsoleLogger(level);
  }
}
