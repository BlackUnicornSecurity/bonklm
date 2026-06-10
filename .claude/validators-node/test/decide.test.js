import { describe, it, expect } from 'vitest';
import { decide } from '../lib/decide.js';
import { EXIT_ALLOW, EXIT_BLOCK } from '../lib/constants.js';

const never = () => false;

describe('decide', () => {
  it('kill-switch active -> ALLOW with no output', () => {
    const r = decide({}, () => ({ block: true, reason: 'x' }), { name: 't', isDisabled: () => true });
    expect(r.exitCode).toBe(EXIT_ALLOW);
    expect(r.stderr).toBe('');
  });

  it('validate throwing an Error -> fail OPEN with diagnostic', () => {
    const r = decide({}, () => {
      throw new Error('boom');
    }, { name: 't', isDisabled: never });
    expect(r.exitCode).toBe(EXIT_ALLOW);
    expect(r.stderr).toContain('internal error (fail-open)');
    expect(r.stderr).toContain('boom');
  });

  it('validate throwing a non-Error -> still fail OPEN', () => {
    const r = decide({}, () => {
      // eslint-disable-next-line no-throw-literal
      throw 'str-failure';
    }, { name: 't', isDisabled: never });
    expect(r.exitCode).toBe(EXIT_ALLOW);
    expect(r.stderr).toContain('str-failure');
  });

  it('block decision -> exit 2 with formatted message', () => {
    const r = decide({}, () => ({ block: true, title: 'T', reason: 'why', target: '/f' }), {
      name: 'secret',
      isDisabled: never,
    });
    expect(r.exitCode).toBe(EXIT_BLOCK);
    expect(r.stderr).toContain('BONKLM GUARDRAIL: T');
    expect(r.stderr).toContain('why');
  });

  it('warn decision -> ALLOW with advisory line', () => {
    const r = decide({}, () => ({ warn: true, reason: 'heads up' }), { name: 'pi', isDisabled: never });
    expect(r.exitCode).toBe(EXIT_ALLOW);
    expect(r.stderr).toContain('warning: heads up');
  });

  it('warn decision without reason -> advisory default', () => {
    const r = decide({}, () => ({ warn: true }), { name: 'pi', isDisabled: never });
    expect(r.stderr).toContain('advisory');
  });

  it('null decision -> ALLOW, no output', () => {
    const r = decide({}, () => null, { name: 't', isDisabled: never });
    expect(r.exitCode).toBe(EXIT_ALLOW);
    expect(r.stderr).toBe('');
  });

  it('undefined decision -> ALLOW', () => {
    expect(decide({}, () => undefined, { name: 't', isDisabled: never }).exitCode).toBe(EXIT_ALLOW);
  });

  it('defaults name + uses real isDisabled with projectDir from input.cwd', () => {
    const r = decide({ cwd: '/no/such/dir-xyz' }, () => null);
    expect(r.exitCode).toBe(EXIT_ALLOW);
  });

  it('passes projectDir to the validate context', () => {
    let seen;
    decide({}, (_input, ctx) => {
      seen = ctx.projectDir;
      return null;
    }, { projectDir: '/pd', isDisabled: never });
    expect(seen).toBe('/pd');
  });
});
