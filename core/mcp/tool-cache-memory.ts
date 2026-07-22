import type { McpServerId, McpToolCacheEntry } from './types';

/**
 * Process-lifetime mirror of the persisted MCP tool cache.
 *
 * MV3 service workers can be terminated at any idle point, and some Chromium
 * forks (e.g. 360Chrome) do not always flush `chrome.storage.local` writes
 * before the worker dies. Relying solely on cross-restart persistence left the
 * "发现工具" panel empty even after a successful discovery. Keeping an
 * in-memory copy lets reads serve real tools within a worker lifetime, and the
 * lazy-rediscovery paths in `getMcpToolCache` / `getMcpToolDescriptors` refill
 * it after a restart. The storage write remains the durable copy; this map is a
 * performance and resilience layer only.
 */
const memoryToolCaches = new Map<McpServerId, McpToolCacheEntry>();

export function setMemoryToolCache(entry: McpToolCacheEntry): void {
  memoryToolCaches.set(entry.serverId, entry);
}

export function getMemoryToolCache(serverId: McpServerId): McpToolCacheEntry | null {
  return memoryToolCaches.get(serverId) ?? null;
}

export function getAllMemoryToolCaches(): McpToolCacheEntry[] {
  return [...memoryToolCaches.values()];
}

export function clearMemoryToolCache(serverId: McpServerId): void {
  memoryToolCaches.delete(serverId);
}

export function pruneMemoryToolCache(now: number): void {
  for (const [serverId, cache] of memoryToolCaches) {
    if (cache.expiresAt <= now) memoryToolCaches.delete(serverId);
  }
}
