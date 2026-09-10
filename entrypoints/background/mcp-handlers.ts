import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type {
  McpOAuthAuthorizationResponse,
  McpServerPermissionResponse,
} from '../../core/messaging/tool-runtime-contracts';
import type { McpOAuthStatus } from '../../core/mcp/oauth-client';
import type {
  McpServerConfig,
  McpServerCreateInput,
  McpServerUpdateInput,
  McpToolCacheEntry,
} from '../../core/mcp/types';
import type {
  McpCapabilityExposureMode,
  McpCapabilitySettings,
  McpCapabilitySettingsPatch,
} from '../../core/mcp/capability-types';
import { defineToolPayloadRuntimeCommandHandler } from './runtime-handler';

export interface McpRuntimeHandlerDependencies {
  getAllMcpServers(): Promise<McpServerConfig[]>;
  getMcpCapabilitySettings(): Promise<McpCapabilitySettings>;
  updateMcpCapabilitySettings(patch: McpCapabilitySettingsPatch): Promise<McpCapabilitySettings>;
  setMcpCapabilityServerExposure(input: {
    serverId: string;
    mode: McpCapabilityExposureMode;
    pinnedDescriptorIds?: readonly string[];
  }): Promise<McpCapabilitySettings>;
  getMcpServerById(id: string): Promise<McpServerConfig | null>;
  createMcpServer(input: McpServerCreateInput): Promise<McpServerConfig>;
  updateMcpServer(id: string, patch: McpServerUpdateInput): Promise<McpServerConfig | null>;
  deleteMcpServer(id: string): Promise<void>;
  getMcpToolCache(serverId: string): Promise<McpToolCacheEntry | null>;
  refreshMcpServerDiscovery(
    serverId: string,
    options?: { cacheTtlMs?: number; signal?: AbortSignal; allowInteractiveOAuth?: boolean },
  ): Promise<McpToolCacheEntry>;
  getMcpOAuthStatusForServer(serverId: string): Promise<McpOAuthStatus | null>;
  authorizeMcpOAuthServer(serverId: string): Promise<McpOAuthAuthorizationResponse>;
  disconnectMcpOAuthServer(serverId: string): Promise<{ ok: true }>;
  getMcpOriginPattern(server: McpServerConfig): string;
  hasMcpServerOriginPermission(server: McpServerConfig): Promise<boolean>;
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
    definePayloadlessRuntimeCommandHandler('GET_MCP_CAPABILITY_SETTINGS', () => (
      dependencies.getMcpCapabilitySettings()
    )),
    defineToolPayloadRuntimeCommandHandler('UPDATE_MCP_CAPABILITY_SETTINGS', async (payload, context) => {
      const settings = await dependencies.updateMcpCapabilitySettings(payload);
      await notifyMcpAndTools(context.tabId);
      return settings;
    }),
    defineToolPayloadRuntimeCommandHandler('SET_MCP_CAPABILITY_SERVER_EXPOSURE', async (payload, context) => {
      const settings = await dependencies.setMcpCapabilityServerExposure(payload);
      await notifyMcpAndTools(context.tabId);
      return settings;
    }),
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
      // The user pressed "Refresh tools": if the stored OAuth grant is dead the
      // only fix is a fresh consent, so allow one interactive re-authorization.
      const cache = await dependencies.refreshMcpServerDiscovery(payload.serverId, {
        allowInteractiveOAuth: true,
      });
      await notifyMcpAndTools(context.tabId);
      return cache;
    }),
    // Keep the released command for compatibility, but never request a new
    // host permission from a runtime message: the Side Panel owns that user
    // gesture. Background callers may only observe the current grant.
    defineToolPayloadRuntimeCommandHandler('REQUEST_MCP_SERVER_PERMISSION', async (payload) => {
      const server = await dependencies.getMcpServerById(payload.serverId);
      if (!server) return { ok: false as const, error: 'mcp_server_not_found' };
      if (server.transport.kind === 'native_messaging') {
        return { ok: true, origin: null };
      }
      try {
        const origin = dependencies.getMcpOriginPattern(server);
        const ok = await dependencies.hasMcpServerOriginPermission(server);
        return { ok, origin };
      } catch (error) {
        return permissionFailure(error);
      }
    }),
    defineToolPayloadRuntimeCommandHandler('TEST_MCP_SERVER_CONNECTION', async (payload, context) => {
      const cache = await dependencies.refreshMcpServerDiscovery(payload.serverId, {
        allowInteractiveOAuth: true,
      });
      await notifyMcpAndTools(context.tabId);
      return {
        ok: cache.health.status === 'ready',
        cache,
        health: cache.health,
      };
    }),
    // The Side Panel must re-render the authorize/disconnect affordance after
    // OAuth state changes, so both mutations broadcast the server list.
    defineToolPayloadRuntimeCommandHandler('GET_MCP_OAUTH_STATUS', (payload) => (
      dependencies.getMcpOAuthStatusForServer(payload.serverId)
    )),
    defineToolPayloadRuntimeCommandHandler('AUTHORIZE_MCP_SERVER', async (payload, context) => {
      const result = await dependencies.authorizeMcpOAuthServer(payload.serverId);
      if (result.ok) await notifyMcpAndTools(context.tabId);
      return result;
    }),
    defineToolPayloadRuntimeCommandHandler('DISCONNECT_MCP_OAUTH', async (payload, context) => {
      const result = await dependencies.disconnectMcpOAuthServer(payload.serverId);
      await notifyMcpAndTools(context.tabId);
      return result;
    }),
  ]);
}

function permissionFailure(error: unknown): McpServerPermissionResponse {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}
