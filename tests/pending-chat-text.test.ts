import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_CHAT_TEXT_STORAGE_KEY,
  pendingChatTextStore,
  type PendingChatTextStore,
} from '../core/chat/pending-text';
import { startPendingTextConsumer } from '../entrypoints/sidepanel/controllers/pending-text-controller';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pending chat text storage truth', () => {
  it('uses one typed key for write, read, change observation, and clear', async () => {
    let value: unknown;
    const listeners: Array<(
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => void> = [];
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ [PENDING_CHAT_TEXT_STORAGE_KEY]: value })),
          set: vi.fn(async (next: Record<string, unknown>) => {
            value = next[PENDING_CHAT_TEXT_STORAGE_KEY];
          }),
          remove: vi.fn(async () => {
            value = undefined;
          }),
        },
        onChanged: {
          addListener: vi.fn((listener) => listeners.push(listener)),
          removeListener: vi.fn((listener) => {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
          }),
        },
      },
    });

    await pendingChatTextStore.write('Review this selection');
    await expect(pendingChatTextStore.read()).resolves.toBe('Review this selection');

    const observed: Array<string | null> = [];
    const errors: unknown[] = [];
    const unsubscribe = pendingChatTextStore.subscribe(
      (text) => observed.push(text),
      (error) => errors.push(error),
    );
    listeners[0]?.({
      [PENDING_CHAT_TEXT_STORAGE_KEY]: { newValue: 'Updated selection' },
    }, 'local');
    listeners[0]?.({
      [PENDING_CHAT_TEXT_STORAGE_KEY]: { newValue: { corrupt: true } },
    }, 'local');

    expect(observed).toEqual(['Updated selection']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    unsubscribe();
    await pendingChatTextStore.clear();
    await expect(pendingChatTextStore.read()).resolves.toBeNull();
  });

  it('fences a stale initial read behind a newer storage event', async () => {
    let resolveRead!: (text: string | null) => void;
    const read = new Promise<string | null>((resolve) => {
      resolveRead = resolve;
    });
    const subscription: { listener?: (text: string | null) => void } = {};
    const clear = vi.fn(async () => undefined);
    const store: PendingChatTextStore = {
      read: () => read,
      write: vi.fn(async () => undefined),
      clear,
      subscribe(next) {
        subscription.listener = next;
        return () => { delete subscription.listener; };
      },
    };
    const received: string[] = [];
    const errors: unknown[] = [];
    const consumer = startPendingTextConsumer({
      store,
      onText: (text) => received.push(text),
      onError: (_operation, error) => errors.push(error),
    });

    expect(subscription.listener).toBeTypeOf('function');
    subscription.listener!('newer event');
    resolveRead('older read');
    await read;
    await Promise.resolve();

    expect(received).toEqual(['newer event']);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
    consumer.stop();
  });

  it('delivers confirmed text while exposing clear failures', async () => {
    const clearError = new Error('storage remove failed');
    const store: PendingChatTextStore = {
      read: async () => 'pending text',
      write: vi.fn(async () => undefined),
      clear: vi.fn(async () => { throw clearError; }),
      subscribe: () => () => undefined,
    };
    const received: string[] = [];
    const errors: Array<{ operation: string; error: unknown }> = [];
    startPendingTextConsumer({
      store,
      onText: (text) => received.push(text),
      onError: (operation, error) => errors.push({ operation, error }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toEqual(['pending text']);
    expect(errors).toEqual([{ operation: 'clear', error: clearError }]);
  });

  it('keeps Background and Side Panel on the shared storage path', () => {
    const app = readFileSync('entrypoints/sidepanel/App.tsx', 'utf8');
    const background = readFileSync('entrypoints/background.ts', 'utf8');
    const start = background.indexOf('async function openSidePanelAndSendText');
    const end = background.indexOf('async function ensureBuiltInMcpPresets', start);
    const delivery = background.slice(start, end);

    expect(app).toContain('startPendingTextConsumer');
    expect(app).not.toContain('OPEN_CHAT_WITH_TEXT');
    expect(app).not.toContain("storage.local.remove('pendingChatText')");
    expect(delivery).toContain('pendingChatTextStore.write(text)');
    expect(delivery).toContain("runtime.sendMessage({ type: 'OPEN_CHAT_WITH_TEXT', text })");
    expect(delivery.indexOf('pendingChatTextStore.write(text)')).toBeLessThan(
      delivery.indexOf("runtime.sendMessage({ type: 'OPEN_CHAT_WITH_TEXT', text })"),
    );
    expect(delivery).not.toContain('storage.local.set');
  });
});
