import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  type PromptInjectionSettings,
} from '../core/prompt/settings';
import PromptControlPanel from '../entrypoints/sidepanel/components/PromptControlPanel';
import LocalSkillImportPanel from '../entrypoints/sidepanel/components/LocalSkillImportPanel';
import ScenarioManager from '../entrypoints/sidepanel/components/ScenarioManager';
import ChatPage from '../entrypoints/sidepanel/pages/ChatPage';
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

  it('shows saved-item repository failures instead of rendering a fake empty state', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_SAVED_ITEMS') {
        return { ok: false, error: 'savedItems.schemaVersion is not supported' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage));
    await flushPromises();

    expect(container.textContent)
      .toContain('保存项操作失败：savedItems.schemaVersion is not supported');
    expect(container.textContent).not.toContain('暂无保存项');
  });

  it('keeps a saved item visible when repository deletion fails', async () => {
    const item = {
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Keep me',
      content: 'Do not remove this item on failure.',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_SAVED_ITEMS') return [item];
      if (message.type === 'DELETE_SAVED_ITEM') {
        return { ok: false, error: 'delete blocked' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage));
    await flushPromises();
    await clickButtonByLabel('删除');
    await clickButton('删除');
    await flushPromises();

    expect(container.textContent).toContain('保存项操作失败：delete blocked');
    expect(container.textContent).toContain('Keep me');
  });

  it('shows scenario repository failures instead of silently loading built-ins', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({
            scenarioConfigs: { schemaVersion: 2, items: [] },
          })),
          set: vi.fn(),
        },
      },
      runtime: {
        sendMessage: vi.fn(),
      },
    });

    await renderElement(React.createElement(ScenarioManager));
    await flushPromises();

    expect(container.textContent)
      .toContain('场景操作失败：scenarios.schemaVersion is not supported');
  });

  it('reports a committed Scenario separately when background menu refresh fails', async () => {
    let scenarioConfigs: unknown;
    const sendMessage = vi.fn(async () => ({ ok: false, error: 'menu offline' }));
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => (
            scenarioConfigs === undefined ? {} : { scenarioConfigs }
          )),
          set: vi.fn(async (patch: { scenarioConfigs: unknown }) => {
            scenarioConfigs = patch.scenarioConfigs;
          }),
        },
      },
      runtime: { sendMessage },
    });

    await renderElement(React.createElement(ScenarioManager));
    await flushPromises();
    const firstToggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(firstToggle).toBeTruthy();
    await act(async () => firstToggle?.click());
    await flushPromises();

    expect((scenarioConfigs as Array<{ id: string; enabled: boolean }>)[0])
      .toMatchObject({ id: 'summarize', enabled: false });
    expect(container.textContent)
      .toContain('场景已保存，但后台右键菜单刷新失败：menu offline');
    expect(container.textContent).not.toContain('场景操作失败：menu offline');
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

  it('explains that non-bundled local Skill resources remain available on demand', async () => {
    const legacyWarning = '13 local supporting file(s) were omitted.';
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type !== 'PREVIEW_LOCAL_SKILL_SOURCE') return null;
      return {
        source: {
          id: 'local:demo',
          provider: 'local',
          rootPath: '/Users/me/.codex/skills/demo',
          displayName: 'demo',
          directoryName: 'demo',
          skillPaths: ['SKILL.md'],
          importedSkillNames: ['demo'],
          importedAt: 1,
          updatedAt: 1,
          warnings: [legacyWarning],
        },
        skills: [{
          path: 'SKILL.md',
          name: 'demo',
          importName: 'demo',
          description: 'Demo Skill',
          bytes: 64000,
          bodyBytes: 6000,
          includedFiles: Array.from({ length: 16 }, (_, index) => ({ path: `references/${index + 1}.md`, bytes: 100 })),
          omittedFiles: Array.from({ length: 13 }, (_, index) => ({ path: `references/${index + 17}.md`, bytes: 100 })),
          scriptFiles: [],
          warnings: [legacyWarning],
          nameChanged: false,
        }],
        warnings: [legacyWarning],
        truncated: false,
      };
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(LocalSkillImportPanel, {
      onImported: vi.fn(),
      onCancel: vi.fn(),
    }));
    await enterText('/Users/me/.codex/skills/my-skill', '/Users/me/.codex/skills/demo');
    await clickButton('预览');
    await flushPromises();

    expect(container.textContent).toContain('按需读取 13');
    expect(container.textContent).toContain('文件没有被删除');
    expect(container.textContent).not.toContain(legacyWarning);
  });

  it('keeps safe local Skills selectable when a sibling needs an unavailable reader', async () => {
    const source = {
      id: 'local:demo',
      provider: 'local' as const,
      rootPath: '/Users/me/.codex/skills/demo',
      displayName: 'demo',
      directoryName: 'demo',
      skillPaths: ['blocked/SKILL.md', 'safe/SKILL.md'],
      importedSkillNames: ['blocked', 'safe'],
      importedAt: 1,
      updatedAt: 1,
      warnings: [],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'PREVIEW_LOCAL_SKILL_SOURCE') {
        return {
          source,
          skills: [
            {
              path: 'blocked/SKILL.md',
              name: 'blocked',
              importName: 'blocked',
              description: 'Needs an on-demand reader',
              bytes: 64000,
              bodyBytes: 6000,
              includedFiles: Array.from({ length: 16 }, (_, index) => ({ path: `blocked/references/${index + 1}.md`, bytes: 100 })),
              omittedFiles: [{ path: 'blocked/references/17.md', bytes: 100 }],
              scriptFiles: [],
              warnings: [],
              importBlock: {
                code: 'shell_reader_unavailable',
              },
              nameChanged: false,
            },
            {
              path: 'safe/SKILL.md',
              name: 'safe',
              importName: 'safe',
              description: 'Safe to import',
              bytes: 1000,
              bodyBytes: 1000,
              includedFiles: [],
              omittedFiles: [],
              scriptFiles: [],
              warnings: [],
              nameChanged: false,
            },
          ],
          warnings: [],
          truncated: false,
        };
      }
      if (message.type === 'IMPORT_LOCAL_SKILL_SOURCE') {
        return {
          ok: true,
          source,
          imported: [],
          replaced: 0,
          renamed: 0,
          warnings: [],
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(LocalSkillImportPanel, {
      onImported: vi.fn(),
      onCancel: vi.fn(),
    }));
    await enterText('/Users/me/.codex/skills/my-skill', '/Users/me/.codex/skills/demo');
    await clickButton('预览');
    await flushPromises();

    const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toMatchObject({ checked: false, disabled: true });
    expect(checkboxes[1]).toMatchObject({ checked: true, disabled: false });
    expect(container.textContent).toContain('按需读取器不可用');
    expect(container.textContent).toContain('当前无法按需读取');
    expect(container.textContent).toContain('请将 Shell Local 执行模式设为“自动”');
    expect(container.textContent).not.toContain('Shell MCP on-demand file reading is not available to chat.');
    expect(container.textContent).toContain('未内嵌 1');
    expect(container.textContent).not.toContain('按需读取 1');

    await clickButton('导入选中 Skill');
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'IMPORT_LOCAL_SKILL_SOURCE',
      payload: {
        rootPath: '/Users/me/.codex/skills/demo',
        selectedPaths: ['safe/SKILL.md'],
        selectedImportNames: {
          'safe/SKILL.md': 'safe',
        },
      },
    });
  });

  it('localizes reader failures detected again at import time', async () => {
    const source = {
      id: 'local:demo',
      provider: 'local' as const,
      rootPath: '/Users/me/.codex/skills/demo',
      displayName: 'demo',
      directoryName: 'demo',
      skillPaths: ['SKILL.md'],
      importedSkillNames: ['demo'],
      importedAt: 1,
      updatedAt: 1,
      warnings: [],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'PREVIEW_LOCAL_SKILL_SOURCE') {
        return {
          source,
          skills: [{
            path: 'SKILL.md',
            name: 'demo',
            importName: 'demo',
            description: 'Reader was available during preview',
            bytes: 64000,
            bodyBytes: 6000,
            includedFiles: [],
            omittedFiles: [{ path: 'references/large.md', bytes: 58000 }],
            scriptFiles: [],
            warnings: [],
            nameChanged: false,
          }],
          warnings: [],
          truncated: false,
        };
      }
      if (message.type === 'IMPORT_LOCAL_SKILL_SOURCE') {
        return {
          ok: false,
          error: 'Shell MCP on-demand file reading is not available to chat.',
          importBlock: {
            code: 'shell_reader_unavailable',
          },
        };
      }
      return null;
    });
    const onImported = vi.fn();
    stubChrome(sendMessage);

    await renderElement(React.createElement(LocalSkillImportPanel, {
      onImported,
      onCancel: vi.fn(),
    }));
    await enterText('/Users/me/.codex/skills/my-skill', '/Users/me/.codex/skills/demo');
    await clickButton('预览');
    await flushPromises();
    await clickButton('导入选中 Skill');
    await flushPromises();

    expect(container.textContent).toContain('按需读取器不可用');
    expect(container.textContent).toContain('请将 Shell Local 执行模式设为“自动”');
    expect(container.textContent).not.toContain('Shell MCP on-demand file reading is not available to chat.');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('persists web model mode from sidepanel chat controls', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'SET_MODEL_TYPE') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    expect(buttonByText('默认').className).toContain('ds-chat-segment-active');

    await clickButton('识图');

    expect(sendMessage).toHaveBeenCalledWith({ type: 'SET_MODEL_TYPE', payload: 'vision' });
    expect(buttonByText('识图').className).toContain('ds-chat-segment-active');
  });

  it('uploads a vision image attachment and submits its file reference', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return 'vision';
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'UPLOAD_DEEPSEEK_IMAGE') {
        return {
          ok: true,
          file: {
            id: 'file-image-1',
            fileName: 'shot.png',
            status: 'SUCCESS',
          },
        };
      }
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);
    stubObjectUrl();
    stubFileReader('data:image/png;base64,YWJj');

    await renderElement(React.createElement(ChatPage));
    await flushPromises();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    const image = new File(['abc'], 'shot.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [image], configurable: true });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPLOAD_DEEPSEEK_IMAGE',
      payload: {
        dataUrl: 'data:image/png;base64,YWJj',
        name: 'shot.png',
        mimeType: 'image/png',
        sizeBytes: 3,
      },
    });
    expect(container.textContent).toContain('已添加');

    await enterText('给 DeepSeek++ 发送消息', '描述这张图片');
    await clickButtonByLabel('发送');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'CHAT_SUBMIT_PROMPT',
      payload: {
        text: '描述这张图片',
        refFileIds: ['file-image-1'],
      },
    });
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
  const button = buttonByText(label);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function clickButtonByLabel(label: string) {
  const button = container.querySelector(`button[aria-label="${label}"]`);
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

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
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

function stubObjectUrl() {
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  }));
}

function stubFileReader(dataUrl: string) {
  class MockFileReader {
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL() {
      this.result = dataUrl;
      this.onload?.();
    }
  }

  vi.stubGlobal('FileReader', MockFileReader);
}
