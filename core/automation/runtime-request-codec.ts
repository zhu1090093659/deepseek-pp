import { validateAutomationSchedule } from './schedule';
import type {
  AutomationCreateInput,
  AutomationPromptOptions,
  AutomationSchedule,
  AutomationStatus,
  AutomationUpdateInput,
} from './types';

export interface AutomationRunsRequest {
  automationId: string;
  limit?: number;
}

export interface AutomationUpdateRequest {
  id: string;
  patch: AutomationUpdateInput;
}

export type AutomationStatusRequest =
  | { ok: true; id: string; status: AutomationStatus }
  | { ok: false; error: 'invalid_automation_status' };

export interface AutomationIdRequest {
  id: string;
}

export function decodeAutomationRunsRequest(value: unknown): AutomationRunsRequest {
  const payload = recordValue(value, 'GET_AUTOMATION_RUNS.payload');
  assertOnlyKeys(payload, ['automationId', 'limit'], 'GET_AUTOMATION_RUNS.payload');
  const automationId = nonEmptyString(payload.automationId, 'automationId');
  if (payload.limit === undefined) return { automationId };
  if (typeof payload.limit !== 'number' || !Number.isInteger(payload.limit) || payload.limit < 1) {
    throw new Error('Automation run limit must be a positive integer.');
  }
  return { automationId, limit: payload.limit };
}

export function decodeAutomationCreateInput(value: unknown): AutomationCreateInput {
  const payload = recordValue(value, 'CREATE_AUTOMATION.payload');
  assertOnlyKeys(payload, ['name', 'prompt', 'schedule', 'promptOptions'], 'CREATE_AUTOMATION.payload');
  return {
    name: nonEmptyString(payload.name, 'Automation name'),
    prompt: nonEmptyString(payload.prompt, 'Automation prompt'),
    schedule: decodeSchedule(payload.schedule),
    promptOptions: decodePromptOptions(payload.promptOptions),
  };
}

export function decodeAutomationUpdateRequest(value: unknown): AutomationUpdateRequest {
  const payload = recordValue(value, 'UPDATE_AUTOMATION.payload');
  assertOnlyKeys(payload, ['id', 'patch'], 'UPDATE_AUTOMATION.payload');
  const id = nonEmptyString(payload.id, 'Automation id');
  const patch = recordValue(payload.patch, 'Automation patch');
  assertOnlyKeys(
    patch,
    ['name', 'prompt', 'status', 'schedule', 'promptOptions', 'nextRunAt'],
    'Automation patch',
  );
  const decoded: AutomationUpdateInput = {};
  if (patch.name !== undefined) decoded.name = nonEmptyString(patch.name, 'Automation name');
  if (patch.prompt !== undefined) decoded.prompt = nonEmptyString(patch.prompt, 'Automation prompt');
  if (patch.status !== undefined && !isAutomationStatus(patch.status)) {
    throw new Error('Invalid automation status');
  }
  if (patch.status !== undefined) decoded.status = patch.status;
  if (patch.schedule !== undefined) decoded.schedule = decodeSchedule(patch.schedule);
  if (patch.promptOptions !== undefined) {
    decoded.promptOptions = decodePromptOptions(patch.promptOptions);
  }
  if (
    patch.nextRunAt !== undefined
    && patch.nextRunAt !== null
    && (typeof patch.nextRunAt !== 'number' || !Number.isFinite(patch.nextRunAt))
  ) {
    throw new Error('Automation nextRunAt must be a finite number or null.');
  }
  if (patch.nextRunAt !== undefined) decoded.nextRunAt = patch.nextRunAt;
  return { id, patch: decoded };
}

export function decodeAutomationStatusRequest(value: unknown): AutomationStatusRequest {
  const payload = recordValue(value, 'SET_AUTOMATION_STATUS.payload');
  assertOnlyKeys(payload, ['id', 'status'], 'SET_AUTOMATION_STATUS.payload');
  if (!isAutomationStatus(payload.status)) {
    return { ok: false, error: 'invalid_automation_status' };
  }
  return {
    ok: true,
    id: nonEmptyString(payload.id, 'Automation id'),
    status: payload.status,
  };
}

export function decodeAutomationIdRequest(value: unknown, command: string): AutomationIdRequest {
  const payload = recordValue(value, `${command}.payload`);
  assertOnlyKeys(payload, ['id'], `${command}.payload`);
  return { id: nonEmptyString(payload.id, 'Automation id') };
}

function decodeSchedule(value: unknown): AutomationSchedule {
  const schedule = recordValue(value, 'Automation schedule');
  assertOnlyKeys(
    schedule,
    ['kind', 'expression', 'timezone', 'enabled', 'minimumIntervalMinutes'],
    'Automation schedule',
  );
  if (schedule.kind !== 'manual' && schedule.kind !== 'cron' && schedule.kind !== 'rrule') {
    throw new Error('Invalid automation schedule kind.');
  }
  if (schedule.expression !== null && typeof schedule.expression !== 'string') {
    throw new Error('Automation schedule expression must be a string or null.');
  }
  if (typeof schedule.timezone !== 'string') {
    throw new Error('Automation schedule timezone must be a string.');
  }
  if (typeof schedule.enabled !== 'boolean') {
    throw new Error('Automation schedule enabled must be a boolean.');
  }
  if (
    typeof schedule.minimumIntervalMinutes !== 'number'
    || !Number.isFinite(schedule.minimumIntervalMinutes)
    || schedule.minimumIntervalMinutes < 0
  ) {
    throw new Error('Automation minimum interval must be a non-negative number.');
  }
  const decoded: AutomationSchedule = {
    kind: schedule.kind,
    expression: schedule.expression,
    timezone: schedule.timezone,
    enabled: schedule.enabled,
    minimumIntervalMinutes: schedule.minimumIntervalMinutes,
  };
  const result = validateAutomationSchedule(decoded);
  if (!result.ok) throw new Error(result.error.message);
  return decoded;
}

function decodePromptOptions(value: unknown): AutomationPromptOptions {
  const options = recordValue(value, 'Automation prompt options');
  assertOnlyKeys(
    options,
    ['modelType', 'searchEnabled', 'thinkingEnabled', 'refFileIds'],
    'Automation prompt options',
  );
  if (options.modelType !== null && typeof options.modelType !== 'string') {
    throw new Error('Automation modelType must be a string or null.');
  }
  if (typeof options.searchEnabled !== 'boolean' || typeof options.thinkingEnabled !== 'boolean') {
    throw new Error('Automation prompt flags must be booleans.');
  }
  if (!Array.isArray(options.refFileIds)) {
    throw new Error('Automation refFileIds must be an array.');
  }
  for (let index = 0; index < options.refFileIds.length; index++) {
    if (
      !Object.prototype.hasOwnProperty.call(options.refFileIds, index)
      || typeof options.refFileIds[index] !== 'string'
    ) {
      throw new Error('Automation refFileIds must contain only strings.');
    }
  }
  return {
    modelType: options.modelType,
    searchEnabled: options.searchEnabled,
    thinkingEnabled: options.thinkingEnabled,
    refFileIds: [...options.refFileIds],
  };
}

function validateNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}

function nonEmptyString(value: unknown, label: string): string {
  validateNonEmptyString(value, label);
  return value;
}

function isAutomationStatus(value: unknown): value is AutomationStatus {
  return value === 'active' || value === 'paused' || value === 'archived';
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported) throw new Error(`${label} contains an unsupported field: ${unsupported}`);
}
