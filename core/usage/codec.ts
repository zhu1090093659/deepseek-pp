import { toLocalDayKey } from './stats';
import type {
  UsageRecordSource,
  UsageTurnRecord,
} from './types';

const USAGE_RECORD_SOURCES = new Set<UsageRecordSource>([
  'deepseek-web',
  'sidepanel-web',
  'sidepanel-api',
]);
const METRIC_SOURCES = new Set(['server', 'estimated']);

export class UsageStorageContractError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'UsageStorageContractError';
  }
}

/**
 * Decodes the released bare-array v1 contract. Missing storage is the only
 * empty-state case; a present envelope/scalar/corrupt row must remain intact.
 */
export function decodeUsageRecords(
  raw: unknown,
  path = 'usageRecords',
): UsageTurnRecord[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(path, 'Expected the released usage record array.');

  const records = raw.map((value, index) => decodeUsageRecord(value, `${path}[${index}]`));
  assertUniqueIds(records, path);
  return records;
}

export function encodeUsageRecords(records: readonly UsageTurnRecord[]): UsageTurnRecord[] {
  return decodeUsageRecords([...records]);
}

function decodeUsageRecord(raw: unknown, path: string): UsageTurnRecord {
  const value = recordValue(raw, path);
  const recordedAt = positiveNumber(value.recordedAt, `${path}.recordedAt`);

  return {
    ...value,
    id: nonEmptyString(value.id, `${path}.id`),
    recordedAt,
    // Early v1 readers projected absent fields; explicit invalid values are
    // rejected instead of being silently rewritten as those legacy defaults.
    day: value.day === undefined
      ? toLocalDayKey(recordedAt)
      : calendarDay(value.day, `${path}.day`),
    source: value.source === undefined
      ? 'deepseek-web'
      : enumValue(value.source, USAGE_RECORD_SOURCES, `${path}.source`),
    chatSessionId: optionalNullableString(value.chatSessionId, `${path}.chatSessionId`),
    assistantMessageId: optionalNullableInteger(
      value.assistantMessageId,
      `${path}.assistantMessageId`,
    ),
    modelType: optionalNullableString(value.modelType, `${path}.modelType`),
    totalTokens: nonNegativeInteger(value.totalTokens, `${path}.totalTokens`),
    tokenSource: value.tokenSource === undefined
      ? 'estimated'
      : enumValue(value.tokenSource, METRIC_SOURCES, `${path}.tokenSource`),
    tps: value.tps === undefined ? 0 : nonNegativeNumber(value.tps, `${path}.tps`),
    speedSource: value.speedSource === undefined
      ? 'estimated'
      : enumValue(value.speedSource, METRIC_SOURCES, `${path}.speedSource`),
    elapsedMs: value.elapsedMs === undefined
      ? 0
      : nonNegativeNumber(value.elapsedMs, `${path}.elapsedMs`),
    messageCount: value.messageCount === undefined
      ? 2
      : positiveInteger(value.messageCount, `${path}.messageCount`),
  } as UsageTurnRecord;
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'Expected an object.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, 'Expected a plain object.');
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail(path, 'Expected a non-empty string.');
  }
  return value;
}

function calendarDay(value: unknown, path: string): string {
  const day = nonEmptyString(value, path);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) fail(path, 'Expected a valid YYYY-MM-DD calendar day.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > daysInMonth[month - 1]) {
    fail(path, 'Expected a valid YYYY-MM-DD calendar day.');
  }
  return day;
}

function optionalNullableString(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail(path, 'Expected a string or null.');
  return value;
}

function optionalNullableInteger(value: unknown, path: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value)) fail(path, 'Expected a safe integer or null.');
  return value as number;
}

function positiveNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(path, 'Expected a positive finite number.');
  }
  return value;
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(path, 'Expected a non-negative finite number.');
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(path, 'Expected a non-negative safe integer.');
  }
  return value as number;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail(path, 'Expected a positive safe integer.');
  }
  return value as number;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, path: string): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    fail(path, `Expected one of: ${[...allowed].join(', ')}.`);
  }
  return value as T;
}

function assertUniqueIds(records: readonly UsageTurnRecord[], path: string): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) fail(path, `Duplicate usage record id: ${record.id}.`);
    ids.add(record.id);
  }
}

function fail(path: string, message: string): never {
  throw new UsageStorageContractError(path, message);
}
