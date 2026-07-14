import { SUPPORTED_LOCALES } from '../i18n/types';
import { decodePersistedMemoryRecord } from '../memory/codec';
import {
  isToolDescriptorRecord,
  isToolExecutionRecord,
} from '../messaging/tool-record-codec';
import type {
  Automation,
  AutomationDeepSeekSession,
  AutomationErrorState,
  AutomationHistorySnapshot,
  AutomationPromptContext,
  AutomationPromptOptions,
  AutomationRun,
  AutomationRunnerFailure,
  AutomationRunnerRequest,
  AutomationRunnerResult,
  AutomationRunnerSuccess,
  AutomationSchedule,
} from './types';

export const AUTOMATION_STORAGE_KEY = 'deepseek_pp_automations';
export const AUTOMATION_STORAGE_VERSION = 1 as const;
export const LEGACY_AUTOMATION_RUN_TIMEOUT_MS = 180_000;

const AUTOMATION_STATUSES = new Set(['active', 'paused', 'archived']);
const AUTOMATION_RUN_STATUSES = new Set([
  'queued',
  'running',
  'succeeded',
  'failed',
  'timeout',
  'cancelled',
  'skipped',
]);
const AUTOMATION_TRIGGERS = new Set(['manual', 'schedule', 'retry']);
const AUTOMATION_SCHEDULE_KINDS = new Set(['manual', 'cron', 'rrule']);
const AUTOMATION_FAILURE_PHASES = new Set([
  'schedule',
  'storage',
  'tab',
  'bridge',
  'auth',
  'session',
  'runner',
  'pow',
  'completion',
  'history',
  'unknown',
]);
const SUPPORTED_LOCALE_SET: ReadonlySet<string> = new Set(SUPPORTED_LOCALES);

export type AutomationStorageState = {
  version: typeof AUTOMATION_STORAGE_VERSION;
  automations: Automation[];
  runs: AutomationRun[];
} & Record<string, unknown>;

export type AutomationStorageContractErrorCode =
  | 'automation_storage_corrupt'
  | 'automation_storage_version_unsupported';

export class AutomationStorageContractError extends Error {
  constructor(
    readonly code: AutomationStorageContractErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'AutomationStorageContractError';
  }
}

export function createEmptyAutomationStorageState(): AutomationStorageState {
  return {
    version: AUTOMATION_STORAGE_VERSION,
    automations: [],
    runs: [],
  };
}

/** Pure decoder for the released v1 storage contract and its explicit aliases. */
export function decodeAutomationStorageState(
  raw: unknown,
  path = 'automationStorage',
): AutomationStorageState {
  if (raw === undefined) return createEmptyAutomationStorageState();

  const state = recordValue(raw, path);
  requireStorageVersion(state.version, `${path}.version`);
  const automations = decodeAutomationList(state.automations, `${path}.automations`);
  const runs = decodeAutomationRunList(state.runs, `${path}.runs`);

  return {
    ...state,
    version: AUTOMATION_STORAGE_VERSION,
    automations,
    runs,
  } as AutomationStorageState;
}

export function encodeAutomationStorageState(state: AutomationStorageState): AutomationStorageState {
  return decodeAutomationStorageState(state);
}

export function decodeAutomationList(raw: unknown, path = 'automations'): Automation[] {
  const automations = arrayValue(raw, path)
    .map((value, index) => decodeAutomation(value, `${path}[${index}]`));
  assertUniqueIds(automations.map((automation) => automation.id), path);
  return automations;
}

export function decodeAutomationRunList(raw: unknown, path = 'automationRuns'): AutomationRun[] {
  const runs = arrayValue(raw, path)
    .map((value, index) => decodeAutomationRun(value, `${path}[${index}]`));
  assertUniqueIds(runs.map((run) => run.id), path);
  return runs;
}

function decodeAutomation(raw: unknown, path: string): Automation {
  const value = recordValue(raw, path);
  if (value.version !== AUTOMATION_STORAGE_VERSION) {
    if (typeof value.version === 'number' && Number.isFinite(value.version)) {
      unsupportedVersion(`${path}.version`);
    }
    corrupt(`${path}.version`, 'Automation record version must be 1.');
  }

  return {
    ...value,
    id: nonEmptyString(value.id, `${path}.id`),
    name: nonEmptyString(value.name, `${path}.name`),
    prompt: nonEmptyString(value.prompt, `${path}.prompt`),
    status: enumValue(value.status, AUTOMATION_STATUSES, `${path}.status`),
    schedule: decodeSchedule(value.schedule, `${path}.schedule`),
    promptOptions: decodePromptOptions(value.promptOptions, `${path}.promptOptions`),
    // The initial released reader projected missing session state to nulls.
    deepseek: value.deepseek === undefined
      ? createEmptyDeepSeekSession()
      : decodeDeepSeekSession(value.deepseek, `${path}.deepseek`),
    createdAt: finiteNumber(value.createdAt, `${path}.createdAt`),
    updatedAt: finiteNumber(value.updatedAt, `${path}.updatedAt`),
    lastRunAt: nullableFiniteNumber(value.lastRunAt, `${path}.lastRunAt`),
    nextRunAt: nullableFiniteNumber(value.nextRunAt, `${path}.nextRunAt`),
    lastError: value.lastError === null
      ? null
      : decodeError(value.lastError, `${path}.lastError`),
    version: AUTOMATION_STORAGE_VERSION,
  } as Automation;
}

function decodeAutomationRun(raw: unknown, path: string): AutomationRun {
  const value = recordValue(raw, path);
  const id = nonEmptyString(value.id, `${path}.id`);
  const automationId = nonEmptyString(value.automationId, `${path}.automationId`);
  const createdAt = finiteNumber(value.createdAt, `${path}.createdAt`);
  const startedAt = nullableFiniteNumber(value.startedAt, `${path}.startedAt`);

  return {
    ...value,
    id,
    automationId,
    trigger: enumValue(value.trigger, AUTOMATION_TRIGGERS, `${path}.trigger`),
    status: enumValue(value.status, AUTOMATION_RUN_STATUSES, `${path}.status`),
    scheduledFor: nullableFiniteNumber(value.scheduledFor, `${path}.scheduledFor`),
    attempt: positiveInteger(value.attempt, `${path}.attempt`),
    request: value.request === null
      ? null
      : decodeRunnerRequest(
        value.request,
        `${path}.request`,
        id,
        automationId,
      ),
    result: value.result === null
      ? null
      : decodeRunnerResult(value.result, `${path}.result`),
    error: value.error === null
      ? null
      : decodeError(value.error, `${path}.error`),
    createdAt,
    startedAt,
    completedAt: nullableFiniteNumber(value.completedAt, `${path}.completedAt`),
    updatedAt: finiteNumber(value.updatedAt, `${path}.updatedAt`),
  } as AutomationRun;
}

function decodeSchedule(raw: unknown, path: string): AutomationSchedule {
  const value = recordValue(raw, path);
  return {
    ...value,
    kind: enumValue(value.kind, AUTOMATION_SCHEDULE_KINDS, `${path}.kind`),
    expression: nullableString(value.expression, `${path}.expression`),
    timezone: stringValue(value.timezone, `${path}.timezone`),
    enabled: booleanValue(value.enabled, `${path}.enabled`),
    minimumIntervalMinutes: nonNegativeNumber(
      value.minimumIntervalMinutes,
      `${path}.minimumIntervalMinutes`,
    ),
  } as AutomationSchedule;
}

function decodePromptOptions(raw: unknown, path: string): AutomationPromptOptions {
  const value = recordValue(raw, path);
  return {
    ...value,
    modelType: nullableString(value.modelType, `${path}.modelType`),
    searchEnabled: booleanValue(value.searchEnabled, `${path}.searchEnabled`),
    thinkingEnabled: booleanValue(value.thinkingEnabled, `${path}.thinkingEnabled`),
    refFileIds: stringArray(value.refFileIds, `${path}.refFileIds`),
  } as AutomationPromptOptions;
}

function createEmptyDeepSeekSession(): AutomationDeepSeekSession {
  return {
    chatSessionId: null,
    parentMessageId: null,
    sessionUrl: null,
    lastHistorySyncedAt: null,
  };
}

function decodeDeepSeekSession(raw: unknown, path: string): AutomationDeepSeekSession {
  const value = recordValue(raw, path);
  return {
    ...value,
    chatSessionId: nullableString(value.chatSessionId, `${path}.chatSessionId`),
    parentMessageId: storedMessageId(value.parentMessageId, `${path}.parentMessageId`),
    sessionUrl: nullableString(value.sessionUrl, `${path}.sessionUrl`),
    lastHistorySyncedAt: nullableFiniteNumber(
      value.lastHistorySyncedAt,
      `${path}.lastHistorySyncedAt`,
    ),
  } as AutomationDeepSeekSession;
}

function decodeRunnerRequest(
  raw: unknown,
  path: string,
  expectedRunId: string,
  expectedAutomationId: string,
): AutomationRunnerRequest {
  const value = recordValue(raw, path);
  const runId = nonEmptyString(value.runId, `${path}.runId`);
  const automationId = nonEmptyString(value.automationId, `${path}.automationId`);
  if (runId !== expectedRunId) corrupt(`${path}.runId`, 'Runner request does not match its run.');
  if (automationId !== expectedAutomationId) {
    corrupt(`${path}.automationId`, 'Runner request does not match its automation.');
  }
  const requestedAt = finiteNumber(value.requestedAt, `${path}.requestedAt`);
  const deadlineAt = value.deadlineAt === undefined
    ? requestedAt + LEGACY_AUTOMATION_RUN_TIMEOUT_MS
    : positiveNumber(value.deadlineAt, `${path}.deadlineAt`);

  return {
    ...value,
    runId,
    automationId,
    deadlineAt,
    prompt: nonEmptyString(value.prompt, `${path}.prompt`),
    trigger: enumValue(value.trigger, AUTOMATION_TRIGGERS, `${path}.trigger`),
    chatSessionId: nullableString(value.chatSessionId, `${path}.chatSessionId`),
    parentMessageId: storedMessageId(value.parentMessageId, `${path}.parentMessageId`),
    promptOptions: decodePromptOptions(value.promptOptions, `${path}.promptOptions`),
    ...(value.locale === undefined
      ? {}
      : { locale: enumValue(value.locale, SUPPORTED_LOCALE_SET, `${path}.locale`) }),
    ...(value.promptContext === undefined
      ? {}
      : { promptContext: decodePromptContext(value.promptContext, `${path}.promptContext`) }),
    requestedAt,
  } as AutomationRunnerRequest;
}

function decodePromptContext(raw: unknown, path: string): AutomationPromptContext {
  const value = recordValue(raw, path);
  const memories = value.memories === undefined
    ? undefined
    : arrayValue(value.memories, `${path}.memories`).map((memory, index) => (
      decodePersistedMemoryRecord(memory, `${path}.memories[${index}]`)
    ));
  const toolDescriptors = value.toolDescriptors === undefined
    ? undefined
    : arrayValue(value.toolDescriptors, `${path}.toolDescriptors`).map((descriptor, index) => {
      if (!isToolDescriptorRecord(descriptor)) {
        corrupt(`${path}.toolDescriptors[${index}]`, 'Invalid persisted tool descriptor.');
      }
      return descriptor;
    });

  return {
    ...value,
    ...(memories === undefined ? {} : { memories }),
    ...(value.presetContent === undefined
      ? {}
      : { presetContent: nullableString(value.presetContent, `${path}.presetContent`) }),
    ...(value.projectContext === undefined
      ? {}
      : { projectContext: nullableString(value.projectContext, `${path}.projectContext`) }),
    ...(toolDescriptors === undefined ? {} : { toolDescriptors }),
  } as AutomationPromptContext;
}

function decodeRunnerResult(raw: unknown, path: string): AutomationRunnerResult {
  const value = recordValue(raw, path);
  if (value.ok === true) return decodeRunnerSuccess(value, path);
  if (value.ok === false) return decodeRunnerFailure(value, path);
  corrupt(`${path}.ok`, 'Runner result must declare a boolean outcome.');
}

function decodeRunnerSuccess(
  value: Record<string, unknown>,
  path: string,
): AutomationRunnerSuccess {
  const toolExecutions = value.toolExecutions === undefined
    ? undefined
    : arrayValue(value.toolExecutions, `${path}.toolExecutions`).map((execution, index) => {
      if (!isToolExecutionRecord(execution)) {
        corrupt(`${path}.toolExecutions[${index}]`, 'Invalid persisted tool execution.');
      }
      return execution;
    });

  return {
    ...value,
    ok: true,
    chatSessionId: stringValue(value.chatSessionId, `${path}.chatSessionId`),
    sessionUrl: nullableString(value.sessionUrl, `${path}.sessionUrl`),
    parentMessageId: requiredStoredMessageId(value.parentMessageId, `${path}.parentMessageId`),
    assistantMessageId: storedMessageId(value.assistantMessageId, `${path}.assistantMessageId`),
    assistantText: stringValue(value.assistantText, `${path}.assistantText`),
    ...(toolExecutions === undefined ? {} : { toolExecutions }),
    history: value.history === null
      ? null
      : decodeHistorySnapshot(value.history, `${path}.history`),
    completedAt: finiteNumber(value.completedAt, `${path}.completedAt`),
  } as AutomationRunnerSuccess;
}

function decodeRunnerFailure(
  value: Record<string, unknown>,
  path: string,
): AutomationRunnerFailure {
  return {
    ...value,
    ok: false,
    chatSessionId: nullableString(value.chatSessionId, `${path}.chatSessionId`),
    parentMessageId: storedMessageId(value.parentMessageId, `${path}.parentMessageId`),
    error: decodeError(value.error, `${path}.error`),
    completedAt: finiteNumber(value.completedAt, `${path}.completedAt`),
  } as AutomationRunnerFailure;
}

function decodeHistorySnapshot(raw: unknown, path: string): AutomationHistorySnapshot {
  const value = recordValue(raw, path);
  return {
    ...value,
    chatSessionId: stringValue(value.chatSessionId, `${path}.chatSessionId`),
    parentMessageId: storedMessageId(value.parentMessageId, `${path}.parentMessageId`),
    assistantMessageId: storedMessageId(value.assistantMessageId, `${path}.assistantMessageId`),
    messageCount: nonNegativeInteger(value.messageCount, `${path}.messageCount`),
    verifiedAt: finiteNumber(value.verifiedAt, `${path}.verifiedAt`),
  } as AutomationHistorySnapshot;
}

function decodeError(raw: unknown, path: string): AutomationErrorState {
  const value = recordValue(raw, path);
  if (value.details !== undefined) recordValue(value.details, `${path}.details`);
  return {
    ...value,
    code: nonEmptyString(value.code, `${path}.code`),
    message: stringValue(value.message, `${path}.message`),
    phase: enumValue(value.phase, AUTOMATION_FAILURE_PHASES, `${path}.phase`),
    retryable: booleanValue(value.retryable, `${path}.retryable`),
    at: finiteNumber(value.at, `${path}.at`),
  } as AutomationErrorState;
}

function requireStorageVersion(value: unknown, path: string): void {
  if (value === AUTOMATION_STORAGE_VERSION) return;
  if (typeof value === 'number' && Number.isFinite(value)) unsupportedVersion(path);
  corrupt(path, 'Automation storage version must be 1.');
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    corrupt(path, 'Expected an object.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    corrupt(path, 'Expected a plain object.');
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) corrupt(path, 'Expected an array.');
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') corrupt(path, 'Expected a string.');
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (!result.trim()) corrupt(path, 'Expected a non-empty string.');
  return result;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return stringValue(value, path);
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') corrupt(path, 'Expected a boolean.');
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    corrupt(path, 'Expected a finite number.');
  }
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  const result = finiteNumber(value, path);
  if (result <= 0) corrupt(path, 'Expected a positive number.');
  return result;
}

function nonNegativeNumber(value: unknown, path: string): number {
  const result = finiteNumber(value, path);
  if (result < 0) corrupt(path, 'Expected a non-negative number.');
  return result;
}

function nullableFiniteNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  return finiteNumber(value, path);
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    corrupt(path, 'Expected a positive safe integer.');
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    corrupt(path, 'Expected a non-negative safe integer.');
  }
  return value as number;
}

function storedMessageId(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xFFFFFFFF) return parsed;
    }
  }
  corrupt(path, 'Expected a released message id or null.');
}

function requiredStoredMessageId(value: unknown, path: string): number {
  const result = storedMessageId(value, path);
  // The released reader represented an absent successful parent id as zero.
  return result ?? 0;
}

function stringArray(value: unknown, path: string): string[] {
  return arrayValue(value, path).map((item, index) => stringValue(item, `${path}[${index}]`));
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<string>, path: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) {
    corrupt(path, `Expected one of: ${[...allowed].join(', ')}.`);
  }
  return value as T;
}

function assertUniqueIds(ids: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) corrupt(path, `Duplicate id: ${id}.`);
    seen.add(id);
  }
}

function unsupportedVersion(path: string): never {
  throw new AutomationStorageContractError(
    'automation_storage_version_unsupported',
    path,
    `${path} is not supported.`,
  );
}

function corrupt(path: string, message: string): never {
  throw new AutomationStorageContractError(
    'automation_storage_corrupt',
    path,
    `${path}: ${message}`,
  );
}
