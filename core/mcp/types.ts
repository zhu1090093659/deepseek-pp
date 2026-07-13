import type { ToolExecutionMode, ToolTransportKind } from '../tool';
import type { JsonValue, ToolCall, ToolDescriptor, ToolResult } from '../tool/types';

export type McpServerId = string;

export type McpServerStatus = 'unknown' | 'ready' | 'error' | 'disabled';

export type McpServerConfigVersion = 1;

export type McpServerSecretKind = 'bearer' | 'basic' | 'header';

export interface McpSecretValue {
  id?: string;
  kind: McpServerSecretKind;
  headerName?: string;
  username?: string;
  value: string;
}

export interface McpHeaderValue {
  name: string;
  value: string;
}

export interface McpServerTransportConfig {
  kind: Extract<ToolTransportKind, 'http' | 'sse' | 'streamable_http' | 'stdio_bridge' | 'native_messaging'>;
  url?: string;
  nativeHost?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface McpServerTimeouts {
  connectMs: number;
  requestMs: number;
  discoveryMs: number;
}

export interface McpServerResultLimits {
  maxResultBytes: number;
  maxToolCount: number;
}

export interface McpToolAllowlist {
  mode: 'all' | 'allow' | 'deny';
  toolNames: string[];
}

export interface McpServerExecutionDefaults {
  mode: ToolExecutionMode;
  enabled: boolean;
}

export interface McpServerConfig {
  version: McpServerConfigVersion;
  id: McpServerId;
  displayName: string;
  enabled: boolean;
  transport: McpServerTransportConfig;
  headers: McpHeaderValue[];
  secrets: McpSecretValue[];
  timeouts: McpServerTimeouts;
  limits: McpServerResultLimits;
  allowlist: McpToolAllowlist;
  execution: McpServerExecutionDefaults;
  status: McpServerStatus;
  lastConnectedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export type McpServerCreateInput = Pick<
  McpServerConfig,
  'displayName' | 'transport'
> &
  Partial<
    Pick<
      McpServerConfig,
      'enabled' | 'headers' | 'secrets' | 'timeouts' | 'limits' | 'allowlist' | 'execution'
    >
  >;

export type McpServerUpdateInput = Partial<
  Pick<
    McpServerConfig,
    | 'displayName'
    | 'enabled'
    | 'transport'
    | 'headers'
    | 'secrets'
    | 'timeouts'
    | 'limits'
    | 'allowlist'
    | 'execution'
    | 'status'
    | 'lastConnectedAt'
    | 'lastError'
  >
>;

export interface McpServerStorageState {
  version: McpServerConfigVersion;
  servers: McpServerConfig[];
  toolCaches: McpToolCacheEntry[];
}

export interface McpServerHealth {
  serverId: McpServerId;
  status: McpServerStatus;
  checkedAt: number;
  latencyMs: number | null;
  toolCount: number;
  error: string | null;
}

export interface McpToolCacheEntry {
  serverId: McpServerId;
  descriptors: ToolDescriptor[];
  refreshedAt: number;
  expiresAt: number;
  health: McpServerHealth;
}

export type McpRequestId = string | number;

export interface McpJsonRpcRequest<TParams extends Record<string, unknown> | undefined = Record<string, unknown>> {
  jsonrpc: '2.0';
  id: McpRequestId;
  method: string;
  params?: TParams;
}

export interface McpJsonRpcNotification<TParams extends Record<string, unknown> | undefined = Record<string, unknown>> {
  jsonrpc: '2.0';
  method: string;
  params?: TParams;
}

export interface McpJsonRpcError {
  code: number;
  message: string;
  data?: JsonValue;
}

export interface McpJsonRpcResponse<TResult = unknown> {
  jsonrpc: '2.0';
  id: McpRequestId | null;
  result?: TResult;
  error?: McpJsonRpcError;
}

export interface McpClientInfo {
  name: string;
  version: string;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, JsonValue>;
  serverInfo?: McpClientInfo;
  instructions?: string;
}

export interface McpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonValue;
  outputSchema?: JsonValue;
  annotations?: Record<string, JsonValue>;
}

export interface McpListToolsResult {
  tools: McpToolDefinition[];
  nextCursor?: string;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
  description?: string;
  [key: string]: JsonValue | undefined;
}

export interface McpCallToolResult {
  content?: McpContentBlock[];
  structuredContent?: JsonValue;
  isError?: boolean;
}

export interface McpProtocolTransport {
  request<TParams extends Record<string, unknown> | undefined, TResult>(
    request: McpJsonRpcRequest<TParams>,
    options?: McpTransportRequestOptions,
  ): Promise<McpJsonRpcResponse<TResult>>;
  notify?(
    notification: McpJsonRpcNotification,
    options?: McpTransportRequestOptions,
  ): Promise<void>;
}

export interface McpTransportRequestOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  signal?: AbortSignal;
}

export interface McpToolDescriptorMapping {
  descriptor: ToolDescriptor;
  mcpTool: McpToolDefinition;
}

export interface McpCallToolOptions {
  call: ToolCall;
  descriptor?: ToolDescriptor;
  timeoutMs?: number;
  maxResultBytes?: number;
  signal?: AbortSignal;
}

export interface McpProtocolClient {
  initialize(): Promise<McpInitializeResult>;
  listTools(): Promise<ToolDescriptor[]>;
  callTool(options: McpCallToolOptions): Promise<ToolResult>;
}
