import { describe, expect, it } from 'vitest';
import { mapLiteLLM, mapOpenAICompat, mapPortkey } from '../src/payload-mappers/index.js';

describe('server payload mapper boundaries', () => {
  it.each([undefined, 'unknownHook'])('rejects an invalid Portkey event type (%s)', eventType => {
    expect(() =>
      mapPortkey({
        eventType,
        request: { text: 'content' }
      } as never)
    ).toThrow(/eventType/);
  });

  it('maps the response envelope for a Portkey after-request hook', () => {
    const mapped = mapPortkey({
      eventType: 'afterRequestHook',
      request: { text: 'request text must not be rescanned' },
      response: {
        json: {
          choices: [{ message: { role: 'assistant', content: 'guard this model response' } }]
        },
        text: 'guard this model response'
      }
    });

    expect(mapped.content).toContain('guard this model response');
    expect(mapped.content).not.toContain('request text must not be rescanned');
  });

  it('maps a text-only Portkey after-request hook', () => {
    expect(
      mapPortkey({
        eventType: 'afterRequestHook',
        response: { text: 'guard this text response' }
      }).content
    ).toBe('guard this text response');
  });

  it.each([null, 'not-an-object', []])('rejects malformed message entries (%j)', message => {
    expect(() => mapOpenAICompat({ messages: [message] } as never)).toThrow(/message must be an object/i);
  });

  it.each([
    ['LiteLLM', () => mapLiteLLM({ data: { messages: 'attack' } } as never)],
    ['Portkey', () => mapPortkey({ eventType: 'beforeRequestHook', messages: 'attack' } as never)],
    ['OpenAI-compatible', () => mapOpenAICompat({ messages: 'attack' } as never)]
  ])('rejects a non-array %s messages field', (_label, action) => {
    expect(action).toThrow(/messages.*array/);
  });

  it.each([
    [
      'Portkey',
      () =>
        mapPortkey({
          eventType: 'beforeRequestHook',
          messages: [{ content: 'benign' }],
          request: { json: { prompt: 'secondary attack' } }
        })
    ],
    ['OpenAI-compatible', () => mapOpenAICompat({ messages: [{ content: 'benign' }], prompt: 'secondary attack' })]
  ])('merges every supported %s text source', (_label, action) => {
    expect(action().content).toContain('benign');
    expect(action().content).toContain('secondary attack');
  });

  it('uses a prompt when an OpenAI message omits optional content', () => {
    expect(mapOpenAICompat({ messages: [{}], prompt: 'prompt content' }).content).toBe('prompt content');
  });

  it.each([
    [
      'LiteLLM',
      () =>
        mapLiteLLM({
          data: { messages: [{ content: 'benign' }], tools: [{ function: { description: 'ATTACK' } }] }
        } as never)
    ],
    [
      'Portkey',
      () =>
        mapPortkey({
          eventType: 'beforeRequestHook',
          request: {
            json: { messages: [{ content: 'benign' }], tools: [{ function: { description: 'ATTACK' } }] }
          }
        } as never)
    ],
    [
      'OpenAI-compatible',
      () =>
        mapOpenAICompat({
          messages: [{ content: 'benign' }],
          tools: [{ function: { description: 'ATTACK' } }]
        } as never)
    ]
  ])('includes %s tool instructions in the scanned content', (_label, action) => {
    expect(action().content).toContain('ATTACK');
  });

  it('includes every supported OpenAI instruction field in the scanned content', () => {
    const mapped = mapOpenAICompat({
      messages: [{ content: 'benign' }],
      tools: [{ function: { description: 'TOOLS_MARKER' } }],
      functions: [{ description: 'FUNCTIONS_MARKER' }],
      tool_choice: { function: { name: 'TOOL_CHOICE_MARKER' } },
      response_format: { json_schema: { description: 'RESPONSE_FORMAT_MARKER' } }
    } as never);

    expect(mapped.content).toContain('TOOLS_MARKER');
    expect(mapped.content).toContain('FUNCTIONS_MARKER');
    expect(mapped.content).toContain('TOOL_CHOICE_MARKER');
    expect(mapped.content).toContain('RESPONSE_FORMAT_MARKER');
  });

  it.each([
    ['LiteLLM', () => mapLiteLLM({ data: { messages: [{ content: { hidden: 'attack' } }] } } as never)],
    [
      'Portkey',
      () => mapPortkey({ eventType: 'beforeRequestHook', messages: [{ content: { hidden: 'attack' } }] } as never)
    ],
    ['OpenAI-compatible', () => mapOpenAICompat({ messages: [{ content: { hidden: 'attack' } }] } as never)]
  ])('rejects unsupported %s message content shapes', (_label, action) => {
    expect(action).toThrow(/message content.*string.*array/);
  });

  it.each([
    ['LiteLLM', () => mapLiteLLM({ data: { messages: [] } })],
    ['Portkey', () => mapPortkey({ eventType: 'beforeRequestHook', request: { json: { messages: [] } } })],
    ['OpenAI-compatible', () => mapOpenAICompat({ messages: [] })]
  ])('rejects a %s payload without scannable text', (_label, action) => {
    expect(action).toThrow(/must contain scannable text/);
  });
});
