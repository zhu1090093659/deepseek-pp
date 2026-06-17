import { describe, expect, it, vi } from 'vitest';
import {
  createOfficialDeepSeekRequestBody,
  DEEPSEEK_OFFICIAL_API_URL,
  submitOfficialDeepSeekStreaming,
} from '../core/deepseek/official-api';
import { createFetchStub } from './helpers/fetch-stub';

describe('DeepSeek official API adapter', () => {
  it('builds current official model and thinking request bodies', () => {
    expect(createOfficialDeepSeekRequestBody({
      config: {
        model: 'deepseek-v4-flash',
        thinking: 'disabled',
        reasoningEffort: 'high',
      },
      messages: [{ role: 'user', content: 'hello' }],
    })).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
      stream: true,
    });

    expect(createOfficialDeepSeekRequestBody({
      config: {
        model: 'deepseek-v4-pro',
        thinking: 'enabled',
        reasoningEffort: 'max',
      },
      messages: [{ role: 'user', content: 'hello' }],
    })).toMatchObject({
      model: 'deepseek-v4-pro',
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
      stream: true,
    });
  });

  it('streams OpenAI-compatible reasoning and answer deltas with the configured API key', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => createSseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"Think"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n\n')));
    const fetchImpl = createFetchStub(fetchMock);
    const chunks: string[] = [];
    const reasoningChunks: string[] = [];

    const turn = await submitOfficialDeepSeekStreaming({
      apiKey: 'sk-test',
      config: {
        model: 'deepseek-v4-flash',
        thinking: 'enabled',
        reasoningEffort: 'high',
      },
      messages: [{ role: 'user', content: 'hello' }],
      fetchImpl,
    }, {
      onTextChunk(chunk) {
        chunks.push(chunk);
      },
      onReasoningChunk(chunk) {
        reasoningChunks.push(chunk);
      },
    });

    expect(turn).toEqual({ assistantText: 'Hello', reasoningText: 'Think', finished: true });
    expect(chunks).toEqual(['Hel', 'lo']);
    expect(reasoningChunks).toEqual(['Think']);
    expect(fetchMock).toHaveBeenCalledWith(DEEPSEEK_OFFICIAL_API_URL, expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer sk-test',
      }),
    }));

    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse((init?.body as string) ?? '{}')).toMatchObject({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    });
  });

  it('surfaces official API error messages', async () => {
    const fetchImpl = createFetchStub(vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'invalid api key' } }),
      { status: 401 },
    )));

    await expect(submitOfficialDeepSeekStreaming({
      apiKey: 'bad-key',
      messages: [{ role: 'user', content: 'hello' }],
      fetchImpl,
    }, {})).rejects.toThrow('invalid api key');
  });

  it('passes reasoning content back for thinking tool loops', () => {
    expect(createOfficialDeepSeekRequestBody({
      config: {
        model: 'deepseek-v4-pro',
        thinking: 'enabled',
        reasoningEffort: 'high',
      },
      messages: [
        { role: 'assistant', content: 'final', reasoningContent: 'private trace' },
        { role: 'user', content: 'next' },
      ],
    }).messages[0]).toMatchObject({
      role: 'assistant',
      content: 'final',
      reasoning_content: 'private trace',
    });
  });

  it('omits reasoning content when thinking is disabled', () => {
    expect(createOfficialDeepSeekRequestBody({
      config: {
        model: 'deepseek-v4-flash',
        thinking: 'disabled',
        reasoningEffort: 'high',
      },
      messages: [
        { role: 'assistant', content: 'final', reasoningContent: 'private trace' },
      ],
    }).messages[0]).toEqual({
      role: 'assistant',
      content: 'final',
    });
  });
});

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
