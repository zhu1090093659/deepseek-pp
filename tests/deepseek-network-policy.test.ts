import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NetworkPolicyError,
  fetchWithNetworkPolicy,
  readNetworkResponseText,
} from '../core/network/request-policy';
import { DEEPSEEK_BODY_BUDGETS } from '../core/deepseek/contracts';

describe('DeepSeek network policy', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enforces request and response budgets in UTF-8 bytes and cancels overflow', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('ok'));
    const onDispatch = vi.fn();
    await expect(fetchWithNetworkPolicy('https://chat.deepseek.com/test', {
      method: 'POST',
      body: '界',
    }, {
      operation: 'request-budget',
      maxRequestBytes: 2,
      maxResponseBytes: 16,
      fetchImpl,
      onDispatch,
    })).rejects.toMatchObject({ code: 'network_request_too_large', retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onDispatch).not.toHaveBeenCalled();

    const exactRequest = await fetchWithNetworkPolicy('https://chat.deepseek.com/test', {
      method: 'POST',
      body: '界',
    }, {
      operation: 'request-budget-exact',
      maxRequestBytes: 3,
      maxResponseBytes: 16,
      fetchImpl,
      onDispatch,
    });
    await expect(exactRequest.text()).resolves.toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledTimes(1);

    const exactResponse = await fetchWithNetworkPolicy('https://chat.deepseek.com/test', {}, {
      operation: 'response-budget-exact',
      maxResponseBytes: 3,
      fetchImpl: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
    });
    expect((await exactResponse.arrayBuffer()).byteLength).toBe(3);

    let cancelled = false;
    const overflow = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await fetchWithNetworkPolicy('https://chat.deepseek.com/test', {}, {
      operation: 'response-budget',
      maxResponseBytes: 3,
      fetchImpl: vi.fn(async () => new Response(overflow)),
    });
    await expect(readNetworkResponseText(response, 'response-budget'))
      .rejects.toMatchObject({ code: 'network_response_too_large', retryable: false });
    expect(cancelled).toBe(true);

    expect(DEEPSEEK_BODY_BUDGETS).toEqual({
      activeRequest: 4 * 1024 * 1024,
      activeJson: 4 * 1024 * 1024,
      activeCompletion: 4 * 1024 * 1024,
      officialApi: 4 * 1024 * 1024,
      conversationExport: 32 * 1024 * 1024,
    });
  });

  it('preserves the caller abort reason after response headers and prevents late bytes', async () => {
    const caller = new AbortController();
    const reason = new Error('automation cancelled');
    let cancelReason: unknown;
    const pendingBody = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel(nextReason) {
        cancelReason = nextReason;
      },
    });
    const response = await fetchWithNetworkPolicy('https://chat.deepseek.com/test', {
      signal: caller.signal,
    }, {
      operation: 'caller-cancellation',
      maxResponseBytes: 64,
      fetchImpl: vi.fn(async () => new Response(pendingBody)),
    });
    const body = readNetworkResponseText(response, 'caller-cancellation');
    caller.abort(reason);

    await expect(body).rejects.toBe(reason);
    expect(cancelReason).toBe(reason);
  });

  it('does not settle the exposed body until underlying cancellation finishes', async () => {
    const caller = new AbortController();
    const reason = new Error('automation cancelled');
    let releaseCancellation!: () => void;
    let cancellationStarted = false;
    const pendingBody = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {
        cancellationStarted = true;
        return new Promise<void>((resolve) => {
          releaseCancellation = resolve;
        });
      },
    });
    const response = await fetchWithNetworkPolicy('https://chat.deepseek.com/test', {
      signal: caller.signal,
    }, {
      operation: 'deferred-cancellation',
      maxResponseBytes: 64,
      fetchImpl: vi.fn(async () => new Response(pendingBody)),
    });
    const body = readNetworkResponseText(response, 'deferred-cancellation');
    let settled = false;
    void body.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    caller.abort(reason);
    await vi.waitFor(() => expect(cancellationStarted).toBe(true));
    expect(settled).toBe(false);

    releaseCancellation();
    await expect(body).rejects.toBe(reason);
  });

  it('waits for a non-cooperative fetch to settle, then cancels its late response', async () => {
    vi.useFakeTimers();
    let resolveFetch!: (response: Response) => void;
    let bodyCancelled = false;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const request = fetchWithNetworkPolicy('https://chat.deepseek.com/test', {}, {
      operation: 'absolute-deadline',
      deadlineAt: Date.now() + 10,
      maxResponseBytes: 64,
      fetchImpl,
    });
    let settled = false;
    void request.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);

    resolveFetch(new Response(new ReadableStream({
      cancel() {
        bodyCancelled = true;
      },
    })));
    await expect(request).rejects.toBeInstanceOf(NetworkPolicyError);
    await expect(request).rejects.toMatchObject({ code: 'network_deadline_exceeded', retryable: false });
    expect(bodyCancelled).toBe(true);
  });

  it('classifies pre-response fetch failures explicitly', async () => {
    const onDispatch = vi.fn();
    await expect(fetchWithNetworkPolicy('https://chat.deepseek.com/test', {}, {
      operation: 'network-failure',
      maxResponseBytes: 64,
      fetchImpl: vi.fn(async () => {
        throw new TypeError('offline');
      }),
      onDispatch,
    })).rejects.toMatchObject({
      code: 'network_request_failed',
      operation: 'network-failure',
      retryable: true,
    });
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });
});
