import type { TokenMetricSource } from '../deepseek/stream-metrics';
import { toLocalDayKey } from './stats';
import type {
  UsageRecordSource,
  UsageTurnRecord,
} from './types';

export function normalizeUsageTurnInput(input: unknown): UsageTurnRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Usage turn payload must be an object.');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Usage turn payload must be a plain object.');
  }
  const value = input as Record<string, unknown>;
  const id = normalizeString(value.id);
  if (!id) throw new Error('Usage turn id is required.');

  const recordedAt = normalizePositiveNumber(value.recordedAt, Date.now());
  const totalTokens = normalizeNonNegativeInteger(value.totalTokens);
  if (totalTokens === null) {
    throw new Error('Usage turn totalTokens must be a non-negative number.');
  }

  return {
    id,
    recordedAt,
    day: toLocalDayKey(recordedAt),
    source: normalizeUsageRecordSource(value.source),
    chatSessionId: normalizeString(value.chatSessionId),
    assistantMessageId: normalizeNullableInteger(value.assistantMessageId),
    modelType: normalizeString(value.modelType),
    totalTokens,
    tokenSource: normalizeMetricSource(value.tokenSource),
    tps: normalizePositiveNumber(value.tps, 0),
    speedSource: normalizeMetricSource(value.speedSource),
    elapsedMs: normalizePositiveNumber(value.elapsedMs, 0),
    messageCount: normalizePositiveInteger(value.messageCount, 2),
  };
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function normalizeNullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function normalizeMetricSource(value: unknown): TokenMetricSource {
  return value === 'server' ? 'server' : 'estimated';
}

function normalizeUsageRecordSource(value: unknown): UsageRecordSource {
  if (value === 'sidepanel-web' || value === 'sidepanel-api') return value;
  return 'deepseek-web';
}
