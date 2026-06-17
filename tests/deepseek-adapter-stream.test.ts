import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitPromptStreaming } from '../core/deepseek/adapter';

describe('DeepSeek web adapter streaming', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('can stream chunks without retaining the full assistant text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => createSseResponse([
      'data: {"v":"Hello "}',
      'data: {"v":"world"}',
      'data: {"p":"response/status","v":"FINISHED"}',
    ].join('\n\n'))));

    const chunks: string[] = [];
    const fullTexts: string[] = [];
    const turn = await submitPromptStreaming(createSubmitInput(), {
      retainAssistantText: false,
      onTextChunk(text, fullText) {
        chunks.push(text);
        fullTexts.push(fullText);
      },
    });

    expect(chunks.join('')).toBe('Hello world');
    expect(fullTexts.every((fullText) => fullText === '')).toBe(true);
    expect(turn).toMatchObject({
      assistantText: '',
      finished: true,
    });
  });

  it('retains full assistant text by default', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => createSseResponse([
      'data: {"v":"Hello "}',
      'data: {"v":"world"}',
    ].join('\n\n'))));

    const fullTexts: string[] = [];
    const turn = await submitPromptStreaming(createSubmitInput(), {
      onTextChunk(_text, fullText) {
        fullTexts.push(fullText);
      },
    });

    expect(fullTexts.at(-1)).toBe('Hello world');
    expect(turn.assistantText).toBe('Hello world');
  });
});

function createSubmitInput() {
  return {
    chatSessionId: 'session-1',
    parentMessageId: 1,
    modelType: null,
    prompt: 'hello',
    refFileIds: [],
    thinkingEnabled: false,
    searchEnabled: false,
    clientHeaders: {},
    powHeaders: {},
  };
}

function createSseResponse(text: string): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  }), {
    headers: { 'content-type': 'text/event-stream' },
  });
}
