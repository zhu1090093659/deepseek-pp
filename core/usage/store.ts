import type { TokenMetricSource } from '../deepseek/stream-metrics';
import {
  normalizeUsageRangeDays,
  summarizeUsage,
  toLocalDayKey,
} from './stats';
import type {
  UsageRangeDays,
  UsageRecordSource,
  UsageSummary,
  UsageTurnInput,
  UsageTurnRecord,
} from './types';
import { decodeUsageRecords, encodeUsageRecords } from './codec';
import { createSerialOperationQueue } from '../persistence/serial-operation-queue';

export const USAGE_STORAGE_KEY = 'deepseek_pp_usage_turns_v1';
const MAX_RECORDS = 5_000;
const RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const usageOperations = createSerialOperationQueue();

export async function recordUsageTurn(input: UsageTurnInput): Promise<UsageTurnRecord> {
  const incoming = normalizeUsageTurnInput(input);
  return usageOperations.run(async () => {
    const records = await readUsageRecordsAlreadyOwned();
    const existingIndex = records.findIndex((record) => record.id === incoming.id);
    const nextRecord = existingIndex >= 0
      ? mergeUsageRecord(records[existingIndex], incoming)
      : incoming;

    const nextRecords = existingIndex >= 0
      ? [...records.slice(0, existingIndex), nextRecord, ...records.slice(existingIndex + 1)]
      : [...records, nextRecord];

    await saveUsageRecordsAlreadyOwned(pruneUsageRecords(nextRecords));
    return nextRecord;
  });
}

export async function getUsageSummary(rangeDaysInput: unknown): Promise<UsageSummary> {
  const rangeDays = normalizeUsageRangeDays(rangeDaysInput);
  const records = await getUsageRecords();
  return summarizeUsage(records, { rangeDays });
}

export async function clearUsageRecords(): Promise<void> {
  await usageOperations.run(async () => {
    await readUsageRecordsAlreadyOwned();
    await chrome.storage.local.remove(USAGE_STORAGE_KEY);
  });
}

export async function getUsageRecords(): Promise<UsageTurnRecord[]> {
  return usageOperations.run(async () => {
    const records = await readUsageRecordsAlreadyOwned();
    return [...records].sort((a, b) => a.recordedAt - b.recordedAt);
  });
}

function normalizeUsageTurnInput(input: UsageTurnInput): UsageTurnRecord {
  if (!input || typeof input !== 'object') {
    throw new Error('Usage turn payload must be an object.');
  }

  const id = normalizeString(input.id);
  if (!id) throw new Error('Usage turn id is required.');

  const recordedAt = normalizePositiveNumber(input.recordedAt, Date.now());
  const totalTokens = normalizeNonNegativeInteger(input.totalTokens);
  if (totalTokens === null) throw new Error('Usage turn totalTokens must be a non-negative number.');

  return {
    id,
    recordedAt,
    day: toLocalDayKey(recordedAt),
    source: normalizeUsageRecordSource(input.source),
    chatSessionId: normalizeString(input.chatSessionId),
    assistantMessageId: normalizeNullableInteger(input.assistantMessageId),
    modelType: normalizeString(input.modelType),
    totalTokens,
    tokenSource: normalizeMetricSource(input.tokenSource),
    tps: normalizePositiveNumber(input.tps, 0),
    speedSource: normalizeMetricSource(input.speedSource),
    elapsedMs: normalizePositiveNumber(input.elapsedMs, 0),
    messageCount: normalizePositiveInteger(input.messageCount, 2),
  };
}

function mergeUsageRecord(existing: UsageTurnRecord, incoming: UsageTurnRecord): UsageTurnRecord {
  const preferIncomingTokens = shouldPreferIncomingMetric(existing.tokenSource, incoming.tokenSource, incoming.recordedAt, existing.recordedAt);
  const preferIncomingSpeed = shouldPreferIncomingMetric(existing.speedSource, incoming.speedSource, incoming.recordedAt, existing.recordedAt);
  const preferIncomingMetadata = incoming.recordedAt >= existing.recordedAt;
  const recordedAt = Math.max(existing.recordedAt, incoming.recordedAt);

  return {
    ...existing,
    id: existing.id,
    recordedAt,
    day: toLocalDayKey(recordedAt),
    source: preferIncomingMetadata ? incoming.source : existing.source,
    chatSessionId: preferIncomingMetadata
      ? incoming.chatSessionId ?? existing.chatSessionId
      : existing.chatSessionId ?? incoming.chatSessionId,
    assistantMessageId: preferIncomingMetadata
      ? incoming.assistantMessageId ?? existing.assistantMessageId
      : existing.assistantMessageId ?? incoming.assistantMessageId,
    modelType: preferIncomingMetadata
      ? incoming.modelType ?? existing.modelType
      : existing.modelType ?? incoming.modelType,
    totalTokens: preferIncomingTokens ? incoming.totalTokens : existing.totalTokens,
    tokenSource: preferIncomingTokens ? incoming.tokenSource : existing.tokenSource,
    tps: preferIncomingSpeed ? incoming.tps : existing.tps,
    speedSource: preferIncomingSpeed ? incoming.speedSource : existing.speedSource,
    elapsedMs: preferIncomingSpeed ? incoming.elapsedMs : existing.elapsedMs,
    messageCount: Math.max(existing.messageCount, incoming.messageCount),
  };
}

function shouldPreferIncomingMetric(
  existing: TokenMetricSource,
  incoming: TokenMetricSource,
  incomingAt: number,
  existingAt: number,
): boolean {
  if (incoming === 'server' && existing !== 'server') return true;
  if (incoming !== 'server' && existing === 'server') return false;
  return incomingAt >= existingAt;
}

function pruneUsageRecords(records: readonly UsageTurnRecord[]): UsageTurnRecord[] {
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  return records
    .filter((record) => record.recordedAt >= cutoff)
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .slice(0, MAX_RECORDS)
    .sort((a, b) => a.recordedAt - b.recordedAt);
}

async function readUsageRecordsAlreadyOwned(): Promise<UsageTurnRecord[]> {
  const data = await chrome.storage.local.get(USAGE_STORAGE_KEY) as Record<string, unknown>;
  return decodeUsageRecords(data[USAGE_STORAGE_KEY]);
}

async function saveUsageRecordsAlreadyOwned(records: readonly UsageTurnRecord[]): Promise<void> {
  await chrome.storage.local.set({ [USAGE_STORAGE_KEY]: encodeUsageRecords(records) });
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

export type { UsageRangeDays };
