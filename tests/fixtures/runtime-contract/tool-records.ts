import type {
  ToolCall,
  ToolCallHistoryRecord,
  ToolDescriptor,
  ToolExecutionContext,
  ToolRegistrySnapshot,
  ToolResult,
} from '../../../core/tool/types';
import type { ToolCallRestoreRecord, ToolExecutionRecord } from '../../../core/types';

export const CONTRACT_PROVIDER = {
  kind: 'mcp',
  id: 'browser-tools',
  displayName: 'Browser Tools',
  transport: 'streamable_http',
} as const;

export const CONTRACT_DESCRIPTOR = {
  id: 'mcp:browser-tools:capture_page',
  provider: CONTRACT_PROVIDER,
  name: 'capture_page',
  invocationName: 'mcp_browser_tools_capture_page',
  title: 'Capture page',
  description: 'Capture a page for contract verification.',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
    additionalProperties: false,
  },
  execution: {
    mode: 'auto',
    enabled: true,
    risk: 'medium',
    timeoutMs: 15_000,
    maxResultBytes: 4_096,
  },
  annotations: { owner: 'compatibility-contract' },
} as const satisfies ToolDescriptor;

export const CONTRACT_TOOL_CALL = {
  id: 'call-contract-1',
  descriptorId: CONTRACT_DESCRIPTOR.id,
  provider: CONTRACT_PROVIDER,
  name: 'capture_page',
  invocationName: 'mcp_browser_tools_capture_page',
  payload: { url: 'https://example.test/contracts' },
  raw: '<mcp_browser_tools_capture_page>{"url":"https://example.test/contracts"}</mcp_browser_tools_capture_page>',
  source: {
    trigger: 'manual_chat',
    requestId: 'request-contract-1',
    chatSessionId: 'chat-contract-1',
    parentMessageId: 10,
  },
  createdAt: 1_752_384_000_000,
} as const satisfies ToolCall;

export const CONTRACT_SUCCESS_RESULT = {
  ok: true,
  summary: 'Captured page',
  detail: 'Compatibility Contract',
  callId: CONTRACT_TOOL_CALL.id,
  descriptorId: CONTRACT_DESCRIPTOR.id,
  provider: CONTRACT_PROVIDER,
  name: CONTRACT_TOOL_CALL.name,
  output: {
    title: 'Compatibility Contract',
    url: 'https://example.test/contracts',
  },
  startedAt: 1_752_384_000_100,
  completedAt: 1_752_384_000_120,
  durationMs: 20,
  truncated: false,
} as const satisfies ToolResult;

export const CONTRACT_FAILURE_RESULT = {
  ok: false,
  summary: 'Capture failed',
  detail: 'Browser disconnected',
  callId: CONTRACT_TOOL_CALL.id,
  descriptorId: CONTRACT_DESCRIPTOR.id,
  provider: CONTRACT_PROVIDER,
  name: CONTRACT_TOOL_CALL.name,
  error: {
    code: 'browser_disconnected',
    message: 'Browser disconnected',
    retryable: true,
    details: { target: 'active-tab' },
  },
  startedAt: 1_752_384_000_100,
  completedAt: 1_752_384_000_110,
  durationMs: 10,
  truncated: false,
} as const satisfies ToolResult;

export const CONTRACT_EXECUTION_CONTEXT = {
  trigger: 'manual_chat',
  requestId: 'request-contract-1',
  chatSessionId: 'chat-contract-1',
  timeoutMs: 15_000,
  maxResultBytes: 4_096,
} as const satisfies ToolExecutionContext;

export const CONTRACT_REGISTRY_SNAPSHOT = {
  providers: [CONTRACT_PROVIDER],
  tools: [CONTRACT_DESCRIPTOR],
  refreshedAt: 1_752_384_000_000,
} as const satisfies ToolRegistrySnapshot;

export const CONTRACT_HISTORY_RECORD = {
  id: 'history-contract-1',
  call: CONTRACT_TOOL_CALL,
  result: CONTRACT_SUCCESS_RESULT,
  createdAt: 1_752_384_000_120,
  source: 'manual_chat',
} as const satisfies ToolCallHistoryRecord;

export const CONTRACT_EXECUTION_RECORD = {
  callId: CONTRACT_TOOL_CALL.id,
  pending: false,
  name: CONTRACT_TOOL_CALL.name,
  provider: CONTRACT_PROVIDER,
  descriptorId: CONTRACT_DESCRIPTOR.id,
  result: {
    ok: CONTRACT_SUCCESS_RESULT.ok,
    summary: CONTRACT_SUCCESS_RESULT.summary,
    detail: CONTRACT_SUCCESS_RESULT.detail,
    output: CONTRACT_SUCCESS_RESULT.output,
    truncated: CONTRACT_SUCCESS_RESULT.truncated,
  },
} as const satisfies ToolExecutionRecord;

export const CONTRACT_RESTORE_RECORD = {
  id: 'restore-contract-1',
  calls: [CONTRACT_TOOL_CALL],
  executions: [CONTRACT_EXECUTION_RECORD],
  content: 'Captured the compatibility page.',
  source: 'storage',
  url: 'https://chat.deepseek.com/a/chat/s/chat-contract-1',
  createdAt: 1_752_384_000_120,
  metadata: { requestId: 'request-contract-1' },
} as const satisfies ToolCallRestoreRecord;

export const LEGAL_TOOL_RECORDS = {
  provider: CONTRACT_PROVIDER,
  descriptor: CONTRACT_DESCRIPTOR,
  call: CONTRACT_TOOL_CALL,
  successResult: CONTRACT_SUCCESS_RESULT,
  failureResult: CONTRACT_FAILURE_RESULT,
  executionContext: CONTRACT_EXECUTION_CONTEXT,
  registrySnapshot: CONTRACT_REGISTRY_SNAPSHOT,
  historyRecord: CONTRACT_HISTORY_RECORD,
  executionRecord: CONTRACT_EXECUTION_RECORD,
  restoreRecord: CONTRACT_RESTORE_RECORD,
} as const;

export const MALFORMED_TOOL_RECORDS = [
  {
    name: 'call missing name and raw fields',
    record: { payload: {} },
    currentBehavior: 'no-authoritative-codec',
    family: 'call',
    target: 'reject-at-T2.1-boundary',
  },
  {
    name: 'result missing summary',
    record: { ok: true, output: { value: 42 } },
    currentBehavior: 'accepted-by-restore-normalizer',
    family: 'result',
    target: 'reject-at-T2.1-boundary',
  },
  {
    name: 'provider has an unsupported kind and transport',
    record: { kind: 'remote', id: 'unknown', displayName: 'Unknown', transport: 'websocket' },
    currentBehavior: 'accepted-by-restore-normalizer',
    family: 'provider',
    target: 'reject-at-T2.1-boundary',
  },
  {
    name: 'restore record carries structurally invalid nested arrays',
    record: { id: 'restore-invalid', calls: [null], executions: [{}] },
    currentBehavior: 'consumer-dependent-failure',
    family: 'restoreRecord',
    target: 'reject-at-T2.1-boundary',
  },
] as const;
