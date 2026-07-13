import { describe, expect, it } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import { XmlToolStreamFilter } from '../core/interceptor/fetch-hook';
import {
  createDeepSeekSseFrameDecoder,
  extractResponseTextFromParsed,
  parseSSEChunk,
  parseSSEData,
} from '../core/deepseek/stream-codec';

describe('XmlToolStreamFilter', () => {
  it('strips whitespace-padded artifact tags with large canvas HTML across SSE events', () => {
    const html = [
      '<!doctype html><html><body><canvas id="stage"></canvas>',
      '<script>',
      'const ctx = document.getElementById("stage").getContext("2d");'.repeat(3000),
      '</script></body></html>',
    ].join('');
    const payload = JSON.stringify({
      filename: 'canvas-design.html',
      content: html,
      language: 'html',
      previewMode: 'html',
    });

    const output = runFilter([
      sseText('Intro < artifact'),
      sseText('_create >' + payload.slice(0, 10_000)),
      sseText(payload.slice(10_000, 80_000)),
      sseText(payload.slice(80_000) + '</ artifact'),
      sseText('_create > done'),
    ]);

    expect(output).not.toContain('artifact_create');
    expect(output).not.toContain('<canvas');
    expect(output).not.toContain('getContext');
    expect(readVisibleText(output)).toBe('Intro  done');
  });

  it('keeps response fragment structure while suppressing a streamed artifact body', () => {
    const payload = JSON.stringify({
      filename: 'fragment-demo.html',
      content: '<!doctype html><canvas></canvas>',
      language: 'html',
    });

    const output = runFilter([
      sseFragment('Before < artifact'),
      sseFragment('_create >' + payload),
      sseFragment('</ artifact_create > after'),
    ]);

    expect(output).toContain('"p":"response/fragments"');
    expect(output).not.toContain('fragment-demo.html');
    expect(output).not.toContain('<canvas');
    expect(readVisibleText(output)).toBe('Before  after');
  });

  it('buffers partial SSE events before parsing full-text stream state', () => {
    const parsed: unknown[] = [];
    const decoder = createDeepSeekSseFrameDecoder();
    const event = sseText('Split event text');

    parsed.push(...decoder.push(event.slice(0, 8)).map((frame) => frame.parsed));
    parsed.push(...decoder.push(event.slice(8, 21)).map((frame) => frame.parsed));
    expect(parsed).toEqual([]);

    parsed.push(...decoder.push(event.slice(21)).map((frame) => frame.parsed));
    expect(parsed).toHaveLength(1);
    expect(extractResponseTextFromParsed(parsed[0])).toBe('Split event text');
  });
});

function runFilter(chunks: string[]): string {
  const filter = new XmlToolStreamFilter(createArtifactToolDescriptors('en'));
  const frameDecoder = createDeepSeekSseFrameDecoder();
  const decoder = new TextDecoder();
  const output: string[] = [];
  const controller = {
    enqueue(data: Uint8Array) {
      output.push(decoder.decode(data));
    },
  } as ReadableStreamDefaultController<Uint8Array>;

  for (const chunk of chunks) {
    filter.processFrames(frameDecoder.push(chunk), controller);
  }
  filter.processFrames(frameDecoder.finish(), controller);
  filter.flush(controller);
  return output.join('');
}

function sseText(text: string): string {
  return `data: ${JSON.stringify({ p: 'response/content', o: 'APPEND', v: text })}\n\n`;
}

function sseFragment(text: string): string {
  return `data: ${JSON.stringify({ p: 'response/fragments', o: 'APPEND', v: [{ content: text }] })}\n\n`;
}

function readVisibleText(output: string): string {
  return parseSSEChunk(output)
    .map((event) => parseSSEData(event.data))
    .map((parsed) => extractResponseTextFromParsed(parsed))
    .filter((text): text is string => text !== null)
    .join('');
}
