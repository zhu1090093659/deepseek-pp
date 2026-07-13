import { describe, expect, it, vi } from 'vitest';
import {
  DEEPSEEK_API_URL,
  DEEPSEEK_BYPASS_HOOK_HEADER,
  DEEPSEEK_CHAT_STREAM_ROUTE_PATHS,
  DEEPSEEK_FILE_FETCH_PATH,
  DEEPSEEK_FILE_UPLOAD_PATH,
  DEEPSEEK_OFFICIAL_API_URL,
  DEEPSEEK_WEB_ORIGIN,
  DEEPSEEK_WEB_ROUTES,
  isDeepSeekChatStreamUrl,
  isDeepSeekHistoryUrl,
} from '../core/deepseek/contracts';
import { submitOfficialDeepSeekStreaming } from '../core/deepseek/official-api';
import { XmlToolStreamFilter } from '../core/interceptor/fetch-hook';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import {
  extractResponseTextFromParsed,
  isStreamFinishedFromParsed,
  parseSSEChunk,
  parseSSEData,
} from '../core/interceptor/sse-parser';
import {
  DEEPSEEK_REQUEST_BODY_FIXTURE,
  DEEPSEEK_ROUTE_CONTRACT,
  DEEPSEEK_ROUTE_CURRENT_GAPS,
  DEEPSEEK_SSE_CURRENT_GAPS,
  LEGAL_DEEPSEEK_ROUTE_FIXTURES,
  LEGAL_DEEPSEEK_SSE_FIXTURES,
  UNKNOWN_DEEPSEEK_SSE_EVENT,
} from './fixtures/external-runtime/deepseek';

describe('DeepSeek external protocol contract', () => {
  it('keeps one production authority for all released web and official routes', () => {
    expect(DEEPSEEK_WEB_ORIGIN).toBe(DEEPSEEK_ROUTE_CONTRACT.origin);
    expect(DEEPSEEK_WEB_ROUTES).toEqual(DEEPSEEK_ROUTE_CONTRACT.routes);
    expect(DEEPSEEK_API_URL).toBe(`${DEEPSEEK_ROUTE_CONTRACT.origin}${DEEPSEEK_ROUTE_CONTRACT.routes.completion}`);
    expect(DEEPSEEK_OFFICIAL_API_URL).toBe(DEEPSEEK_ROUTE_CONTRACT.officialApi);
    expect(DEEPSEEK_FILE_UPLOAD_PATH).toBe(DEEPSEEK_ROUTE_CONTRACT.routes.uploadFile);
    expect(DEEPSEEK_FILE_FETCH_PATH).toBe(DEEPSEEK_ROUTE_CONTRACT.routes.fetchFiles);
    expect(DEEPSEEK_BYPASS_HOOK_HEADER).toBe(DEEPSEEK_ROUTE_CONTRACT.bypassHeader);
    expect(DEEPSEEK_CHAT_STREAM_ROUTE_PATHS).toEqual([
      DEEPSEEK_ROUTE_CONTRACT.routes.completion,
      DEEPSEEK_ROUTE_CONTRACT.routes.regenerate,
    ]);
  });

  it('preserves released route matches and records substring false positives as T3.4 gaps', () => {
    for (const fixture of LEGAL_DEEPSEEK_ROUTE_FIXTURES) {
      const matches = fixture.kind === 'stream'
        ? isDeepSeekChatStreamUrl(fixture.url)
        : isDeepSeekHistoryUrl(fixture.url);
      expect(matches, fixture.url).toBe(true);
    }
    expect(isDeepSeekChatStreamUrl('https://chat.deepseek.com/api/v0/chat/create_pow_challenge')).toBe(false);

    for (const fixture of DEEPSEEK_ROUTE_CURRENT_GAPS) {
      const matches = fixture.kind === 'stream'
        ? isDeepSeekChatStreamUrl(fixture.url)
        : isDeepSeekHistoryUrl(fixture.url);
      expect(matches, fixture.name).toBe(fixture.currentMatch);
      expect(fixture.target).toBe('exact-origin-path-and-method-policy-after-T3.4');
    }
  });

  it('preserves unknown request siblings and leaves invalid JSON or empty prompts untouched', () => {
    const result = augmentRequestBody(JSON.stringify(DEEPSEEK_REQUEST_BODY_FIXTURE), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 4,
      locale: 'en',
    });
    const output = JSON.parse(result?.body ?? '{}');

    for (const [key, value] of Object.entries(DEEPSEEK_REQUEST_BODY_FIXTURE)) {
      if (key === 'prompt') continue;
      expect(output[key], key).toEqual(value);
    }
    expect(output.prompt).toContain(DEEPSEEK_REQUEST_BODY_FIXTURE.prompt);
    expect(result?.agentTaskPrompt).toBe(DEEPSEEK_REQUEST_BODY_FIXTURE.prompt);
    expect(augmentRequestBody('{bad json}', requestState())).toBeNull();
    expect(augmentRequestBody(JSON.stringify({ prompt: '', future_sibling: true }), requestState())).toBeNull();
  });

  it('decodes every released DeepSeek SSE text and finished shape', () => {
    for (const fixture of LEGAL_DEEPSEEK_SSE_FIXTURES) {
      const events = parseSSEChunk(fixture.wire);
      expect(events, fixture.name).toHaveLength(1);
      const parsed = parseSSEData(events[0].data);
      expect(parsed, fixture.name).toEqual(fixture.parsed);
      expect(extractResponseTextFromParsed(parsed), fixture.name).toBe(fixture.text);
      expect(isStreamFinishedFromParsed(parsed), fixture.name).toBe(fixture.finished);
    }
  });

  it('keeps malformed JSON and CRLF handling classified as observable protocol gaps', () => {
    const malformed = parseSSEChunk(DEEPSEEK_SSE_CURRENT_GAPS[0].wire);
    expect(malformed).toHaveLength(1);
    expect(parseSSEData(malformed[0].data)).toBeNull();
    expect(DEEPSEEK_SSE_CURRENT_GAPS[0].target).toBe('observable-protocol-error-after-T5.1');

    const crlf = parseSSEChunk(DEEPSEEK_SSE_CURRENT_GAPS[1].wire);
    expect(crlf).toHaveLength(1);
    expect(crlf[0]).toMatchObject({ type: 'ready' });
    expect(parseSSEData(crlf[0].data)).toBeNull();
    expect(DEEPSEEK_SSE_CURRENT_GAPS[1].target).toBe('crlf-compatible-sse-codec-after-T3.4');
  });

  it('retains unknown SSE events byte-for-byte through the visible-stream filter', () => {
    const filter = new XmlToolStreamFilter([]);
    const decoder = new TextDecoder();
    const output: string[] = [];
    const controller = {
      enqueue(data: Uint8Array) {
        output.push(decoder.decode(data));
      },
    } as ReadableStreamDefaultController<Uint8Array>;

    filter.processChunk(UNKNOWN_DEEPSEEK_SSE_EVENT, controller);
    filter.flush(controller);
    expect(output.join('')).toBe(UNKNOWN_DEEPSEEK_SSE_EVENT);
  });

  it('passes official API cancellation through and fails explicitly on a missing stream body', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const signal = init?.signal;
      expect(signal).toBe(controller.signal);
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const pending = submitOfficialDeepSeekStreaming({
      apiKey: 'contract-key',
      messages: [{ role: 'user', content: 'cancel' }],
      fetchImpl,
    }, {}, controller.signal);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);

    await expect(submitOfficialDeepSeekStreaming({
      apiKey: 'contract-key',
      messages: [{ role: 'user', content: 'missing body' }],
      fetchImpl: vi.fn(async () => new Response(null, { status: 200 })),
    }, {})).rejects.toThrow('DeepSeek official API response did not include a stream body.');
  });

  it('preserves the official thinking_content response alias', async () => {
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode([
          'data: {"choices":[{"delta":{"thinking_content":"legacy thinking"},"finish_reason":null}]}',
          'data: [DONE]',
        ].join('\n\n')));
        controller.close();
      },
    }));

    await expect(submitOfficialDeepSeekStreaming({
      apiKey: 'contract-key',
      messages: [{ role: 'user', content: 'alias' }],
      fetchImpl: vi.fn(async () => response),
    }, {})).resolves.toEqual({
      assistantText: '',
      reasoningText: 'legacy thinking',
      finished: true,
    });
  });
});

function requestState() {
  return {
    memories: [],
    skills: [],
    activePreset: null,
    modelType: null,
    toolDescriptors: [],
    messageCount: 0,
    locale: 'en' as const,
  };
}
