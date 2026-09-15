import { describe, expect, it } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import { extractToolCalls, stripToolCalls } from '../core/interceptor/tool-parser';

describe('tool-parser XML fallback', () => {
  const descriptors = createArtifactToolDescriptors('en');

  it('parses and strips whitespace-padded direct tool tags', () => {
    const text = [
      'Before ',
      '< artifact_create >',
      JSON.stringify({ filename: 'demo.html', content: '<canvas></canvas>' }),
      '</ artifact_create >',
      ' after',
    ].join('');

    const calls = extractToolCalls(text, { descriptors });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: 'artifact_create',
      payload: { filename: 'demo.html', content: '<canvas></canvas>' },
    });
    expect(stripToolCalls(text, { descriptors })).toBe('Before  after');
  });

  it('recovers a foreign-closed call as a parseError record instead of dropping it', () => {
    const text = '<artifact_create>{"filename":"demo.html"}</invoke>';
    const calls = extractToolCalls(text, { descriptors });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      invocationName: 'artifact_create',
      payload: { filename: 'demo.html' },
      raw: text,
      parseError: { code: 'tool_call_close_mismatched', retryable: false },
    });
    expect(stripToolCalls(text, { descriptors })).toBe('');
  });
});
