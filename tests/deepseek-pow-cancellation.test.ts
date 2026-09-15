import { afterEach, describe, expect, it, vi } from 'vitest';
import { solvePowChallengeLocally } from '../core/deepseek/pow';
import {
  DEEPSEEK_POW_DEADLINE_MS,
  createPowHeaders,
} from '../core/deepseek/active-client';
import { DeepSeekPowError } from '../core/deepseek/errors';
import { NetworkPolicyError } from '../core/network/request-policy';

const TEST_WASM_URL = 'chrome-extension://test/deepseek/sha3_wasm_bg.wasm';
const CLIENT_HEADERS = { Authorization: 'Bearer test-token' };

function createPowChallengeResponse(): Response {
  return new Response(JSON.stringify({
    data: {
      biz_code: 0,
      biz_data: {
        challenge: {
          algorithm: 'DeepSeekHashV1',
          challenge: 'd'.repeat(64),
          salt: 'salt',
          difficulty: 1,
          signature: 'signature',
          expire_at: Date.now() + 60_000,
        },
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DeepSeek PoW cancellation', () => {
  it('propagates cancellation into a pending WASM fetch', async () => {
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
    })));
    const controller = new AbortController();
    const reason = new Error('automation deadline');
    const pending = solvePowChallengeLocally({
      algorithm: 'DeepSeekHashV1',
      challenge: 'a'.repeat(64),
      salt: 'salt',
      difficulty: 100,
      signature: 'signature',
      expireAt: Date.now() + 60_000,
    }, 'chrome-extension://test/deepseek/sha3_wasm_bg.wasm', controller.signal);

    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(observedSignal?.aborted).toBe(true);
  });

  it('shares one cancellable cold load across concurrent automation runs', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const challenge = {
      algorithm: 'DeepSeekHashV1',
      challenge: 'b'.repeat(64),
      salt: 'salt',
      difficulty: 100,
      signature: 'signature',
      expireAt: Date.now() + 60_000,
    };
    const first = solvePowChallengeLocally(
      challenge,
      'chrome-extension://test/deepseek/sha3_wasm_bg.wasm',
      firstController.signal,
    );
    const second = solvePowChallengeLocally(
      challenge,
      'chrome-extension://test/deepseek/sha3_wasm_bg.wasm',
      secondController.signal,
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    firstController.abort(new Error('first automation deleted'));
    await expect(first).rejects.toThrow('first automation deleted');
    expect(observedSignal?.aborted).toBe(false);

    secondController.abort(new Error('second automation deleted'));
    await expect(second).rejects.toThrow('second automation deleted');
    expect(observedSignal?.aborted).toBe(true);
  });

  it('starts a fresh cold load instead of joining an aborting zero-waiter load', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error('missing load signal');
      signals.push(signal);
      if (signals.length === 2) {
        return Promise.resolve(new Response(new Uint8Array([0]), { status: 200 }));
      }
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }));
    vi.spyOn(WebAssembly, 'instantiate').mockRejectedValueOnce(new Error('fresh load reached instantiate'));
    const firstController = new AbortController();
    const challenge = {
      algorithm: 'DeepSeekHashV1',
      challenge: 'c'.repeat(64),
      salt: 'salt',
      difficulty: 100,
      signature: 'signature',
      expireAt: Date.now() + 60_000,
    };
    const first = solvePowChallengeLocally(
      challenge,
      'chrome-extension://test/deepseek/sha3_wasm_bg.wasm',
      firstController.signal,
    );

    await vi.waitFor(() => expect(signals).toHaveLength(1));
    firstController.abort(new Error('first load canceled'));
    const second = solvePowChallengeLocally(
      challenge,
      'chrome-extension://test/deepseek/sha3_wasm_bg.wasm',
      new AbortController().signal,
    );

    await expect(first).rejects.toThrow('first load canceled');
    await expect(second).rejects.toThrow('fresh load reached instantiate');
    expect(signals).toHaveLength(2);
  });

  it('rejects with a deadline error when the PoW challenge fetch never resolves', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = createPowHeaders(CLIENT_HEADERS, TEST_WASM_URL);
    const assertion = expect(pending).rejects.toBeInstanceOf(NetworkPolicyError);
    await vi.advanceTimersByTimeAsync(DEEPSEEK_POW_DEADLINE_MS);
    await assertion;
    await expect(pending).rejects.toMatchObject({ code: 'network_deadline_exceeded', retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(observedSignal?.aborted).toBe(true);
  });

  it('rejects when the WASM fetch never answers on its own', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((input: unknown, init?: { signal?: AbortSignal }) => {
      if (String(input).includes('create_pow_challenge')) {
        return Promise.resolve(createPowChallengeResponse());
      }
      // Hung fetch: never answers by itself, only fails when aborted.
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
      });
    }));

    const pending = createPowHeaders(CLIENT_HEADERS, TEST_WASM_URL);
    const assertion = expect(pending).rejects.toBeInstanceOf(DeepSeekPowError);
    await vi.advanceTimersByTimeAsync(DEEPSEEK_POW_DEADLINE_MS);
    await assertion;
    await expect(pending).rejects.toThrow('DeepSeek PoW challenge failed');
  });

  it('propagates the caller abort reason out of a pending PoW solve', async () => {
    const fetchMock = vi.fn((input: unknown, init?: { signal?: AbortSignal }) => {
      if (String(input).includes('create_pow_challenge')) {
        return Promise.resolve(createPowChallengeResponse());
      }
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const reason = new Error('turn cancelled');

    const pending = createPowHeaders(CLIENT_HEADERS, TEST_WASM_URL, controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });
});
