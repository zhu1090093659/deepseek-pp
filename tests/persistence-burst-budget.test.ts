import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  USAGE_STORAGE_KEY,
  clearUsageRecords,
  getUsageRecords,
  recordUsageTurn,
} from '../core/usage/store';
import type { UsageTurnInput } from '../core/usage/types';
import {
  TOOL_HISTORY_STORAGE_KEY,
  appendToolCallHistory,
  clearToolCallHistory,
  getToolCallHistory,
} from '../core/tool/history';
import type { ToolCall, ToolResult } from '../core/tool/types';
import {
  SYNC_CONFIG_STORAGE_KEY,
  createSyncCommandTarget,
  createSyncConfigStore,
  type SyncConfigStoragePort,
  type VersionedSyncConfig,
} from '../core/sync/config';
import {
  createSyncOperationCoordinator,
  type SyncOperationEffects,
} from '../core/sync/operation-coordinator';
import type { SyncConfig, SyncCounts } from '../core/types';

const MUTATION_COUNT = 100;
const MODELED_WRITE_LATENCY_MS = 1;
const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);
const PERSISTENCE_BURST_BASELINE = Object.freeze({
  modeledWriteLatencyMs: MODELED_WRITE_LATENCY_MS,
  usage: { writes: 100, bytes: 1_391_297, observedElapsedMs: 141.75 },
  toolHistory: { writes: 100, bytes: 1_380_970, observedElapsedMs: 170.32 },
  syncConfigStatus: { writes: 200, bytes: 42_083, observedElapsedMs: 270.11 },
});
const PERSISTENCE_BURST_BUDGET = Object.freeze({
  usage: { maxWrites: 1, maxBytes: 27_544, maxElapsedMs: 100 },
  toolHistory: { maxWrites: 1, maxBytes: 27_370, maxElapsedMs: 100 },
  syncConfigStatus: { exactWrites: 200, maxBytes: 42_083, maxElapsedMs: 1_000 },
});
const COUNTS: SyncCounts = {
  memories: 1,
  skills: 2,
  presets: 3,
  projects: 4,
  projectConversations: 5,
  savedItems: 6,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('persistence 100-mutation trace', () => {
  it('records physical writes, UTF-8 payload bytes, elapsed time, and exact final state', async () => {
    installDeterministicEnvironment();
    const reference = await runLocalTrace('sequential');
    const burst = await runLocalTrace('concurrent');

    const syncStorage = new InstrumentedSyncConfigStorage();
    const syncTargetsSeen: string[] = [];
    const sync = createSyncCoordinator(syncStorage, {
      upload: async (config) => {
        if (config.provider !== 'webdav') throw new Error('Expected WebDAV config');
        syncTargetsSeen.push(config.remotePath);
        return COUNTS;
      },
      now: () => NOW + syncTargetsSeen.length - 1,
    });
    let expectedRevision: number | null = null;
    let lastSyncAt: number | null = null;
    const syncStartedAt = performance.now();
    for (let index = 0; index < MUTATION_COUNT; index += 1) {
      const result = await sync.upload(createSyncCommandTarget(
        webdav(`target-${String(index).padStart(3, '0')}`, lastSyncAt),
        expectedRevision,
      ));
      expectedRevision = result.revision;
      lastSyncAt = result.lastSyncAt;
    }
    const syncElapsedMs = performance.now() - syncStartedAt;

    vi.stubGlobal('chrome', burst.local.chromeStub);
    const usage = await getUsageRecords();
    const history = await getToolCallHistory();
    const reopenedSync = createSyncCoordinator(syncStorage);
    const syncConfig = await reopenedSync.getConfig();
    const metrics = {
      mutationCount: MUTATION_COUNT,
      usage: {
        writes: burst.local.metric(USAGE_STORAGE_KEY).writes,
        bytes: burst.local.metric(USAGE_STORAGE_KEY).bytes,
        elapsedMs: round(burst.usageElapsedMs),
      },
      toolHistory: {
        writes: burst.local.metric(TOOL_HISTORY_STORAGE_KEY).writes,
        bytes: burst.local.metric(TOOL_HISTORY_STORAGE_KEY).bytes,
        elapsedMs: round(burst.historyElapsedMs),
      },
      syncConfigStatus: {
        writes: syncStorage.writes,
        bytes: syncStorage.bytes,
        elapsedMs: round(syncElapsedMs),
      },
    };

    const reproducedBaseline = {
      modeledWriteLatencyMs: MODELED_WRITE_LATENCY_MS,
      usage: {
        writes: reference.local.metric(USAGE_STORAGE_KEY).writes,
        bytes: reference.local.metric(USAGE_STORAGE_KEY).bytes,
        observedElapsedMs: round(reference.usageElapsedMs),
      },
      toolHistory: {
        writes: reference.local.metric(TOOL_HISTORY_STORAGE_KEY).writes,
        bytes: reference.local.metric(TOOL_HISTORY_STORAGE_KEY).bytes,
        observedElapsedMs: round(reference.historyElapsedMs),
      },
      syncConfigStatus: {
        writes: metrics.syncConfigStatus.writes,
        bytes: metrics.syncConfigStatus.bytes,
        observedElapsedMs: metrics.syncConfigStatus.elapsedMs,
      },
    };
    console.info(`Persistence burst baseline: ${JSON.stringify(reproducedBaseline)}`);
    console.info(`Persistence burst metrics: ${JSON.stringify(metrics)}`);
    expect(reproducedBaseline.usage).toMatchObject({
      writes: PERSISTENCE_BURST_BASELINE.usage.writes,
      bytes: PERSISTENCE_BURST_BASELINE.usage.bytes,
    });
    expect(reproducedBaseline.toolHistory).toMatchObject({
      writes: PERSISTENCE_BURST_BASELINE.toolHistory.writes,
      bytes: PERSISTENCE_BURST_BASELINE.toolHistory.bytes,
    });
    expect(reproducedBaseline.syncConfigStatus).toMatchObject({
      writes: PERSISTENCE_BURST_BASELINE.syncConfigStatus.writes,
      bytes: PERSISTENCE_BURST_BASELINE.syncConfigStatus.bytes,
    });
    assertBudget(metrics.usage, PERSISTENCE_BURST_BUDGET.usage);
    assertBudget(metrics.toolHistory, PERSISTENCE_BURST_BUDGET.toolHistory);
    expect(metrics.syncConfigStatus.writes).toBe(PERSISTENCE_BURST_BUDGET.syncConfigStatus.exactWrites);
    expect(metrics.syncConfigStatus.bytes).toBeLessThanOrEqual(PERSISTENCE_BURST_BUDGET.syncConfigStatus.maxBytes);
    expect(metrics.syncConfigStatus.elapsedMs).toBeLessThanOrEqual(PERSISTENCE_BURST_BUDGET.syncConfigStatus.maxElapsedMs);
    expect(burst.usageResults.map((record) => record.id)).toEqual(
      Array.from({ length: MUTATION_COUNT }, (_, index) => `usage-${String(index).padStart(3, '0')}`),
    );
    expect(usage.map((record) => record.id)).toEqual(
      Array.from({ length: MUTATION_COUNT }, (_, index) => `usage-${String(index).padStart(3, '0')}`),
    );
    expect(burst.historyResults.map((record) => record.call.name)).toEqual(
      Array.from({ length: MUTATION_COUNT }, (_, index) => `tool_${index}`),
    );
    expect(history.map((record) => record.call.name)).toEqual(
      Array.from({ length: MUTATION_COUNT }, (_, index) => `tool_${99 - index}`),
    );
    expect(syncTargetsSeen).toEqual(
      Array.from({ length: MUTATION_COUNT }, (_, index) => `target-${String(index).padStart(3, '0')}`),
    );
    expect(syncConfig).toMatchObject({
      provider: 'webdav',
      remotePath: 'target-099',
      lastSyncAt: NOW + 99,
      revision: 200,
    });
    expect(syncStorage.writes).toBe(200);

    const writesBeforeRestart = {
      usage: burst.local.metric(USAGE_STORAGE_KEY).writes,
      toolHistory: burst.local.metric(TOOL_HISTORY_STORAGE_KEY).writes,
      syncConfigStatus: syncStorage.writes,
    };
    vi.resetModules();
    const restartedUsage = await import('../core/usage/store');
    const restartedHistory = await import('../core/tool/history');
    await expect(restartedUsage.getUsageRecords()).resolves.toEqual(usage);
    await expect(restartedHistory.getToolCallHistory()).resolves.toEqual(history);
    await expect(createSyncCoordinator(syncStorage).getConfig()).resolves.toEqual(syncConfig);
    expect(burst.local.metric(USAGE_STORAGE_KEY).writes).toBe(writesBeforeRestart.usage);
    expect(burst.local.metric(TOOL_HISTORY_STORAGE_KEY).writes).toBe(writesBeforeRestart.toolHistory);
    expect(syncStorage.writes).toBe(writesBeforeRestart.syncConfigStatus);
  });

  it('keeps clear as a FIFO barrier between adjacent mutation bursts', async () => {
    installDeterministicEnvironment();
    const local = new InstrumentedLocalStorage();
    vi.stubGlobal('chrome', local.chromeStub);

    await Promise.all([
      recordUsageTurn(usageInput(1)),
      clearUsageRecords(),
      recordUsageTurn(usageInput(2)),
    ]);
    await Promise.all([
      appendToolCallHistory(toolCall(1), toolResult(1), 'manual_chat'),
      clearToolCallHistory(),
      appendToolCallHistory(toolCall(2), toolResult(2), 'manual_chat'),
    ]);

    await expect(getUsageRecords()).resolves.toMatchObject([{ id: 'usage-002' }]);
    await expect(getToolCallHistory()).resolves.toMatchObject([{ call: { name: 'tool_2' } }]);
    expect(local.metric(USAGE_STORAGE_KEY).writes).toBe(2);
    expect(local.metric(TOOL_HISTORY_STORAGE_KEY).writes).toBe(2);
  });

  it('rejects an entire failed physical burst without partial state and accepts later mutations', async () => {
    installDeterministicEnvironment();
    const local = new InstrumentedLocalStorage();
    vi.stubGlobal('chrome', local.chromeStub);

    const usageFailure = new Error('usage write failed');
    local.failNextWrite(usageFailure);
    await expect(Promise.allSettled([
      recordUsageTurn(usageInput(1)),
      recordUsageTurn(usageInput(2)),
    ])).resolves.toEqual([
      { status: 'rejected', reason: usageFailure },
      { status: 'rejected', reason: usageFailure },
    ]);
    await expect(getUsageRecords()).resolves.toEqual([]);
    await expect(recordUsageTurn(usageInput(3))).resolves.toMatchObject({ id: 'usage-003' });

    const historyFailure = new Error('tool history write failed');
    local.failNextWrite(historyFailure);
    await expect(Promise.allSettled([
      appendToolCallHistory(toolCall(1), toolResult(1), 'manual_chat'),
      appendToolCallHistory(toolCall(2), toolResult(2), 'manual_chat'),
    ])).resolves.toEqual([
      { status: 'rejected', reason: historyFailure },
      { status: 'rejected', reason: historyFailure },
    ]);
    await expect(getToolCallHistory()).resolves.toEqual([]);
    await expect(appendToolCallHistory(toolCall(3), toolResult(3), 'manual_chat'))
      .resolves.toMatchObject({ call: { name: 'tool_3' } });

    await expect(getUsageRecords()).resolves.toMatchObject([{ id: 'usage-003' }]);
    await expect(getToolCallHistory()).resolves.toMatchObject([{ call: { name: 'tool_3' } }]);
    expect(local.metric(USAGE_STORAGE_KEY).writes).toBe(1);
    expect(local.metric(TOOL_HISTORY_STORAGE_KEY).writes).toBe(1);
  });
});

class InstrumentedLocalStorage {
  private readonly values = new Map<string, unknown>();
  private readonly metrics = new Map<string, { writes: number; bytes: number }>();
  private nextWriteFailure: unknown;

  readonly chromeStub = {
    storage: {
      local: {
        QUOTA_BYTES: 10_485_760,
        get: vi.fn(async (key: string) => ({ [key]: clone(this.values.get(key)) })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          await delay(MODELED_WRITE_LATENCY_MS);
          if (this.nextWriteFailure !== undefined) {
            const failure = this.nextWriteFailure;
            this.nextWriteFailure = undefined;
            throw failure;
          }
          for (const [key, value] of Object.entries(values)) {
            const metric = this.metric(key);
            metric.writes += 1;
            metric.bytes += utf8Bytes(JSON.stringify({ [key]: value }));
            this.values.set(key, clone(value));
          }
        }),
        remove: vi.fn(async (key: string) => {
          this.values.delete(key);
        }),
      },
    },
  };

  metric(key: string): { writes: number; bytes: number } {
    const existing = this.metrics.get(key);
    if (existing) return existing;
    const created = { writes: 0, bytes: 0 };
    this.metrics.set(key, created);
    return created;
  }

  failNextWrite(error: unknown): void {
    this.nextWriteFailure = error;
  }
}

class InstrumentedSyncConfigStorage implements SyncConfigStoragePort {
  present = false;
  value: unknown;
  writes = 0;
  bytes = 0;

  async read() {
    return { present: this.present, value: clone(this.value) };
  }

  async write(value: VersionedSyncConfig) {
    await delay(MODELED_WRITE_LATENCY_MS);
    this.writes += 1;
    this.bytes += utf8Bytes(JSON.stringify({ [SYNC_CONFIG_STORAGE_KEY]: value }));
    this.present = true;
    this.value = clone(value);
  }
}

function createSyncCoordinator(
  storage: InstrumentedSyncConfigStorage,
  overrides: Partial<SyncOperationEffects> = {},
) {
  return createSyncOperationCoordinator(createSyncConfigStore(storage), {
    test: overrides.test ?? (async () => {}),
    authorize: overrides.authorize ?? (async () => 'refresh'),
    upload: overrides.upload ?? (async () => COUNTS),
    download: overrides.download ?? (async () => ({
      counts: COUNTS,
      projectContextChanged: false,
      savedItemsChanged: false,
    })),
    now: overrides.now,
  });
}

function usageInput(index: number): UsageTurnInput {
  return {
    id: `usage-${String(index).padStart(3, '0')}`,
    recordedAt: NOW + index,
    source: 'deepseek-web',
    chatSessionId: `chat-${String(index).padStart(3, '0')}`,
    assistantMessageId: index + 1,
    modelType: 'deepseek-chat',
    totalTokens: 100 + index,
    tokenSource: 'server',
    tps: 20 + index,
    speedSource: 'server',
    elapsedMs: 1_000 + index,
    messageCount: 2,
  };
}

function toolCall(index: number): ToolCall {
  return {
    name: `tool_${index}`,
    payload: { index, argument: `value-${String(index).padStart(3, '0')}` },
    raw: `<tool_${index}>{"index":${index}}</tool_${index}>`,
  };
}

function toolResult(index: number): ToolResult {
  return {
    ok: true,
    summary: `result ${index}`,
    detail: `detail ${String(index).padStart(3, '0')}`,
  };
}

function webdav(
  remotePath: string,
  lastSyncAt: number | null,
): Extract<SyncConfig, { provider: 'webdav' }> {
  return {
    provider: 'webdav',
    url: 'https://dav.example.test/root',
    username: 'user',
    password: 'secret',
    remotePath,
    lastSyncAt,
  };
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function runLocalTrace(mode: 'concurrent' | 'sequential') {
  const local = new InstrumentedLocalStorage();
  vi.stubGlobal('chrome', local.chromeStub);

  const usageStartedAt = performance.now();
  const usageResults = mode === 'concurrent'
    ? await Promise.all(Array.from({ length: MUTATION_COUNT }, (_, index) => (
      recordUsageTurn(usageInput(index))
    )))
    : await runSequentially((index) => recordUsageTurn(usageInput(index)));
  const usageElapsedMs = performance.now() - usageStartedAt;

  const historyStartedAt = performance.now();
  const historyResults = mode === 'concurrent'
    ? await Promise.all(Array.from({ length: MUTATION_COUNT }, (_, index) => (
      appendToolCallHistory(toolCall(index), toolResult(index), 'manual_chat')
    )))
    : await runSequentially((index) => (
      appendToolCallHistory(toolCall(index), toolResult(index), 'manual_chat')
    ));
  const historyElapsedMs = performance.now() - historyStartedAt;

  return { local, usageResults, historyResults, usageElapsedMs, historyElapsedMs };
}

async function runSequentially<T>(operation: (index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  for (let index = 0; index < MUTATION_COUNT; index += 1) {
    results.push(await operation(index));
  }
  return results;
}

function installDeterministicEnvironment(): void {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  let nextUuid = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `00000000-0000-4000-8000-${String(nextUuid += 1).padStart(12, '0')}`,
  });
}

function assertBudget(
  metric: { writes: number; bytes: number; elapsedMs: number },
  budget: { maxWrites: number; maxBytes: number; maxElapsedMs: number },
): void {
  expect(metric.writes).toBeLessThanOrEqual(budget.maxWrites);
  expect(metric.bytes).toBeLessThanOrEqual(budget.maxBytes);
  expect(metric.elapsedMs).toBeLessThanOrEqual(budget.maxElapsedMs);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}
