import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRequestContext,
  hookFetch,
  hookXHR,
  interceptFetchResponse,
  type RequestBodyModification,
  updateHookState,
} from '../core/interceptor/fetch-hook';
import type { ToolDescriptor } from '../core/types';
import type { DeepSeekAugmentableWebRoute } from '../core/deepseek/request-codec';

describe('fetch hook request lifecycle', () => {
  const onRequestTerminal = vi.fn();
  const onResponseComplete = vi.fn();
  const onResponseTokenSpeed = vi.fn();
  const onToolCall = vi.fn();
  const onToolCallChunk = vi.fn();
  const onToolCallStarted = vi.fn();
  const onHeadersCaptured = vi.fn();
  const onRequestBody = vi.fn<(
    body: string,
    requestId: string,
    route: DeepSeekAugmentableWebRoute,
  ) => Promise<RequestBodyModification | null>>(async () => null);

  beforeEach(() => {
    for (const mock of [
      onRequestTerminal,
      onResponseComplete,
      onResponseTokenSpeed,
      onToolCall,
      onToolCallChunk,
      onToolCallStarted,
      onHeadersCaptured,
      onRequestBody,
    ]) mock.mockReset();
    updateHookState({
      toolDescriptors: [makeDescriptor('global')],
      onRequestTerminal,
      onResponseComplete,
      onResponseTokenSpeed,
      onToolCall,
      onToolCallChunk,
      onToolCallStarted,
      onHeadersCaptured,
      onRequestBody,
    });
  });

  it('keeps a request-owned descriptor snapshot after global hook state changes', () => {
    const requestDescriptor = makeDescriptor('request');
    const context = createRequestContext('{"prompt":"hello"}', {
      requestId: 'request-1',
      toolDescriptors: [requestDescriptor],
    });

    updateHookState({ toolDescriptors: [makeDescriptor('later-global')] });

    expect(context.toolDescriptors).toEqual([requestDescriptor]);
  });

  it('emits a terminal event when fetch rejects or returns no body', async () => {
    const rejected = createRequestContext('{"prompt":"hello"}', { requestId: 'request-rejected' });
    await expect(interceptFetchResponse(
      Promise.reject(new Error('network failed')),
      rejected,
    )).rejects.toThrow('network failed');

    const noBody = createRequestContext('{"prompt":"hello"}', { requestId: 'request-no-body' });
    await interceptFetchResponse(Promise.resolve(new Response(null, { status: 204 })), noBody);

    expect(onRequestTerminal.mock.calls.map(([payload]) => payload.requestId)).toEqual([
      'request-rejected',
      'request-no-body',
    ]);
  });

  it('emits one terminal event when the consumer cancels a streaming response', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start() {
        // Keep the source open until the wrapped response is cancelled.
      },
    }));
    const context = createRequestContext('{"prompt":"hello"}', { requestId: 'request-cancelled' });
    const wrapped = await interceptFetchResponse(Promise.resolve(response), context);

    await wrapped.body?.cancel();

    expect(onRequestTerminal).toHaveBeenCalledTimes(1);
    expect(onRequestTerminal).toHaveBeenCalledWith({ requestId: 'request-cancelled' });
  });

  it('does not release terminal authority until upstream cancellation settles', async () => {
    let resolveCancellation!: () => void;
    const cancelStarted = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      cancel() {
        cancelStarted();
        return new Promise<void>((resolve) => {
          resolveCancellation = resolve;
        });
      },
    }));
    const context = createRequestContext('{"prompt":"hello"}', { requestId: 'request-cancel-await' });
    const wrapped = await interceptFetchResponse(Promise.resolve(response), context);

    const cancellation = wrapped.body!.cancel(new Error('stop'));
    await vi.waitFor(() => expect(cancelStarted).toHaveBeenCalledTimes(1));
    expect(onRequestTerminal).not.toHaveBeenCalled();
    expect(onResponseComplete).not.toHaveBeenCalled();

    resolveCancellation();
    await cancellation;

    expect(onRequestTerminal).toHaveBeenCalledOnce();
    expect(onResponseComplete).not.toHaveBeenCalled();
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('publishes one inactive token metric after cancelling an active stream', async () => {
    const wire = 'data: {"p":"response/content","o":"APPEND","v":"partial"}\n\n';
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(wire));
      },
    }));
    const context = createRequestContext('{"prompt":"hello"}', { requestId: 'request-active-cancel' });
    const wrapped = await interceptFetchResponse(Promise.resolve(response), context);
    const reader = wrapped.body!.getReader();

    await reader.read();
    await reader.cancel();

    const activeStates = onResponseTokenSpeed.mock.calls.map(([progress]) => progress.active);
    expect(activeStates[0]).toBe(true);
    expect(activeStates.at(-1)).toBe(false);
    expect(activeStates.filter((active) => !active)).toHaveLength(1);
    expect(onRequestTerminal).toHaveBeenCalledOnce();
  });

  it('preserves response metadata and split UTF-8 visible stream bytes', async () => {
    const wire = [
      'event: ready\r\ndata: {"response_message_id":17,"model_type":"vision"}',
      'data: {"p":"response/content","o":"APPEND","v":"你好🙂"}',
      'data: {"p":"response/status","v":"FINISHED"}',
    ].join('\r\n\r\n') + '\r\n\r\n';
    const bytes = new TextEncoder().encode(wire);
    const splitAt = bytes.indexOf(0xf0) + 2;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    }), {
      status: 202,
      statusText: 'Accepted',
      headers: { 'x-contract': 'preserve' },
    });
    const context = createRequestContext('{"prompt":"hello"}', { requestId: 'request-utf8' });

    const wrapped = await interceptFetchResponse(Promise.resolve(response), context);

    expect(wrapped.status).toBe(202);
    expect(wrapped.statusText).toBe('Accepted');
    expect(wrapped.headers.get('x-contract')).toBe('preserve');
    await expect(wrapped.text()).resolves.toBe(wire);
    expect(onResponseComplete).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-utf8',
      text: '你好🙂',
      assistantMessageId: 17,
    }));
    expect(onRequestTerminal).toHaveBeenCalledOnce();
  });

  it('publishes one terminal parse failure for a started tool call left open at EOF', async () => {
    updateHookState({ toolDescriptors: [makeDescriptor('artifact_create')] });
    const wire = [
      'data: {"p":"response/content","o":"APPEND","v":"<artifact_create>{\\"filename\\":\\"unfinished.html\\""}',
      'data: {"p":"response/status","v":"FINISHED"}',
    ].join('\n\n') + '\n\n';
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(wire));
        controller.close();
      },
    }));
    const context = createRequestContext('{"prompt":"hello"}', { requestId: 'request-unclosed-tool' });

    const wrapped = await interceptFetchResponse(Promise.resolve(response), context);
    await wrapped.text();

    expect(onToolCallStarted).toHaveBeenCalledOnce();
    expect(onToolCall).toHaveBeenCalledOnce();
    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({
      id: onToolCallStarted.mock.calls[0][0].id,
      parseError: expect.objectContaining({ code: 'tool_call_incomplete' }),
      source: expect.objectContaining({ requestId: 'request-unclosed-tool' }),
    }));
    expect(onRequestTerminal).toHaveBeenCalledOnce();
  });

  it('reads at most one upstream chunk ahead of a stalled consumer', async () => {
    const encoder = new TextEncoder();
    let pullCount = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount > 20) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`data: {"p":"response/content","o":"APPEND","v":"${pullCount}"}\n\n`));
      },
    }));
    const context = createRequestContext('{"prompt":"hello"}', { requestId: 'request-backpressure' });

    const wrapped = await interceptFetchResponse(Promise.resolve(response), context);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pullCount).toBeLessThanOrEqual(1);
    expect(onResponseTokenSpeed).not.toHaveBeenCalled();
    await wrapped.body!.cancel();
    expect(onRequestTerminal).toHaveBeenCalledOnce();
  });

  it('surfaces reader failures and cleans response state exactly once', async () => {
    const failure = new Error('stream failed');
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    }));
    const context = createRequestContext('{"prompt":"hello"}', { requestId: 'request-reader-error' });
    const wrapped = await interceptFetchResponse(Promise.resolve(response), context);

    await expect(wrapped.text()).rejects.toBe(failure);

    expect(onRequestTerminal).toHaveBeenCalledOnce();
    expect(onResponseComplete).not.toHaveBeenCalled();
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('publishes one inactive token metric after an active reader fails', async () => {
    const failure = new Error('stream failed after data');
    const wire = 'data: {"p":"response/content","o":"APPEND","v":"partial"}\n\n';
    let pullCount = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(new TextEncoder().encode(wire));
          return;
        }
        controller.error(failure);
      },
    }));
    const context = createRequestContext('{"prompt":"hello"}', { requestId: 'request-active-error' });
    const wrapped = await interceptFetchResponse(Promise.resolve(response), context);
    const reader = wrapped.body!.getReader();

    await reader.read();
    await expect(reader.read()).rejects.toBe(failure);

    const activeStates = onResponseTokenSpeed.mock.calls.map(([progress]) => progress.active);
    expect(activeStates[0]).toBe(true);
    expect(activeStates.at(-1)).toBe(false);
    expect(activeStates.filter((active) => !active)).toHaveLength(1);
    expect(onRequestTerminal).toHaveBeenCalledOnce();
    expect(onResponseComplete).not.toHaveBeenCalled();
  });

  it('intercepts a synchronous OPENED XHR send and flushes EOF before page load handlers', async () => {
    const nativeXMLHttpRequest = globalThis.XMLHttpRequest;
    const rawWire = 'data: {"p":"response/content","o":"APPEND","v":"tail"}';
    const FakeXMLHttpRequest = createFakeXMLHttpRequest(rawWire, 200);
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);

    try {
      hookXHR();
      const xhr = new XMLHttpRequest();
      const pageLoadResponse = vi.fn<(value: string) => void>();
      xhr.addEventListener('readystatechange', () => {
        if (xhr.readyState !== 1) return;
        xhr.setRequestHeader('Authorization', 'Bearer test');
        xhr.send('{"prompt":"hello"}');
      });
      xhr.addEventListener('load', () => pageLoadResponse(xhr.responseText));

      xhr.open('POST', 'https://chat.deepseek.com/api/v0/chat/completion');

      await vi.waitFor(() => expect(pageLoadResponse).toHaveBeenCalledOnce());
      expect(onRequestBody).toHaveBeenCalledWith('{"prompt":"hello"}', expect.any(String), 'completion');
      expect(onHeadersCaptured).toHaveBeenCalledWith(expect.objectContaining({
        Authorization: 'Bearer test',
      }));
      expect(pageLoadResponse).toHaveBeenCalledWith(`${rawWire}\n\n`);
      expect(onResponseComplete).toHaveBeenCalledWith(expect.objectContaining({ text: 'tail' }));
      expect(onResponseTokenSpeed.mock.calls.at(-1)?.[0].active).toBe(false);
      expect(onRequestTerminal).toHaveBeenCalledOnce();
    } finally {
      vi.stubGlobal('XMLHttpRequest', nativeXMLHttpRequest);
    }
  });

  it('restores the previous XHR route and headers when native open throws', async () => {
    const nativeXMLHttpRequest = globalThis.XMLHttpRequest;
    const FakeXMLHttpRequest = createFakeXMLHttpRequest('', 204);
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);

    try {
      hookXHR();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://chat.deepseek.com/api/v0/chat/completion');
      xhr.setRequestHeader('Authorization', 'Bearer previous');
      (xhr as unknown as FakeXMLHttpRequestInstance).throwNextOpen = true;

      expect(() => xhr.open('GET', 'https://chat.deepseek.com/api/v0/chat/history_messages')).toThrow(
        'native open failed',
      );
      xhr.send('{"prompt":"hello"}');

      await vi.waitFor(() => expect(onRequestBody).toHaveBeenCalledOnce());
      expect(onHeadersCaptured).toHaveBeenCalledWith(expect.objectContaining({
        Authorization: 'Bearer previous',
      }));
    } finally {
      vi.stubGlobal('XMLHttpRequest', nativeXMLHttpRequest);
    }
  });

  it('delegates Web IDL-coercible non-string XHR methods without interceptor side effects', () => {
    const nativeXMLHttpRequest = globalThis.XMLHttpRequest;
    const FakeXMLHttpRequest = createFakeXMLHttpRequest('', 204);
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);

    try {
      hookXHR();
      const xhr = new XMLHttpRequest();

      (xhr.open as unknown as (method: unknown, url: unknown) => void)(
        { toString: () => 'POST' },
        'https://chat.deepseek.com/api/v0/chat/completion',
      );
      xhr.send('{"prompt":"hello"}');

      expect(onRequestBody).not.toHaveBeenCalled();
      expect(onHeadersCaptured).not.toHaveBeenCalled();
      expect((xhr as unknown as FakeXMLHttpRequestInstance).sentBody).toBe('{"prompt":"hello"}');
    } finally {
      vi.stubGlobal('XMLHttpRequest', nativeXMLHttpRequest);
    }
  });

  it('delegates an explicit non-string fetch method without interceptor side effects', async () => {
    const nativeFetch = window.fetch;
    const fetchImpl = vi.fn(async () => new Response('native'));
    window.fetch = fetchImpl;

    try {
      hookFetch();
      const request = new Request('https://chat.deepseek.com/api/v0/chat/completion', {
        method: 'POST',
        body: '{"prompt":"request"}',
      });

      await window.fetch(request, {
        method: null as unknown as string,
        body: '{"prompt":"override"}',
      });

      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(onRequestBody).not.toHaveBeenCalled();
      expect(onHeadersCaptured).not.toHaveBeenCalled();
    } finally {
      window.fetch = nativeFetch;
    }
  });

  it('augments edited-message requests before dispatch', async () => {
    const nativeFetch = window.fetch;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    window.fetch = fetchImpl;
    onRequestBody.mockResolvedValueOnce({
      body: '{"prompt":"augmented edit"}',
      agentTaskPrompt: 'edited prompt',
    });

    try {
      hookFetch();
      await window.fetch('https://chat.deepseek.com/api/v0/chat/edit_message', {
        method: 'POST',
        body: '{"prompt":"edited prompt"}',
      });

      expect(onRequestBody).toHaveBeenCalledWith(
        '{"prompt":"edited prompt"}',
        expect.any(String),
        'editMessage',
      );
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://chat.deepseek.com/api/v0/chat/edit_message',
        expect.objectContaining({ body: '{"prompt":"augmented edit"}' }),
      );
    } finally {
      window.fetch = nativeFetch;
    }
  });

  it('preserves a promptless regenerate fetch body while attaching replay context', async () => {
    const nativeFetch = window.fetch;
    const rawBody = '{\n  "chat_session_id": "session-1",\n  "child_message_id": 18,\n  "thinking_enabled": true\n}';
    const fetchImpl = vi.fn(async () => new Response(
      'data: {"p":"response/content","o":"APPEND","v":"done"}\n\n',
    ));
    window.fetch = fetchImpl;
    onRequestBody.mockResolvedValueOnce({
      body: rawBody,
      originalPrompt: 'review the implementation',
      agentTaskPrompt: 'review the implementation',
      requestId: 'authorized-regenerate-fetch',
      toolDescriptors: [makeDescriptor('request-regenerate')],
      promptOptions: {
        modelType: 'expert',
        searchEnabled: false,
        thinkingEnabled: true,
        refFileIds: ['file-1'],
      },
      activeLocalSkillDir: '/trusted/skill',
    });

    try {
      hookFetch();
      const response = await window.fetch('https://chat.deepseek.com/api/v0/chat/regenerate', {
        method: 'POST',
        body: rawBody,
      });
      await response.text();

      expect(onRequestBody).toHaveBeenCalledWith(rawBody, expect.any(String), 'regenerate');
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://chat.deepseek.com/api/v0/chat/regenerate',
        expect.objectContaining({ body: rawBody }),
      );
      expect(onResponseComplete).toHaveBeenCalledWith(expect.objectContaining({
        requestId: 'authorized-regenerate-fetch',
        originalPrompt: 'review the implementation',
        agentTaskPrompt: 'review the implementation',
        promptOptions: {
          modelType: 'expert',
          searchEnabled: false,
          thinkingEnabled: true,
          refFileIds: ['file-1'],
        },
      }));
    } finally {
      window.fetch = nativeFetch;
    }
  });

  it('preserves a promptless regenerate XHR body and route identity', async () => {
    const nativeXMLHttpRequest = globalThis.XMLHttpRequest;
    const rawBody = '{"chat_session_id":"session-1","child_message_id":18,"search_enabled":false}';
    const rawWire = 'data: {"p":"response/content","o":"APPEND","v":"done"}';
    const FakeXMLHttpRequest = createFakeXMLHttpRequest(rawWire, 200);
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    onRequestBody.mockResolvedValueOnce({
      body: rawBody,
      originalPrompt: 'review the implementation',
      agentTaskPrompt: 'review the implementation',
      requestId: 'authorized-regenerate-xhr',
      toolDescriptors: [makeDescriptor('request-regenerate')],
      promptOptions: {
        modelType: 'expert',
        searchEnabled: false,
        thinkingEnabled: true,
        refFileIds: [],
      },
      activeLocalSkillDir: '/trusted/skill',
    });

    try {
      hookXHR();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://chat.deepseek.com/api/v0/chat/regenerate');
      xhr.send(rawBody);

      await vi.waitFor(() => expect(onResponseComplete).toHaveBeenCalledOnce());
      expect(onRequestBody).toHaveBeenCalledWith(rawBody, expect.any(String), 'regenerate');
      expect((xhr as unknown as FakeXMLHttpRequestInstance).sentBody).toBe(rawBody);
      expect(onResponseComplete).toHaveBeenCalledWith(expect.objectContaining({
        requestId: 'authorized-regenerate-xhr',
        originalPrompt: 'review the implementation',
        promptOptions: expect.objectContaining({ modelType: 'expert' }),
      }));
    } finally {
      vi.stubGlobal('XMLHttpRequest', nativeXMLHttpRequest);
    }
  });

  it('installs fetch and XHR wrappers once while consuming the latest shared hook state', async () => {
    const nativeFetch = window.fetch;
    const nativeXMLHttpRequest = globalThis.XMLHttpRequest;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const FakeXMLHttpRequest = createFakeXMLHttpRequest('', 204);
    window.fetch = fetchImpl;
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);

    try {
      const uninstallFetch = hookFetch();
      const installedFetch = window.fetch;
      hookFetch();
      expect(window.fetch).toBe(installedFetch);

      const latestRequestBody = vi.fn(async () => null);
      updateHookState({ onRequestBody: latestRequestBody });
      await window.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
        method: 'POST',
        body: '{"prompt":"hello"}',
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(latestRequestBody).toHaveBeenCalledOnce();

      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      const uninstallXHR = hookXHR();
      const installedOpen = XMLHttpRequest.prototype.open;
      const installedSend = XMLHttpRequest.prototype.send;
      hookXHR();
      expect(XMLHttpRequest.prototype.open).toBe(installedOpen);
      expect(XMLHttpRequest.prototype.send).toBe(installedSend);

      uninstallXHR();
      uninstallFetch();
      expect(XMLHttpRequest.prototype.open).toBe(originalOpen);
      expect(XMLHttpRequest.prototype.send).toBe(originalSend);
      expect(window.fetch).toBe(fetchImpl);
    } finally {
      window.fetch = nativeFetch;
      vi.stubGlobal('XMLHttpRequest', nativeXMLHttpRequest);
    }
  });

  it('sends the original fetch and XHR when request augmentation rejects', async () => {
    const nativeFetch = window.fetch;
    const nativeXMLHttpRequest = globalThis.XMLHttpRequest;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const FakeXMLHttpRequest = createFakeXMLHttpRequest('', 204);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.fetch = fetchImpl;
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    onRequestBody.mockRejectedValue(new Error('DeepSeek++ main/content bridge disconnected.'));

    const requestBody = '{"prompt":"hello"}';
    let uninstallFetch: (() => void) | null = null;
    let uninstallXHR: (() => void) | null = null;
    try {
      uninstallFetch = hookFetch();
      const response = await window.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
        method: 'POST',
        body: requestBody,
      });
      expect(response.status).toBe(204);
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://chat.deepseek.com/api/v0/chat/completion',
        expect.objectContaining({ method: 'POST', body: requestBody }),
      );

      uninstallXHR = hookXHR();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://chat.deepseek.com/api/v0/chat/completion');
      xhr.send(requestBody);

      await vi.waitFor(() => {
        expect((xhr as unknown as FakeXMLHttpRequestInstance).sentBody).toBe(requestBody);
      });
      expect(consoleError).toHaveBeenCalledWith(
        '[DeepSeek++] fetch request augmentation failed; sending original request',
        expect.objectContaining({ message: 'DeepSeek++ main/content bridge disconnected.' }),
      );
      expect(consoleError).toHaveBeenCalledWith(
        '[DeepSeek++] XHR request augmentation failed; sending original request',
        expect.objectContaining({ message: 'DeepSeek++ main/content bridge disconnected.' }),
      );
      expect(consoleError).not.toHaveBeenCalledWith(
        '[DeepSeek++] intercepted XHR request failed',
        expect.anything(),
      );
    } finally {
      uninstallXHR?.();
      uninstallFetch?.();
      consoleError.mockRestore();
      window.fetch = nativeFetch;
      vi.stubGlobal('XMLHttpRequest', nativeXMLHttpRequest);
    }
  });

  it('filters known tool XML without executing it when fetch augmentation fails open', async () => {
    const nativeFetch = window.fetch;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const leakedToolCall = '<shell_session_begin>{"cwd":"C:\\Users\\mark0\\Documents"}</shell_session_begin>';
    const rawWire = `data: ${JSON.stringify({
      p: 'response/content',
      o: 'APPEND',
      v: `before\n${leakedToolCall}\nafter`,
    })}\n\n`;
    const fetchImpl = vi.fn(async () => new Response(rawWire));
    window.fetch = fetchImpl;
    updateHookState({ toolDescriptors: [makeDescriptor('shell_session_begin')] });
    onRequestBody.mockRejectedValue(new Error('DeepSeek++ main/content bridge disconnected.'));

    let uninstallFetch: (() => void) | null = null;
    try {
      uninstallFetch = hookFetch();
      const response = await window.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
        method: 'POST',
        body: '{"prompt":"hello"}',
      });
      const visibleWire = await response.text();

      expect(visibleWire).not.toContain('<shell_session_begin>');
      expect(visibleWire).not.toContain('C:\\Users\\mark0\\Documents');
      expect(onToolCall).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(onResponseComplete).toHaveBeenCalledOnce());
    } finally {
      uninstallFetch?.();
      consoleError.mockRestore();
      window.fetch = nativeFetch;
    }
  });

  it('filters known tool XML without executing it when XHR augmentation fails open', async () => {
    const nativeXMLHttpRequest = globalThis.XMLHttpRequest;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const leakedToolCall = '<shell_session_begin>{"cwd":"C:\\Users\\mark0\\Documents"}</shell_session_begin>';
    const rawWire = `data: ${JSON.stringify({
      p: 'response/content',
      o: 'APPEND',
      v: `before\n${leakedToolCall}\nafter`,
    })}\n\n`;
    const FakeXMLHttpRequest = createFakeXMLHttpRequest(rawWire, 200);
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    updateHookState({ toolDescriptors: [makeDescriptor('shell_session_begin')] });
    onRequestBody.mockRejectedValue(new Error('DeepSeek++ main/content bridge disconnected.'));

    let uninstallXHR: (() => void) | null = null;
    try {
      uninstallXHR = hookXHR();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://chat.deepseek.com/api/v0/chat/completion');
      xhr.send('{"prompt":"hello"}');

      await vi.waitFor(() => {
        expect((xhr as unknown as FakeXMLHttpRequestInstance).sentBody).toBe('{"prompt":"hello"}');
      });
      await vi.waitFor(() => expect(onResponseComplete).toHaveBeenCalledOnce());

      expect(xhr.responseText).not.toContain('<shell_session_begin>');
      expect(xhr.responseText).not.toContain('C:\\Users\\mark0\\Documents');
      expect(onToolCall).not.toHaveBeenCalled();
    } finally {
      uninstallXHR?.();
      consoleError.mockRestore();
      vi.stubGlobal('XMLHttpRequest', nativeXMLHttpRequest);
    }
  });

  it('cancels XHR network failures without publishing a false completion', async () => {
    const nativeXMLHttpRequest = globalThis.XMLHttpRequest;
    const rawWire = 'data: {"p":"response/content","o":"APPEND","v":"partial"}\n\n';
    const FakeXMLHttpRequest = createFakeXMLHttpRequest(rawWire, 0, 'error');
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);

    try {
      hookXHR();
      const xhr = new XMLHttpRequest();
      xhr.addEventListener('readystatechange', () => {
        if (xhr.readyState === 1) xhr.send('{"prompt":"hello"}');
      });

      xhr.open('POST', 'https://chat.deepseek.com/api/v0/chat/completion');

      await vi.waitFor(() => expect(onRequestTerminal).toHaveBeenCalledOnce());
      expect(onResponseComplete).not.toHaveBeenCalled();
      const activeStates = onResponseTokenSpeed.mock.calls.map(([progress]) => progress.active);
      expect(activeStates[0]).toBe(true);
      expect(activeStates.at(-1)).toBe(false);
      expect(activeStates.filter((active) => !active)).toHaveLength(1);
    } finally {
      vi.stubGlobal('XMLHttpRequest', nativeXMLHttpRequest);
    }
  });

  it('cancels XHR response state when native send throws synchronously', async () => {
    const nativeXMLHttpRequest = globalThis.XMLHttpRequest;
    const FakeXMLHttpRequest = createFakeXMLHttpRequest('', 0);
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      hookXHR();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://chat.deepseek.com/api/v0/chat/completion');
      (xhr as unknown as FakeXMLHttpRequestInstance).throwNextSend = true;

      xhr.send('{"prompt":"hello"}');

      await vi.waitFor(() => expect(onRequestTerminal).toHaveBeenCalledOnce());
      expect(onResponseComplete).not.toHaveBeenCalled();
      const activeStates = onResponseTokenSpeed.mock.calls.map(([progress]) => progress.active);
      expect(activeStates[0]).toBe(true);
      expect(activeStates.at(-1)).toBe(false);
      expect(activeStates.filter((active) => !active)).toHaveLength(1);
      expect(consoleError).toHaveBeenCalledWith(
        '[DeepSeek++] intercepted XHR request failed',
        expect.objectContaining({ message: 'native send failed' }),
      );
    } finally {
      consoleError.mockRestore();
      vi.stubGlobal('XMLHttpRequest', nativeXMLHttpRequest);
    }
  });
});

interface FakeXMLHttpRequestInstance {
  sentBody: Document | XMLHttpRequestBodyInit | null | undefined;
  throwNextOpen: boolean;
  throwNextSend: boolean;
}

function createFakeXMLHttpRequest(
  rawWire: string,
  status: number,
  terminalEvent: 'load' | 'error' = 'load',
) {
  return class FakeXMLHttpRequest extends EventTarget {
    readyState = 0;
    responseType: XMLHttpRequestResponseType = '';
    status = 0;
    throwNextOpen = false;
    throwNextSend = false;
    sentBody: Document | XMLHttpRequestBodyInit | null | undefined;
    private rawResponseText = '';

    get responseText() {
      return this.rawResponseText;
    }

    get response() {
      return this.rawResponseText;
    }

    open(_method: unknown, _url: unknown) {
      if (this.throwNextOpen) {
        this.throwNextOpen = false;
        throw new Error('native open failed');
      }
      this.readyState = 1;
      this.dispatchEvent(new Event('readystatechange'));
    }

    setRequestHeader(_name: string, _value: string) {}

    send(body?: Document | XMLHttpRequestBodyInit | null) {
      if (this.throwNextSend) {
        this.throwNextSend = false;
        throw new Error('native send failed');
      }
      this.sentBody = body;
      this.rawResponseText = rawWire;
      this.status = status;
      this.readyState = 4;
      this.dispatchEvent(new Event('readystatechange'));
      this.dispatchEvent(new Event(terminalEvent));
    }
  } as unknown as typeof XMLHttpRequest;
}

function makeDescriptor(id: string): ToolDescriptor {
  return {
    id: `local:test:${id}`,
    provider: { kind: 'local', id: 'test', displayName: 'Test', transport: 'in_process' },
    name: id,
    invocationName: id,
    title: id,
    description: id,
    inputSchema: { type: 'object', properties: {} },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  };
}
