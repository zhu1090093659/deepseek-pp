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
import {
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
} from './constants';
import { createMcpDescriptorId, createMcpInvocationName } from './descriptor-identity';
import { isShellMcpServer } from '../shell/policy';

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
      // Client capabilities are not the server's advertised tool capabilities.
      // Keep this empty until DeepSeek++ implements a client-side MCP capability
      // such as roots, sampling, or elicitation. Strict servers reject unknown
      // client capability keys during initialize.
      capabilities: {},
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
  const rawResult = result as unknown as Record<string, unknown>;
  const hasAdvertisedProtocolVersion = Object.prototype.hasOwnProperty.call(
    rawResult,
    'protocolVersion',
  );
  const advertisedProtocolVersion = rawResult.protocolVersion;
  const protocolVersion = hasAdvertisedProtocolVersion
    ? advertisedProtocolVersion
    : MCP_PROTOCOL_VERSION;
  if (
    typeof protocolVersion !== 'string' ||
    !MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(
      protocolVersion as typeof MCP_SUPPORTED_PROTOCOL_VERSIONS[number],
    )
  ) {
    throw new McpProtocolError(
      'mcp_protocol_version_unsupported',
      'Unsupported MCP protocol version.',
      {
        details: {
          requestedProtocolVersion: MCP_PROTOCOL_VERSION,
          advertisedProtocolVersion,
        },
      },
    );
  }
  const initialization = {
    protocolVersion,
    capabilities: jsonRecordValue(rawResult.capabilities),
    serverInfo: clientInfoValue(rawResult.serverInfo),
    instructions: stringValue(rawResult.instructions),
  };
  transport.commitInitialization?.(initialization);

  if (transport.notify) {
    await transport.notify(createMcpNotification('notifications/initialized'), {
      timeoutMs: server.timeouts.requestMs,
      signal: options?.signal,
    });
  }

  return initialization;
}

export async function listMcpTools(
  server: McpServerConfig,
  transport: McpProtocolTransport,
  options?: { signal?: AbortSignal },
): Promise<ToolDescriptor[]> {
  const tools: ToolDescriptor[] = [];
  const maxToolCount = Math.max(0, Math.floor(server.limits.maxToolCount));
  if (maxToolCount === 0) return tools;
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
    const remaining = maxToolCount - tools.length;
    tools.push(...nextTools
      .slice(0, remaining)
      .map((tool) => normalizeMcpToolDescriptor(server, tool)));
    cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
  } while (cursor && tools.length < maxToolCount);

  return applyMcpToolPolicy(tools, server);
}

export async function callMcpTool(
  server: McpServerConfig,
  transport: McpProtocolTransport,
  options: McpCallToolOptions,
): Promise<ToolResult> {
  const startedAt = Date.now();
  const mcpToolName = getMcpToolName(options.call, options.descriptor);
  // auto 续读仅适用于 Shell Native Host 已发布的 local_file_read 窗口契约
  // （structuredContent.data.{content,nextStart,truncated,totalChars}）。
  // 必须同时校验提供方身份：仅按工具名分流会让第三方 MCP 暴露的同名工具被劫持进
  // Shell 专用续读路径，其结果形状不匹配从而 fail-closed（ok:false）。
  if (mcpToolName === 'local_file_read' && isShellMcpServer(server)) {
    return callLocalFileReadAuto(server, transport, options);
  }

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

// ===== local_file_read auto 续读：确定性代码循环，不依赖模型自觉续读 =====
// 直接复用本模块的 transport 请求/响应解析原语，避免递归与跨模块循环依赖。
// 聚合结果最终仍交回 normalizeMcpToolResult，与通用 MCP 路径共用同一套字节上限、
// 计时与 output 归一化逻辑，不另起第二条返回路径。
//
// 单窗传输切片上限（12000 字符 × 4 字节 ≈ 48KB < 64KB 响应体上限）。这是传输层实现细节，
// 不改变调用方看到的 max_chars 语义。
const AUTO_READ_WINDOW_CHARS = 12000;
// 与宿主 contracts.mjs 已发布契约保持一致：max_chars 为「本次最多返回字符数」总量语义，
// 缺省 16000，硬上限 MAX_LOCAL_FILE_READ_CHARS（100_000）。
const AUTO_READ_DEFAULT_TOTAL_CHARS = 16000;
const AUTO_READ_MAX_TOTAL_CHARS = 100_000;
const AUTO_READ_MAX_WINDOWS = 1000;

export async function callLocalFileReadAuto(
  server: McpServerConfig,
  transport: McpProtocolTransport,
  options: McpCallToolOptions,
): Promise<ToolResult> {
  const startedAt = Date.now();
  const call = options.call;
  const payload = call.payload as Record<string, unknown>;
  const path = String(payload?.path ?? '');
  // max_chars 保持已发布契约的「本次最多返回字符数」总量语义：它是本次调用返回内容的总预算，
  // 由多个窗口分摊消耗；AUTO_READ_WINDOW_CHARS 仅是传输切片，绝不上浮为调用方上限。
  const requestedMaxChars = payload?.max_chars;
  const totalBudget = typeof requestedMaxChars === 'number'
    && Number.isFinite(requestedMaxChars) && requestedMaxChars >= 1
    ? Math.min(Math.floor(requestedMaxChars), AUTO_READ_MAX_TOTAL_CHARS)
    : AUTO_READ_DEFAULT_TOTAL_CHARS;
  // L4：兼容模型显式传入的起始偏移（与宿主 createLocalFileReadResult 的 start 语义一致）；
  // 未传或非法时从 0 开始完整读取。
  const requestedStart = payload?.start;
  const start0 = typeof requestedStart === 'number' && Number.isFinite(requestedStart) && requestedStart >= 0
    ? Math.floor(requestedStart)
    : 0;

  const contents: string[] = [];
  let totalChars = 0;
  let start = start0;
  let prevNextStart = start0;
  let lastTruncated = false;
  let remainingBudget = totalBudget;
  let budgetExhausted = false;

  for (let guard = 0; guard < AUTO_READ_MAX_WINDOWS; guard++) {
    // 每窗只申请「剩余总预算」与「单窗传输上限」中的较小值，使总返回量严格不超过 max_chars。
    const windowChars = Math.min(AUTO_READ_WINDOW_CHARS, remainingBudget);
    if (windowChars <= 0) {
      budgetExhausted = true;
      break;
    }
    let windowResult: McpCallToolResult;
    try {
      const response = await transport.request<Record<string, unknown>, McpCallToolResult>(
        createMcpRequest('tools/call', {
          name: getMcpToolName(call, options.descriptor),
          arguments: { ...payload, path, start, max_chars: windowChars },
        }),
        {
          timeoutMs: options.timeoutMs ?? server.timeouts.requestMs,
          maxResponseBytes: options.maxResultBytes ?? server.limits.maxResultBytes,
          signal: options.signal,
        },
      );
      windowResult = unwrapMcpResponse(response, 'mcp_tool_call_failed') as McpCallToolResult;
    } catch (err) {
      return buildAutoReadResult(server, options, startedAt, contents, totalChars, false, `第 ${contents.length + 1} 窗调用失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    const data = (windowResult.structuredContent as Record<string, unknown> | undefined)?.data as
      | Record<string, unknown>
      | undefined;
    const content = typeof data?.content === 'string' ? data.content : undefined;
    if (typeof content !== 'string') {
      return buildAutoReadResult(server, options, startedAt, contents, totalChars, false, '无法从工具结果解析窗口内容');
    }
    contents.push(content);
    // 按 Unicode 码点计数扣减预算，与宿主 charsRead 同义（代理对不会被重复计为两个字符）。
    remainingBudget -= Array.from(content).length;
    if (typeof data?.totalChars === 'number') totalChars = data.totalChars;
    const truncated = data?.truncated === true;
    lastTruncated = truncated;
    if (!truncated) break;
    if (remainingBudget <= 0) {
      budgetExhausted = true;
      break;
    }
    const nextStart = typeof data?.nextStart === 'number' ? data.nextStart : NaN;
    if (!Number.isFinite(nextStart) || nextStart <= prevNextStart) {
      return buildAutoReadResult(server, options, startedAt, contents, totalChars, false, `nextStart 未前进 (${prevNextStart} -> ${nextStart})`);
    }
    prevNextStart = nextStart;
    start = nextStart;
  }
  // 预算耗尽是调用方通过 max_chars 主动设定的上限，属正常成功返回，只需如实标记 truncated。
  if (budgetExhausted) {
    return buildAutoReadResult(server, options, startedAt, contents, totalChars, true, undefined, true);
  }
  // M1 修复：若因达到最大窗口数而退出循环，且最后一窗仍 truncated（文件超过上限），
  // 必须 fail-closed（ok:false 且 truncated:true），不得谎报为成功读取（fail-open）。
  if (lastTruncated) {
    return buildAutoReadResult(
      server,
      options,
      startedAt,
      contents,
      totalChars,
      false,
      `auto 续读窗口数已达上限（${AUTO_READ_MAX_WINDOWS}），文件可能过大未完整读取`,
      true,
    );
  }
  return buildAutoReadResult(server, options, startedAt, contents, totalChars, true, undefined);
}

function buildAutoReadResult(
  server: McpServerConfig,
  options: McpCallToolOptions,
  startedAt: number,
  contents: string[],
  totalChars: number,
  ok: boolean,
  failReason?: string,
  truncated = false,
): ToolResult {
  const call = options.call;
  const windows = contents.length;
  // 输出形状与非 auto 路径同构：单一 data.content 字符串，而非逐窗数组。
  const content = contents.join('');
  const charsReturned = Array.from(content).length;
  const detail = ok
    ? `已通过 auto 续读分 ${windows} 窗读取，返回 ${charsReturned} 字符（文件共 ${totalChars} 字符）${truncated ? '，已达 max_chars 上限，内容未完整' : '，无静默截断'}。完整内容见 output.data.content。`
    : `local_file_read auto 续读异常终止（${failReason ?? '未知原因'}）。已读取 ${windows} 窗，共 ${charsReturned} 字符。`;
  // 将聚合结果装配为标准 McpCallToolResult 后交回 normalizeMcpToolResult：
  // 由其统一施加 maxResultBytes 字节上限、计时与 output 归一化，避免另起一条绕过统一
  // normalization 的返回路径（这正是评审指出的 max_chars/maxResultBytes 失效根因）。
  const aggregated: McpCallToolResult = {
    content: [{ type: 'text', text: detail }],
    structuredContent: {
      data: {
        path: String((call.payload as Record<string, unknown>)?.path ?? ''),
        windows,
        totalChars,
        charsReturned,
        truncated,
        content,
      },
    },
    isError: !ok,
  };
  const normalized = normalizeMcpToolResult(server, call, aggregated, startedAt, options.maxResultBytes);
  return {
    ...normalized,
    summary: ok ? 'local_file_read auto 续读完成' : 'local_file_read auto 续读失败',
    truncated: normalized.truncated || truncated,
    error: ok
      ? undefined
      : {
        code: 'local_file_read_auto_failed',
        message: failReason ?? 'auto 续读失败',
        retryable: false,
        details: { externalOutcome: 'confirmed', retrySafe: false },
      },
  };
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

function getMcpToolResultSummary(call: ToolCall, result: McpCallToolResult): string {
  if (call.name === 'python_exec') return result.isError ? '工具返回错误' : '工具已执行';
  return result.isError ? 'MCP 工具返回错误' : 'MCP 工具已执行';
}

export function normalizeMcpToolResult(
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
  const detailSource = result.isError ? extractMcpErrorMessage(result, rendered) : rendered;
  const detailProjection = truncateUtf8ToByteLimit(detailSource, limit);
  const detail = detailProjection.value;

  return {
    ok: result.isError !== true,
    summary: getMcpToolResultSummary(call, result),
    detail,
    name: call.name,
    provider: call.provider,
    descriptorId: call.descriptorId,
    output,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    truncated: detailProjection.truncated,
    error: result.isError
      ? {
        code: 'mcp_tool_result_error',
        message: detail || 'MCP tool returned isError=true.',
        retryable: false,
        details: {
          externalOutcome: 'confirmed',
          retrySafe: false,
        },
      }
      : undefined,
  };
}

function truncateUtf8ToByteLimit(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const limit = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0;
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= limit) return { value, truncated: false };

  let boundary = limit;
  while (boundary > 0 && isUtf8ContinuationByte(bytes[boundary])) boundary -= 1;
  return {
    value: new TextDecoder().decode(bytes.subarray(0, boundary)),
    truncated: true,
  };
}

function isUtf8ContinuationByte(value: number | undefined): boolean {
  return value !== undefined && (value & 0b1100_0000) === 0b1000_0000;
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

export function getMcpToolName(call: ToolCall, descriptor?: ToolDescriptor): string {
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
