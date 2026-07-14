import { isToolExecutionRecord } from '../messaging/tool-record-codec';
import type {
  InlineAgentLoopStatus,
  InlineAgentStepStatus,
  InlineAgentTraceRecord,
  InlineAgentTraceStepRecord,
} from './types';

const INLINE_AGENT_LOOP_STATUSES: ReadonlySet<string> = new Set<InlineAgentLoopStatus>([
  'idle',
  'running',
  'stopping',
  'complete',
  'error',
]);
const INLINE_AGENT_STEP_STATUSES: ReadonlySet<string> = new Set<InlineAgentStepStatus>([
  'streaming',
  'executing_tools',
  'complete',
  'error',
]);

export function decodeInlineAgentTraces(
  value: unknown,
  path = 'inlineAgentTraces',
): InlineAgentTraceRecord[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be a versionless array`);
  }
  return value.map((item, index) => decodeTrace(item, `${path}[${index}]`));
}

export const inlineAgentTraceCodec = Object.freeze({
  decode: decodeInlineAgentTraces,
  encode(value: InlineAgentTraceRecord[]): unknown {
    return decodeInlineAgentTraces(value);
  },
});

function decodeTrace(value: unknown, path: string): InlineAgentTraceRecord {
  const trace = recordValue(value, path);
  requireString(trace.id, `${path}.id`, true);
  requireString(trace.loopId, `${path}.loopId`, true);
  requireString(trace.chatSessionId, `${path}.chatSessionId`, true);
  requireFiniteNumber(trace.anchorMessageId, `${path}.anchorMessageId`);
  requireOptionalNullableFiniteNumber(trace.anchorMessageIndex, `${path}.anchorMessageIndex`);
  requireOptionalString(trace.anchorContent, `${path}.anchorContent`);
  requireString(trace.url, `${path}.url`);
  requireString(trace.originalPrompt, `${path}.originalPrompt`);
  requireString(trace.agentTaskPrompt, `${path}.agentTaskPrompt`);
  if (!INLINE_AGENT_LOOP_STATUSES.has(String(trace.status))) {
    throw new Error(`${path}.status is not supported`);
  }
  if (!Array.isArray(trace.steps)) throw new Error(`${path}.steps must be an array`);
  const steps = trace.steps.map((step, index) => decodeStep(step, `${path}.steps[${index}]`));
  requireFiniteNumber(trace.totalSteps, `${path}.totalSteps`);
  requireFiniteNumber(trace.totalTools, `${path}.totalTools`);
  requireOptionalString(trace.finalText, `${path}.finalText`);
  requireOptionalString(trace.error, `${path}.error`);
  requireFiniteNumber(trace.createdAt, `${path}.createdAt`);
  requireFiniteNumber(trace.updatedAt, `${path}.updatedAt`);
  return { ...trace, steps } as unknown as InlineAgentTraceRecord;
}

function decodeStep(value: unknown, path: string): InlineAgentTraceStepRecord {
  const step = recordValue(value, path);
  requireFiniteNumber(step.index, `${path}.index`);
  if (!INLINE_AGENT_STEP_STATUSES.has(String(step.status))) {
    throw new Error(`${path}.status is not supported`);
  }
  requireString(step.text, `${path}.text`);
  if (!Array.isArray(step.toolExecutions) || !step.toolExecutions.every(isToolExecutionRecord)) {
    throw new Error(`${path}.toolExecutions must contain valid tool execution records`);
  }
  requireOptionalNullableFiniteNumber(step.responseMessageId, `${path}.responseMessageId`);
  if (typeof step.collapsed !== 'boolean') throw new Error(`${path}.collapsed must be a boolean`);
  return step as unknown as InlineAgentTraceStepRecord;
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string, nonEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (nonEmpty && value.length === 0)) {
    throw new Error(`${path} must be ${nonEmpty ? 'a non-empty string' : 'a string'}`);
  }
}

function requireOptionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${path} must be a string`);
}

function requireFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
}

function requireOptionalNullableFiniteNumber(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  requireFiniteNumber(value, path);
}
