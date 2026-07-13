import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PLATFORM_CAPABILITIES,
  createCapabilityMap,
  getCurrentBrowserExtensionEnvironment,
  getCurrentPlatformEnvironment,
} from '../core/platform/capabilities';
import { isShellNativeHostSupported } from '../core/platform/gating';
import { ensureMcpServerOriginPermission } from '../core/mcp';
import type { McpServerConfig } from '../core/mcp';
import {
  PLATFORM_CAPABILITY_KEYS,
  PLATFORM_CURRENT_GAPS,
  PLATFORM_PROFILE_FIXTURES,
} from './fixtures/external-runtime/platform';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('external platform capability contract', () => {
  it('keeps all 15 serialized capability keys and defaults missing values to false', () => {
    expect(Object.keys(EMPTY_PLATFORM_CAPABILITIES)).toEqual(PLATFORM_CAPABILITY_KEYS);
    expect(createCapabilityMap({ storage: true })).toEqual({
      ...Object.fromEntries(PLATFORM_CAPABILITY_KEYS.map((key) => [key, false])),
      storage: true,
    });
  });

  it('preserves the Chromium API profile', () => {
    vi.stubGlobal('chrome', chromiumApiProfile());

    const environment = getCurrentBrowserExtensionEnvironment();
    expect(environment.kind).toBe('browser_extension');
    for (const capability of PLATFORM_PROFILE_FIXTURES.chromium.supported) {
      expect(environment.capabilities[capability], capability).toBe(true);
    }
  });

  it('preserves explicit Firefox-style degradation while retaining Native Messaging', () => {
    vi.stubGlobal('chrome', firefoxApiProfile());
    vi.stubGlobal('document', undefined);

    const environment = getCurrentBrowserExtensionEnvironment();
    for (const capability of PLATFORM_PROFILE_FIXTURES.firefox.supported) {
      expect(environment.capabilities[capability], capability).toBe(true);
    }
    for (const capability of PLATFORM_PROFILE_FIXTURES.firefox.unsupported) {
      expect(environment.capabilities[capability], capability).toBe(false);
    }
  });

  it('treats unavailable or throwing optional browser APIs as unsupported', () => {
    const chromeStub = firefoxApiProfile() as Record<string, unknown>;
    Object.defineProperty(chromeStub, 'tabs', {
      get() {
        throw new Error('tabs is not allowed for specified extension ID');
      },
    });
    Object.defineProperty(chromeStub, 'debugger', {
      get() {
        throw new Error('Extension context invalidated while reading debugger');
      },
    });
    vi.stubGlobal('chrome', chromeStub);

    const environment = getCurrentBrowserExtensionEnvironment();
    expect(environment.capabilities.tabs).toBe(false);
    expect(environment.capabilities.debugger).toBe(false);
    expect(environment.capabilities.browserControl).toBe(false);
    expect(environment.capabilities.accessibilityTree).toBe(false);
  });

  it('fails MCP host-permission denial explicitly without making a network request', async () => {
    const request = vi.fn(async () => false);
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn(async () => false),
        request,
      },
    });

    await expect(ensureMcpServerOriginPermission(mcpServer()))
      .rejects.toMatchObject({
        code: 'mcp_origin_permission_denied',
        retryable: false,
      });
    expect(request).toHaveBeenCalledWith({ origins: ['https://mcp.example.test/*'] });
  });

  it('records manifest/capability gaps while unknown environments fail closed', () => {
    expect(isShellNativeHostSupported(null)).toBe(true);

    vi.stubGlobal('chrome', chromiumApiProfile());
    expect(getCurrentBrowserExtensionEnvironment().capabilities.downloads).toBe(true);

    vi.unstubAllGlobals();
    const unknown = getCurrentPlatformEnvironment();
    expect(unknown.kind).toBe('unknown');
    expect(Object.values(unknown.capabilities).every((supported) => !supported)).toBe(true);
    expect(isShellNativeHostSupported(unknown)).toBe(false);

    expect(PLATFORM_CURRENT_GAPS.map((gap) => gap.target)).toEqual([
      'manifest-aligned-capability-port-after-T3.2',
      'manifest-aligned-capability-port-after-T3.2',
      'loaded-explicit-capability-state-after-T3.2',
    ]);
  });
});

function chromiumApiProfile() {
  return {
    runtime: {
      id: 'chromium-extension',
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
  };
}

function firefoxApiProfile() {
  return {
    runtime: {
      id: 'firefox-extension',
      sendMessage: vi.fn(),
      getURL: vi.fn(),
      connectNative: vi.fn(),
    },
    storage: { local: {} },
    contextMenus: {},
    alarms: {},
  };
}

function mcpServer(): McpServerConfig {
  return {
    version: 1,
    id: 'permission-contract',
    displayName: 'Permission Contract',
    enabled: true,
    transport: { kind: 'streamable_http', url: 'https://mcp.example.test/rpc' },
    headers: [],
    secrets: [],
    timeouts: { connectMs: 10_000, requestMs: 60_000, discoveryMs: 20_000 },
    limits: { maxResultBytes: 64_000, maxToolCount: 128 },
    allowlist: { mode: 'all', toolNames: [] },
    execution: { mode: 'auto', enabled: true },
    status: 'unknown',
    lastConnectedAt: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}
