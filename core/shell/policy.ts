import type { McpServerConfig, McpServerCreateInput, McpToolAllowlist } from '../mcp/types';
import { DEFAULT_MCP_REQUEST_TIMEOUT_MS } from '../mcp/config';
import { SHELL_MCP_NATIVE_HOST, SHELL_MCP_SERVER_NAME } from './contracts';

export interface ShellMcpPresetOptions {
  nativeHost?: string;
  enabled?: boolean;
  executionEnabled?: boolean;
  // When provided, overrides the default request timeout on the preset. The
  // caller (e.g. background startup) typically passes the globally configured
  // MCP request timeout so the Shell local preset does not hardcode 120s.
  requestMs?: number;
}

export const DEFAULT_SHELL_MCP_ALLOWLIST_TOOL_NAMES = [
  'shell_status',
  'python_status',
  'local_skill_preview',
  'local_folder_pick',
] as const;

export const LOCAL_SKILL_SHELL_TOOL_NAMES = [
  'local_skill_preview',
  'local_folder_pick',
] as const;

export const LOCAL_FILE_SHELL_TOOL_NAMES = [
  'local_file_stat',
  'local_file_read',
  'local_file_write',
  'local_file_edit',
] as const;

export function createShellMcpPresetInput(
  options: ShellMcpPresetOptions = {},
): McpServerCreateInput {
  return {
    displayName: SHELL_MCP_SERVER_NAME,
    enabled: options.enabled ?? false,
    transport: {
      kind: 'native_messaging',
      nativeHost: options.nativeHost ?? SHELL_MCP_NATIVE_HOST,
    },
    headers: [],
    secrets: [],
    timeouts: {
      connectMs: 5_000,
      requestMs: options.requestMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS,
      discoveryMs: 10_000,
    },
    limits: {
      maxResultBytes: 128_000,
      maxToolCount: 16,
    },
    allowlist: {
      mode: 'allow',
      toolNames: [...DEFAULT_SHELL_MCP_ALLOWLIST_TOOL_NAMES],
    },
    execution: {
      enabled: options.executionEnabled ?? false,
      mode: 'auto',
    },
  };
}

export function isShellMcpServer(
  server: Pick<McpServerConfig, 'displayName' | 'transport'>,
): boolean {
  return server.displayName === SHELL_MCP_SERVER_NAME ||
    server.transport.nativeHost === SHELL_MCP_NATIVE_HOST;
}

export function buildShellAllowlistUpgrade(allowlist: McpToolAllowlist): McpToolAllowlist | null {
  if (allowlist.mode !== 'allow') return null;

  const names = new Set(allowlist.toolNames);
  const missingLocalSkillTools = LOCAL_SKILL_SHELL_TOOL_NAMES.filter((name) => !names.has(name));
  const missingLocalFileTools = LOCAL_FILE_SHELL_TOOL_NAMES.filter((name) => !names.has(name));
  const missing = [...missingLocalSkillTools, ...missingLocalFileTools];
  if (missing.length === 0) return null;

  return {
    mode: 'allow',
    toolNames: [...allowlist.toolNames, ...missing],
  };
}
