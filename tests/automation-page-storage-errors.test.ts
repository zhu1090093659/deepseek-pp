import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '../core/automation/types';
import AutomationPage from '../entrypoints/sidepanel/pages/AutomationPage';

let container: HTMLDivElement;
let root: Root | null;
let automationResponse: unknown;
let messageListener: ((message: { type?: string; automations?: unknown }) => void) | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  automationResponse = [automation];
  messageListener = null;
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (message: { type?: string }) => {
        if (message.type === 'GET_AUTOMATIONS') return automationResponse;
        if (message.type === 'GET_AUTOMATION_RUNS') return [];
        return { ok: true };
      }),
      onMessage: {
        addListener: vi.fn((listener) => {
          messageListener = listener;
        }),
        removeListener: vi.fn(),
      },
    },
    tabs: { create: vi.fn() },
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Automation UI persistence errors', () => {
  it('shows an initial failure without projecting a false empty state', async () => {
    automationResponse = { ok: false, error: 'initial automation load failed' };
    await renderAutomationPage();

    expect(container.textContent).toContain('initial automation load failed');
    expect(container.textContent).not.toContain('暂无自动化');
  });

  it('shows a strict storage failure and keeps the last confirmed list', async () => {
    await renderAutomationPage();
    expect(container.textContent).toContain(automation.name);

    automationResponse = { ok: false, error: 'automation storage version is unsupported' };
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle();

    expect(container.textContent).toContain('automation storage version is unsupported');
    expect(container.textContent).toContain(automation.name);
  });

  it('treats update notifications as invalidations instead of unvalidated data', async () => {
    await renderAutomationPage();
    automationResponse = { ok: false, error: 'authoritative reload failed' };

    await act(async () => {
      messageListener?.({
        type: 'AUTOMATIONS_UPDATED',
        automations: [{ ...automation, name: 'Unconfirmed broadcast automation' }],
      });
    });
    await settle();

    expect(container.textContent).toContain('authoritative reload failed');
    expect(container.textContent).toContain(automation.name);
    expect(container.textContent).not.toContain('Unconfirmed broadcast automation');
  });

  it('ignores a stale reload that finishes after a newer snapshot', async () => {
    await renderAutomationPage();
    const stale = deferred<unknown>();
    automationResponse = stale.promise;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    const newest = { ...automation, id: 'automation-newest', name: 'Newest automation' };
    automationResponse = [newest];
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle();
    expect(container.textContent).toContain(newest.name);

    await act(async () => {
      stale.resolve([{ ...automation, name: 'Stale automation' }]);
    });
    await settle();

    expect(container.textContent).toContain(newest.name);
    expect(container.textContent).not.toContain('Stale automation');
  });
});

async function renderAutomationPage() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(AutomationPage));
  });
  await settle();
}

async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const automation: Automation = {
  id: 'automation-1',
  name: 'Confirmed automation',
  prompt: 'Run safely.',
  status: 'active',
  schedule: {
    kind: 'manual',
    expression: null,
    timezone: 'UTC',
    enabled: false,
    minimumIntervalMinutes: 0,
  },
  promptOptions: {
    modelType: null,
    searchEnabled: false,
    thinkingEnabled: false,
    refFileIds: [],
  },
  deepseek: {
    chatSessionId: null,
    parentMessageId: null,
    sessionUrl: null,
    lastHistorySyncedAt: null,
  },
  createdAt: 1_000,
  updatedAt: 1_000,
  lastRunAt: null,
  nextRunAt: null,
  lastError: null,
  version: 1,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
