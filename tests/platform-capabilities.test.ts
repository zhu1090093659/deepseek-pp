import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCapabilityMap,
  getCurrentBrowserExtensionEnvironment,
  getCurrentPlatformEnvironment,
  isCapabilitySupported,
} from '../core/platform';
import { getSupportedMcpTransportKinds, isShellNativeHostSupported } from '../core/platform/gating';
import type { PlatformEnvironment } from '../core/platform';
import type { McpServerTransportConfig } from '../core/mcp/types';

afterEach(() => {
  delete (window as typeof window & { AndroidBridge?: unknown }).AndroidBridge;
  delete (window as typeof window & { __DPP_DESKTOP__?: unknown }).__DPP_DESKTOP__;
  vi.unstubAllGlobals();
});

describe('platform capability contracts', () => {
  it('fills missing capability keys with false', () => {
    const capabilities = createCapabilityMap({ storage: true });

    expect(capabilities.storage).toBe(true);
    expect(capabilities.nativeMessaging).toBe(false);
    expect(capabilities.sidePanel).toBe(false);
  });

  it('detects browser extension capabilities from chrome APIs', () => {
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'extension-id',
        sendMessage: vi.fn(),
        getURL: vi.fn(),
        connectNative: vi.fn(),
      },
      storage: { local: {} },
      downloads: { download: vi.fn() },
      sidePanel: {},
      contextMenus: {},
      alarms: {},
      tabs: { query: vi.fn(), get: vi.fn() },
      tabGroups: { query: vi.fn() },
      debugger: { attach: vi.fn(), sendCommand: vi.fn() },
    });

    const environment = getCurrentBrowserExtensionEnvironment();

    expect(environment.kind).toBe('browser_extension');
    expect(isCapabilitySupported(environment, 'nativeMessaging')).toBe(true);
    expect(isCapabilitySupported(environment, 'sidePanel')).toBe(true);
    expect(isCapabilitySupported(environment, 'browserControl')).toBe(true);
    expect(isCapabilitySupported(environment, 'accessibilityTree')).toBe(true);
  });

  it('does not require tabGroups for browser control support', () => {
    const chromeStub = {
      runtime: {
        id: 'extension-id',
        sendMessage: vi.fn(),
        getURL: vi.fn(),
        connectNative: vi.fn(),
      },
      storage: { local: {} },
      downloads: { download: vi.fn() },
      sidePanel: {},
      contextMenus: {},
      alarms: {},
      tabs: { query: vi.fn(), get: vi.fn() },
      debugger: { attach: vi.fn(), sendCommand: vi.fn() },
    };
    Object.defineProperty(chromeStub, 'tabGroups', {
      get() {
        throw new Error("'tabGroups' is not allowed for specified extension ID.");
      },
    });
    vi.stubGlobal('chrome', chromeStub);

    const environment = getCurrentBrowserExtensionEnvironment();

    expect(isCapabilitySupported(environment, 'tabGroups')).toBe(false);
    expect(isCapabilitySupported(environment, 'browserControl')).toBe(true);
  });

  it('detects Android WebView as explicit non-native-messaging platform', () => {
    (window as typeof window & { AndroidBridge?: unknown }).AndroidBridge = {};

    const environment = getCurrentPlatformEnvironment();

    expect(environment.kind).toBe('android_webview');
    expect(environment.capabilities.storage).toBe(true);
    expect(environment.capabilities.nativeMessaging).toBe(false);
    expect(environment.capabilities.sidePanel).toBe(false);
    expect(environment.capabilities.browserControl).toBe(false);
  });

  it('detects the Electron desktop host with native messaging enabled', () => {
    // C-04: desktop detection keys off the non-spoofable chrome runtime id set by
    // the desktop preloads, NOT a page-settable window flag.
    vi.stubGlobal('chrome', { runtime: { id: 'deepseek-pp-desktop' } });

    const environment = getCurrentPlatformEnvironment();

    expect(environment.kind).toBe('electron_desktop');
    expect(environment.capabilities.storage).toBe(true);
    expect(environment.capabilities.nativeMessaging).toBe(true);
    expect(isShellNativeHostSupported(environment)).toBe(true);
    // Phase 2b: browser control via webContents.debugger (CDP).
    expect(environment.capabilities.browserControl).toBe(true);
    expect(environment.capabilities.debugger).toBe(true);
    expect(environment.capabilities.accessibilityTree).toBe(true);
    // Phase 2c: automation scheduler via persistent-background timers.
    expect(environment.capabilities.alarms).toBe(true);
    // Remaining Phase 2c surfaces stay gated off until wired.
    expect(environment.capabilities.contextMenus).toBe(false);
  });

  it('does NOT report desktop when a page spoofs window.__DPP_DESKTOP__ (C-04)', () => {
    // A malicious page / XSS sets the window flag and presents an ordinary
    // extension runtime id. Detection must ignore the flag.
    (window as typeof window & { __DPP_DESKTOP__?: unknown }).__DPP_DESKTOP__ = true;
    vi.stubGlobal('chrome', { runtime: { id: 'some-real-extension-id' } });

    const environment = getCurrentPlatformEnvironment();

    expect(environment.kind).not.toBe('electron_desktop');
    expect(environment.capabilities.nativeMessaging).toBe(false);
  });

  it('filters native MCP controls when native messaging is unsupported', () => {
    const environment: PlatformEnvironment = {
      kind: 'android_webview',
      name: 'Android WebView',
      capabilities: createCapabilityMap({ storage: true, runtimeMessaging: true }),
    };
    const kinds: McpServerTransportConfig['kind'][] = ['streamable_http', 'native_messaging', 'stdio_bridge'];

    expect(isShellNativeHostSupported(environment)).toBe(false);
    expect(getSupportedMcpTransportKinds(kinds, environment)).toEqual(['streamable_http', 'stdio_bridge']);
  });
});
