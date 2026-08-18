/**
 * GuardrailsService Tests
 * ======================
 * Unit tests for the GuardrailsService.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { GuardrailsService } from '../src/guardrails.service.js';
import { GUARDRAILS_OPTIONS } from '../src/constants.js';
import {
  PromptInjectionValidator,
  JailbreakValidator,
  SecretGuard,
  createLogger,
  type Logger,
  type Validator,
  type Guard,
  type GuardrailResult,
  Severity,
  RiskLevel
} from '@blackunicorn/bonklm';
import { noOpValidator } from '@blackunicorn/bonklm/testing';

// Mock validator for testing
class MockValidator implements Validator {
  name = 'MockValidator';

  constructor(private readonly shouldBlock: boolean = false) {}

  validate(content: string): GuardrailResult {
    if (this.shouldBlock || content.includes('block')) {
      return {
        allowed: false,
        blocked: true,
        severity: Severity.CRITICAL,
        risk_level: RiskLevel.HIGH,
        risk_score: 25,
        reason: 'Mock validation failed',
        findings: [
          {
            category: 'mock',
            severity: Severity.CRITICAL,
            description: 'Mock finding'
          }
        ],
        timestamp: Date.now()
      };
    }

    return {
      allowed: true,
      blocked: false,
      severity: Severity.INFO,
      risk_level: RiskLevel.LOW,
      risk_score: 0,
      findings: [],
      timestamp: Date.now()
    };
  }
}

// Mock guard for testing
class MockGuard implements Guard {
  name = 'MockGuard';

  validate(content: string, context?: string): GuardrailResult {
    if (context === 'block-context') {
      return {
        allowed: false,
        blocked: true,
        severity: Severity.CRITICAL,
        risk_level: RiskLevel.HIGH,
        risk_score: 30,
        reason: 'Guard blocked content',
        findings: [],
        timestamp: Date.now()
      };
    }

    return {
      allowed: true,
      blocked: false,
      severity: Severity.INFO,
      risk_level: RiskLevel.LOW,
      risk_score: 0,
      findings: [],
      timestamp: Date.now()
    };
  }
}

describe('GuardrailsService', () => {
  let service: GuardrailsService;
  let mockLogger: Logger;

  beforeEach(async () => {
    mockLogger = createLogger('console', 'info' as any);
    vi.spyOn(mockLogger, 'debug').mockImplementation(() => {});
    vi.spyOn(mockLogger, 'warn').mockImplementation(() => {});
    vi.spyOn(mockLogger, 'error').mockImplementation(() => {});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuardrailsService,
        {
          provide: GUARDRAILS_OPTIONS,
          useValue: {
            validators: [new MockValidator()],
            guards: [new MockGuard()],
            logger: mockLogger,
            productionMode: false,
            validationTimeout: 5000,
            maxContentLength: 1024 * 1024
          }
        }
      ]
    }).compile();

    service = module.get<GuardrailsService>(GuardrailsService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateInput', () => {
    it('should allow valid content', async () => {
      const results = await service.validateInput('Hello, world!');
      expect(service.isAllowed(results)).toBe(true);
    });

    it('should block malicious content', async () => {
      // Create service directly with MockValidator to bypass DI issues
      const blockingService = new GuardrailsService({
        validators: [new MockValidator()],
        guards: [new MockGuard()],
        logger: mockLogger
      });
      const results = await blockingService.validateInput('block this content');
      expect(blockingService.isAllowed(results)).toBe(false);
    });

    it('should block content exceeding max size', async () => {
      const largeService = new GuardrailsService({
        validators: [noOpValidator()],
        guards: [],
        logger: mockLogger,
        maxContentLength: 100
      });

      const largeContent = 'a'.repeat(101);
      const results = await largeService.validateInput(largeContent);
      expect(largeService.isAllowed(results)).toBe(false);
      expect(results[0].reason).toBe('Content too large');
    });
  });

  describe('validateOutput', () => {
    it('should allow valid output', async () => {
      const results = await service.validateOutput('Safe response text');
      expect(service.isAllowed(results)).toBe(true);
    });

    it('should block malicious output', async () => {
      // Create service directly with MockValidator to bypass DI issues
      const blockingService = new GuardrailsService({
        validators: [new MockValidator()],
        guards: [new MockGuard()],
        logger: mockLogger
      });
      const results = await blockingService.validateOutput('block this output');
      expect(blockingService.isAllowed(results)).toBe(false);
    });
  });

  describe('isAllowed', () => {
    it('should return true when all results are allowed', () => {
      const results: GuardrailResult[] = [
        {
          allowed: true,
          blocked: false,
          severity: Severity.INFO,
          risk_level: RiskLevel.LOW,
          risk_score: 0,
          findings: [],
          timestamp: Date.now()
        },
        {
          allowed: true,
          blocked: false,
          severity: Severity.INFO,
          risk_level: RiskLevel.LOW,
          risk_score: 0,
          findings: [],
          timestamp: Date.now()
        }
      ];

      expect(service.isAllowed(results)).toBe(true);
    });

    it('should return false when any result is blocked', () => {
      const results: GuardrailResult[] = [
        {
          allowed: true,
          blocked: false,
          severity: Severity.INFO,
          risk_level: RiskLevel.LOW,
          risk_score: 0,
          findings: [],
          timestamp: Date.now()
        },
        {
          allowed: false,
          blocked: true,
          severity: Severity.HIGH,
          risk_level: RiskLevel.HIGH,
          risk_score: 25,
          reason: 'Blocked',
          findings: [],
          timestamp: Date.now()
        }
      ];

      expect(service.isAllowed(results)).toBe(false);
    });
  });

  describe('getBlockedResult', () => {
    it('should return the first blocked result', () => {
      const results: GuardrailResult[] = [
        {
          allowed: true,
          blocked: false,
          severity: Severity.INFO,
          risk_level: RiskLevel.LOW,
          risk_score: 0,
          findings: [],
          timestamp: Date.now()
        },
        {
          allowed: false,
          blocked: true,
          severity: Severity.HIGH,
          risk_level: RiskLevel.HIGH,
          risk_score: 25,
          reason: 'First blocked',
          findings: [],
          timestamp: Date.now()
        },
        {
          allowed: false,
          blocked: true,
          severity: Severity.MEDIUM,
          risk_level: RiskLevel.MEDIUM,
          risk_score: 15,
          reason: 'Second blocked',
          findings: [],
          timestamp: Date.now()
        }
      ];

      const blocked = service.getBlockedResult(results);
      expect(blocked).toBeDefined();
      expect(blocked?.reason).toBe('First blocked');
    });

    it('should return undefined when no results are blocked', () => {
      const results: GuardrailResult[] = [
        {
          allowed: true,
          blocked: false,
          severity: Severity.INFO,
          risk_level: RiskLevel.LOW,
          risk_score: 0,
          findings: [],
          timestamp: Date.now()
        }
      ];

      const blocked = service.getBlockedResult(results);
      expect(blocked).toBeUndefined();
    });
  });

  describe('getErrorMessage', () => {
    it('should return generic message in production mode', () => {
      const prodService = new GuardrailsService({
        validators: [noOpValidator()],
        guards: [],
        logger: mockLogger,
        productionMode: true
      });

      const result: GuardrailResult = {
        allowed: false,
        blocked: true,
        severity: Severity.HIGH,
        risk_level: RiskLevel.HIGH,
        risk_score: 25,
        reason: 'Detailed security reason',
        findings: [],
        timestamp: Date.now()
      };

      const message = prodService.getErrorMessage(result);
      expect(message).toBe('Content blocked by security policy');
    });

    it('should return detailed message in development mode', () => {
      const devService = new GuardrailsService({
        validators: [noOpValidator()],
        guards: [],
        logger: mockLogger,
        productionMode: false
      });

      const result: GuardrailResult = {
        allowed: false,
        blocked: true,
        severity: Severity.HIGH,
        risk_level: RiskLevel.HIGH,
        risk_score: 25,
        reason: 'Detailed security reason',
        findings: [],
        timestamp: Date.now()
      };

      const message = devService.getErrorMessage(result);
      expect(message).toBe('Detailed security reason');
    });
  });

  describe('getEngine', () => {
    it('should return the GuardrailEngine instance', () => {
      const engine = service.getEngine();
      expect(engine).toBeDefined();
      expect(engine.getStats()).toBeDefined();
    });
  });
});
