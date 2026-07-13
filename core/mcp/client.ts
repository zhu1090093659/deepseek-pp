import type {
  JsonValue,
  ToolCall,
  ToolDescriptor,
  ToolDescriptorSchema,
  ToolResult,
  ToolRiskLevel,
  ToolTransportKind,
} from '../tool/types';
import type {
  McpCallToolOptions,
  McpCallToolResult,
  McpContentBlock,
  McpInitializeResult,
  McpJsonRpcNotification,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpListToolsResult,
  McpProtocolClient,
  McpProtocolTransport,
  McpServerConfig,
  McpToolDefinition,
} from './types';
import { getExtensionVersion } from '../version';
import { MCP_PROTOCOL_VERSION } from './constants';

const CLIENT_NAME = 'DeepSeek++';

export class McpProtocolError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, options?: { retryable?: boolean; details?: Record<string, unknown> }) {
    super(message);
    this.name = 'McpProtocolError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
  }
}

export function createMcpProtocolClient(
  server: McpServerConfig,
  transport: McpProtocolTransport,
): McpProtocolClient {
  return {
    initialize() {
      return initializeMcpServer(server, transport);
    },
    listTools() {
      return listMcpTools(server, transport);
    },
    callTool(options) {
      return callMcpTool(server, transport, options);
    },
  };
}

export async function initializeMcpServer(
  server: McpServerConfig,
  transport: McpProtocolTransport,
  options?: { signal?: AbortSignal },
): Promise<McpInitializeResult> {
    const response = await transport.request<Record<string, unknown>, McpInitializeResult>(
    createMcpRequest('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: CLIENT_NAME,
        version: getExtensionVersion(),
      },
    }),
    {
      timeoutMs: server.timeouts.connectMs,
      maxResponseBytes: server.limits.maxResultBytes,
      signal: options?.signal,
    },
  );
  const result = unwrapMcpResponse(response, 'mcp_initialize_failed');

  if (transport.notify) {
    await transport.notify(createMcpNotification('notifications/initialized'), {
      timeoutMs: server.timeouts.requestMs,
      signal: options?.signal,
    });
  }

  const rawResult = result as unknown as Record<string, unknown>;
  return {
    protocolVersion: stringValue(rawResult.protocolVersion) || MCP_PROTOCOL_VERSION,
    capabilities: jsonRecordValue(rawResult.capabilities),
    serverInfo: clientInfoValue(rawResult.serverInfo),
    instructions: stringValue(rawResult.instructions),
  };
}

export async function listMcpTools(
  server: McpServerConfig,
  transport: McpProtocolTransport,
  options?: { signal?: AbortSignal },
): Promise<ToolDescriptor[]> {
  const tools: ToolDescriptor[] = [];
  let cursor: string | undefined;

  do {
    const response = await transport.request<Record<string, unknown>, McpListToolsResult>(
      createMcpRequest('tools/list', cursor ? { cursor } : undefined),
      {
        timeoutMs: server.timeouts.discoveryMs,
        maxResponseBytes: server.limits.maxResultBytes,
        signal: options?.signal,
      },
    );
    const result = unwrapMcpResponse(response, 'mcp_tools_list_failed') as McpListToolsResult;
    const nextTools = Array.isArray(result.tools) ? result.tools : [];
    tools.push(...nextTools.map((tool) => normalizeMcpToolDescriptor(server, tool)));
    cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
  } while (cursor && tools.length < server.limits.maxToolCount);

  return applyMcpToolPolicy(tools, server);
}

export async function callMcpTool(
  server: McpServerConfig,
  transport: McpProtocolTransport,
  options: McpCallToolOptions,
): Promise<ToolResult> {
  const startedAt = Date.now();
  const mcpToolName = getMcpToolName(options.call, options.descriptor);

  try {
    const response = await transport.request<Record<string, unknown>, McpCallToolResult>(
      createMcpRequest('tools/call', {
        name: mcpToolName,
        arguments: options.call.payload,
      }),
      {
        timeoutMs: options.timeoutMs ?? server.timeouts.requestMs,
        maxResponseBytes: options.maxResultBytes ?? server.limits.maxResultBytes,
        signal: options.signal,
      },
    );
    const result = unwrapMcpResponse(response, 'mcp_tool_call_failed') as McpCallToolResult;
    const normalized = normalizeMcpToolResult(server, options.call, result, startedAt, options.maxResultBytes);
    return normalized;
  } catch (err) {
    return {
      ok: false,
      summary: 'MCP 工具调用失败',
      detail: err instanceof Error ? err.message : String(err),
      name: options.call.name,
      provider: options.call.provider,
      descriptorId: options.call.descriptorId,
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      error: {
        code: err instanceof McpProtocolError ? err.code : 'mcp_tool_call_failed',
        message: err instanceof Error ? err.message : String(err),
        retryable: err instanceof McpProtocolError ? err.retryable : true,
        details: err instanceof McpProtocolError && err.details?.externalOutcome === 'confirmed'
          ? err.details
          : {
            ...(err instanceof McpProtocolError ? err.details : undefined),
            externalOutcome: 'ambiguous',
            retrySafe: false,
          },
      },
    };
  }
}

export function normalizeMcpToolDescriptor(server: McpServerConfig, tool: McpToolDefinition): ToolDescriptor {
  const invocationName = createMcpInvocationName(server.id, tool.name);
  return {
    id: createMcpDescriptorId(server.id, tool.name),
    provider: {
      kind: 'mcp',
      id: server.id,
      displayName: server.displayName,
      transport: server.transport.kind as ToolTransportKind,
    },
    name: tool.name,
    invocationName,
    title: stringValue(tool.title) || tool.name,
    description: stringValue(tool.description) || `MCP tool ${tool.name}`,
    inputSchema: normalizeToolSchema(tool.inputSchema),
    outputSchema: normalizeToolSchema(tool.outputSchema),
    execution: {
      mode: server.execution.mode,
      enabled: server.enabled && server.execution.enabled,
      risk: toolRiskValue(tool.annotations?.risk),
      timeoutMs: server.timeouts.requestMs,
      maxResultBytes: server.limits.maxResultBytes,
    },
    annotations: {
      ...stringAnnotations(tool.annotations),
      mcpServerId: server.id,
      mcpToolName: tool.name,
    },
  };
}

export function applyMcpToolPolicy(tools: ToolDescriptor[], server: McpServerConfig): ToolDescriptor[] {
  const names = new Set(server.allowlist.toolNames);
  return tools.map((tool) => {
    const selected = names.has(tool.name) || names.has(tool.invocationName);
    const allowed = server.allowlist.mode === 'all'
      ? true
      : server.allowlist.mode === 'allow'
        ? selected
        : !selected;
    return {
      ...tool,
      provider: {
        ...tool.provider,
        displayName: server.displayName,
        transport: server.transport.kind as ToolTransportKind,
      },
      execution: {
        ...tool.execution,
        mode: server.execution.mode,
        enabled: server.enabled && server.execution.enabled && server.execution.mode !== 'disabled' && allowed,
        timeoutMs: server.timeouts.requestMs,
        maxResultBytes: server.limits.maxResultBytes,
      },
    };
  });
}

export function createMcpRequest<TParams extends Record<string, unknown> | undefined>(
  method: string,
  params?: TParams,
): McpJsonRpcRequest<TParams> {
  return {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method,
    ...(params ? { params } : {}),
  };
}

export function createMcpNotification<TParams extends Record<string, unknown> | undefined>(
  method: string,
  params?: TParams,
): McpJsonRpcNotification<TParams> {
  return {
    jsonrpc: '2.0',
    method,
    ...(params ? { params } : {}),
  };
}

export function unwrapMcpResponse<TResult>(
  response: McpJsonRpcResponse<TResult>,
  errorCode: string,
): TResult {
  if (response.error) {
    throw new McpProtocolError(errorCode, response.error.message, {
      retryable: response.error.code === -32000 || response.error.code === -32603,
      details: {
        jsonRpcCode: response.error.code,
        data: response.error.data,
        externalOutcome: 'confirmed',
        retrySafe: false,
      },
    });
  }
  if (!('result' in response)) {
    throw new McpProtocolError(errorCode, 'MCP response did not include a result.', {
      retryable: true,
      details: { externalOutcome: 'ambiguous', retrySafe: false },
    });
  }
  return response.result as TResult;
}

export function createMcpDescriptorId(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`;
}

export function createMcpInvocationName(serverId: string, toolName: string): string {
  return `mcp_${sanitizeName(serverId)}_${sanitizeName(toolName)}`.slice(0, 96);
}

function getMcpToolResultSummary(call: ToolCall, result: McpCallToolResult): string {
  if (call.name === 'python_exec') return result.isError ? '工具返回错误' : '工具已执行';
  return result.isError ? 'MCP 工具返回错误' : 'MCP 工具已执行';
}

function normalizeMcpToolResult(
  server: McpServerConfig,
  call: ToolCall,
  result: McpCallToolResult,
  startedAt: number,
  maxResultBytes: number | undefined,
): ToolResult {
  const completedAt = Date.now();
  const output = normalizeToolOutput(result);
  const rendered = stringifyOutput(output);
  const limit = maxResultBytes ?? server.limits.maxResultBytes;
  const truncated = rendered.length > limit;
  const detail = truncated ? rendered.slice(0, limit) : rendered;
  const errorMessage = result.isError ? extractMcpErrorMessage(result, detail) : undefined;

  return {
    ok: result.isError !== true,
    summary: getMcpToolResultSummary(call, result),
    detail: result.isError ? (errorMessage || detail) : detail,
    name: call.name,
    provider: call.provider,
    descriptorId: call.descriptorId,
    output,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    truncated,
    error: result.isError
      ? {
        code: 'mcp_tool_result_error',
        message: errorMessage || detail || 'MCP tool returned isError=true.',
        retryable: false,
        details: {
          externalOutcome: 'confirmed',
          retrySafe: false,
        },
      }
      : undefined,
  };
}

function extractMcpErrorMessage(result: McpCallToolResult, fallback: string): string {
  if (Array.isArray(result.content)) {
    const textBlocks = result.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => (block as { text: string }).text);
    if (textBlocks.length > 0) return textBlocks.join('\n');
  }
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    const sc = result.structuredContent as Record<string, unknown>;
    if (typeof sc.message === 'string') return sc.message;
    if (typeof sc.error === 'string') return sc.error;
    if (sc.error && typeof sc.error === 'object') {
      const err = sc.error as Record<string, unknown>;
      if (typeof err.message === 'string') return err.message;
    }
  }
  return fallback;
}

function normalizeToolOutput(result: McpCallToolResult): JsonValue {
  if (result.structuredContent !== undefined) return jsonValue(result.structuredContent);
  if (Array.isArray(result.content)) {
    return result.content.map((block) => jsonValue(normalizeContentBlock(block)));
  }
  return null;
}

function normalizeContentBlock(block: McpContentBlock): Record<string, JsonValue> {
  const normalized: Record<string, JsonValue> = {
    type: stringValue(block.type) || 'unknown',
  };
  for (const [key, value] of Object.entries(block)) {
    if (value !== undefined) normalized[key] = jsonValue(value);
  }
  return normalized;
}

function getMcpToolName(call: ToolCall, descriptor?: ToolDescriptor): string {
  const annotatedName = descriptor?.annotations?.mcpToolName;
  if (annotatedName) return annotatedName;
  if (call.provider?.kind === 'mcp') return call.name;
  return call.invocationName || call.name;
}

function normalizeToolSchema(value: unknown): ToolDescriptorSchema {
  const schema = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {};
  return {
    ...schema,
    type: 'object',
    properties: schema.properties && typeof schema.properties === 'object'
      ? schema.properties as Record<string, JsonValue>
      : {},
  };
}

function toolRiskValue(value: unknown): ToolRiskLevel {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function stringAnnotations(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .map(([key, entry]) => [key, typeof entry === 'string' ? entry : JSON.stringify(entry)]),
  );
}

function clientInfoValue(value: unknown): { name: string; version: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const name = stringValue(raw.name);
  const version = stringValue(raw.version);
  return name || version ? { name, version } : undefined;
}

function jsonRecordValue(value: unknown): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, jsonValue(entry)]),
  );
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, jsonValue(entry)]),
    );
  }
  return null;
}

function stringifyOutput(value: JsonValue): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sanitizeName(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const safe = normalized || 'tool';
  return /^[A-Za-z_]/.test(safe) ? safe : `t_${safe}`;
}
