import { isToolDescriptorRecord } from '../messaging/tool-record-codec';
import { createMcpDescriptorId, createMcpInvocationName } from './descriptor-identity';
import type {
  McpServerConfig,
  McpServerStorageState,
  McpToolCacheEntry,
} from './types';

export const MCP_STORAGE_KEY = 'deepseek_pp_mcp_servers';
export const MCP_STORAGE_VERSION = 1 as const;

const TRANSPORT_KINDS = new Set([
  'http',
  'sse',
  'streamable_http',
  'stdio_bridge',
  'native_messaging',
]);
const SECRET_KINDS = new Set(['bearer', 'basic', 'header']);
const ALLOWLIST_MODES = new Set(['all', 'allow', 'deny']);
const EXECUTION_MODES = new Set(['auto', 'manual', 'disabled']);
const SERVER_STATUSES = new Set(['unknown', 'ready', 'error', 'disabled']);

export type McpStorageContractErrorCode =
  | 'mcp_storage_corrupt'
  | 'mcp_storage_version_unsupported'
  | 'mcp_storage_transport_unsupported';

export class McpStorageContractError extends Error {
  constructor(
    public readonly code: McpStorageContractErrorCode,
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'McpStorageContractError';
  }
}

export function createEmptyMcpStorageState(): McpServerStorageState {
  return {
    version: MCP_STORAGE_VERSION,
    servers: [],
    toolCaches: [],
  };
}

/** Pure v1 decoder. It never repairs, mutates, timestamps, or allocates IDs. */
export function decodeMcpStorageState(raw: unknown): McpServerStorageState {
  if (raw === undefined) return createEmptyMcpStorageState();
  const state = requireRecord(raw, '$');
  requireVersion(state.version, '$.version');
  const servers = requireArray(state.servers, '$.servers');
  const toolCaches = requireArray(state.toolCaches, '$.toolCaches');

  const serversById = new Map<string, McpServerConfig>();
  servers.forEach((server, index) => {
    const decoded = validateServer(server, `$.servers[${index}]`);
    if (serversById.has(decoded.id)) fail(`$.servers[${index}].id`, 'Duplicate MCP server id.');
    serversById.set(decoded.id, decoded);
  });

  const cacheServerIds = new Set<string>();
  toolCaches.forEach((cache, index) => {
    const decoded = validateToolCache(cache, `$.toolCaches[${index}]`, serversById);
    if (cacheServerIds.has(decoded.serverId)) {
      fail(`$.toolCaches[${index}].serverId`, 'Duplicate MCP tool cache.');
    }
    cacheServerIds.add(decoded.serverId);
  });

  return state as unknown as McpServerStorageState;
}

export function encodeMcpStorageState(state: McpServerStorageState): McpServerStorageState {
  return decodeMcpStorageState(state);
}

function validateServer(raw: unknown, path: string): McpServerConfig {
  const server = requireRecord(raw, path);
  requireVersion(server.version, `${path}.version`);
  const id = requireNonEmptyString(server.id, `${path}.id`);
  requireString(server.displayName, `${path}.displayName`);
  requireBoolean(server.enabled, `${path}.enabled`);

  const transport = requireRecord(server.transport, `${path}.transport`);
  const transportKind = requireNonEmptyString(transport.kind, `${path}.transport.kind`);
  if (!TRANSPORT_KINDS.has(transportKind)) {
    throw new McpStorageContractError(
      'mcp_storage_transport_unsupported',
      `${path}.transport.kind`,
      'Unsupported persisted MCP transport.',
    );
  }
  requireOptionalString(transport.url, `${path}.transport.url`);
  requireOptionalString(transport.nativeHost, `${path}.transport.nativeHost`);
  requireOptionalString(transport.command, `${path}.transport.command`);
  requireOptionalStringArray(transport.args, `${path}.transport.args`);
  requireOptionalString(transport.cwd, `${path}.transport.cwd`);
  requireOptionalStringRecord(transport.env, `${path}.transport.env`);

  requireArray(server.headers, `${path}.headers`).forEach((header, index) => {
    const value = requireRecord(header, `${path}.headers[${index}]`);
    requireNonEmptyString(value.name, `${path}.headers[${index}].name`);
    requireString(value.value, `${path}.headers[${index}].value`);
  });
  requireArray(server.secrets, `${path}.secrets`).forEach((secret, index) => {
    const value = requireRecord(secret, `${path}.secrets[${index}]`);
    requireOptionalNonEmptyString(value.id, `${path}.secrets[${index}].id`);
    requireEnum(value.kind, SECRET_KINDS, `${path}.secrets[${index}].kind`);
    requireOptionalString(value.headerName, `${path}.secrets[${index}].headerName`);
    requireOptionalString(value.username, `${path}.secrets[${index}].username`);
    requireString(value.value, `${path}.secrets[${index}].value`);
  });

  const timeouts = requireRecord(server.timeouts, `${path}.timeouts`);
  requirePositiveNumber(timeouts.connectMs, `${path}.timeouts.connectMs`);
  requirePositiveNumber(timeouts.requestMs, `${path}.timeouts.requestMs`);
  requirePositiveNumber(timeouts.discoveryMs, `${path}.timeouts.discoveryMs`);

  const limits = requireRecord(server.limits, `${path}.limits`);
  requirePositiveNumber(limits.maxResultBytes, `${path}.limits.maxResultBytes`);
  requirePositiveNumber(limits.maxToolCount, `${path}.limits.maxToolCount`);

  const allowlist = requireRecord(server.allowlist, `${path}.allowlist`);
  requireEnum(allowlist.mode, ALLOWLIST_MODES, `${path}.allowlist.mode`);
  requireStringArray(allowlist.toolNames, `${path}.allowlist.toolNames`);

  const execution = requireRecord(server.execution, `${path}.execution`);
  requireEnum(execution.mode, EXECUTION_MODES, `${path}.execution.mode`);
  requireBoolean(execution.enabled, `${path}.execution.enabled`);

  requireEnum(server.status, SERVER_STATUSES, `${path}.status`);
  requireNullableFiniteNumber(server.lastConnectedAt, `${path}.lastConnectedAt`);
  requireNullableString(server.lastError, `${path}.lastError`);
  requirePositiveNumber(server.createdAt, `${path}.createdAt`);
  requirePositiveNumber(server.updatedAt, `${path}.updatedAt`);

  return server as unknown as McpServerConfig;
}

function validateToolCache(
  raw: unknown,
  path: string,
  serversById: ReadonlyMap<string, McpServerConfig>,
): McpToolCacheEntry {
  const cache = requireRecord(raw, path);
  const serverId = requireNonEmptyString(cache.serverId, `${path}.serverId`);
  const server = serversById.get(serverId);
  if (!server) fail(`${path}.serverId`, 'MCP tool cache references an unknown server.');
  requireArray(cache.descriptors, `${path}.descriptors`).forEach((descriptor, index) => {
    const descriptorPath = `${path}.descriptors[${index}]`;
    if (!isToolDescriptorRecord(descriptor)) fail(descriptorPath, 'Invalid MCP tool descriptor.');
    const provider = descriptor.provider as Record<string, unknown>;
    if (
      provider.kind !== 'mcp'
      || provider.id !== serverId
      || provider.transport !== server.transport.kind
    ) {
      fail(`${descriptorPath}.provider`, 'MCP tool descriptor belongs to a different server.');
    }
    const name = descriptor.name as string;
    if (descriptor.id !== createMcpDescriptorId(serverId, name)) {
      fail(`${descriptorPath}.id`, 'MCP tool descriptor id does not match its server and tool name.');
    }
    if (descriptor.invocationName !== createMcpInvocationName(serverId, name)) {
      fail(`${descriptorPath}.invocationName`, 'MCP invocation name does not match its server and tool name.');
    }
    const annotations = descriptor.annotations as Record<string, unknown> | undefined;
    if (annotations?.mcpServerId !== undefined && annotations.mcpServerId !== serverId) {
      fail(`${descriptorPath}.annotations.mcpServerId`, 'MCP annotation belongs to a different server.');
    }
    if (annotations?.mcpToolName !== undefined && annotations.mcpToolName !== name) {
      fail(`${descriptorPath}.annotations.mcpToolName`, 'MCP annotation names a different tool.');
    }
  });
  requirePositiveNumber(cache.refreshedAt, `${path}.refreshedAt`);
  requirePositiveNumber(cache.expiresAt, `${path}.expiresAt`);

  const health = requireRecord(cache.health, `${path}.health`);
  if (requireNonEmptyString(health.serverId, `${path}.health.serverId`) !== serverId) {
    fail(`${path}.health.serverId`, 'MCP health record belongs to a different server.');
  }
  requireEnum(health.status, SERVER_STATUSES, `${path}.health.status`);
  requirePositiveNumber(health.checkedAt, `${path}.health.checkedAt`);
  requireNullableNonNegativeNumber(health.latencyMs, `${path}.health.latencyMs`);
  requireNonNegativeInteger(health.toolCount, `${path}.health.toolCount`);
  requireNullableString(health.error, `${path}.health.error`);

  return cache as unknown as McpToolCacheEntry;
}

function requireVersion(value: unknown, path: string): void {
  if (typeof value === 'number' && Number.isFinite(value) && value !== MCP_STORAGE_VERSION) {
    throw new McpStorageContractError(
      'mcp_storage_version_unsupported',
      path,
      'Unsupported persisted MCP storage version.',
    );
  }
  if (value !== MCP_STORAGE_VERSION) fail(path, 'Invalid MCP storage version.');
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'Expected an object.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path, 'Expected a plain object.');
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'Expected an array.');
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'Expected a string.');
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  const result = requireString(value, path);
  if (!result) fail(path, 'Expected a non-empty string.');
  return result;
}

function requireOptionalString(value: unknown, path: string): void {
  if (value !== undefined) requireString(value, path);
}

function requireOptionalNonEmptyString(value: unknown, path: string): void {
  if (value !== undefined) requireNonEmptyString(value, path);
}

function requireNullableString(value: unknown, path: string): void {
  if (value !== null) requireString(value, path);
}

function requireBoolean(value: unknown, path: string): void {
  if (typeof value !== 'boolean') fail(path, 'Expected a boolean.');
}

function requirePositiveNumber(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(path, 'Expected a positive finite number.');
  }
}

function requireNullableFiniteNumber(value: unknown, path: string): void {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'Expected a finite number or null.');
}

function requireNullableNonNegativeNumber(value: unknown, path: string): void {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(path, 'Expected a non-negative finite number or null.');
  }
}

function requireNonNegativeInteger(value: unknown, path: string): void {
  if (!Number.isInteger(value) || (value as number) < 0) fail(path, 'Expected a non-negative integer.');
}

function requireStringArray(value: unknown, path: string): void {
  requireArray(value, path).forEach((item, index) => requireString(item, `${path}[${index}]`));
}

function requireOptionalStringArray(value: unknown, path: string): void {
  if (value !== undefined) requireStringArray(value, path);
}

function requireOptionalStringRecord(value: unknown, path: string): void {
  if (value === undefined) return;
  const record = requireRecord(value, path);
  Object.entries(record).forEach(([key, item]) => requireString(item, `${path}.${key}`));
}

function requireEnum(value: unknown, allowed: ReadonlySet<string>, path: string): void {
  if (typeof value !== 'string' || !allowed.has(value)) fail(path, 'Unexpected enum value.');
}

function fail(path: string, message: string): never {
  throw new McpStorageContractError('mcp_storage_corrupt', path, message);
}
