import type { TokenMetricSource } from '../deepseek/stream-metrics';

export type UsageRangeDays = 7 | 30;
export type UsageRecordSource = 'deepseek-web' | 'sidepanel-web' | 'sidepanel-api';

export interface UsageTurnInput {
  id: string;
  recordedAt?: number;
  source: UsageRecordSource;
  chatSessionId?: string | null;
  assistantMessageId?: number | null;
  modelType?: string | null;
  totalTokens: number;
  tokenSource: TokenMetricSource;
  tps: number;
  speedSource: TokenMetricSource;
  elapsedMs: number;
  messageCount?: number;
}

export interface UsageTurnRecord {
  id: string;
  recordedAt: number;
  day: string;
  source: UsageRecordSource;
  chatSessionId: string | null;
  assistantMessageId: number | null;
  modelType: string | null;
  totalTokens: number;
  tokenSource: TokenMetricSource;
  tps: number;
  speedSource: TokenMetricSource;
  elapsedMs: number;
  messageCount: number;
}

export interface UsageDailyModelSummary {
  modelKey: string;
  modelLabel: string;
  tokens: number;
}

export interface UsageDailySummary {
  day: string;
  timestamp: number;
  tokens: number;
  messageCount: number;
  sessionCount: number;
  turnCount: number;
  models: UsageDailyModelSummary[];
}

export interface UsageHeatmapCell {
  day: string;
  timestamp: number;
  tokens: number;
  level: 0 | 1 | 2 | 3 | 4 | 5;
}

export interface UsageModelSummary {
  modelKey: string;
  modelLabel: string;
  totalTokens: number;
  turnCount: number;
  messageCount: number;
  sessionCount: number;
  share: number;
}

export interface UsageSummary {
  rangeDays: UsageRangeDays;
  generatedAt: number;
  totalTokens: number;
  sessionCount: number;
  messageCount: number;
  turnCount: number;
  activeDays: number;
  currentStreak: number;
  serverTokenRecordCount: number;
  mostUsedModel: UsageModelSummary | null;
  days: UsageDailySummary[];
  heatmap: UsageHeatmapCell[];
  modelUsage: UsageModelSummary[];
}
