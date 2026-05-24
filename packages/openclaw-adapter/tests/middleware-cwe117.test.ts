/**
 * Sprint 40 connector CWE-117 sweep — openclaw-adapter regression.
 *
 * Per Sprint 39 security audit HIGH #3: openclaw-adapter logged
 * `messageId` / `sessionId` / `channel` / `toolName` / `blocked_by`
 * directly in structured-logger meta with no sanitization wrapper.
 * `channel` in particular is attacker-controlled via the incoming
 * OpenClaw message context. Sprint 40 wraps each meta-string with
 * `sanitizeLogString` from the canonical core primitive.
 *
 * This file locks the wrap so a regression (e.g. someone removing
 * a `sanitizeLogString(...)` call thinking it is redundant) fails
 * the build.
 */
import { describe, expect, it, vi } from 'vitest';

import { OpenClawGuardrailsMiddleware } from '../src/middleware.js';

function makeSpyLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('OpenClawGuardrailsMiddleware — Sprint 40 CWE-117 sanitization', () => {
  it('sanitizes messageId / sessionId / channel in validateMessage meta', async () => {
    const logger = makeSpyLogger();
    const mw = new OpenClawGuardrailsMiddleware({ logger, logResults: false });
    await mw.validateMessage({
      messageId: 'msg\nINJECTED:fake_severity',
      sessionId: 'sess\tinjected\ttabs',
      channel: 'chan\x00null',
      content: 'hello world',
    });

    expect(logger.info).toHaveBeenCalled();
    const [, meta] = logger.info.mock.calls[0]!;
    expect(meta.messageId).toBe('msg\\nINJECTED:fake_severity');
    expect(meta.sessionId).toBe('sess\\x09injected\\x09tabs');
    expect(meta.channel).toBe('chan\\x00null');
  });

  it('sanitizes toolName / sessionId in validateTool meta', async () => {
    const logger = makeSpyLogger();
    const mw = new OpenClawGuardrailsMiddleware({ logger, logResults: false });
    await mw.validateTool({
      toolName: 'tool\nNEWLINE',
      sessionId: 'sess\rCR',
      toolInput: { content: 'safe' },
    });

    expect(logger.info).toHaveBeenCalled();
    const [, meta] = logger.info.mock.calls[0]!;
    expect(meta.toolName).toBe('tool\\nNEWLINE');
    // \r is in the strip range (0x0d) so sanitizeLogString hex-escapes
    // it on the first pass — not via the newline-marker pass.
    expect(meta.sessionId).toBe('sess\\x0dCR');
  });
});
