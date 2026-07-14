import { readFileSync } from 'node:fs';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../entrypoints/sidepanel/App';
import LibraryPage from '../entrypoints/sidepanel/pages/LibraryPage';
import CapabilitiesPage from '../entrypoints/sidepanel/pages/CapabilitiesPage';
import SettingsPage from '../entrypoints/sidepanel/pages/SettingsPage';

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;

  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: vi.fn(() => ({ version: '0.7.0' })),
      sendMessage: vi.fn(async (message: { type?: string }) => {
        if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
        if (message.type === 'GET_VOICE_SETTINGS') return {};
        if (message.type === 'GET_USAGE_SUMMARY') return createUsageSummary();
        if (message.type === 'CLEAR_USAGE_STATS') return { ok: true };
        if (message.type === 'GET_SYNC_CONFIG') return null;
        return null;
      }),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (
          key === 'deepseek_pp_chat_enabled'
            ? { deepseek_pp_chat_enabled: true }
            : {}
        )),
        remove: vi.fn(async () => {}),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    identity: {
      getRedirectURL: vi.fn(() => 'https://test-extension.chromiumapp.org/'),
    },
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

describe('sidepanel navigation', () => {
  it('keeps memory/saved under Library and preset/automation under Capabilities', async () => {
    await renderApp();

    const topLabels = navButtonLabels('侧栏导航');
    expect(topLabels).toEqual(['对话', '资料', '项目', '能力', '设置']);

    unmountRoot();
    await renderElement(React.createElement(LibraryPage));
    expect(navButtonLabels('资料子导航')).toEqual(['记忆', '保存']);
    await clickNavButton('资料子导航', '保存');
    await vi.waitFor(() => expect(container.textContent).toContain('保存常用 Prompt'));

    unmountRoot();
    await renderElement(React.createElement(CapabilitiesPage));
    expect(navButtonLabels('能力子导航')).toEqual(['Skill', 'MCP', '工具', '浏览器', '预设', '自动化']);
    await clickNavButton('能力子导航', 'MCP');
    await vi.waitFor(() => expect(container.textContent).toContain('连接本机或远程 MCP 服务'));
  });

  it('keeps the voice settings surface reachable from Settings', async () => {
    await renderElement(React.createElement(SettingsPage));

    // Settings is split into sub-tabs; voice lives under the Voice tab.
    const settingsNav = container.querySelector('nav[aria-label="设置子导航"]');
    expect(settingsNav).toBeTruthy();
    expect(navButtonLabels('设置子导航')).toEqual([
      '通用',
      'API',
      '提示词',
      '语音',
      '外观',
      '用量',
      '数据',
      '关于',
    ]);
    expect(navButtonLabels('设置子导航').indexOf('用量')).toBeLessThan(
      navButtonLabels('设置子导航').indexOf('数据'),
    );
    const voiceTab = Array.from(settingsNav!.querySelectorAll('button')).find(
      (button) => (button.textContent ?? '') === '语音',
    );
    expect(voiceTab).toBeTruthy();

    await act(async () => {
      voiceTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('语音');
      expect(container.textContent).toContain('语音输入');
      expect(container.textContent).toContain('朗读回复');
    });
  });

  it('renders Settings when chrome.identity is unavailable', async () => {
    delete (chrome as unknown as { identity?: unknown }).identity;

    await renderElement(React.createElement(SettingsPage));
    await flushPromises();

    expect(navButtonLabels('设置子导航')).toContain('通用');
    expect(container.textContent).toContain('网页模型模式');
  });

  it('renders usage statistics from the Settings sub-navigation', async () => {
    await renderElement(React.createElement(SettingsPage));

    const usageTab = Array.from(container.querySelectorAll('nav[aria-label="设置子导航"] button')).find(
      (button) => (button.textContent ?? '') === '用量',
    );
    expect(usageTab).toBeTruthy();

    await act(async () => {
      usageTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Tokens 用量');
      expect(container.textContent).toContain('DeepSeek Vision');
      expect(container.textContent).toContain('按天 Token 趋势');
    });
  });

  it('keeps the top navigation from shrinking behind long settings content', () => {
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const navBlock = getCssBlock(css, '.side-tabs');
    const mainBlock = getCssBlock(css, '.ds-app-main');

    expect(navBlock).toContain('flex: 0 0 44px');
    expect(navBlock).toContain('min-height: 44px');
    expect(mainBlock).toContain('flex: 1 1 0');
  });
});

async function renderApp() {
  await renderElement(React.createElement(App));
}

async function renderElement(element: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
}

function navButtonLabels(label: string): string[] {
  const nav = container.querySelector(`nav[aria-label="${label}"]`);
  expect(nav).toBeTruthy();
  return Array.from(nav!.querySelectorAll('button')).map((button) => button.textContent ?? '');
}

async function clickNavButton(navLabel: string, buttonLabel: string) {
  const nav = container.querySelector(`nav[aria-label="${navLabel}"]`);
  const button = Array.from(nav?.querySelectorAll('button') ?? [])
    .find((candidate) => candidate.textContent === buttonLabel);
  expect(button).toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function unmountRoot() {
  if (root) {
    act(() => root?.unmount());
    root = null;
    container.innerHTML = '';
  }
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

function getCssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`));
  expect(match?.groups?.body).toBeTruthy();
  return match!.groups!.body;
}

function createUsageSummary() {
  const now = new Date(2026, 5, 18).getTime();
  const days = Array.from({ length: 30 }, (_, index) => {
    const timestamp = now - (29 - index) * 24 * 60 * 60 * 1000;
    const active = index >= 27;
    return {
      day: new Date(timestamp).toISOString().slice(0, 10),
      timestamp,
      tokens: active ? 1100 + index * 10 : 0,
      messageCount: active ? 2 : 0,
      sessionCount: active ? 1 : 0,
      turnCount: active ? 1 : 0,
      models: active
        ? [{ modelKey: 'vision', modelLabel: 'DeepSeek Vision', tokens: 1100 + index * 10 }]
        : [],
    };
  });

  return {
    rangeDays: 30,
    generatedAt: now,
    totalTokens: 3302,
    sessionCount: 2,
    messageCount: 6,
    turnCount: 3,
    activeDays: 3,
    currentStreak: 3,
    serverTokenRecordCount: 3,
    mostUsedModel: {
      modelKey: 'vision',
      modelLabel: 'DeepSeek Vision',
      totalTokens: 3302,
      turnCount: 3,
      messageCount: 6,
      sessionCount: 2,
      share: 1,
    },
    days,
    heatmap: days.map((day) => ({
      day: day.day,
      timestamp: day.timestamp,
      tokens: day.tokens,
      level: day.tokens > 0 ? 5 : 0,
    })),
    modelUsage: [{
      modelKey: 'vision',
      modelLabel: 'DeepSeek Vision',
      totalTokens: 3302,
      turnCount: 3,
      messageCount: 6,
      sessionCount: 2,
      share: 1,
    }],
  };
}
