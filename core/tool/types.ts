export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ToolPayload = Record<string, unknown>;

export const TOOL_PROVIDER_KINDS = ['local', 'mcp'] as const;

export type ToolProviderKind = typeof TOOL_PROVIDER_KINDS[number];

export type ToolProviderId = string;

export type ToolDescriptorId = string;

export type ToolCallId = string;

export type ToolAuthorizationId = string;

export const TOOL_EXECUTION_TRIGGERS = [
  'manual_chat',
  'agent_run',
  'automation',
  'test',
  'sidepanel_chat',
] as const;

export type ToolExecutionTrigger = typeof TOOL_EXECUTION_TRIGGERS[number];

export const TOOL_EXECUTION_MODES = ['auto', 'manual', 'disabled'] as const;

export type ToolExecutionMode = typeof TOOL_EXECUTION_MODES[number];

export const TOOL_RISK_LEVELS = ['low', 'medium', 'high'] as const;

export type ToolRiskLevel = typeof TOOL_RISK_LEVELS[number];

export const TOOL_TRANSPORT_KINDS = [
  'in_process',
  'http',
  'sse',
  'streamable_http',
  'stdio_bridge',
  'native_messaging',
] as const;

export type ToolTransportKind = typeof TOOL_TRANSPORT_KINDS[number];

export interface ToolProviderIdentity {
  kind: ToolProviderKind;
  id: ToolProviderId;
  displayName: string;
  transport: ToolTransportKind;
}

export interface ToolDescriptorSchema {
  type: 'object';
  properties?: Record<string, JsonValue>;
  required?: string[];
  additionalProperties?: boolean | Record<string, JsonValue>;
  description?: string;
}

export interface ToolDescriptorExecution {
  mode: ToolExecutionMode;
  enabled: boolean;
  risk: ToolRiskLevel;
  timeoutMs?: number;
  maxResultBytes?: number;
}

export interface ToolDescriptor {
  id: ToolDescriptorId;
  provider: ToolProviderIdentity;
  name: string;
  invocationName: string;
  title: string;
  description: string;
  inputSchema: ToolDescriptorSchema;
  outputSchema?: ToolDescriptorSchema;
  execution: ToolDescriptorExecution;
  annotations?: Record<string, string>;
}

export interface ToolCallSource {
  trigger: ToolExecutionTrigger;
  requestId?: string;
  chatSessionId?: string | null;
  parentMessageId?: number | null;
  taskId?: string;
  runId?: string;
  messageId?: number | null;
  automationId?: string;
  automationRunId?: string;
}

export interface ToolCall {
  id?: ToolCallId;
  descriptorId?: ToolDescriptorId;
  provider?: ToolProviderIdentity;
  name: string;
  invocationName?: string;
  payload: ToolPayload;
  raw: string;
  parseError?: ToolError;
  source?: ToolCallSource;
  createdAt?: number;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  details?: ToolPayload;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  detail?: string;
  callId?: ToolCallId;
  descriptorId?: ToolDescriptorId;
  provider?: ToolProviderIdentity;
  name?: string;
  output?: JsonValue;
  error?: ToolError;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  truncated?: boolean;
}

export interface ToolExecutionContext {
  trigger: ToolExecutionTrigger;
  requestId: string;
  chatSessionId?: string | null;
  taskId?: string;
  runId?: string;
  timeoutMs?: number;
  maxResultBytes?: number;
}

export interface ToolRegistrySnapshot {
  providers: ToolProviderIdentity[];
  tools: ToolDescriptor[];
  refreshedAt: number;
}

export interface ToolCallHistoryRecord {
  id: string;
  call: ToolCall;
  result: ToolResult;
  createdAt: number;
  source: ToolExecutionTrigger;
}

export type ToolAuthorizationSurface =
  | 'deepseek_content'
  | 'extension_context'
  | 'background_workflow';

/**
 * Receiver-owned identity for the runtime that is allowed to execute a tool.
 * MAIN-world ToolCall fields are correlation claims only and must never be
 * used to construct this subject.
 */
export interface ToolAuthorizationSubject {
  surface: ToolAuthorizationSurface;
  documentSessionId: string;
  tabId?: number;
  frameId?: number;
  chatSessionId?: string | null;
}

export interface ToolAuthorizationDescriptorSnapshot {
  id: ToolDescriptorId;
  provider: Pick<ToolProviderIdentity, 'kind' | 'id' | 'transport'>;
  name: string;
  invocationName: string;
  execution: ToolDescriptorExecution;
  inputSchemaDigest: string;
}

export interface ToolAuthorizationGrantSummary {
  id: ToolAuthorizationId;
  requestId: string;
  trigger: ToolExecutionTrigger;
  chatSessionId: string | null;
  descriptors: ToolDescriptor[];
  expiresAt: number;
}

export interface ToolGrantExecutionContext {
  kind: 'grant';
  grantId: ToolAuthorizationId;
  subject: ToolAuthorizationSubject;
}

export interface TrustedToolExecutionContext {
  kind: 'trusted';
  trigger: ToolExecutionTrigger;
  requestId: string;
  chatSessionId?: string | null;
  taskId?: string;
  runId?: string;
  automationId?: string;
  automationRunId?: string;
}

export type RuntimeToolAuthorizationContext =
  | ToolGrantExecutionContext
  | TrustedToolExecutionContext;
