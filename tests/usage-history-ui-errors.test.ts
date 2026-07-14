import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageSummary } from '../core/usage/types';
import UsageSubPage from '../entrypoints/sidepanel/components/settings/UsageSubPage';

let container: HTMLDivElement;
let root: Root | null;
let usageResponse: unknown;
let clearResponse: unknown;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  usageResponse = makeUsageSummary();
  clearResponse = { ok: true };
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (message: { type?: string }) => (
        message.type === 'CLEAR_USAGE_STATS' ? clearResponse : usageResponse
      )),
    },
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Usage UI persistence errors', () => {
  it('never renders another range and only keeps last-known data for the selected range', async () => {
    await renderUsagePage();
    expect(container.textContent).toContain('321');

    usageResponse = { ok: false, error: 'usage storage version is unsupported' };
    const lastSevenDays = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '最近 7 天',
    );
    expect(lastSevenDays).toBeTruthy();
    await act(async () => {
      lastSevenDays!.click();
    });
    await settle();

    expect(container.textContent).toContain('usage storage version is unsupported');
    expect(container.textContent).not.toContain('321');

    const lastThirtyDays = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '最近 30 天',
    );
    expect(lastThirtyDays).toBeTruthy();
    await act(async () => {
      lastThirtyDays!.click();
    });
    await settle();

    expect(container.textContent).toContain('usage storage version is unsupported');
    expect(container.textContent).toContain('321');
  });

  it('ignores an older range response after a newer selection completes', async () => {
    const thirtyDays = deferred<unknown>();
    const sevenDays = deferred<unknown>();
    usageResponse = thirtyDays.promise;
    await renderUsagePage();

    usageResponse = sevenDays.promise;
    const lastSevenDays = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '最近 7 天',
    );
    await act(async () => {
      lastSevenDays!.click();
      sevenDays.resolve(makeUsageSummary(7, 700));
    });
    await settle();
    expect(container.textContent).toContain('700');

    await act(async () => {
      thirtyDays.resolve(makeUsageSummary(30, 300));
    });
    await settle();

    expect(container.textContent).toContain('700');
    expect(container.textContent).not.toContain('300');
  });

  it('rejects a malformed success payload instead of rendering it', async () => {
    usageResponse = { turnCount: 1, totalTokens: 999 };
    await renderUsagePage();

    expect(container.textContent).toContain('使用统计加载失败');
    expect(container.textContent).not.toContain('999');
  });

  it('shows a clear failure without false success or discarding the confirmed summary', async () => {
    await renderUsagePage();
    clearResponse = { ok: false, error: 'usage clear was rejected' };

    const clearButton = container.querySelector<HTMLButtonElement>('.usage-clear-button');
    expect(clearButton).toBeTruthy();
    await act(async () => {
      clearButton!.click();
    });
    const confirmButton = container.querySelector<HTMLButtonElement>('.ds-btn-danger');
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton!.click();
    });
    await settle();

    expect(container.textContent).toContain('usage clear was rejected');
    expect(container.textContent).not.toContain('使用统计已清除');
    expect(container.textContent).toContain('321');
  });

  it('does not restore cleared data when reload fails or an older request finishes late', async () => {
    await renderUsagePage();

    usageResponse = makeUsageSummary(7, 700);
    const lastSevenDays = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '最近 7 天',
    );
    await act(async () => {
      lastSevenDays!.click();
    });
    await settle();

    const staleThirtyDays = deferred<unknown>();
    usageResponse = staleThirtyDays.promise;
    const lastThirtyDays = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '最近 30 天',
    );
    await act(async () => {
      lastThirtyDays!.click();
    });
    await settle();

    usageResponse = { ok: false, error: 'post-clear reload failed' };
    const clearButton = container.querySelector<HTMLButtonElement>('.usage-clear-button');
    expect(clearButton).toBeTruthy();
    await act(async () => {
      clearButton!.click();
    });
    const confirmButton = container.querySelector<HTMLButtonElement>('.ds-btn-danger');
    await act(async () => {
      confirmButton!.click();
    });
    await settle();

    expect(container.textContent).toContain('使用统计已清除');
    expect(container.textContent).toContain('post-clear reload failed');
    expect(container.textContent).not.toContain('321');

    await act(async () => {
      staleThirtyDays.resolve(makeUsageSummary(30, 999));
    });
    await settle();
    expect(container.textContent).not.toContain('999');
  });

  it('reloads the latest selected range when clear finishes after a range switch', async () => {
    await renderUsagePage();
    const pendingClear = deferred<unknown>();
    clearResponse = pendingClear.promise;

    const clearButton = container.querySelector<HTMLButtonElement>('.usage-clear-button');
    await act(async () => {
      clearButton!.click();
    });
    const confirmButton = container.querySelector<HTMLButtonElement>('.ds-btn-danger');
    await act(async () => {
      confirmButton!.click();
    });

    usageResponse = makeUsageSummary(7, 700);
    const lastSevenDays = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '最近 7 天',
    );
    await act(async () => {
      lastSevenDays!.click();
    });
    await settle();
    expect(container.textContent).toContain('700');

    usageResponse = makeUsageSummary(7, 701);
    await act(async () => {
      pendingClear.resolve({ ok: true });
    });
    await settle();

    expect(container.textContent).toContain('使用统计已清除');
    expect(container.textContent).toContain('701');
    expect(container.textContent).not.toContain('321');
  });
});

async function renderUsagePage() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(UsageSubPage));
  });
  await settle();
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function makeUsageSummary(rangeDays: 7 | 30 = 30, totalTokens = 321): UsageSummary {
  return {
    rangeDays,
    generatedAt: Date.now(),
    totalTokens,
    sessionCount: 1,
    messageCount: 2,
    turnCount: 1,
    activeDays: 1,
    currentStreak: 1,
    serverTokenRecordCount: 1,
    mostUsedModel: {
      modelKey: 'vision',
      modelLabel: 'DeepSeek Vision',
      totalTokens,
      turnCount: 1,
      messageCount: 2,
      sessionCount: 1,
      share: 1,
    },
    days: [{
      day: '2026-07-14',
      timestamp: Date.now(),
      tokens: totalTokens,
      messageCount: 2,
      sessionCount: 1,
      turnCount: 1,
      models: [{ modelKey: 'vision', modelLabel: 'DeepSeek Vision', tokens: totalTokens }],
    }],
    heatmap: [{
      day: '2026-07-14',
      timestamp: Date.now(),
      tokens: totalTokens,
      level: 5,
    }],
    modelUsage: [{
      modelKey: 'vision',
      modelLabel: 'DeepSeek Vision',
      totalTokens,
      turnCount: 1,
      messageCount: 2,
      sessionCount: 1,
      share: 1,
    }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
