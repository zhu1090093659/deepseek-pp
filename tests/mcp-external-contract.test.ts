import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MCP_NATIVE_ENVELOPE_PROTOCOL,
  MCP_NATIVE_ENVELOPE_VERSION,
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  callMcpTool,
  createMcpNativeMessagingTransport,
  createMcpRequest,
  createMcpTransport,
  fetchWithTimeout,
  initializeMcpServer,
  listMcpTools,
  normalizeJsonRpcResponse,
} from '../core/mcp';
import { parseJsonRpcSseMessage } from '../core/mcp/transports/common';
import type {
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpProtocolTransport,
  McpServerConfig,
} from '../core/mcp';
import type { ToolCall } from '../core/types';
import {
  MCP_CURRENT_GAPS,
  MCP_UNKNOWN_TRANSPORT_CONTRACT,
  MCP_NATIVE_ENVELOPE_FIXTURE,
  MCP_PROTOCOL_CONTRACT,
  MCP_PROTOCOL_NEGOTIATION_FIXTURES,
  MCP_STRICT_RESPONSE_REJECTIONS,
} from './fixtures/external-runtime/mcp';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MCP and Native external contract', () => {
  it('freezes the request protocol, five transports, and Native envelope identity', () => {
    expect(MCP_PROTOCOL_VERSION).toBe(MCP_PROTOCOL_CONTRACT.requestVersion);
    expect([...MCP_SUPPORTED_PROTOCOL_VERSIONS]).toEqual(MCP_PROTOCOL_CONTRACT.supportedVersions);
    expect(MCP_NATIVE_ENVELOPE_PROTOCOL).toBe(MCP_PROTOCOL_CONTRACT.nativeEnvelopeProtocol);
    expect(MCP_NATIVE_ENVELOPE_VERSION).toBe(MCP_PROTOCOL_CONTRACT.nativeEnvelopeVersion);
    expect(MCP_PROTOCOL_CONTRACT.transportKinds).toEqual([
      'http',
      'sse',
      'streamable_http',
      'stdio_bridge',
      'native_messaging',
    ]);
  });

  it('advertises only implemented client capabilities during initialize', async () => {
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => ({ version: '1.11.9' }) },
    });

    const initializeRequests: Array<McpJsonRpcRequest<Record<string, unknown>>> = [];
    const transport: McpProtocolTransport = {
      async request(request) {
        initializeRequests.push(
          request as McpJsonRpcRequest<Record<string, unknown>>,
        );
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'strict-server', version: '1.0.0' },
          },
        } as McpJsonRpcResponse<any>;
      },
      async notify() {},
    };

    await initializeMcpServer(mcpServer(), transport);

    expect(initializeRequests[0]).toMatchObject({
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'DeepSeek++', version: '1.11.9' },
      },
    });
    expect(
      (initializeRequests[0]?.params as { capabilities?: Record<string, unknown> } | undefined)
        ?.capabilities,
    ).not.toHaveProperty('tools');
  });

  it('preserves known/missing negotiation and rejects unsupported versions before notification', async () => {
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => ({ version: '1.10.0' }) },
    });

    for (const fixture of MCP_PROTOCOL_NEGOTIATION_FIXTURES) {
      const methods: string[] = [];
      const transport: McpProtocolTransport = {
        async request(request) {
          methods.push(request.method);
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              ...(fixture.classification === 'legacy-fallback'
                ? {}
                : { protocolVersion: fixture.serverVersion }),
              capabilities: { tools: {} },
              serverInfo: { name: 'contract-server', version: '1.0.0' },
            },
          } as McpJsonRpcResponse<any>;
        },
        async notify(notification) {
          methods.push(notification.method);
        },
      };

      const initialization = initializeMcpServer(mcpServer(), transport);
      if (fixture.classification === 'unsupported') {
        await expect(initialization).rejects.toMatchObject({ code: fixture.errorCode });
        expect(methods).toEqual(['initialize']);
      } else {
        await expect(initialization)
          .resolves.toMatchObject({ protocolVersion: fixture.currentOutput });
        expect(methods).toEqual(MCP_PROTOCOL_CONTRACT.handshakeMethods.slice(0, 2));
      }
    }
  });

  it('propagates a caller cancellation signal through MCP initialization and tool calls', async () => {
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => ({ version: '1.10.0' }) },
    });
    const controller = new AbortController();
    const receivedSignals: Array<AbortSignal | undefined> = [];
    const transport: McpProtocolTransport = {
      async request(request, options) {
        receivedSignals.push(options?.signal);
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: request.method === 'initialize'
            ? { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }
            : { content: [{ type: 'text', text: 'done' }] },
        } as McpJsonRpcResponse<any>;
      },
      async notify(_notification, options) {
        receivedSignals.push(options?.signal);
      },
    };

    await initializeMcpServer(mcpServer(), transport, { signal: controller.signal });
    await callMcpTool(mcpServer(), transport, {
      call: toolCall(),
      signal: controller.signal,
    });

    expect(receivedSignals).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
    ]);
  });

  it('preserves the caller abort reason when cancelling an MCP HTTP request', async () => {
    vi.stubGlobal('fetch', vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })));
    const controller = new AbortController();
    const reason = new Error('automation cancelled');
    const request = fetchWithTimeout('https://mcp.example.test/rpc', {
      signal: controller.signal,
    }, 10_000);

    controller.abort(reason);

    await expect(request).rejects.toBe(reason);
  });

  it('keeps caller cancellation connected after response headers arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => new Response(new ReadableStream({
      start(streamController) {
        init?.signal?.addEventListener('abort', () => {
          streamController.error(init.signal?.reason);
        }, { once: true });
      },
    }))));
    const controller = new AbortController();
    const reason = new Error('cancel while reading');
    const response = await fetchWithTimeout('https://mcp.example.test/rpc', {
      signal: controller.signal,
    }, 10_000);
    const body = response.text();

    controller.abort(reason);

    await expect(body).rejects.toBe(reason);
  });

  it('emits the released Native v1 envelope from the production transport', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        connectNative: vi.fn(() => ({
          postMessage: vi.fn((value: unknown) => posted.push(value)),
          onMessage: { addListener: vi.fn() },
          onDisconnect: { addListener: vi.fn() },
        })),
      },
    });

    await createMcpNativeMessagingTransport(mcpServer({
      kind: 'native_messaging',
      nativeHost: 'com.example.contract',
      command: 'node',
      args: ['server.mjs'],
      cwd: '/tmp/native-contract',
      env: { CONTRACT_ENV: 'visible' },
    }, 'native-contract')).notify!({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    expect(posted).toEqual([MCP_NATIVE_ENVELOPE_FIXTURE]);
  });

  it('rejects an unknown transport before network access', () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true),
      },
    });
    const server = mcpServer({
      kind: 'future_transport',
      url: 'https://future-mcp.example.test/rpc',
    } as any);

    expect(() => createMcpTransport(server)).toThrowError(expect.objectContaining({
      code: MCP_UNKNOWN_TRANSPORT_CONTRACT.errorCode,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(MCP_UNKNOWN_TRANSPORT_CONTRACT.networkRequests);
  });

  it('accepts exactly one correlated JSON-RPC result or error branch', () => {
    const request = {
      jsonrpc: '2.0',
      id: 'expected-id',
      method: 'contract',
    } as const;

    expect(normalizeJsonRpcResponse({
      jsonrpc: '2.0',
      id: 'expected-id',
      result: { value: true },
    }, request)).toEqual({
      jsonrpc: '2.0',
      id: 'expected-id',
      result: { value: true },
    });
    expect(normalizeJsonRpcResponse({
      jsonrpc: '2.0',
      id: 'expected-id',
      error: { code: -32000, message: 'server failed', data: { retryAfterMs: 10 } },
    }, request)).toEqual({
      jsonrpc: '2.0',
      id: 'expected-id',
      error: { code: -32000, message: 'server failed', data: { retryAfterMs: 10 } },
    });
  });

  it.each(MCP_STRICT_RESPONSE_REJECTIONS)('rejects malformed response: $name', ({ response }) => {
    expect(() => normalizeJsonRpcResponse(response, {
      jsonrpc: '2.0',
      id: 'expected-id',
      method: 'contract',
    })).toThrowError(expect.objectContaining({
      code: 'mcp_response_invalid',
      retryable: false,
    }));
  });

  it('accepts legacy SSE server messages before the correlated response', () => {
    const request = {
      jsonrpc: '2.0',
      id: 'expected-id',
      method: 'contract',
    } as const;

    expect(parseJsonRpcSseMessage(
      '{"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
      request,
    )).toBeNull();
    expect(parseJsonRpcSseMessage(
      '{"jsonrpc":"2.0","id":"server-request","method":"roots/list","params":{}}',
      request,
    )).toBeNull();
    expect(parseJsonRpcSseMessage(
      '{"jsonrpc":"2.0","id":"expected-id","result":{"ok":true}}',
      request,
    )).toEqual({
      jsonrpc: '2.0',
      id: 'expected-id',
      result: { ok: true },
    });
  });

  it('preserves structured and text-error output while truncating detail by UTF-8 bytes', async () => {
    const structured = await callMcpTool(
      mcpServer(),
      resultTransport({
        content: [{ type: 'text', text: 'ignored because structured content wins' }],
        structuredContent: { answer: 42 },
      }),
      { call: toolCall() },
    );
    expect(structured).toMatchObject({
      ok: true,
      summary: 'MCP 工具已执行',
      detail: '{\n  "answer": 42\n}',
      output: { answer: 42 },
      truncated: false,
    });

    const failed = await callMcpTool(
      mcpServer(),
      resultTransport({ content: [{ type: 'text', text: 'host failed' }], isError: true }),
      { call: toolCall() },
    );
    expect(failed).toMatchObject({
      ok: false,
      detail: 'host failed',
      error: { code: 'mcp_tool_result_error', message: 'host failed', retryable: false },
    });

    const truncated = await callMcpTool(
      mcpServer(),
      resultTransport({ structuredContent: '中文🙂' }),
      { call: toolCall(), maxResultBytes: 3 },
    );
    expect(truncated).toMatchObject({ truncated: true, detail: '中' });
    expect(new TextEncoder().encode(truncated.detail).byteLength).toBe(3);

    const exactBoundary = await callMcpTool(
      mcpServer(),
      resultTransport({ structuredContent: '中文🙂' }),
      { call: toolCall(), maxResultBytes: 10 },
    );
    expect(exactBoundary).toMatchObject({ truncated: false, detail: '中文🙂' });

    const truncatedError = await callMcpTool(
      mcpServer(),
      resultTransport({ content: [{ type: 'text', text: '中文🙂' }], isError: true }),
      { call: toolCall(), maxResultBytes: 3 },
    );
    expect(truncatedError).toMatchObject({
      ok: false,
      truncated: true,
      detail: '中',
      error: { message: '中' },
    });
  });

  it('caps paginated discovery exactly at maxToolCount', async () => {
    const requestedCursors: Array<string | undefined> = [];
    const pages = [
      {
        tools: [
          { name: 'first', description: 'First tool', inputSchema: { type: 'object' } },
          { name: 'second', description: 'Second tool', inputSchema: { type: 'object' } },
        ],
        nextCursor: 'page-2',
      },
      {
        tools: [
          { name: 'third', description: 'Third tool', inputSchema: { type: 'object' } },
          { name: 'fourth', description: 'Fourth tool', inputSchema: { type: 'object' } },
        ],
        nextCursor: 'page-3',
      },
    ];
    const transport: McpProtocolTransport = {
      async request(request) {
        const cursor = typeof request.params?.cursor === 'string' ? request.params.cursor : undefined;
        requestedCursors.push(cursor);
        const result = pages[requestedCursors.length - 1];
        return { jsonrpc: '2.0', id: request.id, result } as McpJsonRpcResponse<any>;
      },
    };
    const server = mcpServer();
    server.limits.maxToolCount = 3;

    await expect(listMcpTools(server, transport)).resolves.toMatchObject([
      { annotations: { mcpToolName: 'first' } },
      { annotations: { mcpToolName: 'second' } },
      { annotations: { mcpToolName: 'third' } },
    ]);
    expect(requestedCursors).toEqual([undefined, 'page-2']);
    expect(MCP_CURRENT_GAPS).toEqual([]);
  });
});

function resultTransport(result: unknown): McpProtocolTransport {
  return {
    async request(request) {
      return { jsonrpc: '2.0', id: request.id, result } as McpJsonRpcResponse<any>;
    },
  };
}

function toolCall(): ToolCall {
  return {
    name: 'contract_tool',
    invocationName: 'mcp_contract_contract_tool',
    descriptorId: 'mcp:contract:contract_tool',
    provider: {
      kind: 'mcp',
      id: 'contract',
      displayName: 'Contract MCP',
      transport: 'streamable_http',
    },
    payload: {},
    raw: '',
  };
}

function mcpServer(
  transport: McpServerConfig['transport'] = {
    kind: 'streamable_http',
    url: 'https://mcp.example.test/rpc',
  },
  id = 'contract',
): McpServerConfig {
  return {
    version: 1,
    id,
    displayName: 'Contract MCP',
    enabled: true,
    transport,
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
