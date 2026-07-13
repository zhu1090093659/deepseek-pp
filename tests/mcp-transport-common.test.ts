import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MCP_PROTOCOL_VERSION,
  createMcpRequest,
  createMcpTransport,
  createMcpStreamableHttpTransport,
  initializeMcpServer,
  type McpServerConfig,
} from '../core/mcp';
import { McpTransportError, readJsonRpcResponse } from '../core/mcp/transports/common';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP transport response limits', () => {
  it('fails before parsing oversized JSON-RPC HTTP bodies', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: '1', result: { text: 'too large' } });
    const response = new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(readJsonRpcResponse(response, { jsonrpc: '2.0', id: '1', method: 'test' }, { maxBytes: 8 }))
      .rejects
      .toMatchObject({ code: 'mcp_response_too_large' } satisfies Partial<McpTransportError>);
  });

  it('persists Streamable HTTP session ids after initialize', async () => {
    const requests: Array<{ method: string; headers: Headers }> = [];
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true),
      },
      runtime: { getManifest: () => ({ version: '1.10.0' }) },
    });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers as HeadersInit);
      requests.push({ method: body.method, headers });

      const responseHeaders = new Headers({ 'content-type': 'application/json' });
      if (body.method === 'initialize') responseHeaders.set('Mcp-Session-Id', 'session-254');
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: body.method === 'tools/list'
          ? { tools: [] }
          : { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } },
      }), { status: 200, headers: responseHeaders });
    }));

    const server = createServerConfig();
    const transport = createMcpStreamableHttpTransport(server);
    await initializeMcpServer(server, transport);
    await transport.request(createMcpRequest('tools/list'));

    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    expect(requests[0].headers.get('Mcp-Session-Id')).toBeNull();
    expect(requests[1].headers.get('Mcp-Session-Id')).toBe('session-254');
    expect(requests[2].headers.get('Mcp-Session-Id')).toBe('session-254');
    expect(requests[0].headers.get('MCP-Protocol-Version')).toBeNull();
    expect(requests[1].headers.get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
    expect(requests[2].headers.get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
  });

  it('does not reuse a rejected Streamable HTTP protocol or session on retry', async () => {
    const requests: Array<{ method: string; headers: Headers }> = [];
    let initializeCount = 0;
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true),
      },
      runtime: { getManifest: () => ({ version: '1.10.0' }) },
    });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers as HeadersInit);
      requests.push({ method: body.method, headers });
      if (body.method === 'initialize') initializeCount += 1;
      const future = body.method === 'initialize' && initializeCount === 1;
      const responseHeaders = new Headers({
        'content-type': 'application/json',
        'Mcp-Session-Id': future ? 'future-session' : 'current-session',
      });
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: body.method === 'initialize'
          ? {
              protocolVersion: future ? '2099-12-31' : MCP_PROTOCOL_VERSION,
              capabilities: { tools: {} },
            }
          : { tools: [] },
      }), { status: 200, headers: responseHeaders });
    }));

    const server = createServerConfig();
    const transport = createMcpStreamableHttpTransport(server);
    await expect(initializeMcpServer(server, transport)).rejects.toMatchObject({
      code: 'mcp_protocol_version_unsupported',
    });
    await expect(initializeMcpServer(server, transport)).resolves.toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
    });
    await transport.request(createMcpRequest('tools/list'));

    expect(requests[1].headers.get('MCP-Protocol-Version')).toBeNull();
    expect(requests[1].headers.get('Mcp-Session-Id')).toBeNull();
    expect(requests[2].headers.get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
    expect(requests[2].headers.get('Mcp-Session-Id')).toBe('current-session');
    expect(requests[3].headers.get('Mcp-Session-Id')).toBe('current-session');
  });

  it('sends raw JSON-RPC to stdio bridge HTTP services', async () => {
    const requests: unknown[] = [];
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true),
      },
    });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const transport = createMcpTransport({
      ...createServerConfig(),
      transport: {
        kind: 'stdio_bridge',
        url: 'http://127.0.0.1:9333/mcp',
        command: 'uvx',
        args: ['enhanced-mcp-memory'],
      },
    });

    await transport.request(createMcpRequest('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: 'test', version: '0.0.0' },
    }));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
    });
    expect(requests[0]).not.toHaveProperty('protocol');
    expect(requests[0]).not.toHaveProperty('server');
    expect(requests[0]).not.toHaveProperty('message');
  });
});

function createServerConfig(): McpServerConfig {
  return {
    version: 1,
    id: 'stateful',
    displayName: 'Stateful MCP',
    enabled: true,
    transport: {
      kind: 'streamable_http',
      url: 'http://127.0.0.1:48123/mcp',
    },
    headers: [],
    secrets: [],
    timeouts: {
      connectMs: 1_000,
      requestMs: 1_000,
      discoveryMs: 1_000,
    },
    limits: {
      maxResultBytes: 64_000,
      maxToolCount: 128,
    },
    allowlist: {
      mode: 'all',
      toolNames: [],
    },
    execution: {
      mode: 'auto',
      enabled: true,
    },
    status: 'unknown',
    lastConnectedAt: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}
