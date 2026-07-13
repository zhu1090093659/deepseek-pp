import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BYPASS_HOOK_HEADER,
  createPowHeadersForPath,
  DEEPSEEK_FILE_UPLOAD_PATH,
  submitPromptStreaming,
  uploadDeepSeekFile,
} from '../core/deepseek/adapter';
import type { ResponseTokenSpeedPayload } from '../core/interceptor/token-speed';

vi.mock('../core/deepseek/pow', () => ({
  solvePowChallengeLocally: vi.fn(async () => ({
    algorithm: 'sha256',
    challenge: 'challenge',
    salt: 'salt',
    answer: 42,
    signature: 'signature',
  })),
}));

describe('DeepSeek web adapter streaming', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('can stream chunks without retaining the full assistant text', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => createSseResponse([
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
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => createSseResponse([
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

  it('cancels a stream after headers without emitting late callbacks', async () => {
    const caller = new AbortController();
    const reason = new Error('stop active completion');
    const onTextChunk = vi.fn();
    const onFinished = vi.fn();
    const cancel = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel,
    })));
    vi.stubGlobal('fetch', fetchMock);

    const completion = submitPromptStreaming(
      createSubmitInput(),
      { onTextChunk, onFinished },
      caller.signal,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    caller.abort(reason);

    await expect(completion).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(onTextChunk).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('emits token speed progress for bypass streaming requests', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => createSseResponse([
      'event: ready\ndata: {"request_message_id":1,"response_message_id":2,"model_type":"vision"}',
      'data: {"v":{"response":{"message_id":2,"inserted_at":1000,"accumulated_token_usage":0}}}',
      'data: {"p":"response/fragments/-1/content","v":"Hello "}',
      'data: {"p":"response/fragments/-1/content","v":"world"}',
      'data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":3302},{"p":"quasi_status","v":"FINISHED"}]}',
      'event: update_session\ndata: {"updated_at":1003.11}',
    ].join('\n\n'))));

    const progress: ResponseTokenSpeedPayload[] = [];
    const turn = await submitPromptStreaming(createSubmitInput(), {
      onTokenSpeed(next) {
        progress.push(next);
      },
      onTextChunk() {
        now += 1000;
      },
    });

    const final = progress.at(-1);
    expect(turn.responseMessageId).toBe(2);
    expect(final).toMatchObject({
      active: false,
      accumulatedTokens: 3302,
      tokenSource: 'server',
      speedSource: 'server',
      modelType: 'vision',
      chatSessionId: 'session-1',
      assistantMessageId: 2,
    });
    expect(final?.tokensPerSecond).toBeCloseTo(3302 / 3.11, 5);
  });

  it('creates PoW headers for the requested DeepSeek target path', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      data: {
        biz_code: 0,
        biz_data: {
          challenge: {
            algorithm: 'sha256',
            challenge: 'challenge',
            salt: 'salt',
            difficulty: 1,
            signature: 'signature',
          },
        },
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const headers = await createPowHeadersForPath({ Authorization: 'Bearer token' }, DEEPSEEK_FILE_UPLOAD_PATH);

    expect(fetchMock).toHaveBeenCalledWith('https://chat.deepseek.com/api/v0/chat/create_pow_challenge', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ target_path: DEEPSEEK_FILE_UPLOAD_PATH }),
    }));
    const payload = JSON.parse(atob(headers['X-DS-PoW-Response']));
    expect(payload).toMatchObject({
      target_path: DEEPSEEK_FILE_UPLOAD_PATH,
      answer: 42,
      signature: 'signature',
    });
  });

  it('uploads images through the official DeepSeek file endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      data: {
        biz_code: 0,
        biz_data: {
          id: 'file-image-1',
          file_name: 'shot.png',
          file_size: 3,
          mime_type: 'image/png',
          status: 'SUCCESS',
          signed_path: '/signed/image',
        },
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const file = new Blob(['abc'], { type: 'image/png' });
    const uploaded = await uploadDeepSeekFile({
      file,
      filename: 'shot.png',
      modelType: 'vision',
      clientHeaders: { Authorization: 'Bearer token' },
      powHeaders: { 'X-DS-PoW-Response': 'pow' },
    });

    expect(uploaded).toMatchObject({
      id: 'file-image-1',
      fileName: 'shot.png',
      fileSize: 3,
      mimeType: 'image/png',
      status: 'SUCCESS',
      signedPath: '/signed/image',
    });
    const [, options] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe('https://chat.deepseek.com/api/v0/file/upload_file');
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
    const headers = (options as RequestInit).headers as Record<string, string>;
    expect(headers[BYPASS_HOOK_HEADER]).toBe('1');
    expect(headers['x-model-type']).toBe('vision');
    expect(headers['x-file-size']).toBe('3');
    expect(headers['content-type']).toBeUndefined();
    expect((options as RequestInit).body).toBeInstanceOf(FormData);
  });

  it('accepts successful image uploads while DeepSeek reports audit_result unknown', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      data: {
        biz_code: 0,
        biz_data: {
          id: 'file-image-1',
          file_name: 'shot.png',
          file_size: 3,
          mime_type: 'image/png',
          status: 'SUCCESS',
          audit_result: 'unknown',
        },
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const uploaded = await uploadDeepSeekFile({
      file: new Blob(['abc'], { type: 'image/png' }),
      filename: 'shot.png',
      modelType: 'vision',
      clientHeaders: { Authorization: 'Bearer token' },
      powHeaders: { 'X-DS-PoW-Response': 'pow' },
    });

    expect(uploaded).toMatchObject({
      id: 'file-image-1',
      status: 'SUCCESS',
      auditResult: 'unknown',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects image uploads when DeepSeek reports explicit audit rejection', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      data: {
        biz_code: 0,
        biz_data: {
          id: 'file-image-1',
          file_name: 'shot.png',
          file_size: 3,
          mime_type: 'image/png',
          status: 'SUCCESS',
          audit_result: 'REJECTED',
        },
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadDeepSeekFile({
      file: new Blob(['abc'], { type: 'image/png' }),
      filename: 'shot.png',
      modelType: 'vision',
      clientHeaders: { Authorization: 'Bearer token' },
      powHeaders: { 'X-DS-PoW-Response': 'pow' },
    })).rejects.toThrow('DeepSeek rejected shot.png: audit_result=REJECTED.');
  });

  it('waits for uploaded images to finish processing before returning', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('/api/v0/file/upload_file')) {
        return jsonResponse({
          data: {
            biz_code: 0,
            biz_data: {
              id: 'file-image-1',
              file_name: 'shot.png',
              file_size: 3,
              mime_type: 'image/png',
              status: 'PENDING',
            },
          },
        });
      }
      if (url.includes('/api/v0/file/fetch_files')) {
        return jsonResponse({
          data: {
            biz_code: 0,
            biz_data: {
              files: [{
                id: 'file-image-1',
                file_name: 'shot.png',
                file_size: 3,
                mime_type: 'image/png',
                status: 'SUCCESS',
                audit_result: 'PASS',
              }],
            },
          },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = uploadDeepSeekFile({
      file: new Blob(['abc'], { type: 'image/png' }),
      filename: 'shot.png',
      modelType: 'vision',
      clientHeaders: { Authorization: 'Bearer token' },
      powHeaders: { 'X-DS-PoW-Response': 'pow' },
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    const uploaded = await promise;

    expect(uploaded.status).toBe('SUCCESS');
    expect(uploaded.auditResult).toBe('PASS');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://chat.deepseek.com/api/v0/file/fetch_files?file_ids=file-image-1');
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}
