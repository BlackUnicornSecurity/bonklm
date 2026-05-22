/**
 * Story 2.4 — wrapEko tests
 * =========================
 *
 * AC coverage:
 *   - Reuses browser-agents-core event union (act/extract/observe/file/mcp.tool).
 *   - Wraps Eko's LLM client + `BrowserAgent` / `FileAgent` tool execution.
 *   - Peer `@eko-ai/eko ^4.1.0` (structural typing — peer not installed at test time).
 *   - MCP tool results flow through RetrievedDocValidator (post-call extract).
 *   - Multi-agent planner output validated at task-creation boundary (eko.run).
 *
 * Story 2.3 audit closures applied transitively:
 *   - CUA refused by default; opt-in regex matches synonyms.
 *   - Shared error base class (BrowserAgentGuardrailBlockedError).
 *   - Reason sanitization at construction.
 *   - console.warn fallback when no logger.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  GuardrailEngine,
  Severity,
  RiskLevel,
} from '@blackunicorn/bonklm';
import type { GuardrailResult, Validator } from '@blackunicorn/bonklm';
import { BrowserAgentGuardrailBlockedError } from '@blackunicorn/bonklm-browser-agents-core';
import {
  wrapEko,
  wrapEkoBrowserAgent,
  wrapEkoFileAgent,
  EkoGuardrailBlockedError,
} from '../src/index.js';
import type {
  EkoBrowserAgentLike,
  EkoFileAgentLike,
  EkoLike,
  EkoMcpClientLike,
} from '../src/types.js';

const okResult = (note: string): GuardrailResult => ({
  allowed: true,
  blocked: false,
  reason: note,
  severity: Severity.INFO,
  risk_level: RiskLevel.LOW,
  risk_score: 0,
  findings: [],
  timestamp: Date.now(),
});

const blockResult = (note: string): GuardrailResult => ({
  allowed: false,
  blocked: true,
  reason: note,
  severity: Severity.BLOCKED,
  risk_level: RiskLevel.HIGH,
  risk_score: 0.95,
  findings: [],
  timestamp: Date.now(),
});

function makeValidator(name: string, fn: () => GuardrailResult): Validator {
  return { name, validate: fn };
}

function makeMockEko(): EkoLike & {
  run: ReturnType<typeof vi.fn>;
  agents: {
    browser: EkoBrowserAgentLike & {
      act: ReturnType<typeof vi.fn>;
      extract: ReturnType<typeof vi.fn>;
      observe: ReturnType<typeof vi.fn>;
    };
    file: EkoFileAgentLike & {
      read: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };
  mcp: EkoMcpClientLike & { callTool: ReturnType<typeof vi.fn> };
} {
  return {
    run: vi.fn().mockResolvedValue({ done: true }),
    agents: {
      browser: {
        act: vi.fn().mockResolvedValue({ ok: true }),
        extract: vi.fn().mockResolvedValue({ title: 'page' }),
        observe: vi.fn().mockResolvedValue([{ element: '#submit' }]),
      },
      file: {
        read: vi.fn().mockResolvedValue('file-content'),
        write: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    },
    mcp: {
      callTool: vi.fn().mockResolvedValue({ result: 'tool-output' }),
    },
  };
}

describe('Story 2.4 — wrapEko', () => {
  describe('Construction', () => {
    it('throws when client is null', () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      // @ts-expect-error — invalid input under test.
      expect(() => wrapEko(null, engine)).toThrow(/non-null object/);
    });

    it('throws when engine is missing', () => {
      // @ts-expect-error — invalid input under test.
      expect(() => wrapEko(makeMockEko(), undefined)).toThrow(/GuardrailEngine/);
    });
  });

  describe('CUA-mode refusal (audit closure parity with wrapStagehand)', () => {
    it('refuses construction when ekoConfig.mode === "cua"', () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      expect(() =>
        wrapEko(makeMockEko(), engine, { ekoConfig: { mode: 'cua' } })
      ).toThrow(/refused by default/);
    });

    it('matches computer-use synonym', () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      expect(() =>
        wrapEko(makeMockEko(), engine, { ekoConfig: { mode: 'computer-use' } })
      ).toThrow(/refused by default/);
    });

    it('reads mode from client.mode (fail-closed)', () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      const client = makeMockEko();
      (client as unknown as { mode: string }).mode = 'computer_use';
      expect(() => wrapEko(client, engine)).toThrow(/refused by default/);
    });

    it('accepts CUA opt-in', () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      const warn = vi.fn();
      expect(() =>
        wrapEko(makeMockEko(), engine, {
          ekoConfig: { mode: 'cua' },
          allowCuaMode: true,
          logger: { warn },
        })
      ).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/CUA mode opted in/));
    });
  });

  describe('eko.run — composed_context at task-creation (AC: planner output validated)', () => {
    it('validates the task as composed_context BEFORE dispatch', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
      const client = makeMockEko();
      const originalRun = client.run;
      const guarded = wrapEko(client, engine);
      await guarded.run({ task: 'Book a flight to NYC' });
      expect(validate).toHaveBeenCalledWith({
        kind: 'composed_context',
        entries: ['Book a flight to NYC'],
      });
      expect(originalRun).toHaveBeenCalled();
    });

    it('accepts a raw string task', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
      const client = makeMockEko();
      const guarded = wrapEko(client, engine);
      await guarded.run('do the thing');
      expect(validate).toHaveBeenCalledWith({
        kind: 'composed_context',
        entries: ['do the thing'],
      });
    });

    it('throws EkoGuardrailBlockedError on BLOCK; original run NOT called', async () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => blockResult('malicious task'))],
      });
      const client = makeMockEko();
      const originalRun = client.run;
      const guarded = wrapEko(client, engine);
      await expect(guarded.run('delete production')).rejects.toBeInstanceOf(
        EkoGuardrailBlockedError
      );
      expect(originalRun).not.toHaveBeenCalled();
    });

    it('blocks empty task string up front', async () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      const guarded = wrapEko(makeMockEko(), engine);
      await expect(guarded.run('')).rejects.toBeInstanceOf(EkoGuardrailBlockedError);
    });
  });

  describe('Agent registry interception', () => {
    it('walks eko.agents, detects BrowserAgent shape, wraps act/extract/observe', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
      const client = makeMockEko();
      const originalAct = client.agents.browser.act;
      wrapEko(client, engine);

      // After wrap, calling agents.browser.act flows through validator.
      await client.agents.browser.act('click submit');
      expect(validate).toHaveBeenCalledWith({
        kind: 'tool_call',
        toolName: 'click submit',
        args: {},
      });
      expect(originalAct).toHaveBeenCalled();
    });

    it('detects FileAgent shape; validates read path before dispatch', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
      const client = makeMockEko();
      const originalRead = client.agents.file.read;
      wrapEko(client, engine);

      await client.agents.file.read('/etc/passwd');
      expect(validate).toHaveBeenCalledWith({
        kind: 'tool_call',
        toolName: 'file.read',
        args: { path: '/etc/passwd' },
      });
      expect(originalRead).toHaveBeenCalled();
    });

    it('FileAgent.write validates path + content', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
      const client = makeMockEko();
      wrapEko(client, engine);

      await client.agents.file.write('/tmp/out.txt', 'hello world');
      expect(validate).toHaveBeenCalledWith({
        kind: 'tool_call',
        toolName: 'file.write',
        args: { path: '/tmp/out.txt', content: 'hello world' },
      });
    });

    it('FileAgent.delete validates path; BLOCK refuses delete', async () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => blockResult('path-traversal'))],
      });
      const client = makeMockEko();
      const originalDelete = client.agents.file.delete;
      wrapEko(client, engine);
      await expect(client.agents.file.delete('/../etc/passwd')).rejects.toBeInstanceOf(
        EkoGuardrailBlockedError
      );
      expect(originalDelete).not.toHaveBeenCalled();
    });

    it('skipAgents option skips wrapping for named agents', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
      const client = makeMockEko();
      const originalAct = client.agents.browser.act;
      wrapEko(client, engine, { skipAgents: ['browser'] });

      // Skipped → act stays the original; calling it does NOT fire validator.
      await client.agents.browser.act('click submit');
      expect(validate).not.toHaveBeenCalled();
      expect(originalAct).toHaveBeenCalled();
    });
  });

  describe('MCP tool dispatch (AC: results flow through RetrievedDocValidator)', () => {
    it('validates args BEFORE dispatch + result AFTER dispatch', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
      const client = makeMockEko();
      client.mcp.callTool.mockResolvedValueOnce({ data: 'tool-result' });
      const originalCallTool = client.mcp.callTool;
      wrapEko(client, engine);

      await client.mcp.callTool!('fs-server', 'list', { dir: '/tmp' });

      // Two validate() calls: args pre-dispatch + result post-dispatch.
      expect(validate).toHaveBeenCalledTimes(2);
      expect(validate).toHaveBeenNthCalledWith(1, {
        kind: 'tool_call',
        toolName: 'fs-server/list',
        args: { dir: '/tmp' },
      });
      expect(validate).toHaveBeenNthCalledWith(2, {
        kind: 'retrieved_docs',
        docs: [
          {
            content: JSON.stringify({ data: 'tool-result' }),
            metadata: { schemaPresent: true },
          },
        ],
      });
      expect(originalCallTool).toHaveBeenCalled();
    });

    it('blocked args refuse dispatch', async () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => blockResult('malicious args'))],
      });
      const client = makeMockEko();
      const originalCallTool = client.mcp.callTool;
      wrapEko(client, engine);
      await expect(
        client.mcp.callTool!('fs-server', 'list', { dir: '/etc/passwd' })
      ).rejects.toBeInstanceOf(EkoGuardrailBlockedError);
      expect(originalCallTool).not.toHaveBeenCalled();
    });

    it('blocked result throws POST-dispatch (tool result contained injection)', async () => {
      let callCount = 0;
      const validate = vi.fn().mockImplementation(() => {
        callCount += 1;
        // Pre-dispatch ALLOW; post-dispatch BLOCK.
        return callCount === 1 ? okResult('cold-args') : blockResult('poisoned-result');
      });
      const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
      const client = makeMockEko();
      const originalCallTool = client.mcp.callTool; // capture BEFORE wrap.
      wrapEko(client, engine);
      await expect(
        client.mcp.callTool!('fs-server', 'list', { dir: '/tmp' })
      ).rejects.toBeInstanceOf(EkoGuardrailBlockedError);
      expect(originalCallTool).toHaveBeenCalled();
    });
  });

  describe('Cross-connector base class', () => {
    it('EkoGuardrailBlockedError instanceof BrowserAgentGuardrailBlockedError', async () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => blockResult('block'))],
      });
      const guarded = wrapEko(makeMockEko(), engine);
      try {
        await guarded.run('some task');
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(EkoGuardrailBlockedError);
        expect(err).toBeInstanceOf(BrowserAgentGuardrailBlockedError);
        const e = err as EkoGuardrailBlockedError;
        expect(e.connector).toBe('eko');
        expect(e.surface).toBe('composed_context');
      }
    });

    it('reason text is sanitized at base class', async () => {
      const engine = new GuardrailEngine({
        validators: [
          makeValidator('V', () =>
            // eslint-disable-next-line no-control-regex
            blockResult('attacker\x00\x07payload')
          ),
        ],
      });
      const guarded = wrapEko(makeMockEko(), engine);
      try {
        await guarded.run('task');
        expect.fail('expected throw');
      } catch (err) {
        expect((err as Error).message).not.toMatch(/[\x00-\x1f]/);
        expect((err as Error).message).toMatch(/attackerpayload/);
      }
    });
  });

  describe('Direct agent wrappers (testing fixtures)', () => {
    it('wrapEkoBrowserAgent intercepts the agent in place', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
      const agent: EkoBrowserAgentLike = {
        act: vi.fn().mockResolvedValue({ ok: true }),
      };
      wrapEkoBrowserAgent(agent, engine);
      await agent.act!('click');
      expect(validate).toHaveBeenCalledWith({
        kind: 'tool_call',
        toolName: 'click',
        args: {},
      });
    });

    it('wrapEkoFileAgent intercepts read/write/delete', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
      const agent: EkoFileAgentLike = {
        read: vi.fn().mockResolvedValue('x'),
        write: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      };
      wrapEkoFileAgent(agent, engine);
      await agent.read!('/tmp/in');
      await agent.write!('/tmp/out', 'data');
      await agent.delete!('/tmp/old');
      expect(validate).toHaveBeenCalledTimes(3);
    });
  });

  describe('Audit-loop closures', () => {
    describe('rev B1: hybrid agent (act + read/write) — both branches run', () => {
      it('wraps both BrowserAgent + FileAgent methods on a hybrid agent', async () => {
        const validate = vi.fn().mockReturnValue(okResult('cold'));
        const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
        const hybridAgent = {
          act: vi.fn().mockResolvedValue({ ok: true }),
          read: vi.fn().mockResolvedValue('content'),
        };
        const client: EkoLike & { agents: { hybrid: typeof hybridAgent } } = {
          run: vi.fn().mockResolvedValue(undefined),
          agents: { hybrid: hybridAgent },
        };
        wrapEko(client, engine);
        // Both methods now validated.
        await client.agents.hybrid.act('click');
        await client.agents.hybrid.read('/etc/passwd');
        expect(validate).toHaveBeenCalledTimes(2);
        expect(validate).toHaveBeenCalledWith({
          kind: 'tool_call',
          toolName: 'click',
          args: {},
        });
        expect(validate).toHaveBeenCalledWith({
          kind: 'tool_call',
          toolName: 'file.read',
          args: { path: '/etc/passwd' },
        });
      });
    });

    describe('rev B2: detectEkoMode no longer reads modelName', () => {
      it('does NOT refuse construction when modelName contains a CUA-like substring', () => {
        const engine = new GuardrailEngine({
          validators: [makeValidator('V', () => okResult('cold'))],
        });
        const client = makeMockEko();
        // A model name happens to contain "computer-use"; should NOT trigger refusal.
        (client as unknown as { modelName: string }).modelName = 'gpt-computer-use-preview';
        expect(() => wrapEko(client, engine)).not.toThrow();
      });
    });

    describe('sec B3: MCP server/tool slash injection blocked', () => {
      it('rejects server containing slash with structured error', async () => {
        const engine = new GuardrailEngine({
          validators: [makeValidator('V', () => okResult('cold'))],
        });
        const client = makeMockEko();
        wrapEko(client, engine);
        await expect(
          client.mcp.callTool!('admin/rm-rf', 'innocuous', {})
        ).rejects.toBeInstanceOf(EkoGuardrailBlockedError);
      });

      it('rejects tool containing slash', async () => {
        const engine = new GuardrailEngine({
          validators: [makeValidator('V', () => okResult('cold'))],
        });
        const client = makeMockEko();
        wrapEko(client, engine);
        await expect(
          client.mcp.callTool!('admin', 'rm-rf/escape', {})
        ).rejects.toBeInstanceOf(EkoGuardrailBlockedError);
      });

      it('rejects empty server/tool strings', async () => {
        const engine = new GuardrailEngine({
          validators: [makeValidator('V', () => okResult('cold'))],
        });
        const client = makeMockEko();
        wrapEko(client, engine);
        await expect(client.mcp.callTool!('', 'tool', {})).rejects.toBeInstanceOf(
          EkoGuardrailBlockedError
        );
      });
    });

    describe('sec B2: binary / async-iterable MCP results blocked', () => {
      it('blocks Buffer results', async () => {
        const engine = new GuardrailEngine({
          validators: [makeValidator('V', () => okResult('cold'))],
        });
        const client = makeMockEko();
        client.mcp.callTool.mockResolvedValueOnce(Buffer.from('binary'));
        wrapEko(client, engine);
        await expect(
          client.mcp.callTool!('server', 'tool', {})
        ).rejects.toBeInstanceOf(EkoGuardrailBlockedError);
      });

      it('blocks Uint8Array results', async () => {
        const engine = new GuardrailEngine({
          validators: [makeValidator('V', () => okResult('cold'))],
        });
        const client = makeMockEko();
        client.mcp.callTool.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
        wrapEko(client, engine);
        await expect(
          client.mcp.callTool!('server', 'tool', {})
        ).rejects.toBeInstanceOf(EkoGuardrailBlockedError);
      });

      it('blocks async-iterable results', async () => {
        const engine = new GuardrailEngine({
          validators: [makeValidator('V', () => okResult('cold'))],
        });
        const client = makeMockEko();
        async function* stream(): AsyncIterableIterator<string> {
          yield 'chunk1';
        }
        client.mcp.callTool.mockResolvedValueOnce(stream());
        wrapEko(client, engine);
        await expect(
          client.mcp.callTool!('server', 'tool', {})
        ).rejects.toBeInstanceOf(EkoGuardrailBlockedError);
      });

      it('plain object results still flow through validators', async () => {
        const validate = vi.fn().mockReturnValue(okResult('cold'));
        const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
        const client = makeMockEko();
        client.mcp.callTool.mockResolvedValueOnce({ ok: true });
        wrapEko(client, engine);
        await client.mcp.callTool!('server', 'tool', {});
        // Plain object: 2 validate calls (pre + post).
        expect(validate).toHaveBeenCalledTimes(2);
      });
    });

    describe('sec B4: skipAgents total-bypass emits warning', () => {
      it('warns when skipAgents covers ALL agents', () => {
        const warn = vi.fn();
        const engine = new GuardrailEngine({
          validators: [makeValidator('V', () => okResult('cold'))],
        });
        const client = makeMockEko();
        wrapEko(client, engine, {
          skipAgents: ['browser', 'file'],
          logger: { warn },
        });
        expect(warn).toHaveBeenCalledWith(
          expect.stringMatching(/covers ALL registered agents/)
        );
      });

      it('does NOT warn when skipAgents covers only some agents', () => {
        const warn = vi.fn();
        const engine = new GuardrailEngine({
          validators: [makeValidator('V', () => okResult('cold'))],
        });
        const client = makeMockEko();
        wrapEko(client, engine, {
          skipAgents: ['browser'],
          logger: { warn },
        });
        // No total-bypass warning (file is still wrapped).
        const calls = warn.mock.calls.filter((c) =>
          /covers ALL/.test(String(c[0]))
        );
        expect(calls).toHaveLength(0);
      });
    });

    describe('sec B5: path canonicalisation prevents TOCTOU mismatch', () => {
      it('collapses // and \\ to /', async () => {
        const validate = vi.fn().mockReturnValue(okResult('cold'));
        const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
        const client = makeMockEko();
        wrapEko(client, engine);
        await client.agents.file.read('//tmp\\\\file.txt');
        expect(validate).toHaveBeenCalledWith({
          kind: 'tool_call',
          toolName: 'file.read',
          args: { path: '/tmp/file.txt' },
        });
      });

      it('resolves . segments + collapses /./', async () => {
        const validate = vi.fn().mockReturnValue(okResult('cold'));
        const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
        const client = makeMockEko();
        wrapEko(client, engine);
        await client.agents.file.read('/tmp/./file.txt');
        expect(validate).toHaveBeenCalledWith({
          kind: 'tool_call',
          toolName: 'file.read',
          args: { path: '/tmp/file.txt' },
        });
      });

      it('preserves attacker-explicit `..` segments below root', async () => {
        const validate = vi.fn().mockReturnValue(okResult('cold'));
        const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
        const client = makeMockEko();
        wrapEko(client, engine);
        await client.agents.file.read('/../etc/passwd');
        // Below root → explicit `..` marker preserved so PathTraversalValidator
        // can fire on the ascent signal.
        const calls = (validate as ReturnType<typeof vi.fn>).mock.calls;
        const arg = calls[0][0] as { args: { path: string } };
        expect(arg.args.path).toMatch(/\.\./);
      });
    });

    describe('rev B6: mcp.callTool SDK throw preserves original error', () => {
      it('SDK throw propagates after pre-validation passes', async () => {
        const validate = vi.fn().mockReturnValue(okResult('cold'));
        const engine = new GuardrailEngine({ validators: [{ name: 'V', validate }] });
        const client = makeMockEko();
        const sdkErr = new Error('network failure');
        client.mcp.callTool.mockRejectedValueOnce(sdkErr);
        wrapEko(client, engine);
        await expect(client.mcp.callTool!('server', 'tool', {})).rejects.toBe(sdkErr);
        // Only the pre-dispatch validate fired.
        expect(validate).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Missing optional methods', () => {
    it('agent without `extract` does not break the wrapper', () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      const agent: EkoBrowserAgentLike = {
        act: vi.fn().mockResolvedValue({ ok: true }),
        // no extract / observe
      };
      expect(() => wrapEkoBrowserAgent(agent, engine)).not.toThrow();
    });

    it('client without `mcp` does not break the wrapper', () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      const client: EkoLike = {
        run: vi.fn().mockResolvedValue(undefined),
      };
      expect(() => wrapEko(client, engine)).not.toThrow();
    });

    it('client without `agents` does not break the wrapper', () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      const client: EkoLike = {
        run: vi.fn().mockResolvedValue(undefined),
      };
      expect(() => wrapEko(client, engine)).not.toThrow();
    });
  });
});
