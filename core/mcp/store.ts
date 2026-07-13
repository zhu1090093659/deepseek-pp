import type {
  McpHeaderValue,
  McpServerSecretKind,
  McpSecretValue,
  McpServerConfig,
  McpServerCreateInput,
  McpServerId,
  McpServerStatus,
  McpServerStorageState,
  McpServerUpdateInput,
  McpToolCacheEntry,
} from './types';
import { MCP_DEFAULT_LIMITS, MCP_DEFAULT_TIMEOUTS } from './constants';
import {
  decodeMcpStorageState,
  encodeMcpStorageState,
  MCP_STORAGE_KEY,
  MCP_STORAGE_VERSION,
} from './storage-codec';

const REDACTED_SECRET_VALUE = '********';

export async function getAllMcpServers(options?: { includeSecrets?: boolean }): Promise<McpServerConfig[]> {
  const state = await readState();
  const servers = [...state.servers].sort((a, b) => b.updatedAt - a.updatedAt);
  return options?.includeSecrets ? servers : servers.map(sanitizeMcpServerConfig);
}

export async function getMcpServerById(
  id: McpServerId,
  options?: { includeSecrets?: boolean },
): Promise<McpServerConfig | null> {
  const state = await readState();
  const server = state.servers.find((item) => item.id === id) ?? null;
  if (!server) return null;
  return options?.includeSecrets ? server : sanitizeMcpServerConfig(server);
}

export async function createMcpServer(input: McpServerCreateInput): Promise<McpServerConfig> {
  const state = await readState();
  const now = Date.now();
  const server = normalizeServerForMutation({
    version: MCP_STORAGE_VERSION,
    id: crypto.randomUUID(),
    displayName: input.displayName,
    enabled: input.enabled ?? true,
    transport: input.transport,
    headers: input.headers ?? [],
    secrets: input.secrets ?? [],
    timeouts: input.timeouts ?? MCP_DEFAULT_TIMEOUTS,
    limits: input.limits ?? MCP_DEFAULT_LIMITS,
    allowlist: input.allowlist ?? {
      mode: 'all',
      toolNames: [],
    },
    execution: input.execution ?? {
      mode: 'auto',
      enabled: true,
    },
    status: input.enabled === false ? 'disabled' : 'unknown',
    lastConnectedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });

  await writeState({
    ...state,
    servers: [server, ...state.servers.filter((item) => item.id !== server.id)],
  });

  return sanitizeMcpServerConfig(server);
}

export async function updateMcpServer(
  id: McpServerId,
  patch: McpServerUpdateInput,
): Promise<McpServerConfig | null> {
  const state = await readState();
  let updated: McpServerConfig | null = null;
  const cacheInvalidations = new Set<McpServerId>();
  const servers = state.servers.map((server) => {
    if (server.id !== id) return server;
    const nextPatch: McpServerUpdateInput = patch.secrets
      ? { ...patch, secrets: mergeRedactedSecrets(server.secrets, patch.secrets) }
      : patch;
    const nextServer = normalizeServerForMutation({
      ...server,
      ...nextPatch,
      updatedAt: Date.now(),
      status: resolvePatchedServerStatus(server, nextPatch),
    });
    if (shouldInvalidateMcpToolCache(server, nextServer)) {
      cacheInvalidations.add(server.id);
      updated = {
        ...nextServer,
        status: nextServer.enabled ? 'unknown' : 'disabled',
        lastConnectedAt: null,
        lastError: null,
      };
      return updated;
    }
    updated = nextServer;
    return updated;
  });

  if (!updated) return null;
  await writeState({
    ...state,
    servers,
    toolCaches: cacheInvalidations.size > 0
      ? state.toolCaches.filter((cache) => !cacheInvalidations.has(cache.serverId))
      : state.toolCaches,
  });
  return sanitizeMcpServerConfig(updated);
}

export async function deleteMcpServer(id: McpServerId): Promise<void> {
  const state = await readState();
  await writeState({
    ...state,
    servers: state.servers.filter((server) => server.id !== id),
    toolCaches: state.toolCaches.filter((cache) => cache.serverId !== id),
  });
}

export async function getMcpToolCache(serverId: McpServerId): Promise<McpToolCacheEntry | null> {
  const state = await readState();
  return state.toolCaches.find((cache) => cache.serverId === serverId) ?? null;
}

export async function getAllMcpToolCaches(): Promise<McpToolCacheEntry[]> {
  const state = await readState();
  return [...state.toolCaches].sort((a, b) => b.refreshedAt - a.refreshedAt);
}

export async function saveMcpToolCache(entry: McpToolCacheEntry): Promise<void> {
  const state = await readState();
  await writeState({
    ...state,
    toolCaches: [entry, ...state.toolCaches.filter((cache) => cache.serverId !== entry.serverId)],
  });
}

export async function clearMcpToolCache(serverId: McpServerId): Promise<void> {
  const state = await readState();
  await writeState({
    ...state,
    toolCaches: state.toolCaches.filter((cache) => cache.serverId !== serverId),
  });
}

export function sanitizeMcpServerConfig(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    secrets: server.secrets.map(redactSecret),
  };
}

export function buildMcpRequestHeaders(server: McpServerConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of server.headers) {
    if (header.name.trim()) headers[header.name.trim()] = header.value;
  }
  for (const secret of server.secrets) {
    if (!secret.value) continue;
    if (secret.kind === 'bearer') headers.Authorization = `Bearer ${secret.value}`;
    if (secret.kind === 'basic') headers.Authorization = `Basic ${secret.value}`;
    if (secret.kind === 'header' && secret.headerName?.trim()) {
      headers[secret.headerName.trim()] = secret.value;
    }
  }
  return headers;
}

async function readState(): Promise<McpServerStorageState> {
  const data = await chrome.storage.local.get(MCP_STORAGE_KEY) as Record<string, unknown>;
  return decodeMcpStorageState(data[MCP_STORAGE_KEY]);
}

async function writeState(state: McpServerStorageState): Promise<void> {
  await chrome.storage.local.set({
    [MCP_STORAGE_KEY]: encodeMcpStorageState(state),
  });
}

function normalizeServerForMutation(raw: unknown): McpServerConfig {
  const value = raw && typeof raw === 'object' ? raw as Partial<McpServerConfig> : {};
  const now = Date.now();
  const enabled = value.enabled !== false;
  const status = normalizeServerStatus(value.status, enabled);
  return {
    version: MCP_STORAGE_VERSION,
    id: stringValue(value.id) || crypto.randomUUID(),
    displayName: stringValue(value.displayName) || 'MCP Server',
    enabled,
    transport: {
      kind: value.transport?.kind ?? 'streamable_http',
      url: stringValue(value.transport?.url),
      nativeHost: stringValue(value.transport?.nativeHost),
      command: stringValue(value.transport?.command),
      args: stringArrayValue(value.transport?.args),
      cwd: stringValue(value.transport?.cwd),
      env: stringRecordValue(value.transport?.env),
    },
    headers: headerArrayValue(value.headers),
    secrets: secretArrayValue(value.secrets),
    timeouts: {
      connectMs: positiveNumber(value.timeouts?.connectMs, MCP_DEFAULT_TIMEOUTS.connectMs),
      requestMs: positiveNumber(value.timeouts?.requestMs, MCP_DEFAULT_TIMEOUTS.requestMs),
      discoveryMs: positiveNumber(value.timeouts?.discoveryMs, MCP_DEFAULT_TIMEOUTS.discoveryMs),
    },
    limits: {
      maxResultBytes: positiveNumber(value.limits?.maxResultBytes, MCP_DEFAULT_LIMITS.maxResultBytes),
      maxToolCount: positiveNumber(value.limits?.maxToolCount, MCP_DEFAULT_LIMITS.maxToolCount),
    },
    allowlist: {
      mode: value.allowlist?.mode === 'allow' || value.allowlist?.mode === 'deny' ? value.allowlist.mode : 'all',
      toolNames: stringArrayValue(value.allowlist?.toolNames),
    },
    execution: {
      mode: value.execution?.mode === 'manual' || value.execution?.mode === 'disabled' ? value.execution.mode : 'auto',
      enabled: value.execution?.enabled !== false,
    },
    status,
    lastConnectedAt: nullableNumber(value.lastConnectedAt),
    lastError: stringValue(value.lastError),
    createdAt: positiveNumber(value.createdAt, now),
    updatedAt: positiveNumber(value.updatedAt, now),
  };
}

function resolvePatchedServerStatus(
  server: McpServerConfig,
  patch: McpServerUpdateInput,
): McpServerStatus {
  if (patch.enabled === false) return 'disabled';
  if (patch.status) return patch.status;
  if (patch.enabled === true && (!server.enabled || server.status === 'disabled')) return 'unknown';
  return server.status;
}

function normalizeServerStatus(
  status: McpServerStatus | undefined,
  enabled: boolean,
): McpServerStatus {
  if (!enabled) return 'disabled';
  return status && status !== 'disabled' ? status : 'unknown';
}

function redactSecret(secret: McpSecretValue): McpSecretValue {
  return {
    ...secret,
    value: secret.value ? REDACTED_SECRET_VALUE : '',
  };
}

function mergeRedactedSecrets(previous: McpSecretValue[], next: McpSecretValue[]): McpSecretValue[] {
  const usedPreviousIndexes = new Set<number>();
  return next.map((incoming) => {
    const secret = ensureSecretId(incoming);
    if (secret.value !== REDACTED_SECRET_VALUE) return secret;

    const idMatchIndex = secret.id
      ? previous.findIndex((item, index) => item.id === secret.id && !usedPreviousIndexes.has(index))
      : -1;
    const idMatch = idMatchIndex >= 0 ? previous[idMatchIndex] : undefined;
    if (idMatch) {
      usedPreviousIndexes.add(idMatchIndex);
      return { ...secret, value: idMatch.value };
    }

    const metadataMatches = previous
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => !usedPreviousIndexes.has(index) && secretMetadataMatches(secret, item));
    const metadataMatch = metadataMatches.length === 1 ? metadataMatches[0] : undefined;
    if (metadataMatch) {
      usedPreviousIndexes.add(metadataMatch.index);
      return { ...secret, value: metadataMatch.item.value };
    }

    return { ...secret, value: '' };
  });
}

function ensureSecretId(secret: McpSecretValue): McpSecretValue {
  return {
    ...secret,
    id: stringValue(secret.id) || crypto.randomUUID(),
  };
}

function secretMetadataMatches(left: McpSecretValue, right: McpSecretValue): boolean {
  return left.kind === right.kind &&
    stringValue(left.headerName) === stringValue(right.headerName) &&
    stringValue(left.username) === stringValue(right.username);
}

function shouldInvalidateMcpToolCache(previous: McpServerConfig, next: McpServerConfig): boolean {
  return mcpDiscoveryFingerprint(previous) !== mcpDiscoveryFingerprint(next);
}

function mcpDiscoveryFingerprint(server: McpServerConfig): string {
  return JSON.stringify({
    transport: server.transport,
    headers: server.headers,
    secrets: server.secrets,
    timeouts: server.timeouts,
    limits: server.limits,
  });
}

function headerArrayValue(value: unknown): McpHeaderValue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const header = item && typeof item === 'object' ? item as Partial<McpHeaderValue> : {};
      return {
        name: stringValue(header.name),
        value: stringValue(header.value),
      };
    })
    .filter((header) => header.name);
}

function secretArrayValue(value: unknown): McpSecretValue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const secret = item && typeof item === 'object' ? item as Partial<McpSecretValue> : {};
      const kind: McpServerSecretKind = secret.kind === 'basic' || secret.kind === 'header' ? secret.kind : 'bearer';
      return {
        id: stringValue(secret.id) || crypto.randomUUID(),
        kind,
        headerName: stringValue(secret.headerName),
        username: stringValue(secret.username),
        value: stringValue(secret.value),
      };
    })
    .filter((secret) => secret.value || secret.headerName || secret.username);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringRecordValue(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return Object.fromEntries(entries);
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
