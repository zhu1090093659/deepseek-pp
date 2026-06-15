import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveChatLoop,
  markChatLoopFinished,
  markChatLoopStarted,
  reconcileInterruptedChatLoop,
} from '../core/chat/active-loop';

const STORAGE_KEY = 'deepseek_pp_active_chat_loop';

function createSessionStorageStub() {
  const storage = new Map<string, unknown>();
  const sessionApi = {
    get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
    set: vi.fn(async (value: Record<string, unknown>) => {
      for (const [key, storedValue] of Object.entries(value)) storage.set(key, storedValue);
    }),
    remove: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  };
  return {
    storage,
    chromeStub: { storage: { session: sessionApi } },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('active chat loop marker', () => {
  it('marks a loop as started and reads it back', async () => {
    const { chromeStub } = createSessionStorageStub();
    vi.stubGlobal('chrome', chromeStub);

    await markChatLoopStarted('web');

    const marker = await getActiveChatLoop();
    expect(marker).toEqual({
      active: true,
      startedAt: expect.any(Number),
      provider: 'web',
    });
  });

  it('clears the marker when the loop finishes', async () => {
    const { chromeStub } = createSessionStorageStub();
    vi.stubGlobal('chrome', chromeStub);

    await markChatLoopStarted('official-api');
    await markChatLoopFinished();

    expect(await getActiveChatLoop()).toBeNull();
  });

  it('ignores malformed stored markers', async () => {
    const { storage, chromeStub } = createSessionStorageStub();
    vi.stubGlobal('chrome', chromeStub);
    storage.set(STORAGE_KEY, { active: 'yes', startedAt: 'oops' });

    expect(await getActiveChatLoop()).toBeNull();
  });
});

describe('reconcileInterruptedChatLoop', () => {
  it('returns null and keeps the marker when the loop is still fresh', async () => {
    const { storage, chromeStub } = createSessionStorageStub();
    vi.stubGlobal('chrome', chromeStub);
    const startedAt = 1_000_000;
    storage.set(STORAGE_KEY, { active: true, startedAt, provider: 'web' });

    // Only 5s elapsed — under the 15s stale threshold.
    const result = await reconcileInterruptedChatLoop(startedAt + 5_000);

    expect(result).toBeNull();
    expect(storage.has(STORAGE_KEY)).toBe(true);
  });

  it('returns the interrupted loop and clears the marker once stale', async () => {
    const { storage, chromeStub } = createSessionStorageStub();
    vi.stubGlobal('chrome', chromeStub);
    const startedAt = 1_000_000;
    storage.set(STORAGE_KEY, { active: true, startedAt, provider: 'official-api' });

    // 20s elapsed — past the threshold, e.g. a SW restart.
    const result = await reconcileInterruptedChatLoop(startedAt + 20_000);

    expect(result).toEqual({
      provider: 'official-api',
      startedAt,
      interruptedAt: startedAt + 20_000,
    });
    expect(storage.has(STORAGE_KEY)).toBe(false);
  });

  it('returns null when no marker exists', async () => {
    const { chromeStub } = createSessionStorageStub();
    vi.stubGlobal('chrome', chromeStub);

    expect(await reconcileInterruptedChatLoop(Date.now())).toBeNull();
  });
});
