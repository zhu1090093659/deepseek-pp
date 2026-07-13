import type { ToolCall, ToolDescriptor, ToolResult } from '../tool';
import { haveEquivalentToolDescriptorSecurity } from '../tool/authorization';
import { applyMcpToolPolicy, callMcpTool, createMcpProtocolClient, initializeMcpServer } from './client';
import {
  getAllMcpServers,
  getAllMcpToolCaches,
  getMcpServerById,
  getMcpToolCache,
  saveMcpToolCache,
  updateMcpServer,
} from './store';
import { createMcpTransport } from './transports';
import type {
  McpServerConfig,
  McpServerHealth,
  McpServerId,
  McpToolCacheEntry,
} from './types';

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

export async function refreshMcpServerDiscovery(
  serverId: McpServerId,
  options?: { cacheTtlMs?: number },
): Promise<McpToolCacheEntry> {
  const server = await getMcpServerById(serverId, { includeSecrets: true });
  if (!server) throw new Error(`MCP server not found: ${serverId}`);
  return discoverServerTools(server, options);
}

export async function getMcpToolDescriptors(options?: {
  includeDisabled?: boolean;
  maxAgeMs?: number;
}): Promise<ToolDescriptor[]> {
  const [servers, caches] = await Promise.all([
    getAllMcpServers({ includeSecrets: false }),
    getAllMcpToolCaches(),
  ]);
  const now = Date.now();
  const serverMap = new Map(servers.map((server) => [server.id, server]));
  const descriptors: ToolDescriptor[] = [];

  for (const cache of caches) {
    const server = serverMap.get(cache.serverId);
    if (!server) continue;
    if (!options?.includeDisabled && !server.enabled) continue;
    if (options?.maxAgeMs != null && now - cache.refreshedAt > options.maxAgeMs) continue;
    // Expired descriptors are still useful for prompt injection; execution refreshes stale discovery before calling.
    const policyDescriptors = applyMcpToolPolicy(cache.descriptors, server);
    descriptors.push(
      ...policyDescriptors.filter((descriptor) =>
        options?.includeDisabled ||
        (descriptor.execution.enabled && descriptor.execution.mode === 'auto'),
      ),
    );
  }

  return descriptors;
}

export async function ensureMcpServerDiscovery(
  serverId: McpServerId,
  options?: { maxAgeMs?: number; cacheTtlMs?: number },
): Promise<McpToolCacheEntry> {
  const cache = await getMcpToolCache(serverId);
  const now = Date.now();
  if (
    cache &&
    cache.expiresAt > now &&
    (options?.maxAgeMs == null || now - cache.refreshedAt <= options.maxAgeMs)
  ) {
    return cache;
  }
  return refreshMcpServerDiscovery(serverId, options);
}

export interface McpToolExecutionOptions {
  timeoutMs?: number;
  maxResultBytes?: number;
}

export async function executeMcpToolCall(
  call: ToolCall,
  authorizedDescriptor: ToolDescriptor,
  options: McpToolExecutionOptions = {},
): Promise<ToolResult> {
  const serverId = authorizedDescriptor.provider.kind === 'mcp'
    ? authorizedDescriptor.provider.id
    : null;
  if (!serverId) {
    return {
      ok: false,
      summary: 'MCP 服务缺失',
      detail: 'Tool call does not include an MCP server id.',
      name: call.name,
      error: {
        code: 'mcp_server_id_missing',
        message: 'Tool call does not include an MCP server id.',
        retryable: false,
      },
    };
  }

  const server = await getMcpServerById(serverId, { includeSecrets: true });
  if (!server || !server.enabled) {
    return {
      ok: false,
      summary: 'MCP 服务不可用',
      detail: server ? 'MCP server is disabled.' : `MCP server not found: ${serverId}`,
      name: call.name,
      error: {
        code: server ? 'mcp_server_disabled' : 'mcp_server_not_found',
        message: server ? 'MCP server is disabled.' : `MCP server not found: ${serverId}`,
        retryable: false,
      },
    };
  }
  if (!server.execution.enabled || server.execution.mode === 'disabled') {
    return {
      ok: false,
      summary: 'MCP 工具执行已禁用',
      detail: `MCP execution is disabled on server ${server.displayName}.`,
      name: call.name,
      provider: call.provider,
      descriptorId: call.descriptorId,
      error: {
        code: 'mcp_execution_disabled',
        message: `MCP execution is disabled on server ${server.displayName}.`,
        retryable: false,
      },
    };
  }

  const cache = await ensureMcpServerDiscovery(server.id);
  const descriptors = applyMcpToolPolicy(cache.descriptors, server);
  const descriptor = descriptors.find((item) => item.id === authorizedDescriptor.id);
  if (!descriptor) {
    return {
      ok: false,
      summary: 'MCP 工具不可用',
      detail: `MCP tool is not available on server ${server.displayName}.`,
      name: call.name,
      provider: call.provider,
      descriptorId: call.descriptorId,
      error: {
        code: 'mcp_tool_not_found',
        message: `MCP tool is not available on server ${server.displayName}.`,
        retryable: true,
      },
    };
  }
  if (!descriptor.execution.enabled || descriptor.execution.mode === 'disabled') {
    return {
      ok: false,
      summary: 'MCP 工具已禁用',
      detail: `MCP tool ${descriptor.name} is disabled by server policy.`,
      name: descriptor.name,
      provider: descriptor.provider,
      descriptorId: descriptor.id,
      error: {
        code: 'mcp_tool_disabled',
        message: `MCP tool ${descriptor.name} is disabled by server policy.`,
        retryable: false,
      },
    };
  }
  if (!await haveEquivalentToolDescriptorSecurity(authorizedDescriptor, descriptor)) {
    return {
      ok: false,
      summary: 'MCP 工具授权已过期',
      detail: `MCP tool ${authorizedDescriptor.name} changed after it was authorized.`,
      name: authorizedDescriptor.name,
      provider: authorizedDescriptor.provider,
      descriptorId: authorizedDescriptor.id,
      error: {
        code: 'mcp_tool_authorization_stale',
        message: `MCP tool ${authorizedDescriptor.name} changed after it was authorized.`,
        retryable: false,
      },
    };
  }
  const startedAt = Date.now();
  try {
    const transport = createMcpTransport(server);
    await initializeMcpServer(server, transport);
    return callMcpTool(server, transport, {
      call: {
        ...call,
        descriptorId: descriptor?.id ?? call.descriptorId,
        provider: descriptor?.provider ?? call.provider,
      },
      descriptor,
      timeoutMs: options.timeoutMs ?? descriptor?.execution.timeoutMs ?? server.timeouts.requestMs,
      maxResultBytes: options.maxResultBytes ?? descriptor?.execution.maxResultBytes ?? server.limits.maxResultBytes,
    });
  } catch (err) {
    const completedAt = Date.now();
    const message = err instanceof Error ? err.message : String(err);
    const error = err && typeof err === 'object'
      ? err as { code?: unknown; retryable?: unknown; details?: unknown }
      : {};
    return {
      ok: false,
      summary: 'MCP 服务初始化失败',
      detail: message,
      name: descriptor.name,
      provider: descriptor.provider,
      descriptorId: descriptor.id,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      error: {
        code: typeof error.code === 'string' ? error.code : 'mcp_initialize_failed',
        message,
        retryable: typeof error.retryable === 'boolean' ? error.retryable : true,
        details: error.details && typeof error.details === 'object'
          ? error.details as Record<string, unknown>
          : undefined,
      },
    };
  }
}

async function discoverServerTools(
  server: McpServerConfig,
  options?: { cacheTtlMs?: number },
): Promise<McpToolCacheEntry> {
  const startedAt = Date.now();
  try {
    const client = createMcpProtocolClient(server, createMcpTransport(server));
    await client.initialize();
    const descriptors = await client.listTools();
    const completedAt = Date.now();
    const health: McpServerHealth = {
      serverId: server.id,
      status: 'ready',
      checkedAt: completedAt,
      latencyMs: completedAt - startedAt,
      toolCount: descriptors.length,
      error: null,
    };
    const entry: McpToolCacheEntry = {
      serverId: server.id,
      descriptors,
      refreshedAt: completedAt,
      expiresAt: completedAt + (options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
      health,
    };
    await saveMcpToolCache(entry);
    await updateMcpServer(server.id, {
      status: 'ready',
      lastConnectedAt: completedAt,
      lastError: null,
    });
    return entry;
  } catch (err) {
    const completedAt = Date.now();
    const message = err instanceof Error ? err.message : String(err);
    const health: McpServerHealth = {
      serverId: server.id,
      status: 'error',
      checkedAt: completedAt,
      latencyMs: completedAt - startedAt,
      toolCount: 0,
      error: message,
    };
    const entry: McpToolCacheEntry = {
      serverId: server.id,
      descriptors: [],
      refreshedAt: completedAt,
      expiresAt: completedAt + Math.min(options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, 30_000),
      health,
    };
    await saveMcpToolCache(entry);
    await updateMcpServer(server.id, {
      status: 'error',
      lastError: message,
    });
    return entry;
  }
}
