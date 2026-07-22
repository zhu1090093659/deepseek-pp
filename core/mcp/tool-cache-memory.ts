import type { McpServerId, McpToolCacheEntry } from './types';

// In-process mirror of MCP tool caches. On MV3 the durable chrome.storage.local
// write can be silently dropped when the service worker is evicted before the
// LevelDB flush lands, which left the "发现工具" panel stuck at zero even after
// a successful discovery. The mirror keeps real tools visible for the SW
// lifetime and is intentionally dependency-free so it can be imported by both
// store.ts and discovery.ts without creating a circular import.
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
