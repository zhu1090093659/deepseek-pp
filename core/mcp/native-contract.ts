import type {
  McpJsonRpcNotification,
  McpJsonRpcRequest,
} from './types';

export const MCP_NATIVE_ENVELOPE_PROTOCOL = 'deepseek-pp-mcp-native';
export const MCP_NATIVE_ENVELOPE_VERSION = 1;

export interface McpNativeEnvelope {
  protocol: typeof MCP_NATIVE_ENVELOPE_PROTOCOL;
  version: typeof MCP_NATIVE_ENVELOPE_VERSION;
  server: {
    id: string;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  message: McpJsonRpcRequest<any> | McpJsonRpcNotification;
}
