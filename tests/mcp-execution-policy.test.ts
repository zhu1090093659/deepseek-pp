import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_PROTOCOL_VERSION } from '../core/mcp';
import { createMcpDescriptorId, createMcpInvocationName } from '../core/mcp/descriptor-identity';
import { executeMcpToolCall, getMcpToolDescriptors, refreshMcpServerDiscovery } from '../core/mcp/discovery';
import {
  createMcpServer,
  getMcpServerById,
  getMcpToolCache,
  saveMcpToolCache,
  updateMcpServer,
} from '../core/mcp/store';
import { renderToolSchemas } from '../core/prompt/augmentation';
import type { McpServerConfig, ToolCall, ToolDescriptor } from '../core/types';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
      },
    },
    permissions: {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
    },
    runtime: {
      getManifest: vi.fn(() => ({ version: '0.0.0' })),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP execution policy', () => {
  it('rejects tool calls before discovery when server execution is disabled', async () => {
    const server = await createMcpServer({
      displayName: 'Disabled Execution MCP',
      enabled: true,
      transport: {
        kind: 'native_messaging',
        nativeHost: 'com.example.disabled_execution',
      },
      execution: {
        enabled: false,
        mode: 'manual',
      },
    });

    const descriptor = createMcpDescriptor(server);
    const result = await executeMcpToolCall(createMcpCall(server.id, descriptor), descriptor);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('mcp_execution_disabled');
    expect(result.detail).toContain('Disabled Execution MCP');
  });

  it('discovers tools through a Streamable HTTP initialized session', async () => {
    const requests: Array<{ method: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers as HeadersInit);
      requests.push({ method: body.method, headers });

      const responseHeaders = new Headers({ 'content-type': 'application/json' });
      if (body.method === 'initialize') responseHeaders.set('Mcp-Session-Id', 'discover-session-254');
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: body.method === 'tools/list'
          ? {
              tools: [{
                name: 'sample_tool',
                title: 'Sample Tool',
                description: 'Sample MCP tool.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    group: {
                      type: 'string',
                      enum: ['playwright', 'filesystem'],
                    },
                  },
                  required: ['group'],
                },
              }],
            }
          : { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } },
      }), { status: 200, headers: responseHeaders });
    }));

    const server = await createMcpServer({
      displayName: 'Discoverable HTTP MCP',
      enabled: true,
      transport: {
        kind: 'streamable_http',
        url: 'http://127.0.0.1:48125/mcp',
      },
      timeouts: {
        connectMs: 1_000,
        requestMs: 1_000,
        discoveryMs: 1_000,
      },
    });

    const cache = await refreshMcpServerDiscovery(server.id);

    expect(cache.health.status).toBe('ready');
    expect(cache.descriptors.map((descriptor) => descriptor.name)).toEqual(['sample_tool']);
    expect(cache.descriptors[0].inputSchema.properties?.group).toEqual({
      type: 'string',
      enum: ['playwright', 'filesystem'],
    });
    const persistedDescriptors = await getMcpToolDescriptors({ includeDisabled: true });
    expect(renderToolSchemas(persistedDescriptors)).toContain('"enum":["playwright","filesystem"]');
    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    expect(requests[0].headers.get('Mcp-Session-Id')).toBeNull();
    expect(requests[1].headers.get('Mcp-Session-Id')).toBe('discover-session-254');
    expect(requests[2].headers.get('Mcp-Session-Id')).toBe('discover-session-254');
    expect(requests[0].headers.get('MCP-Protocol-Version')).toBeNull();
    expect(requests[1].headers.get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
    expect(requests[2].headers.get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
  });

  it('does not persist an error cache when stale discovery is cancelled', async () => {
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
    })));
    const server = await createMcpServer({
      displayName: 'Cancelled Discovery MCP',
      enabled: true,
      transport: {
        kind: 'streamable_http',
        url: 'http://127.0.0.1:48126/mcp',
      },
    });
    const before = await getMcpServerById(server.id);
    const controller = new AbortController();
    const reason = new Error('automation cancelled during discovery');
    const pending = refreshMcpServerDiscovery(server.id, { signal: controller.signal });
    await vi.waitFor(() => expect(observedSignal).toBeDefined());

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(await getMcpToolCache(server.id)).toBeNull();
    expect(await getMcpServerById(server.id)).toMatchObject({
      status: before?.status,
      lastError: before?.lastError,
      lastConnectedAt: before?.lastConnectedAt,
    });
  });

  it('initializes Streamable HTTP sessions before executing cached tools', async () => {
    const requests: Array<{ method: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers as HeadersInit);
      requests.push({ method: body.method, headers });

      const responseHeaders = new Headers({ 'content-type': 'application/json' });
      if (body.method === 'initialize') responseHeaders.set('Mcp-Session-Id', 'exec-session-254');
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: body.method === 'tools/call'
          ? {
              content: [{ type: 'text', text: 'done' }],
              structuredContent: { ok: true },
              isError: false,
            }
          : { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } },
      }), { status: 200, headers: responseHeaders });
    }));

    const server = await createMcpServer({
      displayName: 'Stateful HTTP MCP',
      enabled: true,
      transport: {
        kind: 'streamable_http',
        url: 'http://127.0.0.1:48124/mcp',
      },
      timeouts: {
        connectMs: 1_000,
        requestMs: 1_000,
        discoveryMs: 1_000,
      },
    });
    const descriptor = createMcpDescriptor(server);
    await saveMcpToolCache({
      serverId: server.id,
      descriptors: [descriptor],
      refreshedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      health: {
        serverId: server.id,
        status: 'ready',
        checkedAt: Date.now(),
        latencyMs: 1,
        toolCount: 1,
        error: null,
      },
    });

    const result = await executeMcpToolCall(createMcpCall(server.id, descriptor), descriptor);

    expect(result.ok).toBe(true);
    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
    ]);
    expect(requests[0].headers.get('Mcp-Session-Id')).toBeNull();
    expect(requests[1].headers.get('Mcp-Session-Id')).toBe('exec-session-254');
    expect(requests[2].headers.get('Mcp-Session-Id')).toBe('exec-session-254');
    expect(requests[0].headers.get('MCP-Protocol-Version')).toBeNull();
    expect(requests[1].headers.get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
    expect(requests[2].headers.get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
  });

  it('exposes only policy-enabled auto MCP tools to the prompt runtime', async () => {
    const server = await createMcpServer({
      displayName: 'Policy MCP',
      enabled: true,
      transport: {
        kind: 'native_messaging',
        nativeHost: 'com.example.policy',
      },
      allowlist: {
        mode: 'allow',
        toolNames: ['local_file_read'],
      },
      execution: {
        enabled: true,
        mode: 'auto',
      },
    });
    const descriptors = [
      createMcpDescriptor(server, 'local_file_read'),
      createMcpDescriptor(server, 'shell_exec'),
    ];
    await saveMcpToolCache({
      serverId: server.id,
      descriptors,
      refreshedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      health: {
        serverId: server.id,
        status: 'ready',
        checkedAt: Date.now(),
        latencyMs: 1,
        toolCount: descriptors.length,
        error: null,
      },
    });

    await expect(getMcpToolDescriptors()).resolves.toEqual([
      expect.objectContaining({ name: 'local_file_read' }),
    ]);

    await updateMcpServer(server.id, {
      allowlist: { mode: 'deny', toolNames: ['local_file_read'] },
    });
    await expect(getMcpToolDescriptors()).resolves.toEqual([
      expect.objectContaining({ name: 'shell_exec' }),
    ]);

    await updateMcpServer(server.id, {
      execution: { enabled: true, mode: 'manual' },
    });
    await expect(getMcpToolDescriptors()).resolves.toEqual([]);
  });
});

function createMcpCall(serverId: string, descriptor?: ToolDescriptor): ToolCall {
  return {
    name: descriptor?.name ?? 'sample_tool',
    invocationName: descriptor?.invocationName ?? createMcpInvocationName(serverId, 'sample_tool'),
    descriptorId: descriptor?.id ?? createMcpDescriptorId(serverId, 'sample_tool'),
    provider: {
      kind: 'mcp',
      id: serverId,
      displayName: descriptor?.provider.displayName ?? 'Disabled Execution MCP',
      transport: descriptor?.provider.transport ?? 'native_messaging',
    },
    payload: {},
    raw: '',
  };
}

function createMcpDescriptor(server: McpServerConfig, name = 'sample_tool'): ToolDescriptor {
  return {
    id: createMcpDescriptorId(server.id, name),
    provider: {
      kind: 'mcp',
      id: server.id,
      displayName: server.displayName,
      transport: server.transport.kind,
    },
    name,
    invocationName: createMcpInvocationName(server.id, name),
    title: name,
    description: `${name} MCP tool.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execution: {
      mode: 'auto',
      enabled: true,
      risk: 'low',
      timeoutMs: 1_000,
      maxResultBytes: 64_000,
    },
  };
}
