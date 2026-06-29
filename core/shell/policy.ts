import type { McpServerCreateInput } from '../mcp/types';
import { SHELL_MCP_NATIVE_HOST, SHELL_MCP_SERVER_NAME } from './contracts';

export interface ShellMcpPresetOptions {
  nativeHost?: string;
  enabled?: boolean;
  executionEnabled?: boolean;
}

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
      requestMs: 120_000,
      discoveryMs: 10_000,
    },
    limits: {
      maxResultBytes: 256_000,
      maxToolCount: 20,
    },
    allowlist: {
      mode: 'allow',
      toolNames: ['shell_status', 'python_status', 'local_skill_preview', 'local_folder_pick', 'file_read', 'file_list', 'file_search', 'git_status', 'git_diff', 'git_log', 'git_branch'],
    },
    execution: {
      enabled: options.executionEnabled ?? false,
      mode: 'manual',
    },
  };
}
