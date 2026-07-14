import { describe, expect, it, vi } from 'vitest';
import type { McpServerConfig, McpToolCacheEntry, ToolDescriptor } from '../core/types';
import {
  McpPermissionError,
  createMcpToolsController,
  createPythonToolTogglePatch,
  isMcpToolEnabled,
  nextMcpToolAllowlist,
  normalizeHostPermissionOrigin,
} from '../entrypoints/sidepanel/controllers/mcp-tools-controller';
import { createSidepanelRuntimeClient } from '../entrypoints/sidepanel/runtime-client';

describe('sidepanel MCP and Tools controller', () => {
  it('loads one validated snapshot through typed runtime requests', async () => {
    const requests: unknown[] = [];
    const controller = createMcpToolsController(createSidepanelRuntimeClient(async (request) => {
      requests.push(request);
      if (request.type === 'GET_MCP_SERVERS') return [server];
      if (request.type === 'GET_PLATFORM_CAPABILITIES') return platform;
      if (request.type === 'GET_MCP_TOOL_CACHE') return null;
      if (request.type === 'GET_TOOL_CALL_HISTORY') return [];
      throw new Error(`Unexpected command: ${request.type}`);
    }));

    await expect(controller.loadMcpSnapshot()).resolves.toMatchObject({
      servers: [server],
      caches: { 'server-1': null },
      history: [],
      platform,
    });
    expect(requests).toEqual(expect.arrayContaining([
      { type: 'GET_MCP_SERVERS' },
      { type: 'GET_PLATFORM_CAPABILITIES' },
      { type: 'GET_MCP_TOOL_CACHE', payload: { serverId: 'server-1' } },
      { type: 'GET_TOOL_CALL_HISTORY', payload: { limit: 12 } },
    ]));
  });

  it('owns permission-before-connect policy and does not retry after denial', async () => {
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === 'REQUEST_MCP_SERVER_PERMISSION') {
        return { ok: false, origin: 'https://example.test/*' };
      }
      if (request.type === 'REFRESH_MCP_SERVER_TOOLS') return cache;
      throw new Error(`Unexpected command: ${request.type}`);
    });
    const controller = createMcpToolsController(createSidepanelRuntimeClient(sendMessage));

    await expect(controller.connectServer(server, 'refresh')).rejects.toMatchObject({
      name: 'McpPermissionError',
      origin: 'https://example.test/*',
    } satisfies Partial<McpPermissionError>);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('centralizes tool allowlist and Python provider policy', () => {
    expect(isMcpToolEnabled(server, pythonTool)).toBe(true);
    expect(nextMcpToolAllowlist(server.allowlist, pythonTool, false)).toEqual({
      mode: 'deny',
      toolNames: ['python_exec'],
    });
    expect(createPythonToolTogglePatch(server, pythonTool)).toMatchObject({
      allowlist: { mode: 'deny', toolNames: ['python_exec'] },
    });
    expect(normalizeHostPermissionOrigin('https://example.test/path?q=1'))
      .toBe('https://example.test/*');
    expect(() => normalizeHostPermissionOrigin('file:///tmp/data'))
      .toThrow('only supports http/https');
  });
});

const server: McpServerConfig = {
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
};

const cache: McpToolCacheEntry = {
  serverId: server.id,
  descriptors: [],
  refreshedAt: 1_000,
  expiresAt: 2_000,
  health: {
    serverId: server.id,
    status: 'ready',
    checkedAt: 1_000,
    latencyMs: 10,
    toolCount: 0,
    error: null,
  },
};

const pythonTool = {
  id: 'tool-1',
  name: 'python_exec',
  invocationName: 'python_exec',
} as ToolDescriptor;

const platform = {
  kind: 'browser_extension',
  name: 'WebExtension',
  capabilities: { nativeMessaging: true },
};
