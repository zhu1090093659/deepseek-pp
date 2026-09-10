import {
  MULTIMODAL_MCP_NATIVE_HOST,
  MULTIMODAL_MCP_SERVER_NAME,
  createMultimodalMcpPresetInput,
} from '../../../core/multimodal';
import { getMcpRequestTimeoutMs } from '../../../core/mcp/config';
import { decodeMcpCapabilitySettings } from '../../../core/mcp/capability-settings';
import { decodeMcpStorageState, MCP_STORAGE_VERSION } from '../../../core/mcp/storage-codec';
import { getMcpOriginPattern } from '../../../core/mcp/transports';
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
  McpCapabilityExposureMode,
  McpCapabilitySettings,
  McpCapabilitySettingsPatch,
  McpServerConfig,
  McpServerCreateInput,
  McpServerTransportConfig,
  McpToolAllowlist,
  McpToolCacheEntry,
  PlatformEnvironment,
  ToolCallHistoryRecord,
  ToolDescriptor,
} from '../../../core/types';
import type { McpOAuthStatus } from '../../../core/mcp/oauth-client';
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
  capabilitySettings: McpCapabilitySettings;
}

export interface McpPermissionResult {
  ok: boolean;
  origin: string | null;
  error?: string;
}

/** Outcome of an interactive OAuth authorization attempt. */
export type McpOAuthAuthorizationResult =
  | { ok: true; status: McpOAuthStatus }
  | { ok: false; error: string };

export interface McpToolsController {
  loadMcpSnapshot(): Promise<McpSnapshot>;
  loadMcpServerState(): Promise<Pick<McpSnapshot, 'servers' | 'platform'>>;
  getToolCache(server: McpServerConfig): Promise<McpToolCacheEntry | null>;
  createServer(payload: McpServerCreateInput): Promise<McpServerConfig>;
  updateServer(server: McpServerConfig, patch: Partial<McpServerConfig>): Promise<McpServerConfig | null>;
  deleteServer(id: string): Promise<void>;
  updateCapabilitySettings(patch: McpCapabilitySettingsPatch): Promise<McpCapabilitySettings>;
  setServerExposure(input: {
    serverId: string;
    mode: McpCapabilityExposureMode;
    pinnedDescriptorIds?: readonly string[];
  }): Promise<McpCapabilitySettings>;
  requestServerPermission(server: McpServerConfig): Promise<McpPermissionResult>;
  connectServer(server: McpServerConfig, action: McpConnectionAction): Promise<McpToolCacheEntry>;
  /** Current OAuth status for a server, or null when the server is unknown. */
  getMcpOAuthStatus(serverId: string): Promise<McpOAuthStatus | null>;
  /** Run the interactive OAuth 2.1 + PKCE flow for a server. */
  authorizeMcpOAuth(serverId: string): Promise<McpOAuthAuthorizationResult>;
  /** Drop the cached access token and clear the stored refresh token. */
  disconnectMcpOAuth(serverId: string): Promise<void>;
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

export interface SidepanelHostPermissionPort {
  request(origins: readonly string[]): Promise<boolean>;
}

export function createMcpToolsController(
  runtimeClient: SidepanelRuntimeClient = sidepanelRuntimeClient,
  hostPermissions: SidepanelHostPermissionPort = sidepanelHostPermissionPort,
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

  const requestServerPermission = async (
    server: McpServerConfig,
  ): Promise<McpPermissionResult> => {
    if (!mcpServerNeedsOriginPermission(server)) return { ok: true, origin: null };
    const origin = getMcpOriginPattern(server);
    try {
      return {
        ok: await hostPermissions.request([origin]),
        origin,
      };
    } catch (error) {
      return {
        ok: false,
        origin,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const controller: McpToolsController = {
    async loadMcpSnapshot() {
      const { servers, platform } = await loadMcpServerState();
      const [cacheEntries, history, capabilitySettings] = await Promise.all([
        Promise.all(servers.map(async (server) => (
          [server.id, await getToolCache(server)] as const
        ))),
        runtimeClient.request(
          { type: 'GET_TOOL_CALL_HISTORY', payload: { limit: 12 } },
          { decode: (value) => decodeToolCallHistory(value, 'GET_TOOL_CALL_HISTORY response') },
        ),
        runtimeClient.request(
          { type: 'GET_MCP_CAPABILITY_SETTINGS' },
          { decode: decodeMcpCapabilitySettings },
        ),
      ]);
      return {
        servers,
        platform,
        caches: Object.fromEntries(cacheEntries),
        history,
        capabilitySettings,
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
    updateCapabilitySettings: (patch) => runtimeClient.request(
      { type: 'UPDATE_MCP_CAPABILITY_SETTINGS', payload: patch },
      { decode: decodeMcpCapabilitySettings },
    ),
    setServerExposure: ({ serverId, mode, pinnedDescriptorIds }) => runtimeClient.request(
      {
        type: 'SET_MCP_CAPABILITY_SERVER_EXPOSURE',
        payload: {
          serverId,
          mode,
          ...(pinnedDescriptorIds === undefined
            ? {}
            : { pinnedDescriptorIds: [...pinnedDescriptorIds] }),
        },
      },
      { decode: decodeMcpCapabilitySettings },
    ),
    requestServerPermission,
    async connectServer(server, action) {
      if (mcpServerNeedsOriginPermission(server)) {
        const permission = await requestServerPermission(server);
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
    getMcpOAuthStatus: (serverId) => runtimeClient.request(
      { type: 'GET_MCP_OAUTH_STATUS', payload: { serverId } },
      { decode: decodeMcpOAuthStatus },
    ),
    authorizeMcpOAuth: (serverId) => runtimeClient.request(
      { type: 'AUTHORIZE_MCP_SERVER', payload: { serverId } },
      { acceptFailure: true, decode: decodeMcpOAuthAuthorizationResponse },
    ),
    async disconnectMcpOAuth(serverId) {
      await runtimeClient.request(
        { type: 'DISCONNECT_MCP_OAUTH', payload: { serverId } },
        { decode: decodeAck },
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
    requestHostPermission(origins) {
      // chrome.permissions.request must be called synchronously from the
      // sidepanel click handler to preserve Chrome's required user gesture.
      return hostPermissions.request(origins);
    },
  };
  return Object.freeze(controller);
}

const sidepanelHostPermissionPort: SidepanelHostPermissionPort = Object.freeze({
  request(origins: readonly string[]) {
    if (!chrome.permissions?.request) {
      throw new Error('Browser host permission requests are unavailable.');
    }
    return chrome.permissions.request({ origins: [...origins] });
  },
});

export const mcpToolsController = createMcpToolsController();

export class McpPermissionError extends Error {
  readonly origin: string | null;

  constructor(origin: string | null, message?: string) {
    super(message ?? 'MCP origin permission was denied.');
    this.name = 'McpPermissionError';
    this.origin = origin;
  }
}

export async function getMcpPresetInput(kind: McpPresetKind): Promise<McpServerCreateInput> {
  if (kind === 'shell') {
    const requestMs = await getMcpRequestTimeoutMs();
    return createShellMcpPresetInput({ requestMs });
  }
  return createMultimodalMcpPresetInput();
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

export function isMcpToolSelected(server: McpServerConfig, tool: ToolDescriptor): boolean {
  const selected = server.allowlist.toolNames.includes(tool.name)
    || server.allowlist.toolNames.includes(tool.invocationName);
  if (server.allowlist.mode === 'allow') return selected;
  if (server.allowlist.mode === 'deny') return !selected;
  return true;
}

export function isMcpToolEnabled(server: McpServerConfig, tool: ToolDescriptor): boolean {
  if (!server.enabled || !server.execution.enabled || server.execution.mode === 'disabled') return false;
  return isMcpToolSelected(server, tool);
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

function decodeMcpOAuthStatus(value: unknown): McpOAuthStatus | null {
  if (value === null || value === undefined) return null;
  const record = requireRecord(value, 'GET_MCP_OAUTH_STATUS response');
  const scopes = Array.isArray(record.scopes)
    ? record.scopes.filter((scope): scope is string => typeof scope === 'string')
    : [];
  return {
    enabled: record.enabled === true,
    authorized: record.authorized === true,
    expiresAt: typeof record.expiresAt === 'number' ? record.expiresAt : null,
    hasRefreshToken: record.hasRefreshToken === true,
    scopes,
    authorizationUrl: typeof record.authorizationUrl === 'string'
      ? record.authorizationUrl
      : null,
  };
}

function decodeMcpOAuthAuthorizationResponse(value: unknown): McpOAuthAuthorizationResult {
  const record = requireRecord(value, 'AUTHORIZE_MCP_SERVER response');
  if (record.ok === true) {
    const status = decodeMcpOAuthStatus(record.status);
    if (!status) throw new Error('AUTHORIZE_MCP_SERVER response.status is missing.');
    return { ok: true, status };
  }
  return {
    ok: false,
    error: typeof record.error === 'string' ? record.error : 'mcp_oauth_failed',
  };
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
