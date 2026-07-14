import {
  normalizeUsageRangeDays,
  summarizeUsage,
  toLocalDayKey,
} from './stats';
import type {
  UsageRangeDays,
  UsageSummary,
  UsageTurnInput,
  UsageTurnRecord,
} from './types';
import { decodeUsageRecords, encodeUsageRecords } from './codec';
import { createCoalescingMutationQueue } from '../persistence/coalescing-mutation-queue';
import { normalizeUsageTurnInput } from './input-codec';
import type { TokenMetricSource } from '../deepseek/stream-metrics';

export const USAGE_STORAGE_KEY = 'deepseek_pp_usage_turns_v1';
const MAX_RECORDS = 5_000;
const RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const usageOperations = createCoalescingMutationQueue<UsageTurnRecord, UsageTurnRecord>(
  persistUsageBurst,
);

export async function recordUsageTurn(input: UsageTurnInput): Promise<UsageTurnRecord> {
  const incoming = normalizeUsageTurnInput(input);
  return usageOperations.mutate(incoming);
}

async function persistUsageBurst(
  incomingRecords: readonly UsageTurnRecord[],
): Promise<UsageTurnRecord[]> {
  let records = await readUsageRecordsAlreadyOwned();
  const results: UsageTurnRecord[] = [];
  for (const incoming of incomingRecords) {
    const existingIndex = records.findIndex((record) => record.id === incoming.id);
    const nextRecord = existingIndex >= 0
      ? mergeUsageRecord(records[existingIndex], incoming)
      : incoming;

    records = pruneUsageRecords(existingIndex >= 0
      ? [...records.slice(0, existingIndex), nextRecord, ...records.slice(existingIndex + 1)]
      : [...records, nextRecord]);
    results.push(nextRecord);
  }

  await saveUsageRecordsAlreadyOwned(records);
  return results;
}

export async function getUsageSummary(rangeDaysInput: unknown): Promise<UsageSummary> {
  const rangeDays = normalizeUsageRangeDays(rangeDaysInput);
  const records = await getUsageRecords();
  return summarizeUsage(records, { rangeDays });
}

export async function clearUsageRecords(): Promise<void> {
  await usageOperations.barrier(async () => {
    await readUsageRecordsAlreadyOwned();
    await chrome.storage.local.remove(USAGE_STORAGE_KEY);
  });
}

export async function getUsageRecords(): Promise<UsageTurnRecord[]> {
  return usageOperations.barrier(async () => {
    const records = await readUsageRecordsAlreadyOwned();
    return [...records].sort((a, b) => a.recordedAt - b.recordedAt);
  });
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

export type { UsageRangeDays };
