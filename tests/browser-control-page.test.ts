import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
} from '../core/browser-control';
import BrowserControlPage from '../entrypoints/sidepanel/pages/BrowserControlPage';

let container: HTMLDivElement;
let root: Root | null;
let runtimeListener: ((message: unknown) => void) | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  runtimeListener = null;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('BrowserControlPage', () => {
  it('keeps the newest invalidation reload when an older read finishes later', async () => {
    const staleSettings = deferred<unknown>();
    const staleState = deferred<unknown>();
    const newestTarget = target(9, 'Newest target');
    let settingsReads = 0;
    let stateReads = 0;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'GET_BROWSER_CONTROL_SETTINGS') {
        settingsReads += 1;
        return settingsReads === 1
          ? staleSettings.promise
          : Promise.resolve(settings(9));
      }
      if (message.type === 'GET_BROWSER_CONTROL_STATE') {
        stateReads += 1;
        return stateReads === 1
          ? staleState.promise
          : Promise.resolve(state(newestTarget));
      }
      return Promise.resolve({ ok: true });
    });
    stubChrome(sendMessage);

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(BrowserControlPage));
    });
    await act(async () => runtimeListener?.({ type: 'BROWSER_CONTROL_UPDATED' }));
    await settle();
    expect(container.textContent).toContain('Newest target');

    staleSettings.resolve(settings(3));
    staleState.resolve(state(target(3, 'Stale target')));
    await settle();

    expect(container.textContent).toContain('Newest target');
    expect(container.textContent).not.toContain('Stale target');
  });
});

function stubChrome(sendMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListener = listener;
        }),
        removeListener: vi.fn(),
      },
    },
  });
}

function settings(targetTabId: number): BrowserControlSettings {
  return {
    enabled: true,
    targetTabId,
    includeSnapshotAfterActions: true,
    maxSnapshotNodes: 400,
    maxSnapshotTextBytes: 24_000,
  };
}

function state(activeTarget: BrowserControlTarget): BrowserControlState {
  return {
    supported: true,
    enabled: true,
    attached: true,
    targetTabId: activeTarget.id,
    target: activeTarget,
    targets: [activeTarget],
    error: null,
  };
}

function target(id: number, title: string): BrowserControlTarget {
  return {
    id,
    windowId: 1,
    groupId: -1,
    active: true,
    currentWindow: true,
    title,
    url: 'https://chat.deepseek.com/',
    controllable: true,
  };
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
