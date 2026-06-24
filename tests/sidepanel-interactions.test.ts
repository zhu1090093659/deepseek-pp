import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  type PromptInjectionSettings,
} from '../core/prompt/settings';
import PromptControlPanel from '../entrypoints/sidepanel/components/PromptControlPanel';
import SavedPage from '../entrypoints/sidepanel/pages/SavedPage';

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
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

describe('sidepanel interactions', () => {
  it('sends a saved snippet payload when the save button is clicked', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_SAVED_ITEMS') return [];
      if (message.type === 'SAVE_SAVED_ITEM') {
        return {
          id: 'saved-1',
          syncId: 'sync-1',
          kind: 'snippet',
          title: 'Review prompt',
          content: 'Summarize this thread.',
          tags: ['prompt'],
          createdAt: 1,
          updatedAt: 1,
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage));
    await enterText('标题', 'Review prompt');
    await enterText('Prompt 片段、笔记或可复用文本', 'Summarize this thread.');
    await enterText('标签（逗号分隔）', 'prompt');
    await clickButton('保存');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SAVE_SAVED_ITEM',
      payload: {
        kind: 'snippet',
        title: 'Review prompt',
        content: 'Summarize this thread.',
        tags: ['prompt'],
      },
    });
    expect(inputByPlaceholder('标题').value).toBe('');
  });

  it('requests insertion into the active DeepSeek chat when a saved item is clicked', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_SAVED_ITEMS') {
        return [{
          id: 'saved-1',
          syncId: 'sync-1',
          kind: 'snippet',
          title: 'Review prompt',
          content: 'Summarize this thread.',
          tags: ['prompt'],
          createdAt: 1,
          updatedAt: 1,
        }];
      }
      if (message.type === 'INSERT_SAVED_PROMPT_INTO_CHAT') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage));
    await flushPromises();
    await clickButton('插入到对话');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'INSERT_SAVED_PROMPT_INTO_CHAT',
      payload: { text: 'Summarize this thread.' },
    });
    expect(container.textContent).toContain('已插入当前 DeepSeek 对话');
  });

  it('shows insertion failures from the active DeepSeek chat route', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_SAVED_ITEMS') {
        return [{
          id: 'saved-1',
          syncId: 'sync-1',
          kind: 'snippet',
          title: 'Review prompt',
          content: 'Summarize this thread.',
          tags: [],
          createdAt: 1,
          updatedAt: 1,
        }];
      }
      if (message.type === 'INSERT_SAVED_PROMPT_INTO_CHAT') {
        return { ok: false, error: '请先在 chat.deepseek.com 登录，或刷新 DeepSeek 页面后重试。' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage));
    await flushPromises();
    await clickButton('插入到对话');

    expect(container.textContent).toContain('插入到对话失败：请先在 chat.deepseek.com 登录，或刷新 DeepSeek 页面后重试。');
  });

  it('persists prompt control select changes instead of reverting to defaults', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: PromptInjectionSettings }) => {
      if (message.type === 'GET_PROMPT_INJECTION_SETTINGS') return DEFAULT_PROMPT_INJECTION_SETTINGS;
      if (message.type === 'SAVE_PROMPT_INJECTION_SETTINGS') return message.payload;
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(PromptControlPanel));
    const cadenceSelect = container.querySelector('select');
    expect(cadenceSelect).toBeInstanceOf(HTMLSelectElement);

    await act(async () => {
      setSelectValue(cadenceSelect as HTMLSelectElement, 'every_message');
      cadenceSelect?.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SAVE_PROMPT_INJECTION_SETTINGS',
      payload: {
        ...DEFAULT_PROMPT_INJECTION_SETTINGS,
        presetCadence: 'every_message',
      },
    });
    expect((cadenceSelect as HTMLSelectElement).value).toBe('every_message');
  });

  it('shows prompt control save failures and restores the previous confirmed state', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROMPT_INJECTION_SETTINGS') return DEFAULT_PROMPT_INJECTION_SETTINGS;
      if (message.type === 'SAVE_PROMPT_INJECTION_SETTINGS') {
        return { ok: false, error: 'tabs permission unavailable' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(PromptControlPanel));
    const memoryToggle = container.querySelector('button');
    expect(memoryToggle).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      memoryToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('保存提示词设置失败：tabs permission unavailable');
    expect((memoryToggle as HTMLButtonElement).getAttribute('style')).toContain('var(--ds-blue)');
  });
});

async function renderElement(element: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
}

function stubChrome(sendMessage: ReturnType<typeof vi.fn>) {
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
}

async function enterText(placeholder: string, value: string) {
  const field = inputByPlaceholder(placeholder);
  await act(async () => {
    setTextControlValue(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

function inputByPlaceholder(placeholder: string): HTMLInputElement | HTMLTextAreaElement {
  const input = container.querySelector(`input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`);
  expect(input).toBeTruthy();
  return input as HTMLInputElement | HTMLTextAreaElement;
}

function setTextControlValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(input, value);
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
}
