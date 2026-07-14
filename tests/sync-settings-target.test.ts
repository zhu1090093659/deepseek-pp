import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../entrypoints/sidepanel/pages/SettingsPage';

const INITIAL_CONFIG = {
  provider: 'webdav',
  url: 'https://dav.example.test/root',
  username: 'user',
  password: 'secret',
  remotePath: 'Target-A',
  lastSyncAt: null,
  schemaVersion: 1,
  revision: 1,
  additive: { retained: true },
} as const;

let container: HTMLDivElement;
let root: Root | null;
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
    switch (message.type) {
      case 'GET_SYNC_CONFIG': return structuredClone(INITIAL_CONFIG);
      case 'GET_CONFIG': return { version: '1.10.0' };
      case 'GET_MEMORIES': return [];
      case 'GET_DEEPSEEK_API_KEY_STATUS': return { configured: false };
      case 'GET_MULTIMODAL_SETTINGS_STATUS': return multimodalStatus();
      case 'GET_MODEL_TYPE':
      case 'GET_BACKGROUND':
      case 'GET_PET': return null;
      case 'WEBDAV_UPLOAD_LOCAL': return {
        ok: true,
        lastSyncAt: 99,
        revision: 3,
        counts: syncCounts(),
      };
      default: return null;
    }
  });

  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
    permissions: { request: vi.fn(async () => true) },
    identity: { getRedirectURL: vi.fn(() => 'https://test-extension.chromiumapp.org/') },
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Settings sync confirmed target', () => {
  it('sends one immutable target-bearing upload command and never uses save-then-action', async () => {
    await renderDataSettings();
    await openUploadConfirmation();
    await confirmDialogAction('上传本地');
    await flushPromises();

    const uploadCalls = sendMessage.mock.calls.filter(([message]) => (
      (message as { type?: string }).type === 'WEBDAV_UPLOAD_LOCAL'
    ));
    expect(uploadCalls).toEqual([[
      {
        type: 'WEBDAV_UPLOAD_LOCAL',
        payload: {
          config: INITIAL_CONFIG,
          expectedRevision: 1,
        },
      },
    ]]);
    expect(sendMessage.mock.calls.some(([message]) => (
      (message as { type?: string }).type === 'SAVE_SYNC_CONFIG'
    ))).toBe(false);
    expect(container.textContent).toContain('上传完成');
    expect(container.textContent).toContain('01/01');
  });

  it('rejects a target whose form changes after the confirmation opens', async () => {
    await renderDataSettings();
    await openUploadConfirmation();
    const remotePath = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .find((input) => input.value === 'Target-A');
    expect(remotePath).toBeTruthy();

    await act(async () => {
      setInputValue(remotePath!, 'Target-B');
      remotePath!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await confirmDialogAction('上传本地');
    await flushPromises();

    expect(sendMessage.mock.calls.some(([message]) => (
      (message as { type?: string }).type === 'WEBDAV_UPLOAD_LOCAL'
    ))).toBe(false);
    expect(container.textContent).toContain('同步设置已变化，请确认当前目标后重试');
  });

  it('keeps provider and credential fields disabled for the complete pending action', async () => {
    const pending = deferred<unknown>();
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'WEBDAV_UPLOAD_LOCAL') return pending.promise;
      if (message.type === 'GET_SYNC_CONFIG') return structuredClone(INITIAL_CONFIG);
      if (message.type === 'GET_CONFIG') return { version: '1.10.0' };
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_MULTIMODAL_SETTINGS_STATUS') return multimodalStatus();
      if (message.type === 'GET_DEEPSEEK_API_KEY_STATUS') return { configured: false };
      return null;
    });
    await renderDataSettings();
    await openUploadConfirmation();
    await confirmDialogAction('上传本地');
    await flushPromises();

    const syncInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'));
    expect(syncInputs.length).toBeGreaterThan(0);
    expect(syncInputs.every((input) => input.disabled)).toBe(true);
    const providerButtons = ['WebDAV', 'Google Drive', 'OneDrive'].map(buttonByExactText);
    expect(providerButtons.every((button) => button.disabled)).toBe(true);

    await act(async () => {
      pending.resolve({ ok: true, lastSyncAt: 99, revision: 3, counts: syncCounts() });
      await pending.promise;
    });
    await flushPromises();
    expect(syncInputs.every((input) => !input.disabled)).toBe(true);
  });

  it('carries a committed download timestamp into the next action after notification failure', async () => {
    sendMessage.mockImplementation(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_SYNC_CONFIG') return structuredClone(INITIAL_CONFIG);
      if (message.type === 'GET_CONFIG') return { version: '1.10.0' };
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_MULTIMODAL_SETTINGS_STATUS') return multimodalStatus();
      if (message.type === 'GET_DEEPSEEK_API_KEY_STATUS') return { configured: false };
      if (message.type === 'WEBDAV_DOWNLOAD_REMOTE') {
        return {
          ok: false,
          error: 'Injected notification failure',
          code: 'sync_operation_failed_after_config_commit',
          revision: 3,
          lastSyncAt: 99,
        };
      }
      if (message.type === 'WEBDAV_UPLOAD_LOCAL') {
        return { ok: true, lastSyncAt: 100, revision: 5, counts: syncCounts() };
      }
      return null;
    });
    await renderDataSettings();

    await click(buttonByExactText('下载云端'));
    await confirmDialogAction('下载云端');
    await flushPromises();
    expect(container.textContent).toContain('Injected notification failure');

    await openUploadConfirmation();
    await confirmDialogAction('上传本地');
    await flushPromises();

    const upload = sendMessage.mock.calls.find(([message]) => (
      (message as { type?: string }).type === 'WEBDAV_UPLOAD_LOCAL'
    ))?.[0] as { payload?: { config?: { lastSyncAt?: unknown }; expectedRevision?: unknown } } | undefined;
    expect(upload?.payload).toMatchObject({
      config: { lastSyncAt: 99, revision: 3 },
      expectedRevision: 3,
    });
  });

  it('reloads the authoritative config after completed-action bookkeeping becomes uncertain', async () => {
    const authoritative = {
      ...INITIAL_CONFIG,
      remotePath: 'Authoritative-B',
      lastSyncAt: 99,
      revision: 3,
    } as const;
    let configReads = 0;
    let uploads = 0;
    sendMessage.mockImplementation(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_SYNC_CONFIG') {
        configReads += 1;
        return structuredClone(configReads === 1 ? INITIAL_CONFIG : authoritative);
      }
      if (message.type === 'GET_CONFIG') return { version: '1.10.0' };
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_MULTIMODAL_SETTINGS_STATUS') return multimodalStatus();
      if (message.type === 'GET_DEEPSEEK_API_KEY_STATUS') return { configured: false };
      if (message.type === 'WEBDAV_UPLOAD_LOCAL') {
        uploads += 1;
        if (uploads === 1) {
          return {
            ok: false,
            error: 'Sync bookkeeping outcome is unknown',
            code: 'sync_operation_effect_completed_config_persist_failed',
            reloadConfig: true,
            effectCompleted: true,
          };
        }
        return { ok: true, lastSyncAt: 100, revision: 5, counts: syncCounts() };
      }
      return null;
    });
    await renderDataSettings();

    await openUploadConfirmation();
    await confirmDialogAction('上传本地');
    await flushPromises();
    expect(configReads).toBe(2);
    expect(container.textContent).toContain('Sync bookkeeping outcome is unknown');

    await openUploadConfirmation();
    await confirmDialogAction('上传本地');
    await flushPromises();

    const uploadCalls = sendMessage.mock.calls.filter(([message]) => (
      (message as { type?: string }).type === 'WEBDAV_UPLOAD_LOCAL'
    ));
    expect(uploadCalls).toHaveLength(2);
    expect(uploadCalls[1][0]).toMatchObject({
      payload: {
        config: { remotePath: 'Authoritative-B', lastSyncAt: 99, revision: 3 },
        expectedRevision: 3,
      },
    });
  });
});

async function renderDataSettings() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(SettingsPage));
  });
  await flushPromises();
  await click(buttonByExactText('数据'));
  await flushPromises();
}

async function openUploadConfirmation() {
  await click(buttonByExactText('上传本地'));
  expect(container.querySelector('[role="dialog"]')).toBeTruthy();
}

async function confirmDialogAction(label: string) {
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).toBeTruthy();
  const button = Array.from(dialog!.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  await click(button as HTMLButtonElement);
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonByExactText(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
}

function syncCounts() {
  return {
    memories: 1,
    skills: 2,
    presets: 3,
    projects: 4,
    projectConversations: 5,
    savedItems: 6,
  };
}

function multimodalStatus() {
  return {
    ok: true,
    openaiConfigured: false,
    geminiConfigured: false,
    openaiImageModel: 'gpt-4.1-mini',
    geminiVideoModel: 'gemini-2.5-flash',
    openaiBaseUrl: 'https://api.openai.com/v1',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com',
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
