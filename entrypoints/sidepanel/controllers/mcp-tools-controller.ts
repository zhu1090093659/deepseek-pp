import {
  MULTIMODAL_MCP_NATIVE_HOST,
  MULTIMODAL_MCP_SERVER_NAME,
  createMultimodalMcpPresetInput,
} from '../../../core/multimodal';
import { decodeMcpStorageState, MCP_STORAGE_VERSION } from '../../../core/mcp/storage-codec';
import {
  getSupportedMcpTransportKinds,
  isShellNativeHostSupported,
} from '../../../core/platform';
import {
  SHELL_MCP_NATIVE_HOST,
  SHELL_MCP_SERVER_NAME,
  createShellMcpPresetInput,
} from '../../../core/shell';
import { decodeToolCallHistory } from '../../../core/tool/history-codec';
import type { WebSearchToolName } from '../../../core/tool/web-search';
import type { WebToolSettings } from '../../../core/tool/web-settings';
import type {
  McpServerConfig,
  McpServerCreateInput,
  McpServerTransportConfig,
  McpToolAllowlist,
  McpToolCacheEntry,
  PlatformEnvironment,
  ToolCallHistoryRecord,
  ToolDescriptor,
} from '../../../core/types';
import {
  sidepanelRuntimeClient,
  type SidepanelRuntimeClient,
} from '../runtime-client';

export type McpPresetKind = 'shell' | 'multimodal';
export type McpConnectionAction = 'refresh' | 'test';

export interface McpSnapshot {
  servers: McpServerConfig[];
  caches: Record<string, McpToolCacheEntry | null>;
  history: ToolCallHistoryRecord[];
  platform: PlatformEnvironment;
}

export interface McpPermissionResult {
  ok: boolean;
  origin: string | null;
  error?: string;
}

export interface McpToolsController {
  loadMcpSnapshot(): Promise<McpSnapshot>;
  loadMcpServerState(): Promise<Pick<McpSnapshot, 'servers' | 'platform'>>;
  getToolCache(server: McpServerConfig): Promise<McpToolCacheEntry | null>;
  createServer(payload: McpServerCreateInput): Promise<McpServerConfig>;
  updateServer(server: McpServerConfig, patch: Partial<McpServerConfig>): Promise<McpServerConfig | null>;
  deleteServer(id: string): Promise<void>;
  requestServerPermission(serverId: string): Promise<McpPermissionResult>;
  connectServer(server: McpServerConfig, action: McpConnectionAction): Promise<McpToolCacheEntry>;
  getWebToolSettings(): Promise<WebToolSettings>;
  setWebToolEnabled(name: WebSearchToolName, enabled: boolean): Promise<void>;
  diagnoseWebSearch(query: string): Promise<Record<string, {
    status: number;
    length: number;
    error?: string;
    preview?: string;
  }>>;
  requestHostPermission(origins: string[]): Promise<boolean>;
}

export function createMcpToolsController(
  runtimeClient: SidepanelRuntimeClient = sidepanelRuntimeClient,
): McpToolsController {
  const loadMcpServerState = async () => {
    const [servers, platform] = await Promise.all([
      runtimeClient.request(
        { type: 'GET_MCP_SERVERS' },
        { decode: decodeMcpServers },
      ),
      runtimeClient.request(
        { type: 'GET_PLATFORM_CAPABILITIES' },
        { decode: decodePlatformEnvironment },
      ),
    ]);
    return { servers, platform };
  };

  const getToolCache = (server: McpServerConfig) => runtimeClient.request(
    { type: 'GET_MCP_TOOL_CACHE', payload: { serverId: server.id } },
    { decode: (value) => decodeMcpToolCache(value, server) },
  );

  const controller: McpToolsController = {
    async loadMcpSnapshot() {
      const { servers, platform } = await loadMcpServerState();
      const [cacheEntries, history] = await Promise.all([
        Promise.all(servers.map(async (server) => (
          [server.id, await getToolCache(server)] as const
        ))),
        runtimeClient.request(
          { type: 'GET_TOOL_CALL_HISTORY', payload: { limit: 12 } },
          { decode: (value) => decodeToolCallHistory(value, 'GET_TOOL_CALL_HISTORY response') },
        ),
      ]);
      return {
        servers,
        platform,
        caches: Object.fromEntries(cacheEntries),
        history,
      };
    },
    loadMcpServerState,
    getToolCache,
    createServer: (payload) => runtimeClient.request(
      { type: 'CREATE_MCP_SERVER', payload },
      { decode: decodeMcpServer },
    ),
    updateServer: (server, patch) => runtimeClient.request(
      { type: 'UPDATE_MCP_SERVER', payload: { id: server.id, patch } },
      { decode: (value) => value === null ? null : decodeMcpServer(value) },
    ),
    async deleteServer(id) {
      await runtimeClient.request(
        { type: 'DELETE_MCP_SERVER', payload: { id } },
        { decode: decodeAck },
      );
    },
    requestServerPermission: (serverId) => runtimeClient.request(
      { type: 'REQUEST_MCP_SERVER_PERMISSION', payload: { serverId } },
      { acceptFailure: true, decode: decodeMcpPermissionResult },
    ),
    async connectServer(server, action) {
      if (mcpServerNeedsOriginPermission(server)) {
        const permission = await runtimeClient.request(
          { type: 'REQUEST_MCP_SERVER_PERMISSION', payload: { serverId: server.id } },
          { acceptFailure: true, decode: decodeMcpPermissionResult },
        );
        if (!permission.ok) {
          throw new McpPermissionError(permission.origin, permission.error);
        }
      }
      if (action === 'refresh') {
        return runtimeClient.request(
          { type: 'REFRESH_MCP_SERVER_TOOLS', payload: { serverId: server.id } },
          { decode: (value) => decodeRequiredMcpToolCache(value, server) },
        );
      }
      return runtimeClient.request(
        { type: 'TEST_MCP_SERVER_CONNECTION', payload: { serverId: server.id } },
        {
          acceptFailure: true,
          decode: (value) => decodeMcpConnectionResponse(value, server),
        },
      );
    },
    getWebToolSettings: () => runtimeClient.request(
      { type: 'GET_WEB_TOOL_SETTINGS' },
      { decode: decodeWebToolSettings },
    ),
    async setWebToolEnabled(name, enabled) {
      await runtimeClient.request(
        { type: 'SET_WEB_TOOL_SETTING', payload: { name, enabled } },
        { decode: decodeAck },
      );
    },
    diagnoseWebSearch: (query) => runtimeClient.request(
      { type: 'DIAGNOSE_WEB_SEARCH', payload: { query } },
      { decode: decodeWebSearchDiagnostics },
    ),
    async requestHostPermission(origins) {
      return runtimeClient.request(
        { type: 'REQUEST_HOST_PERMISSION', payload: { origins } },
        {
          acceptFailure: true,
          decode(value) {
            const record = requireRecord(value, 'REQUEST_HOST_PERMISSION response');
            if (typeof record.ok !== 'boolean') {
              throw new Error('REQUEST_HOST_PERMISSION response.ok must be a boolean.');
            }
            return record.ok;
          },
        },
      );
    },
  };
  return Object.freeze(controller);
}

export const mcpToolsController = createMcpToolsController();

export class McpPermissionError extends Error {
  readonly origin: string | null;

  constructor(origin: string | null, message?: string) {
    super(message ?? 'MCP origin permission was denied.');
    this.name = 'McpPermissionError';
    this.origin = origin;
  }
}

export function getMcpPresetInput(kind: McpPresetKind): McpServerCreateInput {
  return kind === 'shell' ? createShellMcpPresetInput() : createMultimodalMcpPresetInput();
}

export function findMcpPreset(
  servers: readonly McpServerConfig[],
  kind: McpPresetKind,
): McpServerConfig | null {
  return servers.find((server) => kind === 'shell'
    ? isShellMcpServer(server)
    : isMultimodalMcpServer(server)) ?? null;
}

export function isShellMcpServer(server: McpServerConfig): boolean {
  return server.displayName === SHELL_MCP_SERVER_NAME
    || server.transport.nativeHost === SHELL_MCP_NATIVE_HOST;
}

export function isMultimodalMcpServer(server: McpServerConfig): boolean {
  return server.displayName === MULTIMODAL_MCP_SERVER_NAME
    || server.transport.nativeHost === MULTIMODAL_MCP_NATIVE_HOST;
}

export function isMcpNativeMessagingSupported(
  platform: PlatformEnvironment | null | undefined,
): boolean {
  return isShellNativeHostSupported(platform);
}

export function mcpServerNeedsOriginPermission(server: McpServerConfig): boolean {
  return server.transport.kind !== 'native_messaging' && Boolean(server.transport.url);
}

export function getAllowedMcpTransportKinds(
  candidates: readonly McpServerTransportConfig['kind'][],
  platform: PlatformEnvironment | null | undefined,
): McpServerTransportConfig['kind'][] {
  return getSupportedMcpTransportKinds([...candidates], platform);
}

export function isMcpToolEnabled(server: McpServerConfig, tool: ToolDescriptor): boolean {
  if (!server.enabled || !server.execution.enabled || server.execution.mode !== 'auto') return false;
  const selected = server.allowlist.toolNames.includes(tool.name)
    || server.allowlist.toolNames.includes(tool.invocationName);
  if (server.allowlist.mode === 'allow') return selected;
  if (server.allowlist.mode === 'deny') return !selected;
  return true;
}

export function countEnabledMcpTools(
  server: McpServerConfig,
  tools: readonly ToolDescriptor[],
): number {
  return tools.filter((tool) => isMcpToolEnabled(server, tool)).length;
}

export function nextMcpToolAllowlist(
  allowlist: McpToolAllowlist,
  tool: ToolDescriptor,
  shouldEnable: boolean,
): McpToolAllowlist {
  const names = new Set(allowlist.toolNames);
  const removeTool = () => {
    names.delete(tool.name);
    names.delete(tool.invocationName);
  };

  if (allowlist.mode === 'allow') {
    if (shouldEnable) names.add(tool.name);
    else removeTool();
    return { mode: 'allow', toolNames: [...names] };
  }
  if (allowlist.mode === 'deny') {
    if (shouldEnable) removeTool();
    else names.add(tool.name);
    return { mode: names.size === 0 ? 'all' : 'deny', toolNames: [...names] };
  }
  return shouldEnable ? allowlist : { mode: 'deny', toolNames: [tool.name] };
}

export function createPythonToolTogglePatch(
  server: McpServerConfig,
  tool: ToolDescriptor,
): Partial<McpServerConfig> {
  const shouldEnable = !isMcpToolEnabled(server, tool);
  return {
    enabled: shouldEnable ? true : server.enabled,
    execution: {
      ...server.execution,
      enabled: shouldEnable ? true : server.execution.enabled,
      mode: shouldEnable ? 'auto' : server.execution.mode,
    },
    allowlist: nextMcpToolAllowlist(server.allowlist, tool, shouldEnable),
  };
}

export function normalizeHostPermissionOrigin(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Host permission URL only supports http/https.');
  }
  return `${url.origin}/*`;
}

function decodeMcpServers(value: unknown): McpServerConfig[] {
  return decodeMcpStorageState({
    version: MCP_STORAGE_VERSION,
    servers: value,
    toolCaches: [],
  }).servers;
}

function decodeMcpServer(value: unknown): McpServerConfig {
  const servers = decodeMcpServers([value]);
  return servers[0]!;
}

function decodeMcpToolCache(
  value: unknown,
  server: McpServerConfig,
): McpToolCacheEntry | null {
  if (value === null) return null;
  return decodeRequiredMcpToolCache(value, server);
}

function decodeRequiredMcpToolCache(
  value: unknown,
  server: McpServerConfig,
): McpToolCacheEntry {
  const caches = decodeMcpStorageState({
    version: MCP_STORAGE_VERSION,
    servers: [server],
    toolCaches: [value],
  }).toolCaches;
  return caches[0]!;
}

function decodeMcpConnectionResponse(
  value: unknown,
  server: McpServerConfig,
): McpToolCacheEntry {
  const record = requireRecord(value, 'TEST_MCP_SERVER_CONNECTION response');
  if (typeof record.ok !== 'boolean') {
    throw new Error('TEST_MCP_SERVER_CONNECTION response.ok must be a boolean.');
  }
  return decodeRequiredMcpToolCache(record.cache, server);
}

function decodeMcpPermissionResult(value: unknown): McpPermissionResult {
  const record = requireRecord(value, 'REQUEST_MCP_SERVER_PERMISSION response');
  if (typeof record.ok !== 'boolean') {
    throw new Error('REQUEST_MCP_SERVER_PERMISSION response.ok must be a boolean.');
  }
  if (record.origin !== null && typeof record.origin !== 'string' && record.origin !== undefined) {
    throw new Error('REQUEST_MCP_SERVER_PERMISSION response.origin is invalid.');
  }
  if (record.error !== undefined && typeof record.error !== 'string') {
    throw new Error('REQUEST_MCP_SERVER_PERMISSION response.error is invalid.');
  }
  return {
    ok: record.ok,
    origin: typeof record.origin === 'string' ? record.origin : null,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
}

function decodePlatformEnvironment(value: unknown): PlatformEnvironment {
  const record = requireRecord(value, 'GET_PLATFORM_CAPABILITIES response');
  const capabilities = requireRecord(
    record.capabilities,
    'GET_PLATFORM_CAPABILITIES response.capabilities',
  );
  if ((record.kind !== 'browser_extension' && record.kind !== 'unknown')
    || typeof record.name !== 'string') {
    throw new Error('Invalid GET_PLATFORM_CAPABILITIES response.');
  }
  for (const [name, supported] of Object.entries(capabilities)) {
    if (typeof supported !== 'boolean') {
      throw new Error(`GET_PLATFORM_CAPABILITIES response.capabilities.${name} must be a boolean.`);
    }
  }
  return value as PlatformEnvironment;
}

function decodeWebToolSettings(value: unknown): WebToolSettings {
  const record = requireRecord(value, 'GET_WEB_TOOL_SETTINGS response');
  if (typeof record.web_search !== 'boolean' || typeof record.web_fetch !== 'boolean') {
    throw new Error('Invalid GET_WEB_TOOL_SETTINGS response.');
  }
  return { web_search: record.web_search, web_fetch: record.web_fetch };
}

function decodeWebSearchDiagnostics(value: unknown): Record<string, {
  status: number;
  length: number;
  error?: string;
  preview?: string;
}> {
  const record = requireRecord(value, 'DIAGNOSE_WEB_SEARCH response');
  return Object.fromEntries(Object.entries(record).map(([domain, raw]) => {
    const diagnostic = requireRecord(raw, `DIAGNOSE_WEB_SEARCH response.${domain}`);
    if (!Number.isFinite(diagnostic.status) || !Number.isFinite(diagnostic.length)) {
      throw new Error(`Invalid DIAGNOSE_WEB_SEARCH response for ${domain}.`);
    }
    if (diagnostic.error !== undefined && typeof diagnostic.error !== 'string') {
      throw new Error(`Invalid DIAGNOSE_WEB_SEARCH error for ${domain}.`);
    }
    if (diagnostic.preview !== undefined && typeof diagnostic.preview !== 'string') {
      throw new Error(`Invalid DIAGNOSE_WEB_SEARCH preview for ${domain}.`);
    }
    return [domain, diagnostic] as const;
  })) as Record<string, {
    status: number;
    length: number;
    error?: string;
    preview?: string;
  }>;
}

function decodeAck(value: unknown): void {
  const record = requireRecord(value, 'runtime acknowledgement');
  if (record.ok !== true) throw new Error('Invalid runtime acknowledgement.');
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}
