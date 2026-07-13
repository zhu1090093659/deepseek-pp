import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRequestContext,
  interceptFetchResponse,
  updateHookState,
} from '../core/interceptor/fetch-hook';
import type { ToolDescriptor } from '../core/types';

describe('fetch hook request lifecycle', () => {
  const onRequestTerminal = vi.fn();

  beforeEach(() => {
    onRequestTerminal.mockReset();
    updateHookState({
      toolDescriptors: [makeDescriptor('global')],
      onRequestTerminal,
      onResponseComplete: vi.fn(),
      onResponseTokenSpeed: vi.fn(),
      onToolCall: vi.fn(),
      onToolCallChunk: vi.fn(),
      onToolCallStarted: vi.fn(),
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
});

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
