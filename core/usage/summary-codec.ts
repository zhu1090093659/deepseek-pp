import type { UsageModelSummary, UsageSummary } from './types';

/** Validates the complete Usage summary at the receiving runtime boundary. */
export function isUsageSummary(value: unknown): value is UsageSummary {
  if (!isRecord(value)) return false;
  if (value.rangeDays !== 7 && value.rangeDays !== 30) return false;
  if (!hasFiniteNumbers(value, [
    'generatedAt',
    'totalTokens',
    'sessionCount',
    'messageCount',
    'turnCount',
    'activeDays',
    'currentStreak',
    'serverTokenRecordCount',
  ])) return false;
  if (value.mostUsedModel !== null && !isUsageModelSummary(value.mostUsedModel)) return false;
  return Array.isArray(value.days) && value.days.every(isUsageDailySummary) &&
    Array.isArray(value.heatmap) && value.heatmap.every(isUsageHeatmapCell) &&
    Array.isArray(value.modelUsage) && value.modelUsage.every(isUsageModelSummary);
}

function isUsageDailySummary(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.day === 'string' &&
    hasFiniteNumbers(value, ['timestamp', 'tokens', 'messageCount', 'sessionCount', 'turnCount']) &&
    Array.isArray(value.models) &&
    value.models.every((model) => (
      isRecord(model) &&
      typeof model.modelKey === 'string' &&
      typeof model.modelLabel === 'string' &&
      hasFiniteNumbers(model, ['tokens'])
    ));
}

function isUsageHeatmapCell(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.day === 'string' &&
    hasFiniteNumbers(value, ['timestamp', 'tokens', 'level']) &&
    Number.isInteger(value.level) &&
    (value.level as number) >= 0 &&
    (value.level as number) <= 5;
}

function isUsageModelSummary(value: unknown): value is UsageModelSummary {
  return isRecord(value) &&
    typeof value.modelKey === 'string' &&
    typeof value.modelLabel === 'string' &&
    hasFiniteNumbers(value, [
      'totalTokens',
      'turnCount',
      'messageCount',
      'sessionCount',
      'share',
    ]);
}

function hasFiniteNumbers(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
