import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCapabilityMap,
  getCurrentPlatformEnvironment,
  isCapabilitySupported,
} from '../core/platform';
import { getSupportedMcpTransportKinds, isShellNativeHostSupported } from '../core/platform/gating';
import type { PlatformEnvironment } from '../core/platform';
import type { McpServerTransportConfig } from '../core/mcp/types';

afterEach(() => {
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

    const environment = getCurrentPlatformEnvironment();

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

    const environment = getCurrentPlatformEnvironment();

    expect(isCapabilitySupported(environment, 'tabGroups')).toBe(false);
    expect(isCapabilitySupported(environment, 'browserControl')).toBe(true);
  });

  it('reports unknown with no capabilities outside an extension runtime', () => {
    const environment = getCurrentPlatformEnvironment();

    expect(environment.kind).toBe('unknown');
    expect(Object.values(environment.capabilities).every((supported) => !supported)).toBe(true);
  });

  it('reports unknown when the extension runtime is no longer readable', () => {
    const chromeStub = {};
    Object.defineProperty(chromeStub, 'runtime', {
      get() {
        throw new Error('Extension context invalidated');
      },
    });
    vi.stubGlobal('chrome', chromeStub);

    const environment = getCurrentPlatformEnvironment();

    expect(environment.kind).toBe('unknown');
    expect(Object.values(environment.capabilities).every((supported) => !supported)).toBe(true);
  });

  it('surfaces unexpected runtime access failures', () => {
    const chromeStub = {};
    Object.defineProperty(chromeStub, 'runtime', {
      get() {
        throw new Error('unexpected runtime getter failure');
      },
    });
    vi.stubGlobal('chrome', chromeStub);

    expect(() => getCurrentPlatformEnvironment())
      .toThrow('unexpected runtime getter failure');
  });

  it('filters native MCP controls when native messaging is unsupported', () => {
    const environment: PlatformEnvironment = {
      kind: 'unknown',
      name: 'Unknown',
      capabilities: createCapabilityMap({}),
    };
    const kinds: McpServerTransportConfig['kind'][] = ['streamable_http', 'native_messaging', 'stdio_bridge'];

    expect(isShellNativeHostSupported(environment)).toBe(false);
    expect(getSupportedMcpTransportKinds(kinds, environment)).toEqual(['streamable_http', 'stdio_bridge']);
  });
});
