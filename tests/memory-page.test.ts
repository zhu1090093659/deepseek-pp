import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Memory } from '../core/types';
import MemoryPage from '../entrypoints/sidepanel/pages/MemoryPage';

let container: HTMLDivElement;
let root: Root | null;
let runtimeListeners: Array<(message: unknown) => void>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  runtimeListeners = [];
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('MemoryPage', () => {
  it('does not let an older initial read replace a newer state update', async () => {
    let resolveInitialRead!: (value: unknown) => void;
    const initialRead = new Promise<unknown>((resolve) => {
      resolveInitialRead = resolve;
    });
    const sendMessage = vi.fn(() => initialRead);
    await renderMemoryPage(sendMessage);

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'STATE_UPDATED',
        memories: [createMemory('newer-update')],
      }));
    });
    expect(container.textContent).toContain('newer-update');

    await act(async () => {
      resolveInitialRead([createMemory('older-read')]);
      await initialRead;
    });
    expect(container.textContent).toContain('newer-update');
    expect(container.textContent).not.toContain('older-read');
  });

  it('retains the last valid list and surfaces a corrupt state update', async () => {
    const sendMessage = vi.fn(async () => [createMemory('remember-me')]);
    await renderMemoryPage(sendMessage);

    expect(container.textContent).toContain('remember-me');

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'STATE_UPDATED',
        memories: [{ name: 'corrupt' }],
      }));
    });

    expect(container.textContent).toContain('remember-me');
    expect(container.textContent).toContain('memoryUpdate[0].id must be a positive safe integer');
    expect(container.textContent).not.toContain('还没有记忆');
  });

  it('does not render an empty-state success when the initial repository read fails', async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, error: 'memory database unavailable' }));
    await renderMemoryPage(sendMessage);

    expect(container.textContent).toContain('memory database unavailable');
    expect(container.textContent).not.toContain('还没有记忆');
  });
});

async function renderMemoryPage(sendMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListeners.push(listener);
        }),
        removeListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListeners = runtimeListeners.filter((item) => item !== listener);
        }),
      },
    },
  });

  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(MemoryPage));
  });
}

function createMemory(name: string): Memory {
  return {
    id: 1,
    syncId: 'sync-1',
    scope: 'global',
    type: 'topic',
    name,
    content: 'content',
    description: '',
    tags: [],
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    lastAccessedAt: 1,
  };
}
