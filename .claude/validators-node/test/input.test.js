import { describe, it, expect } from 'vitest';
import {
  parseHookInput,
  getFilePath,
  getCommand,
  getWriteContent,
  gatherText,
} from '../lib/input.js';

// Note: reading stdin (the only I/O) lives in run-hook.js and is proven by the
// spawn-based bin integration tests (empty + malformed stdin -> ALLOW).

describe('parseHookInput', () => {
  it('parses a PreToolUse payload', () => {
    const r = parseHookInput(
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/c' }),
    );
    expect(r.eventName).toBe('PreToolUse');
    expect(r.toolName).toBe('Bash');
    expect(r.toolInput.command).toBe('ls');
    expect(r.cwd).toBe('/c');
  });

  it('parses a UserPromptSubmit prompt', () => {
    expect(parseHookInput(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' })).prompt).toBe('hi');
  });

  it('falls back safely on empty / invalid / non-object input', () => {
    expect(parseHookInput('').toolName).toBe('');
    expect(parseHookInput('{ bad json').toolName).toBe('');
    expect(parseHookInput('   ').prompt).toBe('');
    expect(parseHookInput('123').toolInput).toEqual({});
  });

  it('uses fallbackCwd when cwd is absent', () => {
    expect(parseHookInput('{}', '/fb').cwd).toBe('/fb');
  });

  it('coerces a non-object tool_input to {}', () => {
    expect(parseHookInput(JSON.stringify({ tool_input: 'x' })).toolInput).toEqual({});
  });
});

describe('extractors', () => {
  it('getFilePath prefers file_path, then notebook_path, then path', () => {
    expect(getFilePath({ toolInput: { file_path: '/a' } })).toBe('/a');
    expect(getFilePath({ toolInput: { notebook_path: '/n' } })).toBe('/n');
    expect(getFilePath({ toolInput: { path: '/p' } })).toBe('/p');
    expect(getFilePath({ toolInput: {} })).toBe('');
    expect(getFilePath({})).toBe('');
  });

  it('getCommand reads the command field', () => {
    expect(getCommand({ toolInput: { command: 'ls' } })).toBe('ls');
    expect(getCommand({ toolInput: {} })).toBe('');
    expect(getCommand({})).toBe('');
  });

  it('getWriteContent joins content / new_string / new_source', () => {
    expect(getWriteContent({ toolInput: { content: 'a' } })).toBe('a');
    expect(getWriteContent({ toolInput: { new_string: 'b' } })).toBe('b');
    expect(getWriteContent({ toolInput: { new_source: 'c' } })).toBe('c');
    expect(getWriteContent({ toolInput: { content: 'a', new_string: 'b' } })).toBe('a\nb');
    expect(getWriteContent({ toolInput: {} })).toBe('');
    expect(getWriteContent({})).toBe('');
  });

  it('gatherText collects prompt + nested strings, arrays; depth-bounded', () => {
    const text = gatherText({ prompt: 'P', toolInput: { a: 'x', b: ['y', { c: 'z' }], n: null, num: 5 } });
    expect(text).toContain('P');
    expect(text).toContain('x');
    expect(text).toContain('y');
    expect(text).toContain('z');

    let deep = { v: 'TOODEEP' };
    for (let i = 0; i < 8; i += 1) deep = { n: deep };
    expect(gatherText({ prompt: '', toolInput: deep })).not.toContain('TOODEEP');
  });
});
