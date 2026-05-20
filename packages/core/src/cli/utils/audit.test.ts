/**
 * Unit tests for AuditLogger
 *
 * Tests the tamper-evident audit logging system with:
 * - Event logging with HMAC signing
 * - Reading with limit and signature verification
 * - Directory creation with secure permissions
 * - Credential detection and rejection
 * - Tamper detection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditLogger, createAuditEvent, type AuditAction } from './audit.js';
import { WizardError } from './error.js';

// Mock fs/promises functions
const mocks = {
  appendFile: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
  chmod: vi.fn(),
  stat: vi.fn(),
  open: vi.fn(),
};

vi.mock('fs/promises', () => ({
  appendFile: (...args: unknown[]) => mocks.appendFile(...args),
  readFile: (...args: unknown[]) => mocks.readFile(...args),
  mkdir: (...args: unknown[]) => mocks.mkdir(...args),
  chmod: (...args: unknown[]) => mocks.chmod(...args),
  stat: (...args: unknown[]) => mocks.stat(...args),
  open: (...args: unknown[]) => mocks.open(...args),
}));

// Mock existsSync
const existsSyncMock = vi.fn();
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
}));

// Mock crypto for deterministic HMAC signatures
const hmacMock = {
  update: vi.fn(function(this: any) { return this; }),
  digest: vi.fn(() => 'valid-signature-123'),
};

const createHmacMock = vi.fn(() => hmacMock);
// `randomBytes` is called at MODULE-INIT time inside `audit.ts` to generate a
// dev-only HMAC key when LLM_GUARDRAILS_AUDIT_KEY is unset. Since vi.mock is
// hoisted above all top-level statements, the mock factory runs before any
// regular const declaration. vi.hoisted ensures `randomBytesMock` is defined
// when the mock factory references it. `createHmac` doesn't need this because
// it's only invoked from method bodies, after beforeEach() has run.
const { randomBytesMock } = vi.hoisted(() => ({
  randomBytesMock: () => Buffer.from('deadbeefdeadbeefdeadbeefdeadbeef', 'hex'),
}));
vi.mock('node:crypto', () => ({
  createHmac: (...args: unknown[]) => createHmacMock(...args),
  randomBytes: (...args: unknown[]) => randomBytesMock(),
}));

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock behaviors
    existsSyncMock.mockReturnValue(false);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.appendFile.mockResolvedValue(undefined);
    mocks.chmod.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue('');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default paths when none provided', () => {
      auditLogger = new AuditLogger();

      expect(auditLogger.getLogPath()).toBe('.bonklm/audit.log');
      expect(auditLogger.getAuditDir()).toBe('.bonklm');
    });

    it('should use custom paths when provided', () => {
      auditLogger = new AuditLogger('/custom/audit', 'custom.log');

      expect(auditLogger.getLogPath()).toBe('/custom/audit/custom.log');
      expect(auditLogger.getAuditDir()).toBe('/custom/audit');
    });
  });

  describe('log()', () => {
    it('should add timestamp to event', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      mocks.appendFile.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      const event = {
        action: 'connector_added' as AuditAction,
        connector_id: 'openai',
        success: true,
      };

      await auditLogger.log(event);

      const writeCall = mocks.appendFile.mock.calls[0];
      const writtenContent = writeCall[1] as string;
      const parsed = JSON.parse(writtenContent);

      expect(parsed.event).toHaveProperty('timestamp');
      expect(parsed.event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should use provided timestamp if present', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      mocks.appendFile.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      const fixedTimestamp = '2026-02-18T12:00:00.000Z';
      const event = {
        timestamp: fixedTimestamp,
        action: 'connector_added' as AuditAction,
        success: true,
      };

      await auditLogger.log(event);

      const writeCall = mocks.appendFile.mock.calls[0];
      const writtenContent = writeCall[1] as string;
      const parsed = JSON.parse(writtenContent);

      expect(parsed.event.timestamp).toBe(fixedTimestamp);
    });

    it('should create directory with secure permissions if missing', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      mocks.appendFile.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await auditLogger.log({
        action: 'connector_added' as AuditAction,
        success: true,
      });

      expect(mocks.mkdir).toHaveBeenCalledWith(
        '.bonklm',
        { recursive: true, mode: 0o700 }
      );
    });

    it('should create directory if existsSync returns false', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      mocks.appendFile.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await auditLogger.log({
        action: 'connector_added' as AuditAction,
        success: true,
      });

      expect(mocks.mkdir).toHaveBeenCalled();
    });

    it('should not create directory if it exists', async () => {
      existsSyncMock.mockReturnValue(true);
      mocks.stat.mockResolvedValue({ mode: 0o700 });
      mocks.appendFile.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await auditLogger.log({
        action: 'connector_added' as AuditAction,
        success: true,
      });

      expect(mocks.mkdir).not.toHaveBeenCalled();
    });

    it('should write event with HMAC signature', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      mocks.appendFile.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await auditLogger.log({
        action: 'connector_added' as AuditAction,
        connector_id: 'openai',
        success: true,
      });

      const writeCall = mocks.appendFile.mock.calls[0];
      const writtenContent = writeCall[1] as string;
      const parsed = JSON.parse(writtenContent);

      expect(parsed).toHaveProperty('event');
      expect(parsed).toHaveProperty('signature');
      expect(typeof parsed.signature).toBe('string');
      expect(parsed.signature.length).toBeGreaterThan(0);
    });

    it('should write in JSONL format (newline terminated)', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      mocks.appendFile.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await auditLogger.log({
        action: 'connector_added' as AuditAction,
        success: true,
      });

      const writeCall = mocks.appendFile.mock.calls[0];
      const writtenContent = writeCall[1] as string;

      // Check that content ends with newline
      expect(writtenContent[writtenContent.length - 1]).toBe('\n');
    });

    it('should throw WizardError if credential detected in event', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await expect(
        auditLogger.log({
          action: 'credential_validated' as AuditAction,
          success: true,
          metadata: { api_key: 'sk-1234567890abcdef' },
        })
      ).rejects.toThrow(WizardError);

      try {
        await auditLogger.log({
          action: 'credential_validated' as AuditAction,
          success: true,
          metadata: { api_key: 'sk-1234567890abcdef' },
        });
      } catch (error) {
        expect(error).toBeInstanceOf(WizardError);
        if (error instanceof WizardError) {
          expect(error.code).toBe('CREDENTIAL_IN_AUDIT');
        }
      }
    });

    it('should throw WizardError for Bearer tokens in event', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await expect(
        auditLogger.log({
          action: 'connector_tested' as AuditAction,
          success: true,
          metadata: { token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' },
        })
      ).rejects.toThrow(WizardError);
    });

    it('should allow connector_id without credential', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      mocks.appendFile.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await expect(
        auditLogger.log({
          action: 'connector_added' as AuditAction,
          connector_id: 'openai',
          success: true,
        })
      ).resolves.not.toThrow();
    });

    it('should set secure file mode on write', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      mocks.appendFile.mockResolvedValue(undefined);
      mocks.chmod.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await auditLogger.log({
        action: 'connector_added' as AuditAction,
        success: true,
      });

      expect(mocks.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { mode: 0o600 }
      );
    });

    it('should chmod file after write to ensure permissions', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      mocks.appendFile.mockResolvedValue(undefined);
      mocks.chmod.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await auditLogger.log({
        action: 'connector_added' as AuditAction,
        success: true,
      });

      expect(mocks.chmod).toHaveBeenCalledWith('.bonklm/audit.log', 0o600);
    });
  });

  describe('read()', () => {
    it('should return empty array when log file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);
      auditLogger = new AuditLogger();

      const result = await auditLogger.read();

      expect(result).toEqual([]);
      expect(mocks.readFile).not.toHaveBeenCalled();
    });

    it('should return empty array when log file is empty', async () => {
      existsSyncMock.mockReturnValue(true);
      mocks.readFile.mockResolvedValue('');
      auditLogger = new AuditLogger();

      const result = await auditLogger.read();

      expect(result).toEqual([]);
    });

    it('should parse and return audit events', async () => {
      existsSyncMock.mockReturnValue(true);
      const mockEvent = {
        timestamp: '2026-02-18T12:00:00.000Z',
        action: 'connector_added' as AuditAction,
        connector_id: 'openai',
        success: true,
      };
      const mockEntry = {
        event: mockEvent,
        signature: 'valid-signature-123', // Match the mocked HMAC digest
      };
      mocks.readFile.mockResolvedValue(JSON.stringify(mockEntry) + '\n');
      auditLogger = new AuditLogger();

      const result = await auditLogger.read();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockEvent);
    });

    it('should return most recent events first', async () => {
      existsSyncMock.mockReturnValue(true);
      const event1 = {
        timestamp: '2026-02-18T12:00:00.000Z',
        action: 'connector_added' as AuditAction,
        success: true,
      };
      const event2 = {
        timestamp: '2026-02-18T12:01:00.000Z',
        action: 'connector_tested' as AuditAction,
        success: true,
      };
      // Use the mocked signature value
      const entry1 = { event: event1, signature: 'valid-signature-123' };
      const entry2 = { event: event2, signature: 'valid-signature-123' };

      mocks.readFile.mockResolvedValue(
        JSON.stringify(entry1) + '\n' + JSON.stringify(entry2) + '\n'
      );
      auditLogger = new AuditLogger();

      const result = await auditLogger.read();

      expect(result).toHaveLength(2);
      expect(result[0].action).toBe('connector_tested'); // Most recent
      expect(result[1].action).toBe('connector_added');
    });

    it('should respect limit parameter', async () => {
      existsSyncMock.mockReturnValue(true);
      const events = Array.from({ length: 10 }, (_, i) => ({
        timestamp: `2026-02-18T12:0${i}:00.000Z`,
        action: 'connector_added' as AuditAction,
        success: true,
      }));
      const lines = events.map((e) => JSON.stringify({ event: e, signature: 'valid-signature-123' }) + '\n');
      mocks.readFile.mockResolvedValue(lines.join(''));
      auditLogger = new AuditLogger();

      const result = await auditLogger.read(5);

      expect(result).toHaveLength(5);
    });

    it('should use default limit of 100', async () => {
      existsSyncMock.mockReturnValue(true);
      mocks.readFile.mockResolvedValue('');
      auditLogger = new AuditLogger();

      await auditLogger.read();

      // Should not throw - using default limit
      expect(mocks.readFile).toHaveBeenCalled();
    });

    it('should skip empty lines', async () => {
      existsSyncMock.mockReturnValue(true);
      const event = {
        timestamp: '2026-02-18T12:00:00.000Z',
        action: 'connector_added' as AuditAction,
        success: true,
      };
      mocks.readFile.mockResolvedValue(
        '\n\n' + JSON.stringify({ event, signature: 'valid-signature-123' }) + '\n\n'
      );
      auditLogger = new AuditLogger();

      const result = await auditLogger.read();

      expect(result).toHaveLength(1);
    });

    it('should exclude tampered entries from results', async () => {
      existsSyncMock.mockReturnValue(true);
      const validEvent = {
        timestamp: '2026-02-18T12:00:00.000Z',
        action: 'connector_added' as AuditAction,
        success: true,
      };
      const tamperedEvent = {
        timestamp: '2026-02-18T12:01:00.000Z',
        action: 'connector_tested' as AuditAction,
        success: true,
      };
      // Mix of valid and tampered entries
      mocks.readFile.mockResolvedValue(
        JSON.stringify({ event: validEvent, signature: 'valid-signature-123' }) + '\n' +
        JSON.stringify({ event: tamperedEvent, signature: 'wrong-signature' }) + '\n'
      );
      auditLogger = new AuditLogger();

      const result = await auditLogger.read();

      // Only the valid entry should be returned
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('connector_added');
    });
  });

  describe('directory handling', () => {
    it('should fix permissions if directory exists but has wrong permissions', async () => {
      existsSyncMock.mockReturnValue(true);
      mocks.stat.mockResolvedValue({ mode: 0o755 }); // Too permissive
      mocks.appendFile.mockResolvedValue(undefined);
      mocks.chmod.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await auditLogger.log({
        action: 'connector_added' as AuditAction,
        success: true,
      });

      expect(mocks.chmod).toHaveBeenCalledWith('.bonklm', 0o700);
    });

    it('should not chmod if directory has correct permissions', async () => {
      existsSyncMock.mockReturnValue(true);
      mocks.stat.mockResolvedValue({ mode: 0o700 });
      mocks.appendFile.mockResolvedValue(undefined);
      mocks.chmod.mockResolvedValue(undefined);
      auditLogger = new AuditLogger();

      await auditLogger.log({
        action: 'connector_added' as AuditAction,
        success: true,
      });

      // Should not chmod the directory (only the file)
      expect(mocks.chmod).toHaveBeenCalledTimes(1);
      expect(mocks.chmod).toHaveBeenCalledWith('.bonklm/audit.log', 0o600);
    });
  });

  describe('error handling', () => {
    it('should throw WizardError on mkdir failure', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockRejectedValue(new Error('Permission denied'));
      auditLogger = new AuditLogger();

      await expect(
        auditLogger.log({
          action: 'connector_added' as AuditAction,
          success: true,
        })
      ).rejects.toThrow(WizardError);
    });

    it('should throw WizardError on appendFile failure', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      mocks.appendFile.mockRejectedValue(new Error('Disk full'));
      auditLogger = new AuditLogger();

      await expect(
        auditLogger.log({
          action: 'connector_added' as AuditAction,
          success: true,
        })
      ).rejects.toThrow(WizardError);
    });

    it('should throw WizardError with AUDIT_WRITE_FAILED code', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdir.mockResolvedValue(undefined);
      mocks.appendFile.mockRejectedValue(new Error('Write failed'));
      auditLogger = new AuditLogger();

      try {
        await auditLogger.log({
          action: 'connector_added' as AuditAction,
          success: true,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(WizardError);
        if (error instanceof WizardError) {
          expect(error.code).toBe('AUDIT_WRITE_FAILED');
        }
      }
    });

    it('should throw WizardError on readFile failure', async () => {
      existsSyncMock.mockReturnValue(true);
      mocks.readFile.mockRejectedValue(new Error('Read error'));
      auditLogger = new AuditLogger();

      await expect(auditLogger.read()).rejects.toThrow(WizardError);
    });
  });
});

describe('createAuditEvent', () => {
  it('should create standard audit event', () => {
    const event = createAuditEvent('connector_added', 'openai', true);

    expect(event.action).toBe('connector_added');
    expect(event.connector_id).toBe('openai');
    expect(event.success).toBe(true);
    expect(event.timestamp).toBeDefined();
  });

  it('should include error code when provided', () => {
    const event = createAuditEvent('connector_tested', 'anthropic', false, 'CONN_ERROR');

    expect(event.error_code).toBe('CONN_ERROR');
  });

  it('should not include connector_id when undefined', () => {
    const event = createAuditEvent('wizard_started', undefined, true);

    expect(event.connector_id).toBeUndefined();
  });

  it('should not include error_code when undefined', () => {
    const event = createAuditEvent('env_written', undefined, true);

    expect(event.error_code).toBeUndefined();
  });
});
