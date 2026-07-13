import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeWebSearchToolCall } from '../core/tool/web-search';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web tool cancellation', () => {
  it('propagates the automation signal into web_fetch network I/O', async () => {
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
    })));
    const controller = new AbortController();
    const reason = new Error('automation deleted');
    const pending = executeWebSearchToolCall({
      name: 'web_fetch',
      payload: { url: 'https://example.test/' },
      raw: '<web_fetch />',
    }, 'en', { signal: controller.signal });

    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(observedSignal?.aborted).toBe(true);
  });

  it.each([
    ['an HTTP error', new Response('failure', { status: 503, statusText: 'Unavailable' })],
    ['an unsupported content type', new Response('binary', {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    })],
  ])('cancels an unconsumed response body for %s', async (_case, response) => {
    const cancelSpy = vi.spyOn(response.body!, 'cancel');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await executeWebSearchToolCall({
      name: 'web_fetch',
      payload: { url: 'https://example.test/resource' },
      raw: '<web_fetch />',
    }, 'en');

    expect(cancelSpy).toHaveBeenCalledOnce();
  });

  it.each([
    ['an HTTP error', false, 503, 'text/plain'],
    ['an unsupported content type', true, 200, 'application/octet-stream'],
  ])('preserves the primary result when body cancellation fails for %s', async (
    _case,
    ok,
    status,
    contentType,
  ) => {
    const cancelError = new Error('stream cancel failed');
    const cancel = vi.fn().mockRejectedValue(cancelError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Unavailable',
      headers: new Headers({ 'content-type': contentType }),
      body: { cancel },
    } as unknown as Response));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await executeWebSearchToolCall({
      name: 'web_fetch',
      payload: { url: 'https://example.test/resource' },
      raw: '<web_fetch />',
    }, 'en');

    expect(result.ok).toBe(ok);
    expect(cancel).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      '[DeepSeek++] Failed to cancel an unused web response body:',
      cancelError,
    );
    warn.mockRestore();
  });
});
