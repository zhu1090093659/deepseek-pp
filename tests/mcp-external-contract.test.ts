import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MCP_NATIVE_ENVELOPE_PROTOCOL,
  MCP_NATIVE_ENVELOPE_VERSION,
  MCP_PROTOCOL_VERSION,
  callMcpTool,
  createMcpNativeMessagingTransport,
  createMcpRequest,
  createMcpTransport,
  fetchWithTimeout,
  initializeMcpServer,
  listMcpTools,
  normalizeJsonRpcResponse,
} from '../core/mcp';
import type {
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
} from './fixtures/external-runtime/mcp';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MCP and Native external contract', () => {
  it('freezes the request protocol, five transports, and Native envelope identity', () => {
    expect(MCP_PROTOCOL_VERSION).toBe(MCP_PROTOCOL_CONTRACT.requestVersion);
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

  it('records shallow response normalization without promoting malformed JSON-RPC to legal output', () => {
    const normalized = normalizeJsonRpcResponse({
      jsonrpc: '1.0',
      id: 'wrong-id',
      result: { value: true },
      error: { code: -32000, message: 'also present' },
    }, {
      jsonrpc: '2.0',
      id: 'expected-id',
      method: 'contract',
    });

    expect(normalized).toEqual({
      jsonrpc: '2.0',
      id: 'wrong-id',
      result: { value: true },
      error: { code: -32000, message: 'also present' },
    });
    expect(MCP_CURRENT_GAPS[0].target).toBe('strict-json-rpc-response-codec-after-T3.5');
  });

  it('freezes structured, text-error, and current UTF-16 truncation output behavior', async () => {
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
    expect(truncated).toMatchObject({ truncated: true, detail: '中文\ud83d' });
    expect(MCP_CURRENT_GAPS[1].target).toBe('byte-accurate-output-budget-after-T5.1');
  });

  it('keeps page-level tool-count overshoot executable but owned by T4.5', async () => {
    const transport = resultTransport({
      tools: [
        { name: 'first', description: 'First tool', inputSchema: { type: 'object' } },
        { name: 'second', description: 'Second tool', inputSchema: { type: 'object' } },
      ],
    });
    const server = mcpServer();
    server.limits.maxToolCount = 1;

    await expect(listMcpTools(server, transport)).resolves.toHaveLength(2);
    expect(MCP_CURRENT_GAPS[2].target).toBe('explicit-shell-catalog-limit-after-T4.5');
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
