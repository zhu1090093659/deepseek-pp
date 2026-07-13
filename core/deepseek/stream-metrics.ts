import { estimateTokenUnits } from '../token/estimator';

export type TokenMetricSource = 'server' | 'estimated';

export interface ResponseTokenUsageStats {
  modelType?: string | null;
  insertedAt?: number | null;
  updatedAt?: number | null;
  accumulatedTokenUsage?: number | null;
}

export interface ResponseTokenSpeedPayload {
  requestId?: string;
  chatSessionId?: string | null;
  assistantMessageId?: number | null;
  active: boolean;
  estimatedTokens: number;
  accumulatedTokens: number | null;
  tokensPerSecond: number;
  elapsedMs: number;
  textLength: number;
  tokenSource: TokenMetricSource;
  speedSource: TokenMetricSource;
  modelType: string | null;
}

export interface ResponseTokenSpeedTracker {
  append(text: string): void;
  updateServerStats(stats: ResponseTokenUsageStats | null | undefined): void;
  finish(): void;
}

export function shouldIgnoreEmptyTokenSpeedProgress(
  progress: ResponseTokenSpeedPayload,
  previous: ResponseTokenSpeedPayload,
): boolean {
  if (!isEmptyTokenSpeedProgress(progress)) return false;
  if (!hasMeaningfulTokenSpeedProgress(previous)) return false;
  return isSameTokenSpeedRequest(progress, previous);
}

export function createResponseTokenSpeedTracker(
  onProgress: (progress: ResponseTokenSpeedPayload) => void,
  emitIntervalMs: number,
): ResponseTokenSpeedTracker {
  const startedAt = performance.now();
  let firstTokenAt: number | null = null;
  let firstChunkTokenUnits = 0;
  let lastEmitAt = 0;
  let totalTokenUnits = 0;
  let textLength = 0;
  let finished = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let serverStartedAtMs: number | null = null;
  let serverCompletedAtMs: number | null = null;
  let serverAccumulatedTokens: number | null = null;
  let modelType: string | null = null;

  // Decode speed measured from the first streamed chunk, so queueing /
  // prefill latency before the stream starts does not drag the rate down.
  // The first chunk's tokens are excluded because no time has elapsed for
  // them yet (otherwise the first emit would show a huge spike).
  const getAverageTokensPerSecond = (now: number): number => {
    if (firstTokenAt === null) return 0;
    const elapsedMs = Math.max(now - firstTokenAt, 1);
    return ((totalTokenUnits - firstChunkTokenUnits) / elapsedMs) * 1000;
  };

  const getServerElapsedMs = (): number | null => {
    if (serverStartedAtMs === null || serverCompletedAtMs === null) return null;
    const elapsedMs = serverCompletedAtMs - serverStartedAtMs;
    return Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : null;
  };

  const getServerTokensPerSecond = (): number | null => {
    if (serverAccumulatedTokens === null) return null;
    const elapsedMs = getServerElapsedMs();
    if (elapsedMs === null) return null;
    return (serverAccumulatedTokens / elapsedMs) * 1000;
  };

  const emit = (active: boolean, force = false) => {
    if (finished && active) return;

    const now = performance.now();
    if (!force && now - lastEmitAt < emitIntervalMs) return;
    lastEmitAt = now;

    const estimatedTokens = Math.round(totalTokenUnits);
    const serverTokensPerSecond = getServerTokensPerSecond();
    const serverElapsedMs = getServerElapsedMs();
    const elapsedMs = serverElapsedMs ?? Math.max(now - startedAt, 1);
    onProgress({
      active,
      estimatedTokens,
      accumulatedTokens: serverAccumulatedTokens === null ? null : Math.round(serverAccumulatedTokens),
      tokensPerSecond: serverTokensPerSecond ?? getAverageTokensPerSecond(now),
      elapsedMs: Math.round(elapsedMs),
      textLength,
      tokenSource: serverAccumulatedTokens === null ? 'estimated' : 'server',
      speedSource: serverTokensPerSecond === null ? 'estimated' : 'server',
      modelType,
    });
  };

  emit(true, true);
  tickTimer = setInterval(() => emit(true, true), emitIntervalMs);

  return {
    append(text: string) {
      if (!text) return;
      const tokenUnits = estimateTokenUnits(text);
      if (firstTokenAt === null) {
        firstTokenAt = performance.now();
        firstChunkTokenUnits = tokenUnits;
      }
      textLength += text.length;
      totalTokenUnits += tokenUnits;
      emit(true);
    },
    updateServerStats(stats: ResponseTokenUsageStats | null | undefined) {
      if (!stats) return;
      let changed = false;

      if (typeof stats.modelType === 'string' && stats.modelType !== modelType) {
        modelType = stats.modelType;
        changed = true;
      }

      const insertedAtMs = normalizeServerTimestampMs(stats.insertedAt);
      if (insertedAtMs !== null && insertedAtMs !== serverStartedAtMs) {
        serverStartedAtMs = insertedAtMs;
        changed = true;
      }

      const accumulatedTokens = normalizeServerTokenCount(stats.accumulatedTokenUsage);
      if (accumulatedTokens !== null && accumulatedTokens !== serverAccumulatedTokens) {
        serverAccumulatedTokens = accumulatedTokens;
        changed = true;
      }

      const updatedAtMs = normalizeServerTimestampMs(stats.updatedAt);
      if (
        updatedAtMs !== null &&
        serverAccumulatedTokens !== null &&
        (serverCompletedAtMs === null || updatedAtMs >= serverCompletedAtMs)
      ) {
        serverCompletedAtMs = updatedAtMs;
        changed = true;
      }

      if (changed) emit(!finished, true);
    },
    finish() {
      if (finished) return;
      finished = true;
      if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      emit(false, true);
    },
  };
}

function normalizeServerTimestampMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value * 1000;
}

function normalizeServerTokenCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function isEmptyTokenSpeedProgress(progress: ResponseTokenSpeedPayload): boolean {
  const tokens = progress.accumulatedTokens ?? progress.estimatedTokens;
  return tokens <= 0 && progress.textLength <= 0;
}

function hasMeaningfulTokenSpeedProgress(progress: ResponseTokenSpeedPayload): boolean {
  const tokens = progress.accumulatedTokens ?? progress.estimatedTokens;
  return tokens > 0 || progress.textLength > 0;
}

function isSameTokenSpeedRequest(
  progress: ResponseTokenSpeedPayload,
  previous: ResponseTokenSpeedPayload,
): boolean {
  if (progress.requestId || previous.requestId) {
    return progress.requestId === previous.requestId;
  }
  if (progress.assistantMessageId !== null || previous.assistantMessageId !== null) {
    return progress.assistantMessageId === previous.assistantMessageId;
  }
  return false;
}
