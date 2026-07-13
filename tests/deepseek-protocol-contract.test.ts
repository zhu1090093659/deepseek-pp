import { describe, expect, it, vi } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import {
  DEEPSEEK_API_URL,
  DEEPSEEK_BYPASS_HOOK_HEADER,
  DEEPSEEK_FILE_FETCH_PATH,
  DEEPSEEK_FILE_UPLOAD_PATH,
  DEEPSEEK_OFFICIAL_API_URL,
  DEEPSEEK_WEB_ORIGIN,
  DEEPSEEK_WEB_ROUTES,
} from '../core/deepseek/contracts';
import { matchDeepSeekWebRoute } from '../core/deepseek/request-codec';
import { submitOfficialDeepSeekStreaming } from '../core/deepseek/official-api';
import { XmlToolStreamFilter } from '../core/interceptor/fetch-hook';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import {
  extractResponseTextFromParsed,
  isStreamFinishedFromParsed,
  parseSSEChunk,
  parseSSEData,
  createDeepSeekSseFrameDecoder,
} from '../core/deepseek/stream-codec';
import {
  CRLF_DEEPSEEK_SSE_FIXTURE,
  DEEPSEEK_REQUEST_BODY_FIXTURE,
  DEEPSEEK_ROUTE_CONTRACT,
  DEEPSEEK_SSE_CURRENT_GAPS,
  LEGAL_DEEPSEEK_ROUTE_FIXTURES,
  LEGAL_DEEPSEEK_SSE_FIXTURES,
  REJECTED_DEEPSEEK_ROUTE_FIXTURES,
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
  });

  it('matches released routes by exact origin, path, and method', () => {
    for (const fixture of LEGAL_DEEPSEEK_ROUTE_FIXTURES) {
      expect(matchDeepSeekWebRoute({
        url: fixture.url,
        method: fixture.method,
        ...('baseUrl' in fixture ? { baseUrl: fixture.baseUrl } : {}),
      }), fixture.url).toBe(fixture.route);
    }

    for (const fixture of REJECTED_DEEPSEEK_ROUTE_FIXTURES) {
      expect(matchDeepSeekWebRoute({
        url: fixture.url,
        method: fixture.method,
        ...('baseUrl' in fixture ? { baseUrl: fixture.baseUrl } : {}),
      }), fixture.name).toBeNull();
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

  it('keeps malformed JSON observable as the remaining protocol gap', () => {
    const malformed = parseSSEChunk(DEEPSEEK_SSE_CURRENT_GAPS[0].wire);
    expect(malformed).toHaveLength(1);
    expect(parseSSEData(malformed[0].data)).toBeNull();
    expect(DEEPSEEK_SSE_CURRENT_GAPS[0].target).toBe('observable-protocol-error-after-T5.1');

  });

  it('decodes CRLF frames without merging adjacent events', () => {
    for (let splitAt = 0; splitAt <= CRLF_DEEPSEEK_SSE_FIXTURE.wire.length; splitAt++) {
      const decoder = createDeepSeekSseFrameDecoder();
      const frames = [
        ...decoder.push(CRLF_DEEPSEEK_SSE_FIXTURE.wire.slice(0, splitAt)),
        ...decoder.push(CRLF_DEEPSEEK_SSE_FIXTURE.wire.slice(splitAt)),
        ...decoder.finish(),
      ];
      expect(frames.map((frame) => ({
        type: frame.event?.type,
        parsed: frame.parsed,
      })), `split ${splitAt}`).toEqual(CRLF_DEEPSEEK_SSE_FIXTURE.events);
    }
  });

  it('retains unknown SSE events byte-for-byte through the visible-stream filter', () => {
    for (const wire of [
      UNKNOWN_DEEPSEEK_SSE_EVENT,
      UNKNOWN_DEEPSEEK_SSE_EVENT.replaceAll('\n', '\r\n'),
    ]) {
      const filter = new XmlToolStreamFilter([]);
      const decoder = new TextDecoder();
      const output: string[] = [];
      const controller = {
        enqueue(data: Uint8Array) {
          output.push(decoder.decode(data));
        },
      } as ReadableStreamDefaultController<Uint8Array>;
      const frameDecoder = createDeepSeekSseFrameDecoder();

      filter.processFrames(frameDecoder.push(wire), controller);
      filter.processFrames(frameDecoder.finish(), controller);
      filter.flush(controller);
      expect(output.join('')).toBe(wire);
    }
  });

  it('retains the released final-frame delimiter for unterminated passive SSE input', () => {
    const filter = new XmlToolStreamFilter([]);
    const decoder = new TextDecoder();
    const output: string[] = [];
    const controller = {
      enqueue(data: Uint8Array) {
        output.push(decoder.decode(data));
      },
    } as ReadableStreamDefaultController<Uint8Array>;
    const wire = UNKNOWN_DEEPSEEK_SSE_EVENT.slice(0, -2);
    const frameDecoder = createDeepSeekSseFrameDecoder();

    filter.processFrames(frameDecoder.push(wire), controller);
    filter.processFrames(frameDecoder.finish(), controller);
    filter.flush(controller);

    expect(output.join('')).toBe(`${wire}\n\n`);
  });

  it('preserves event metadata, CRLF, and unknown siblings when filtering known text', () => {
    const filter = new XmlToolStreamFilter(createArtifactToolDescriptors('en'));
    const decoder = new TextDecoder();
    const output: string[] = [];
    const controller = {
      enqueue(data: Uint8Array) {
        output.push(decoder.decode(data));
      },
    } as ReadableStreamDefaultController<Uint8Array>;
    const wire = [
      'id: future-id',
      'event: future',
      ': preserve-comment',
      `data: ${JSON.stringify({
        p: 'response/content',
        o: 'APPEND',
        v: 'before <artifact_create>{"filename":"demo.html"}</artifact_create> after',
        future_sibling: { preserve: true },
      })}`,
      '',
      '',
    ].join('\r\n');
    const frameDecoder = createDeepSeekSseFrameDecoder();

    filter.processFrames(frameDecoder.push(wire), controller);
    filter.processFrames(frameDecoder.finish(), controller);
    filter.flush(controller);

    const visible = output.join('');
    expect(visible).toContain('id: future-id\r\n');
    expect(visible).toContain('event: future\r\n');
    expect(visible).toContain(': preserve-comment\r\n');
    expect(visible.endsWith('\r\n\r\n')).toBe(true);
    const parsed = parseSSEChunk(visible)
      .map((event) => parseSSEData(event.data) as Record<string, unknown>);
    expect(parsed.every((event) => JSON.stringify(event.future_sibling) === '{"preserve":true}')).toBe(true);
    expect(parsed.map((event) => event.v).join('')).toBe('before  after');
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
