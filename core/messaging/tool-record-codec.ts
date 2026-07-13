import {
  TOOL_EXECUTION_MODES,
  TOOL_EXECUTION_TRIGGERS,
  TOOL_PROVIDER_KINDS,
  TOOL_RISK_LEVELS,
  TOOL_TRANSPORT_KINDS,
} from '../tool/types';

const TOOL_PROVIDER_KIND_SET: ReadonlySet<string> = new Set(TOOL_PROVIDER_KINDS);
const TOOL_TRANSPORT_KIND_SET: ReadonlySet<string> = new Set(TOOL_TRANSPORT_KINDS);
const TOOL_EXECUTION_TRIGGER_SET: ReadonlySet<string> = new Set(TOOL_EXECUTION_TRIGGERS);
const TOOL_EXECUTION_MODE_SET: ReadonlySet<string> = new Set(TOOL_EXECUTION_MODES);
const TOOL_RISK_LEVEL_SET: ReadonlySet<string> = new Set(TOOL_RISK_LEVELS);

export function isToolProviderIdentity(value: unknown): value is Record<string, unknown> {
  return (
    isPlainRecord(value) &&
    TOOL_PROVIDER_KIND_SET.has(String(value.kind)) &&
    isNonEmptyString(value.id) &&
    typeof value.displayName === 'string' &&
    TOOL_TRANSPORT_KIND_SET.has(String(value.transport))
  );
}

export function isToolDescriptorRecord(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isToolProviderIdentity(value.provider) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.invocationName) &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    isToolDescriptorSchema(value.inputSchema) &&
    (value.outputSchema === undefined || isToolDescriptorSchema(value.outputSchema)) &&
    isToolDescriptorExecution(value.execution) &&
    (value.annotations === undefined || isStringRecord(value.annotations))
  );
}

export function isToolCallRecord(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  if (!isNonEmptyString(value.name) || !isJsonObject(value.payload) || typeof value.raw !== 'string') return false;
  if (value.id !== undefined && !isNonEmptyString(value.id)) return false;
  if (value.descriptorId !== undefined && !isNonEmptyString(value.descriptorId)) return false;
  if (value.invocationName !== undefined && !isNonEmptyString(value.invocationName)) return false;
  if (value.provider !== undefined && !isToolProviderIdentity(value.provider)) return false;
  if (value.source !== undefined && !isToolCallSource(value.source)) return false;
  if (value.createdAt !== undefined && !isFiniteNumber(value.createdAt)) return false;
  if (value.parseError !== undefined && !isToolError(value.parseError)) return false;
  return true;
}

export function isToolResultRecord(value: unknown): value is Record<string, unknown> {
  if (!isToolCardResult(value)) return false;
  if (!optionalString(value.callId) || !optionalString(value.descriptorId) || !optionalString(value.name)) return false;
  if (value.provider !== undefined && !isToolProviderIdentity(value.provider)) return false;
  if (value.startedAt !== undefined && !isFiniteNumber(value.startedAt)) return false;
  if (value.completedAt !== undefined && !isFiniteNumber(value.completedAt)) return false;
  if (value.durationMs !== undefined && !isNonNegativeFiniteNumber(value.durationMs)) return false;
  return true;
}

export function isToolExecutionContextRecord(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value) || !TOOL_EXECUTION_TRIGGER_SET.has(String(value.trigger))) return false;
  if (!isNonEmptyString(value.requestId)) return false;
  if (!optionalNullableString(value.chatSessionId) || !optionalString(value.taskId) || !optionalString(value.runId)) return false;
  if (value.timeoutMs !== undefined && !isPositiveFiniteNumber(value.timeoutMs)) return false;
  if (value.maxResultBytes !== undefined && !isPositiveFiniteNumber(value.maxResultBytes)) return false;
  return true;
}

export function isToolRegistrySnapshotRecord(value: unknown): value is Record<string, unknown> {
  return (
    isPlainRecord(value) &&
    Array.isArray(value.providers) &&
    value.providers.every(isToolProviderIdentity) &&
    Array.isArray(value.tools) &&
    value.tools.every(isToolDescriptorRecord) &&
    isFiniteNumber(value.refreshedAt)
  );
}

export function isToolCallHistoryRecord(value: unknown): value is Record<string, unknown> {
  return (
    isPlainRecord(value) &&
    isNonEmptyString(value.id) &&
    isToolCallRecord(value.call) &&
    isToolResultRecord(value.result) &&
    isFiniteNumber(value.createdAt) &&
    TOOL_EXECUTION_TRIGGER_SET.has(String(value.source))
  );
}

export function isToolExecutionRecord(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value) || !isNonEmptyString(value.name) || !isToolCardResult(value.result)) return false;
  if (!optionalString(value.callId) || !optionalString(value.descriptorId)) return false;
  if (value.pending !== undefined && typeof value.pending !== 'boolean') return false;
  if (value.provider !== undefined && !isToolProviderIdentity(value.provider)) return false;
  return true;
}

export function isToolCallRestoreRecord(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value) || !isNonEmptyString(value.id)) return false;
  if (value.calls !== undefined && (!Array.isArray(value.calls) || !value.calls.every(isToolCallRecord))) return false;
  if (value.executions !== undefined && (!Array.isArray(value.executions) || !value.executions.every(isToolExecutionRecord))) return false;
  if (!optionalString(value.content) || !optionalString(value.url)) return false;
  if (value.source !== undefined && value.source !== 'history' && value.source !== 'storage') return false;
  if (value.createdAt !== undefined && !isFiniteNumber(value.createdAt)) return false;
  if (value.metadata !== undefined && !isJsonObject(value.metadata)) return false;
  return true;
}

function isToolDescriptorSchema(value: unknown): boolean {
  if (!isPlainRecord(value) || value.type !== 'object') return false;
  if (value.properties !== undefined && !isJsonObject(value.properties)) return false;
  if (value.required !== undefined && (!Array.isArray(value.required) || !value.required.every(isString))) return false;
  if (
    value.additionalProperties !== undefined &&
    typeof value.additionalProperties !== 'boolean' &&
    !isJsonObject(value.additionalProperties)
  ) return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  return true;
}

function isToolDescriptorExecution(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  if (!TOOL_EXECUTION_MODE_SET.has(String(value.mode)) || typeof value.enabled !== 'boolean') return false;
  if (!TOOL_RISK_LEVEL_SET.has(String(value.risk))) return false;
  if (value.timeoutMs !== undefined && !isPositiveFiniteNumber(value.timeoutMs)) return false;
  if (value.maxResultBytes !== undefined && !isPositiveFiniteNumber(value.maxResultBytes)) return false;
  return true;
}

function isToolCallSource(value: unknown): boolean {
  if (!isPlainRecord(value) || !TOOL_EXECUTION_TRIGGER_SET.has(String(value.trigger))) return false;
  return optionalString(value.requestId) &&
    optionalNullableString(value.chatSessionId) &&
    optionalNullableNumber(value.parentMessageId) &&
    optionalString(value.taskId) &&
    optionalString(value.runId) &&
    optionalNullableNumber(value.messageId) &&
    optionalString(value.automationId) &&
    optionalString(value.automationRunId);
}

function isToolCardResult(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value) || typeof value.ok !== 'boolean' || typeof value.summary !== 'string') return false;
  if (!optionalString(value.detail) || !optionalBoolean(value.truncated)) return false;
  if (value.output !== undefined && !isJsonValue(value.output)) return false;
  if (value.error !== undefined && !isToolError(value.error)) return false;
  return true;
}

function isToolError(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    isNonEmptyString(value.code) &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean' &&
    (value.details === undefined || isJsonObject(value.details))
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value) && isJsonValue(value);
}

function isJsonValue(value: unknown, ancestors: Set<object> = new Set()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors))
    : isPlainRecord(value) && Object.values(value).every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function isStringRecord(value: unknown): boolean {
  return isPlainRecord(value) && Object.values(value).every(isString);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function optionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function optionalNullableNumber(value: unknown): boolean {
  return value === undefined || value === null || isFiniteNumber(value);
}

function isPositiveFiniteNumber(value: unknown): boolean {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeFiniteNumber(value: unknown): boolean {
  return isFiniteNumber(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
