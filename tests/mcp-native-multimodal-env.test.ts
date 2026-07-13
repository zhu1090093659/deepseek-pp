import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from '../core/mcp/types';
import { MULTIMODAL_MCP_NATIVE_HOST } from '../core/multimodal/contracts';
import { saveMultimodalSettings } from '../core/multimodal/settings';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('multimodal native messaging env', () => {
  it('uses Settings as the only provider env source', async () => {
    const storage = new Map<string, unknown>();
    let postedEnvelope: any;

    vi.stubGlobal('chrome', {
      runtime: {
        connectNative: vi.fn(() => ({
          postMessage: vi.fn((value: unknown) => {
            postedEnvelope = value;
          }),
          onMessage: { addListener: vi.fn() },
          onDisconnect: { addListener: vi.fn() },
        })),
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
          set: vi.fn(async (value: Record<string, unknown>) => {
            for (const [key, item] of Object.entries(value)) storage.set(key, item);
          }),
          remove: vi.fn(async (key: string) => {
            storage.delete(key);
          }),
        },
      },
    });

    await saveMultimodalSettings({
      openaiApiKey: 'settings-openai',
      geminiApiKey: 'settings-gemini',
      openaiImageModel: 'gpt-4.1-mini',
      geminiVideoModel: 'gemini-2.5-flash',
      openaiBaseUrl: 'https://openai-settings.example/v1',
      geminiBaseUrl: 'https://gemini-settings.example/v1beta',
    });

    const server = createServer({
      OPENAI_API_KEY: 'stale-openai',
      GEMINI_API_KEY: 'stale-gemini',
      OPENAI_BASE_URL: 'https://stale-openai.example/v1',
      GEMINI_BASE_URL: 'https://stale-gemini.example',
      EXTRA_STALE_VALUE: 'hidden',
    });

    const { createMcpNativeMessagingTransport } = await import('../core/mcp/transports/native');
    await createMcpNativeMessagingTransport(server).notify!({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    expect(postedEnvelope.server.env).toEqual({
      OPENAI_IMAGE_MODEL: 'gpt-4.1-mini',
      GEMINI_VIDEO_MODEL: 'gemini-2.5-flash',
      OPENAI_BASE_URL: 'https://openai-settings.example/v1',
      GEMINI_BASE_URL: 'https://gemini-settings.example/v1beta',
      OPENAI_API_KEY: 'settings-openai',
      GEMINI_API_KEY: 'settings-gemini',
    });
  });

  it('does not dispatch a request cancelled while its async envelope is being hydrated', async () => {
    vi.resetModules();
    let releaseSettings!: (value: Record<string, unknown>) => void;
    const settings = new Promise<Record<string, unknown>>((resolve) => {
      releaseSettings = resolve;
    });
    const connectNative = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: { connectNative },
      storage: {
        local: {
          get: vi.fn(async () => settings),
        },
      },
    });
    const controller = new AbortController();
    const reason = new Error('automation cancelled during env read');
    const { createMcpNativeMessagingTransport } = await import('../core/mcp/transports/native');
    const pending = createMcpNativeMessagingTransport(createServer({})).request({
      jsonrpc: '2.0',
      id: 'cancel-before-native-dispatch',
      method: 'tools/call',
      params: { name: 'vision_status', arguments: {} },
    }, { signal: controller.signal });

    controller.abort(reason);
    releaseSettings({});

    await expect(pending).rejects.toBe(reason);
    expect(connectNative).not.toHaveBeenCalled();
  });
});

describe('native messaging payload limits', () => {
  it('rejects oversized local_file_write content before opening the native host', async () => {
    const connectNative = vi.fn();

    vi.stubGlobal('chrome', {
      runtime: {
        connectNative,
      },
    });

    const server = createServer({}, 'com.deepseek_pp.shell');

    const { createMcpNativeMessagingTransport } = await import('../core/mcp/transports/native');
    await expect(createMcpNativeMessagingTransport(server).request({
      jsonrpc: '2.0',
      id: 'write-big-file',
      method: 'tools/call',
      params: {
        name: 'local_file_write',
        arguments: {
          path: '/tmp/big.txt',
          content: 'x'.repeat(2_000_001),
        },
      },
    })).rejects.toMatchObject({
      code: 'mcp_native_payload_too_large',
      retryable: false,
    });

    expect(connectNative).not.toHaveBeenCalled();
  });

  it('rejects content just over the 900 KB cap and points users at chunked writes (issue #297)', async () => {
    const connectNative = vi.fn();

    vi.stubGlobal('chrome', {
      runtime: {
        connectNative,
      },
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      },
    });

    const server = createServer({}, 'com.deepseek_pp.shell');

    const { createMcpNativeMessagingTransport } = await import('../core/mcp/transports/native');
    await expect(createMcpNativeMessagingTransport(server).request({
      jsonrpc: '2.0',
      id: 'write-over-cap',
      method: 'tools/call',
      params: {
        name: 'local_file_write',
        arguments: {
          path: '/tmp/over.txt',
          content: 'x'.repeat(900_001),
        },
      },
    })).rejects.toMatchObject({
      code: 'mcp_native_payload_too_large',
      retryable: false,
    });

    expect(connectNative).not.toHaveBeenCalled();
  });

  it('does not size-gate multimodal native host payloads (regression for analyze_images/analyze_video)', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        connectNative: vi.fn(() => ({
          postMessage: vi.fn(),
          onMessage: { addListener: vi.fn((handler: (msg: unknown) => void) => {
            setTimeout(() => handler({
              jsonrpc: '2.0',
              id: 'analyze-big',
              result: { content: [{ type: 'text', text: 'ok' }] },
            }), 0);
          }) },
          onDisconnect: { addListener: vi.fn() },
        })),
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
        },
      },
    });

    const server = createServer({}, 'com.deepseek_pp.multimodal.test-payload');
    const largeImage = 'x'.repeat(10 * 1024 * 1024);

    const { createMcpNativeMessagingTransport } = await import('../core/mcp/transports/native');
    const result = await createMcpNativeMessagingTransport(server).request({
      jsonrpc: '2.0',
      id: 'analyze-big',
      method: 'tools/call',
      params: {
        name: 'analyze_images',
        arguments: {
          prompt: 'describe',
          images: [{ type: 'input_image', image_url: `data:image/png;base64,${largeImage}`, detail: 'auto' }],
        },
      },
    }, { timeoutMs: 5_000 });

    expect(result).toBeDefined();
  });

  it('rejects oversized non-local_file_write shell host envelope', async () => {
    const connectNative = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: { connectNative },
    });

    const server = createServer({}, 'com.deepseek_pp.shell');
    const { createMcpNativeMessagingTransport } = await import('../core/mcp/transports/native');

    await expect(createMcpNativeMessagingTransport(server).request({
      jsonrpc: '2.0',
      id: 'big-shell-call',
      method: 'tools/call',
      params: {
        name: 'shell_exec',
        arguments: { command: 'x'.repeat(10 * 1024 * 1024) },
      },
    })).rejects.toMatchObject({
      code: 'mcp_native_payload_too_large',
      retryable: false,
    });

    expect(connectNative).not.toHaveBeenCalled();
  });

  it('does not size-gate notifications on the shell host', async () => {
    const postedEnvelopes: unknown[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        connectNative: vi.fn(() => ({
          postMessage: vi.fn((value: unknown) => { postedEnvelopes.push(value); }),
          onMessage: { addListener: vi.fn() },
          onDisconnect: { addListener: vi.fn() },
        })),
      },
    });

    const server = createServer({}, 'com.deepseek_pp.shell');
    const { createMcpNativeMessagingTransport } = await import('../core/mcp/transports/native');

    await createMcpNativeMessagingTransport(server).notify!({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    expect(postedEnvelopes).toHaveLength(1);
  });
});

function createServer(env: Record<string, string>, nativeHost = MULTIMODAL_MCP_NATIVE_HOST): McpServerConfig {
  return {
    version: 1,
    id: 'multimodal',
    displayName: 'Multimodal Vision',
    enabled: true,
    transport: {
      kind: 'native_messaging',
      nativeHost,
      env,
    },
    headers: [],
    secrets: [],
    timeouts: {
      connectMs: 1_000,
      requestMs: 1_000,
      discoveryMs: 1_000,
    },
    limits: {
      maxResultBytes: 1_000_000,
      maxToolCount: 64,
    },
    allowlist: {
      mode: 'all',
      toolNames: [],
    },
    execution: {
      enabled: true,
      mode: 'manual',
    },
    status: 'unknown',
    lastConnectedAt: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 0,
  };
}
