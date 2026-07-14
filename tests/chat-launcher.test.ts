import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startChatLauncher, type ChatLauncherController } from '../entrypoints/content/adapters/chat-launcher';

let controller: ChatLauncherController | null;

beforeEach(() => {
  controller = null;
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  controller?.stop();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('floating chat launcher', () => {
  it('lets the header close button handle its pointer sequence without starting a drag', () => {
    controller = startChatLauncher();
    const launcher = document.getElementById('dpp-chat-launcher-button');
    expect(launcher).toBeInstanceOf(HTMLButtonElement);

    launcher?.dispatchEvent(pointerEvent('pointerdown'));
    launcher?.dispatchEvent(pointerEvent('pointerup'));

    const panel = document.getElementById('dpp-floating-chat-window');
    const closeButton = panel?.querySelector('[data-dpp-floating-chat-close]');
    expect(panel).toBeInstanceOf(HTMLElement);
    expect(closeButton).toBeInstanceOf(HTMLButtonElement);

    const pointerDownAccepted = closeButton?.dispatchEvent(pointerEvent('pointerdown'));
    expect(pointerDownAccepted).toBe(true);
    expect(panel?.classList.contains('dpp-floating-chat--dragging')).toBe(false);
    expect(document.body.classList.contains('dpp-floating-chat-dragging')).toBe(false);

    closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('dpp-floating-chat-window')).toBeNull();
  });

  it('does not access chrome.runtime after startup when the launcher is clicked', () => {
    const getURL = vi.mocked(chrome.runtime.getURL);
    controller = startChatLauncher();
    expect(getURL).toHaveBeenCalledTimes(2);

    getURL.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });

    const launcher = document.getElementById('dpp-chat-launcher-button');
    expect(() => {
      launcher?.dispatchEvent(pointerEvent('pointerdown'));
      launcher?.dispatchEvent(pointerEvent('pointerup'));
    }).not.toThrow();
    expect(document.getElementById('dpp-floating-chat-window')).toBeInstanceOf(HTMLElement);
    expect(getURL).toHaveBeenCalledTimes(2);
  });

  it('removes stale launcher UI when storage reports an invalidated context', async () => {
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(
      new Error('Extension context invalidated.'),
    );

    controller = startChatLauncher();

    await vi.waitFor(() => {
      expect(document.getElementById('dpp-chat-launcher-button')).toBeNull();
    });
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledOnce();
  });

  it('replaces an active controller without duplicating UI or letting stale teardown remove it', () => {
    const first = startChatLauncher();
    const firstButton = document.getElementById('dpp-chat-launcher-button');

    controller = startChatLauncher();
    const secondButton = document.getElementById('dpp-chat-launcher-button');

    expect(secondButton).toBeInstanceOf(HTMLButtonElement);
    expect(secondButton).not.toBe(firstButton);
    expect(document.querySelectorAll('#dpp-chat-launcher-button')).toHaveLength(1);
    first.stop();
    expect(document.getElementById('dpp-chat-launcher-button')).toBe(secondButton);
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(2);
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(1);
  });

  it('tears down owned resources exactly once', () => {
    controller = startChatLauncher();
    controller.stop();
    controller.stop();

    expect(document.getElementById('dpp-chat-launcher-button')).toBeNull();
    expect(document.getElementById('dpp-floating-chat-window')).toBeNull();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledOnce();
  });
});

function pointerEvent(type: string): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 100,
    clientY: 100,
  });
}
