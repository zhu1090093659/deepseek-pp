import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type {
  McpServerPermissionResponse,
} from '../../core/messaging/tool-runtime-contracts';
import type {
  McpServerConfig,
  McpServerCreateInput,
  McpServerUpdateInput,
  McpToolCacheEntry,
} from '../../core/mcp/types';
import { defineToolPayloadRuntimeCommandHandler } from './runtime-handler';

export interface McpRuntimeHandlerDependencies {
  getAllMcpServers(): Promise<McpServerConfig[]>;
  getMcpServerById(id: string): Promise<McpServerConfig | null>;
  createMcpServer(input: McpServerCreateInput): Promise<McpServerConfig>;
  updateMcpServer(id: string, patch: McpServerUpdateInput): Promise<McpServerConfig | null>;
  deleteMcpServer(id: string): Promise<void>;
  getMcpToolCache(serverId: string): Promise<McpToolCacheEntry | null>;
  refreshMcpServerDiscovery(serverId: string): Promise<McpToolCacheEntry>;
  getMcpOriginPattern(server: McpServerConfig): string;
  requestMcpServerOriginPermission(server: McpServerConfig): Promise<boolean>;
  broadcastMcpServersUpdate(excludeTabId?: number): Promise<void>;
  broadcastToolDescriptorsUpdate(excludeTabId?: number): Promise<void>;
}

export function createMcpRuntimeHandlers(
  dependencies: McpRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  const notifyMcpAndTools = async (excludeTabId?: number): Promise<void> => {
    await dependencies.broadcastMcpServersUpdate(excludeTabId);
    await dependencies.broadcastToolDescriptorsUpdate(excludeTabId);
  };

  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_MCP_SERVERS', () => (
      dependencies.getAllMcpServers()
    )),
    defineToolPayloadRuntimeCommandHandler('GET_MCP_SERVER', (payload) => (
      dependencies.getMcpServerById(payload.id)
    )),
    defineToolPayloadRuntimeCommandHandler('CREATE_MCP_SERVER', async (payload, context) => {
      const server = await dependencies.createMcpServer(payload);
      await notifyMcpAndTools(context.tabId);
      return server;
    }),
    defineToolPayloadRuntimeCommandHandler('UPDATE_MCP_SERVER', async (payload, context) => {
      const server = await dependencies.updateMcpServer(payload.id, payload.patch);
      await notifyMcpAndTools(context.tabId);
      return server;
    }),
    defineToolPayloadRuntimeCommandHandler('DELETE_MCP_SERVER', async (payload, context) => {
      await dependencies.deleteMcpServer(payload.id);
      await notifyMcpAndTools(context.tabId);
      return { ok: true as const };
    }),
    defineToolPayloadRuntimeCommandHandler('GET_MCP_TOOL_CACHE', (payload) => (
      dependencies.getMcpToolCache(payload.serverId)
    )),
    defineToolPayloadRuntimeCommandHandler('REFRESH_MCP_SERVER_TOOLS', async (payload, context) => {
      const cache = await dependencies.refreshMcpServerDiscovery(payload.serverId);
      await notifyMcpAndTools(context.tabId);
      return cache;
    }),
    defineToolPayloadRuntimeCommandHandler('REQUEST_MCP_SERVER_PERMISSION', async (payload) => {
      const server = await dependencies.getMcpServerById(payload.serverId);
      if (!server) return { ok: false as const, error: 'mcp_server_not_found' };
      if (server.transport.kind === 'native_messaging') {
        return { ok: true, origin: null };
      }
      try {
        const origin = dependencies.getMcpOriginPattern(server);
        const ok = await dependencies.requestMcpServerOriginPermission(server);
        return { ok, origin };
      } catch (error) {
        return permissionFailure(error);
      }
    }),
    defineToolPayloadRuntimeCommandHandler('TEST_MCP_SERVER_CONNECTION', async (payload, context) => {
      const cache = await dependencies.refreshMcpServerDiscovery(payload.serverId);
      await notifyMcpAndTools(context.tabId);
      return {
        ok: cache.health.status === 'ready',
        cache,
        health: cache.health,
      };
    }),
  ]);
}

function permissionFailure(error: unknown): McpServerPermissionResponse {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}
