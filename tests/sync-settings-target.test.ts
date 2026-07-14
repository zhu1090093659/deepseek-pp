import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsController } from '../entrypoints/sidepanel/controllers/useSettingsController';
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
let runtimeMessageListener: ((message: {
  type?: string;
  config?: Record<string, unknown> | null;
}) => void) | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  runtimeMessageListener = null;
  sendMessage = vi.fn(defaultRuntimeResponse);

  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener) => {
          runtimeMessageListener = listener;
        }),
        removeListener: vi.fn(),
      },
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
    expect(container.textContent).toContain('请勿立即重试');

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

describe('Settings initial load ordering', () => {
  it('decodes malformed GET_CONFIG responses without leaving Settings loading forever', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMessage.mockImplementation(async (message: { type: string; payload?: unknown }) => (
      message.type === 'GET_CONFIG' ? true : defaultRuntimeResponse(message)
    ));

    await renderSettingsProbe();

    const probe = requireSettingsProbe();
    expect(probe.dataset.loading).toBe('false');
    expect(probe.dataset.version).toBe('');
    expect(consoleError).toHaveBeenCalledWith(
      '[DeepSeek++] Failed to load extension version settings.',
      expect.anything(),
    );
  });

  it('keeps a PET_UPDATED event authoritative over an older initial GET_PET response', async () => {
    const petLoad = deferred<unknown>();
    sendMessage.mockImplementation(async (message: { type: string; payload?: unknown }) => (
      message.type === 'GET_PET' ? petLoad.promise : defaultRuntimeResponse(message)
    ));

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(SettingsProbe));
    });
    await flushPromises();
    expect(runtimeMessageListener).toBeTruthy();

    await act(async () => {
      runtimeMessageListener?.({
        type: 'PET_UPDATED',
        config: {
          enabled: true,
          position: 'bottom-left',
          size: 196,
          opacity: 0.65,
          motion: false,
        },
      });
      petLoad.resolve({
        enabled: false,
        position: 'bottom-right',
        size: 92,
        opacity: 0.9,
        motion: true,
      });
      await petLoad.promise;
    });
    await vi.waitFor(() => {
      expect(requireSettingsProbe().dataset.loading).toBe('false');
    });

    expect(requireSettingsProbe().dataset).toMatchObject({
      petEnabled: 'true',
      petPosition: 'bottom-left',
      petSize: '196',
      petOpacity: '0.65',
      petMotion: 'false',
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
  await vi.waitFor(() => {
    expect(findButtonByExactText('上传本地')).toBeTruthy();
  });
}

function SettingsProbe() {
  const state = useSettingsController();
  return React.createElement('output', {
    'data-settings-probe': 'true',
    'data-loading': String(state.loading),
    'data-version': state.version,
    'data-pet-enabled': String(state.petEnabled),
    'data-pet-position': state.petPosition,
    'data-pet-size': String(state.petSize),
    'data-pet-opacity': String(state.petOpacity),
    'data-pet-motion': String(state.petMotion),
  });
}

async function renderSettingsProbe() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(SettingsProbe));
  });
  await vi.waitFor(() => {
    expect(requireSettingsProbe().dataset.loading).toBe('false');
  });
}

function requireSettingsProbe(): HTMLOutputElement {
  const probe = container.querySelector<HTMLOutputElement>('[data-settings-probe="true"]');
  expect(probe).toBeTruthy();
  return probe!;
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
  const button = findButtonByExactText(label);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function findButtonByExactText(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
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

async function defaultRuntimeResponse(message: { type: string; payload?: unknown }) {
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
