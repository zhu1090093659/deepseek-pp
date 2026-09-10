import type { ToolCall, ToolDescriptor, ToolResult } from '../tool/types';
import { haveEquivalentToolDescriptorSecurity } from '../tool/authorization';
import { applyMcpToolPolicy, callMcpTool, initializeMcpServer, listMcpTools } from './client';
import {
  getAllMcpServers,
  getAllMcpToolCaches,
  getMcpServerById,
  getMcpToolCache,
  saveMcpDiscoveryResult,
} from './store';
import { createMcpTransport } from './transports';
import { authorizeMcpOAuthServer } from './oauth-service';
import { isMcpOAuthEnabled } from './oauth-client';
import type {
  McpServerConfig,
  McpServerHealth,
  McpServerId,
  McpToolCacheEntry,
} from './types';

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const discoveryTails = new Map<McpServerId, Promise<void>>();

export interface McpDiscoveryOptions {
  cacheTtlMs?: number;
  signal?: AbortSignal;
  /**
   * Allow a single interactive OAuth re-authorization when the resource server
   * rejects a freshly refreshed token. Only user-initiated discovery may set
   * this; background refreshes must never open a web-auth window.
   */
  allowInteractiveOAuth?: boolean;
}

export async function refreshMcpServerDiscovery(
  serverId: McpServerId,
  options?: McpDiscoveryOptions,
): Promise<McpToolCacheEntry> {
  const previous = discoveryTails.get(serverId) ?? Promise.resolve();
  const operation = previous.then(
    () => discoverServerToolsById(serverId, options),
    () => discoverServerToolsById(serverId, options),
  );
  const tail = operation.then(() => undefined, () => undefined);
  discoveryTails.set(serverId, tail);
  return operation.finally(() => {
    if (discoveryTails.get(serverId) === tail) discoveryTails.delete(serverId);
  });
}

async function discoverServerToolsById(
  serverId: McpServerId,
  options?: McpDiscoveryOptions,
): Promise<McpToolCacheEntry> {
  throwIfMcpExecutionAborted(options?.signal);
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
        (descriptor.execution.enabled && descriptor.execution.mode !== 'disabled'),
      ),
    );
  }

  return descriptors;
}

export async function ensureMcpServerDiscovery(
  serverId: McpServerId,
  options?: { maxAgeMs?: number; cacheTtlMs?: number; signal?: AbortSignal },
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
  signal?: AbortSignal;
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

  const cache = await ensureMcpServerDiscovery(server.id, { signal: options.signal });
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
    await initializeMcpServer(server, transport, { signal: options.signal });
    return callMcpTool(server, transport, {
      call: {
        ...call,
        descriptorId: descriptor?.id ?? call.descriptorId,
        provider: descriptor?.provider ?? call.provider,
      },
      descriptor,
      timeoutMs: options.timeoutMs ?? descriptor?.execution.timeoutMs ?? server.timeouts.requestMs,
      maxResultBytes: options.maxResultBytes ?? descriptor?.execution.maxResultBytes ?? server.limits.maxResultBytes,
      signal: options.signal,
    });
  } catch (err) {
    throwIfMcpExecutionAborted(options.signal);
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
  options?: McpDiscoveryOptions,
): Promise<McpToolCacheEntry> {
  const startedAt = Date.now();
  let descriptors: ToolDescriptor[];
  try {
    descriptors = await listServerToolsOnce(server, options?.signal);
  } catch (err) {
    throwIfMcpExecutionAborted(options?.signal);
    // A refresh that the resource server still rejects means the stored grant
    // is dead (revoked, rotated, or minted for another client). Refreshing
    // again cannot help; only a fresh interactive authorization can. Do that
    // once, and only for user-initiated discovery.
    if (isRecoverableOAuthGrantError(err) && options?.allowInteractiveOAuth && isMcpOAuthEnabled(server)) {
      const reauthorized = await authorizeMcpOAuthServer(server.id);
      if (reauthorized.ok) {
        const reloaded = await getMcpServerById(server.id, { includeSecrets: true });
        if (reloaded) {
          try {
            descriptors = await listServerToolsOnce(reloaded, options?.signal);
          } catch (retryError) {
            throwIfMcpExecutionAborted(options?.signal);
            return persistMcpDiscoveryFailure(server, startedAt, retryError, options);
          }
        } else {
          return persistMcpDiscoveryFailure(server, startedAt, err, options);
        }
      } else {
        return persistMcpDiscoveryFailure(server, startedAt, err, options);
      }
    } else {
      return persistMcpDiscoveryFailure(server, startedAt, err, options);
    }
  }

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
  await saveMcpDiscoveryResult(entry, server);
  return entry;
}

async function listServerToolsOnce(
  server: McpServerConfig,
  signal?: AbortSignal,
): Promise<ToolDescriptor[]> {
  const transport = createMcpTransport(server);
  await initializeMcpServer(server, transport, { signal });
  return listMcpTools(server, transport, { signal });
}

/**
 * True when a stored OAuth grant is dead and only a fresh interactive
 * authorization can recover. Covers both shapes the failure can take:
 *  - `mcp_oauth_refresh_failed`: the token endpoint rejected the refresh token
 *    (invalid_grant / invalid_client), i.e. the grant is revoked or rotated.
 *  - `mcp_oauth_invalid_token`: the refresh succeeded but the resource server
 *    still rejected the access token.
 * A *missing* refresh token is different and stays `authorization_required`.
 */
export function isRecoverableOAuthGrantError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'mcp_oauth_invalid_token' || code === 'mcp_oauth_refresh_failed';
}

async function persistMcpDiscoveryFailure(
  server: McpServerConfig,
  startedAt: number,
  providerError: unknown,
  options?: { cacheTtlMs?: number; signal?: AbortSignal },
): Promise<McpToolCacheEntry> {
  const completedAt = Date.now();
  const message = providerError instanceof Error ? providerError.message : String(providerError);
  const previousCache = await getMcpToolCache(server.id);
  throwIfMcpExecutionAborted(options?.signal);
  const descriptors = previousCache?.descriptors ?? [];
  const health: McpServerHealth = {
    serverId: server.id,
    status: 'error',
    checkedAt: completedAt,
    latencyMs: completedAt - startedAt,
    toolCount: descriptors.length,
    error: message,
  };
  const entry: McpToolCacheEntry = {
    serverId: server.id,
    descriptors,
    refreshedAt: previousCache?.refreshedAt ?? completedAt,
    expiresAt: previousCache?.expiresAt
      ?? completedAt + Math.min(options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, 30_000),
    health,
  };
  await saveMcpDiscoveryResult(entry, server);
  return entry;
}

function throwIfMcpExecutionAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('MCP execution was aborted.', 'AbortError');
}
