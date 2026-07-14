import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type {
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
} from '../core/browser-control/types';
import type { RuntimeMessageContext } from '../core/messaging/runtime-boundary';
import { RUNTIME_COMMAND_CONTRACTS } from '../core/messaging/runtime-command-contracts';
import {
  getRuntimeCommandOwner,
  type RuntimeCommandHandler,
} from '../core/messaging/runtime-command-registry';
import { TOOL_RUNTIME_PAYLOAD_DECODERS } from '../core/messaging/tool-runtime-request-codec';
import type { McpServerConfig, McpToolCacheEntry } from '../core/mcp/types';
import { createCapabilityMap, type PlatformEnvironment } from '../core/platform/capabilities';
import { ToolAuthorizationError } from '../core/tool/authorization';
import type {
  RuntimeToolAuthorizationContext,
  ToolAuthorizationGrantSummary,
  ToolCall,
  ToolCallHistoryRecord,
  ToolDescriptor,
  ToolResult,
} from '../core/tool/types';
import {
  createBrowserToolRuntimeHandlers,
  type BrowserToolRuntimeHandlerDependencies,
} from '../entrypoints/background/browser-tool-handlers';
import {
  createMcpRuntimeHandlers,
  type McpRuntimeHandlerDependencies,
} from '../entrypoints/background/mcp-handlers';
import {
  createToolAuthorizationSubject,
  createToolExecutionRuntimeHandlers,
  type ToolExecutionRuntimeHandlerDependencies,
} from '../entrypoints/background/tool-execution-handlers';
import { createToolRuntimeHandlers } from '../entrypoints/background/tool-runtime-handlers';

const extensionContext: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'extension_context',
  senderUrl: 'chrome-extension://extension-id/sidepanel.html',
  senderOrigin: 'chrome-extension://extension-id',
  tabId: 17,
  frameId: 0,
  documentId: 'extension-document-1',
  documentSessionId: 'extension-document-1',
};

const deepSeekContext: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'deepseek_content',
  senderUrl: 'https://chat.deepseek.com/a/chat/s/chat-1',
  senderOrigin: 'https://chat.deepseek.com',
  tabId: 7,
  frameId: 0,
  documentId: 'document-1',
  documentSessionId: 'document-1',
  chatSessionId: 'chat-1',
};

const descriptor: ToolDescriptor = {
  id: 'local:test:sample_tool',
  provider: { kind: 'local', id: 'test', displayName: 'Test', transport: 'in_process' },
  name: 'sample_tool',
  invocationName: 'sample_tool',
  title: 'Sample tool',
  description: 'Sample tool.',
  inputSchema: { type: 'object', properties: {} },
  execution: { mode: 'auto', enabled: true, risk: 'low' },
};

const call: ToolCall = {
  id: 'call-1',
  descriptorId: descriptor.id,
  provider: descriptor.provider,
  name: descriptor.name,
  invocationName: descriptor.invocationName,
  payload: { value: 'approved' },
  raw: '<sample_tool>{"value":"approved"}</sample_tool>',
  source: {
    trigger: 'manual_chat',
    requestId: 'request-1',
    chatSessionId: 'chat-1',
  },
};

describe('R4.2 tool runtime handler ownership', () => {
  it('creates exactly the 29 inventory-assigned handlers without duplicate ownership', () => {
    const handlers = createToolRuntimeHandlers({
      mcp: createMcpDependencies(),
      browser: createBrowserDependencies(),
      execution: createExecutionDependencies(),
    });
    const types = handlers.map((handler) => handler.type);
    const expected = readInventoryCommands(
      'R4.2 / #361 — MCP, tool, browser control, and sandbox (29)',
    );

    expect(types).toHaveLength(29);
    expect(new Set(types).size).toBe(29);
    expect([...types].sort()).toEqual([...expected].sort());
    for (const type of types) expect(getRuntimeCommandOwner(type)).toBe('typed-handler');

    const decodedTypes = Object.entries(RUNTIME_COMMAND_CONTRACTS)
      .filter(([, contract]) => contract.request.access === 'payload-decoded')
      .map(([type]) => type)
      .filter((type) => expected.includes(type))
      .sort();
    expect(Object.keys(TOOL_RUNTIME_PAYLOAD_DECODERS).sort()).toEqual(decodedTypes);
    expect(decodedTypes).toHaveLength(20);
  });

  it('rejects malformed nested MCP input before persistence or external I/O', async () => {
    const dependencies = createMcpDependencies();
    const handlers = createMcpRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'CREATE_MCP_SERVER',
      payload: {
        displayName: 'Invalid',
        transport: { kind: 'http', url: 'https://example.test/mcp' },
        secrets: [{ kind: 'bearer', value: 7 }],
      },
    })).rejects.toThrow('CREATE_MCP_SERVER.payload.secrets[0].value must be a string');
    expect(dependencies.createMcpServer).not.toHaveBeenCalled();
  });

  it('rejects missing and non-plain required payloads before dependency I/O', async () => {
    const dependencies = createMcpDependencies();
    const handlers = createMcpRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, { type: 'GET_MCP_SERVER' }))
      .rejects.toThrow('GET_MCP_SERVER.payload must be a plain object');
    await expect(dispatch(handlers, {
      type: 'GET_MCP_SERVER',
      payload: new Date(0),
    })).rejects.toThrow('GET_MCP_SERVER.payload must be a plain object');
    expect(dependencies.getMcpServerById).not.toHaveBeenCalled();
  });
});

describe('MCP runtime handlers', () => {
  it('preserves nullable reads, redacted server output, and raw cache output', async () => {
    const dependencies = createMcpDependencies();
    const redacted = createMcpServer({
      secrets: [{ kind: 'bearer', value: '********' }],
    });
    const cache = createMcpCache();
    vi.mocked(dependencies.getAllMcpServers).mockResolvedValue([redacted]);
    vi.mocked(dependencies.getMcpServerById)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(redacted);
    vi.mocked(dependencies.getMcpToolCache)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(cache);
    vi.mocked(dependencies.updateMcpServer).mockResolvedValueOnce(null);
    const handlers = createMcpRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, { type: 'GET_MCP_SERVERS' })).resolves.toEqual([redacted]);
    await expect(dispatch(handlers, {
      type: 'GET_MCP_SERVER',
      payload: { id: 'missing' },
    })).resolves.toBeNull();
    await expect(dispatch(handlers, {
      type: 'GET_MCP_SERVER',
      payload: { id: redacted.id },
    })).resolves.toEqual(redacted);
    await expect(dispatch(handlers, {
      type: 'GET_MCP_TOOL_CACHE',
      payload: { serverId: 'missing' },
    })).resolves.toBeNull();
    await expect(dispatch(handlers, {
      type: 'GET_MCP_TOOL_CACHE',
      payload: { serverId: redacted.id },
    })).resolves.toBe(cache);
    await expect(dispatch(handlers, {
      type: 'UPDATE_MCP_SERVER',
      payload: { id: redacted.id, patch: {} },
    })).resolves.toBeNull();
  });

  it('notifies MCP consumers before descriptor consumers after mutations and discovery', async () => {
    const events: string[] = [];
    const dependencies = createMcpDependencies();
    vi.mocked(dependencies.createMcpServer).mockImplementation(async () => {
      events.push('create');
      return createMcpServer();
    });
    vi.mocked(dependencies.refreshMcpServerDiscovery).mockImplementation(async () => {
      events.push('refresh');
      return createMcpCache();
    });
    vi.mocked(dependencies.broadcastMcpServersUpdate).mockImplementation(async (tabId) => {
      events.push(`mcp:${tabId}`);
    });
    vi.mocked(dependencies.broadcastToolDescriptorsUpdate).mockImplementation(async (tabId) => {
      events.push(`tools:${tabId}`);
    });
    const handlers = createMcpRuntimeHandlers(dependencies);

    await dispatch(handlers, {
      type: 'CREATE_MCP_SERVER',
      payload: {
        displayName: 'Example',
        transport: { kind: 'http', url: 'https://example.test/mcp' },
      },
    });
    expect(events).toEqual(['create', 'mcp:17', 'tools:17']);

    events.length = 0;
    await dispatch(handlers, {
      type: 'REFRESH_MCP_SERVER_TOOLS',
      payload: { serverId: 'server-1' },
    });
    expect(events).toEqual(['refresh', 'mcp:17', 'tools:17']);
  });

  it('preserves all released MCP permission response branches', async () => {
    const dependencies = createMcpDependencies();
    const handlers = createMcpRuntimeHandlers(dependencies);

    vi.mocked(dependencies.getMcpServerById).mockResolvedValueOnce(null);
    await expect(dispatch(handlers, {
      type: 'REQUEST_MCP_SERVER_PERMISSION',
      payload: { serverId: 'missing' },
    })).resolves.toEqual({ ok: false, error: 'mcp_server_not_found' });

    vi.mocked(dependencies.getMcpServerById).mockResolvedValueOnce(createMcpServer({
      transport: { kind: 'native_messaging', nativeHost: 'com.example.host' },
    }));
    await expect(dispatch(handlers, {
      type: 'REQUEST_MCP_SERVER_PERMISSION',
      payload: { serverId: 'server-1' },
    })).resolves.toEqual({ ok: true, origin: null });
    expect(dependencies.requestMcpServerOriginPermission).not.toHaveBeenCalled();

    vi.mocked(dependencies.getMcpServerById).mockResolvedValue(createMcpServer());
    vi.mocked(dependencies.requestMcpServerOriginPermission)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('permissions API unavailable'));
    await expect(dispatch(handlers, {
      type: 'REQUEST_MCP_SERVER_PERMISSION',
      payload: { serverId: 'server-1' },
    })).resolves.toEqual({
      ok: false,
      origin: 'https://example.test/*',
    });
    await expect(dispatch(handlers, {
      type: 'REQUEST_MCP_SERVER_PERMISSION',
      payload: { serverId: 'server-1' },
    })).resolves.toEqual({ ok: false, error: 'permissions API unavailable' });
  });

  it('wraps the connection test without changing the raw discovery cache contract', async () => {
    const dependencies = createMcpDependencies();
    const cache = createMcpCache();
    vi.mocked(dependencies.refreshMcpServerDiscovery).mockResolvedValue(cache);
    const handlers = createMcpRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'TEST_MCP_SERVER_CONNECTION',
      payload: { serverId: cache.serverId },
    })).resolves.toEqual({ ok: true, cache, health: cache.health });
    expect(dependencies.broadcastMcpServersUpdate).toHaveBeenCalledWith(17);
    expect(dependencies.broadcastToolDescriptorsUpdate).toHaveBeenCalledWith(17);
  });
});

describe('browser and web runtime handlers', () => {
  it('keeps the released empty settings patch and descriptor-before-browser notification order', async () => {
    const events: string[] = [];
    const dependencies = createBrowserDependencies();
    vi.mocked(dependencies.saveBrowserControlSettings).mockImplementation(async (patch) => {
      events.push(`save:${JSON.stringify(patch)}`);
      return createBrowserSettings();
    });
    vi.mocked(dependencies.broadcastToolDescriptorsUpdate).mockImplementation(async () => {
      events.push('tools');
    });
    vi.mocked(dependencies.broadcastBrowserControlUpdate).mockImplementation(async () => {
      events.push('browser');
    });
    const handlers = createBrowserToolRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'SAVE_BROWSER_CONTROL_SETTINGS',
    })).resolves.toEqual(createBrowserSettings());
    expect(events).toEqual(['save:{}', 'tools', 'browser']);
  });

  it('detaches before publishing a disabled browser-control state', async () => {
    const events: string[] = [];
    const dependencies = createBrowserDependencies();
    vi.mocked(dependencies.setBrowserControlEnabled).mockImplementation(async () => {
      events.push('disable');
      return createBrowserSettings({ enabled: false });
    });
    vi.mocked(dependencies.detachBrowserControl).mockImplementation(async () => {
      events.push('detach');
    });
    vi.mocked(dependencies.broadcastToolDescriptorsUpdate).mockImplementation(async () => {
      events.push('tools');
    });
    vi.mocked(dependencies.broadcastBrowserControlUpdate).mockImplementation(async () => {
      events.push('browser');
    });
    const handlers = createBrowserToolRuntimeHandlers(dependencies);

    await dispatch(handlers, {
      type: 'SET_BROWSER_CONTROL_ENABLED',
      payload: { enabled: false },
    });
    expect(events).toEqual(['disable', 'detach', 'tools', 'browser']);

    events.length = 0;
    await dispatch(handlers, {
      type: 'SET_BROWSER_CONTROL_ENABLED',
      payload: { enabled: true },
    });
    expect(events).toEqual(['disable', 'tools', 'browser']);
  });

  it('passes through unsupported PC browser state and publishes target changes after success', async () => {
    const state = createBrowserState({
      supported: false,
      error: 'browser_control_unsupported',
    });
    const target = createBrowserTarget();
    const dependencies = createBrowserDependencies();
    vi.mocked(dependencies.getBrowserControlState).mockResolvedValue(state);
    vi.mocked(dependencies.setBrowserControlTarget).mockResolvedValue(target);
    const handlers = createBrowserToolRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, { type: 'GET_BROWSER_CONTROL_STATE' }))
      .resolves.toBe(state);
    await expect(dispatch(handlers, {
      type: 'SET_BROWSER_CONTROL_TARGET',
      payload: { tabId: 9 },
    })).resolves.toEqual({ ok: true, target });
    expect(dependencies.broadcastBrowserControlUpdate).toHaveBeenCalledWith(17);
  });

  it('defaults missing or non-string diagnostic queries and isolates failures by domain', async () => {
    const dependencies = createBrowserDependencies();
    vi.mocked(dependencies.fetch)
      .mockResolvedValueOnce({ status: 200, text: async () => '<b>Bing result</b>' })
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ status: 204, text: async () => '' })
      .mockResolvedValueOnce({ status: 204, text: async () => '' })
      .mockResolvedValueOnce({ status: 204, text: async () => '' })
      .mockResolvedValueOnce({ status: 204, text: async () => '' });
    const handlers = createBrowserToolRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, { type: 'DIAGNOSE_WEB_SEARCH' })).resolves.toEqual({
      'cn.bing.com': { status: 200, length: 18, preview: 'Bing result' },
      'www.bing.com': { status: 0, length: 0, error: 'network unavailable' },
    });
    expect(dependencies.fetch).toHaveBeenNthCalledWith(
      1,
      'https://cn.bing.com/search?q=test',
      expect.any(Object),
    );

    await dispatch(handlers, {
      type: 'DIAGNOSE_WEB_SEARCH',
      payload: null,
    });
    expect(dependencies.fetch).toHaveBeenNthCalledWith(
      3,
      'https://cn.bing.com/search?q=test',
      expect.any(Object),
    );

    await dispatch(handlers, {
      type: 'DIAGNOSE_WEB_SEARCH',
      payload: { query: 7 },
    });
    expect(dependencies.fetch).toHaveBeenNthCalledWith(
      5,
      'https://cn.bing.com/search?q=test',
      expect.any(Object),
    );
  });

  it('preserves empty, denied, rejected-Promise, and synchronous permission responses', async () => {
    const dependencies = createBrowserDependencies();
    const handlers = createBrowserToolRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'REQUEST_HOST_PERMISSION',
      payload: { origins: [] },
    })).resolves.toEqual({ ok: false, error: 'no_origins' });
    expect(dependencies.requestHostPermission).not.toHaveBeenCalled();

    vi.mocked(dependencies.requestHostPermission)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('permissions Promise rejected'))
      .mockImplementationOnce(() => {
        throw new Error('permissions API unavailable');
      });
    await expect(dispatch(handlers, {
      type: 'REQUEST_HOST_PERMISSION',
      payload: { origins: ['https://example.test/*'] },
    })).resolves.toEqual({ ok: false, origins: ['https://example.test/*'] });
    await expect(dispatch(handlers, {
      type: 'REQUEST_HOST_PERMISSION',
      payload: { origins: ['https://example.test/*'] },
    })).resolves.toEqual({ ok: false, origins: ['https://example.test/*'] });
    await expect(dispatch(handlers, {
      type: 'REQUEST_HOST_PERMISSION',
      payload: { origins: ['https://example.test/*'] },
    })).resolves.toEqual({ ok: false, error: 'permissions API unavailable' });
  });
});

describe('tool execution runtime handlers', () => {
  it('gates authorization by receiver surface and validates before descriptor I/O', async () => {
    const dependencies = createExecutionDependencies();
    const handlers = createToolExecutionRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'CREATE_TOOL_AUTHORIZATION',
      payload: { requestId: 'request-1', trigger: 'manual_chat' },
    })).resolves.toEqual({
      ok: false,
      error: 'tool_authorization_requires_content_runtime',
    });
    expect(dependencies.getToolDescriptors).not.toHaveBeenCalled();

    await expect(dispatch(handlers, {
      type: 'CREATE_TOOL_AUTHORIZATION',
      payload: { requestId: 7, trigger: 'manual_chat' },
    }, deepSeekContext)).resolves.toEqual({
      ok: false,
      error: 'invalid_tool_authorization_request',
    });
    expect(dependencies.getToolDescriptors).not.toHaveBeenCalled();
  });

  it('distinguishes omitted descriptor selection from an explicit empty selection', async () => {
    const dependencies = createExecutionDependencies();
    vi.mocked(dependencies.getToolDescriptors).mockResolvedValue([descriptor]);
    const handlers = createToolExecutionRuntimeHandlers(dependencies);

    await dispatch(handlers, {
      type: 'CREATE_TOOL_AUTHORIZATION',
      payload: { requestId: 'request-all', trigger: 'manual_chat', chatSessionId: 'chat-1' },
    }, deepSeekContext);
    expect(dependencies.createToolAuthorization).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ descriptors: [descriptor] }),
    );

    await dispatch(handlers, {
      type: 'CREATE_TOOL_AUTHORIZATION',
      payload: {
        requestId: 'request-none',
        trigger: 'manual_chat',
        chatSessionId: 'chat-1',
        descriptorIds: [],
      },
    }, deepSeekContext);
    expect(dependencies.createToolAuthorization).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ descriptors: [] }),
    );
  });

  it('keeps Firefox grant identity stable when MessageSender.documentId is unavailable', () => {
    const subject = createToolAuthorizationSubject({
      ...deepSeekContext,
      documentId: undefined,
      documentSessionId: 'deepseek_content:7:0:https://chat.deepseek.com/a/chat/s/chat-1',
    });

    expect(subject).toEqual({
      surface: 'deepseek_content',
      documentSessionId: 'deepseek_content:7:0',
      tabId: 7,
      frameId: 0,
      chatSessionId: 'chat-1',
    });
  });

  it('authorizes an external payload before caching and appending its first chunk', async () => {
    const events: string[] = [];
    const dependencies = createExecutionDependencies();
    vi.mocked(dependencies.externalPayloadAuthorizationCache.has).mockImplementation(() => {
      events.push('cache:has');
      return false;
    });
    vi.mocked(dependencies.getAuthorizationDescriptors).mockImplementation(async () => {
      events.push('descriptors');
      return [descriptor];
    });
    vi.mocked(dependencies.authorizeExternalToolPayloadChunk).mockImplementation(async () => {
      events.push('authorize');
      return { namespace: 'grant-1', expiresAt: 2_000 };
    });
    vi.mocked(dependencies.externalPayloadAuthorizationCache.remember).mockImplementation(() => {
      events.push('cache:remember');
    });
    vi.mocked(dependencies.appendExternalizedToolPayloadChunk).mockImplementation(() => {
      events.push('append');
    });
    const handlers = createToolExecutionRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, createAppendMessage(), deepSeekContext))
      .resolves.toEqual({ ok: true });
    expect(events).toEqual([
      'cache:has',
      'descriptors',
      'authorize',
      'cache:remember',
      'append',
    ]);
  });

  it('projects authorization failures without appending and reuses a valid hot-path proof', async () => {
    const dependencies = createExecutionDependencies();
    vi.mocked(dependencies.authorizeExternalToolPayloadChunk).mockRejectedValueOnce(
      new ToolAuthorizationError('tool_authorization_missing', 'Grant not found.'),
    );
    const handlers = createToolExecutionRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, createAppendMessage(), deepSeekContext)).resolves.toMatchObject({
      ok: false,
      error: { code: 'tool_authorization_missing' },
    });
    expect(dependencies.appendExternalizedToolPayloadChunk).not.toHaveBeenCalled();

    vi.mocked(dependencies.externalPayloadAuthorizationCache.has).mockReturnValueOnce(true);
    await expect(dispatch(handlers, createAppendMessage(), deepSeekContext))
      .resolves.toEqual({ ok: true });
    expect(dependencies.getAuthorizationDescriptors).toHaveBeenCalledTimes(1);
    expect(dependencies.authorizeExternalToolPayloadChunk).toHaveBeenCalledTimes(1);
    expect(dependencies.appendExternalizedToolPayloadChunk).toHaveBeenCalledTimes(1);
  });

  it('uses content grants, fails closed without an id, and keeps extension calls trusted', async () => {
    const events: string[] = [];
    const dependencies = createExecutionDependencies();
    vi.mocked(dependencies.externalPayloadAuthorizationCache.deleteCall).mockImplementation(() => {
      events.push('cache:delete-call');
    });
    vi.mocked(dependencies.executeToolCall).mockImplementation(async (_call, authorization) => {
      events.push(`execute:${authorization.kind}`);
      return { ok: true, summary: 'done' };
    });
    vi.mocked(dependencies.broadcastToolCallHistoryUpdate).mockImplementation(async () => {
      events.push('history:broadcast');
    });
    const handlers = createToolExecutionRuntimeHandlers(dependencies);

    await dispatch(handlers, {
      type: 'EXECUTE_TOOL_CALL',
      payload: { ...call, authorizationId: 'grant-1' },
    }, deepSeekContext);
    expect(events).toEqual(['cache:delete-call', 'execute:grant', 'history:broadcast']);
    expect(dependencies.executeToolCall).toHaveBeenNthCalledWith(
      1,
      call,
      {
        kind: 'grant',
        grantId: 'grant-1',
        subject: createToolAuthorizationSubject(deepSeekContext),
      },
      'en',
    );

    events.length = 0;
    await dispatch(handlers, { type: 'EXECUTE_TOOL_CALL', payload: call }, deepSeekContext);
    expect(dependencies.executeToolCall).toHaveBeenNthCalledWith(
      2,
      call,
      expect.objectContaining({ kind: 'grant', grantId: '' }),
      'en',
    );

    events.length = 0;
    await dispatch(handlers, { type: 'EXECUTE_TOOL_CALL', payload: call });
    expect(dependencies.executeToolCall).toHaveBeenNthCalledWith(
      3,
      call,
      expect.objectContaining({
        kind: 'trusted',
        trigger: 'manual_chat',
        requestId: 'request-1',
        chatSessionId: 'chat-1',
      }),
      'en',
    );
  });

  it.each([
    ['missing payload', undefined],
    ['null payload', null],
    ['array payload', []],
    ['malformed identified call', {
      authorizationId: 'grant-1',
      id: 'call-invalid',
      name: descriptor.name,
    }],
  ])('rejects %s before cache, runtime, or broadcast side effects', async (_name, payload) => {
    const dependencies = createExecutionDependencies();
    const invalidResult: ToolResult = {
      ok: false,
      summary: 'Invalid tool call',
      detail: 'Runtime tool call does not match the released contract.',
      error: {
        code: 'tool_call_payload_invalid',
        message: 'Runtime tool call does not match the released contract.',
        retryable: false,
      },
    };
    vi.mocked(dependencies.createInvalidToolCallResult).mockReturnValue(invalidResult);
    const handlers = createToolExecutionRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'EXECUTE_TOOL_CALL',
      payload,
    }, deepSeekContext)).resolves.toBe(invalidResult);
    expect(dependencies.externalPayloadAuthorizationCache.deleteCall).not.toHaveBeenCalled();
    expect(dependencies.executeToolCall).not.toHaveBeenCalled();
    expect(dependencies.broadcastToolCallHistoryUpdate).not.toHaveBeenCalled();
  });

  it('closes persisted authorization before clearing hot and external payload state', async () => {
    const events: string[] = [];
    const dependencies = createExecutionDependencies();
    vi.mocked(dependencies.closeToolAuthorization).mockImplementation(async () => {
      events.push('close');
    });
    vi.mocked(dependencies.externalPayloadAuthorizationCache.deleteGrant).mockImplementation(() => {
      events.push('cache:delete-grant');
    });
    vi.mocked(dependencies.clearExternalizedToolPayloadNamespace).mockImplementation(() => {
      events.push('payload:clear');
    });
    const handlers = createToolExecutionRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'CLOSE_TOOL_AUTHORIZATION',
      payload: { authorizationId: 'grant-1' },
    }, deepSeekContext)).resolves.toEqual({ ok: true });
    expect(events).toEqual(['close', 'cache:delete-grant', 'payload:clear']);
  });

  it('normalizes valid sandbox input and rejects invalid input before runtime I/O', async () => {
    const dependencies = createExecutionDependencies();
    const handlers = createToolExecutionRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'RUN_ARTIFACT_CODE',
      payload: { language: 'javascript', code: 'return 1' },
    })).resolves.toEqual({ ok: true, summary: 'sandbox done' });
    expect(dependencies.runSandbox).toHaveBeenCalledWith({
      language: 'javascript',
      code: 'return 1',
      input: undefined,
      timeoutMs: 5_000,
    });

    vi.mocked(dependencies.runSandbox).mockClear();
    await expect(dispatch(handlers, {
      type: 'RUN_ARTIFACT_CODE',
      payload: { language: 'ruby', code: 'puts 1' },
    })).resolves.toMatchObject({
      ok: false,
      summary: 'Invalid sandbox request',
      error: { code: 'sandbox_invalid_request', retryable: false },
    });
    expect(dependencies.runSandbox).not.toHaveBeenCalled();
  });

  it('preserves history limits, notification order, and platform capabilities', async () => {
    const dependencies = createExecutionDependencies();
    const history = createHistoryRecord();
    const platform = createPlatformEnvironment();
    vi.mocked(dependencies.getToolCallHistory).mockResolvedValue([history]);
    vi.mocked(dependencies.getPlatformEnvironment).mockReturnValue(platform);
    const handlers = createToolExecutionRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'GET_TOOL_CALL_HISTORY',
      payload: { limit: 5 },
    })).resolves.toEqual([history]);
    expect(dependencies.getToolCallHistory).toHaveBeenCalledWith(5);

    vi.mocked(dependencies.getToolCallHistory).mockClear();
    await expect(dispatch(handlers, { type: 'GET_TOOL_CALL_HISTORY' }))
      .resolves.toEqual([history]);
    expect(dependencies.getToolCallHistory).toHaveBeenCalledWith(undefined);

    await expect(dispatch(handlers, { type: 'CLEAR_TOOL_CALL_HISTORY' }))
      .resolves.toEqual({ ok: true });
    expect(dependencies.clearToolCallHistory).toHaveBeenCalledOnce();
    expect(dependencies.broadcastToolCallHistoryUpdate).toHaveBeenCalledWith(17);

    await expect(dispatch(handlers, { type: 'GET_PLATFORM_CAPABILITIES' }))
      .resolves.toBe(platform);
  });

  it('publishes descriptor refreshes in descriptor-before-MCP order', async () => {
    const events: string[] = [];
    const dependencies = createExecutionDependencies();
    vi.mocked(dependencies.refreshToolDescriptors).mockImplementation(async () => {
      events.push('refresh');
      return [descriptor];
    });
    vi.mocked(dependencies.broadcastToolDescriptorsUpdate).mockImplementation(async () => {
      events.push('tools');
    });
    vi.mocked(dependencies.broadcastMcpServersUpdate).mockImplementation(async () => {
      events.push('mcp');
    });
    const handlers = createToolExecutionRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, { type: 'REFRESH_TOOL_DESCRIPTORS' }))
      .resolves.toEqual([descriptor]);
    expect(events).toEqual(['refresh', 'tools', 'mcp']);
  });
});

function createMcpDependencies(): McpRuntimeHandlerDependencies {
  return {
    getAllMcpServers: vi.fn(async () => []),
    getMcpServerById: vi.fn(async () => createMcpServer()),
    createMcpServer: vi.fn(async () => createMcpServer()),
    updateMcpServer: vi.fn(async () => createMcpServer()),
    deleteMcpServer: vi.fn(async () => undefined),
    getMcpToolCache: vi.fn(async () => createMcpCache()),
    refreshMcpServerDiscovery: vi.fn(async () => createMcpCache()),
    getMcpOriginPattern: vi.fn(() => 'https://example.test/*'),
    requestMcpServerOriginPermission: vi.fn(async () => true),
    broadcastMcpServersUpdate: vi.fn(async () => undefined),
    broadcastToolDescriptorsUpdate: vi.fn(async () => undefined),
  };
}

function createBrowserDependencies(): BrowserToolRuntimeHandlerDependencies {
  return {
    getWebToolSettings: vi.fn(async () => ({ web_search: true, web_fetch: true })),
    setWebToolEnabled: vi.fn(async () => undefined),
    getBrowserControlSettings: vi.fn(async () => createBrowserSettings()),
    saveBrowserControlSettings: vi.fn(async () => createBrowserSettings()),
    setBrowserControlEnabled: vi.fn(async (enabled) => createBrowserSettings({ enabled })),
    getBrowserControlState: vi.fn(async () => createBrowserState()),
    setBrowserControlTarget: vi.fn(async () => createBrowserTarget()),
    detachBrowserControl: vi.fn(async () => undefined),
    requestHostPermission: vi.fn(async () => true),
    fetch: vi.fn(async () => ({ status: 200, text: async () => '' })),
    broadcastToolDescriptorsUpdate: vi.fn(async () => undefined),
    broadcastBrowserControlUpdate: vi.fn(async () => undefined),
  };
}

function createExecutionDependencies(): ToolExecutionRuntimeHandlerDependencies {
  const grant: ToolAuthorizationGrantSummary = {
    id: 'grant-1',
    requestId: 'request-1',
    trigger: 'manual_chat',
    chatSessionId: 'chat-1',
    descriptors: [descriptor],
    expiresAt: 2_000,
  };
  return {
    getLocale: vi.fn(() => 'en' as const),
    getToolDescriptors: vi.fn(async () => [descriptor]),
    getAuthorizationDescriptors: vi.fn(async () => [descriptor]),
    refreshToolDescriptors: vi.fn(async () => [descriptor]),
    createToolAuthorization: vi.fn(async () => grant),
    closeToolAuthorization: vi.fn(async () => undefined),
    authorizeExternalToolPayloadChunk: vi.fn(async () => ({
      namespace: 'grant-1',
      expiresAt: 2_000,
    })),
    createToolAuthorizationResult: vi.fn((error) => ({
      ok: false,
      summary: 'Tool authorization rejected',
      detail: error.message,
      error: { code: error.code, message: error.message, retryable: false },
    })),
    createInvalidToolCallResult: vi.fn(() => ({
      ok: false,
      summary: 'Invalid tool call',
      detail: 'Runtime tool call does not match the released contract.',
      error: {
        code: 'tool_call_payload_invalid',
        message: 'Runtime tool call does not match the released contract.',
        retryable: false,
      },
    })),
    externalPayloadAuthorizationCache: {
      has: vi.fn(() => false),
      remember: vi.fn(() => undefined),
      deleteGrant: vi.fn(() => undefined),
      deleteCall: vi.fn(() => undefined),
    },
    appendExternalizedToolPayloadChunk: vi.fn(() => undefined),
    clearExternalizedToolPayloadNamespace: vi.fn(() => undefined),
    executeToolCall: vi.fn(async (_call, _authorization: RuntimeToolAuthorizationContext) => ({
      ok: true,
      summary: 'done',
    })),
    runSandbox: vi.fn(async () => ({ ok: true, summary: 'sandbox done' })),
    getToolCallHistory: vi.fn(async () => []),
    clearToolCallHistory: vi.fn(async () => undefined),
    getPlatformEnvironment: vi.fn(() => createPlatformEnvironment()),
    createRequestId: vi.fn(() => 'generated-request-id'),
    now: vi.fn(() => 1_000),
    sandboxInvalidRequestSummary: vi.fn(() => 'Invalid sandbox request'),
    broadcastToolDescriptorsUpdate: vi.fn(async () => undefined),
    broadcastMcpServersUpdate: vi.fn(async () => undefined),
    broadcastToolCallHistoryUpdate: vi.fn(async () => undefined),
  };
}

function createMcpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    version: 1,
    id: 'server-1',
    displayName: 'Example MCP',
    enabled: true,
    transport: { kind: 'http', url: 'https://example.test/mcp' },
    headers: [],
    secrets: [],
    timeouts: { connectMs: 10_000, requestMs: 60_000, discoveryMs: 20_000 },
    limits: { maxResultBytes: 64_000, maxToolCount: 128 },
    allowlist: { mode: 'all', toolNames: [] },
    execution: { mode: 'auto', enabled: true },
    status: 'ready',
    lastConnectedAt: 1_000,
    lastError: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function createMcpCache(): McpToolCacheEntry {
  return {
    serverId: 'server-1',
    descriptors: [descriptor],
    refreshedAt: 1_000,
    expiresAt: 2_000,
    health: {
      serverId: 'server-1',
      status: 'ready',
      checkedAt: 1_000,
      latencyMs: 10,
      toolCount: 1,
      error: null,
    },
  };
}

function createBrowserSettings(
  overrides: Partial<BrowserControlSettings> = {},
): BrowserControlSettings {
  return {
    enabled: true,
    targetTabId: 9,
    includeSnapshotAfterActions: true,
    maxSnapshotNodes: 500,
    maxSnapshotTextBytes: 32_000,
    ...overrides,
  };
}

function createBrowserTarget(): BrowserControlTarget {
  return {
    id: 9,
    windowId: 3,
    groupId: -1,
    active: true,
    currentWindow: true,
    title: 'Example',
    url: 'https://example.test/',
    controllable: true,
  };
}

function createBrowserState(overrides: Partial<BrowserControlState> = {}): BrowserControlState {
  return {
    supported: true,
    enabled: true,
    attached: false,
    targetTabId: 9,
    target: createBrowserTarget(),
    targets: [createBrowserTarget()],
    error: null,
    ...overrides,
  };
}

function createPlatformEnvironment(): PlatformEnvironment {
  return {
    kind: 'browser_extension',
    name: 'WebExtension',
    capabilities: createCapabilityMap({
      storage: true,
      runtimeMessaging: true,
      tabs: true,
    }),
  };
}

function createHistoryRecord(): ToolCallHistoryRecord {
  const result: ToolResult = { ok: true, summary: 'done' };
  return {
    id: 'history-1',
    call,
    result,
    source: 'manual_chat',
    createdAt: 1_000,
  };
}

function createAppendMessage(): { type: string; payload: Record<string, unknown> } {
  return {
    type: 'APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK',
    payload: {
      authorizationId: 'grant-1',
      callId: 'call-1',
      invocationName: descriptor.invocationName,
      chunk: '{"value":"approved"}',
    },
  };
}

function dispatch(
  handlers: readonly RuntimeCommandHandler[],
  message: { type: string; payload?: unknown },
  context: RuntimeMessageContext = extensionContext,
): Promise<unknown> {
  const handler = handlers.find((candidate) => candidate.type === message.type);
  if (!handler) throw new Error(`Handler not found: ${message.type}`);
  return handler.handle(message, context);
}

function readInventoryCommands(heading: string): string[] {
  const source = readFileSync('docs/compatibility/runtime-command-inventory.md', 'utf8');
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = source.match(
    new RegExp(`### ${escaped}[^\\n]*\\n\\n` + '```text\\n([\\s\\S]*?)\\n```'),
  )?.[1];
  if (!block) throw new Error(`Inventory block not found: ${heading}`);
  return block.split('\n').filter(Boolean);
}
