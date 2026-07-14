import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TOOL_HISTORY_STORAGE_KEY,
  appendToolCallHistory,
  clearToolCallHistory,
  getToolCallHistory,
} from '../core/tool/history';
import { ToolHistoryStorageContractError } from '../core/tool/history-codec';
import type { ToolCall, ToolResult } from '../core/tool/types';
import {
  USAGE_STORAGE_KEY,
  clearUsageRecords,
  getUsageRecords,
  recordUsageTurn,
} from '../core/usage/store';
import { UsageStorageContractError } from '../core/usage/codec';
import type { UsageTurnInput, UsageTurnRecord } from '../core/usage/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Usage whole-key mutation authority', () => {
  it('retains all concurrent records and prevents a stale estimate from replacing newer state', async () => {
    const { storage, chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    const now = Date.now();

    await Promise.all(Array.from({ length: 12 }, (_, index) => recordUsageTurn(
      makeUsageInput(`request-${index}`, { recordedAt: now + index }),
    )));
    await recordUsageTurn(makeUsageInput('shared', {
      recordedAt: now + 100,
      source: 'sidepanel-api',
      chatSessionId: 'new-chat',
      modelType: 'vision',
      totalTokens: 900,
      tokenSource: 'server',
      tps: 90,
      speedSource: 'server',
    }));
    await recordUsageTurn(makeUsageInput('shared', {
      recordedAt: now - 100,
      source: 'deepseek-web',
      chatSessionId: 'stale-chat',
      modelType: 'stale-model',
      totalTokens: 10,
      tokenSource: 'estimated',
      tps: 1,
      speedSource: 'estimated',
    }));

    const records = await getUsageRecords();
    expect(records).toHaveLength(13);
    expect(records.find((record) => record.id === 'shared')).toMatchObject({
      source: 'sidepanel-api',
      chatSessionId: 'new-chat',
      modelType: 'vision',
      totalTokens: 900,
      tokenSource: 'server',
      tps: 90,
      speedSource: 'server',
      recordedAt: now + 100,
    });
    expect(storage.get(USAGE_STORAGE_KEY)).toHaveLength(13);
  });

  it('projects legacy fields and preserves additions through the next write', async () => {
    const recordedAt = Date.now();
    const legacy = {
      id: 'legacy',
      recordedAt,
      totalTokens: 7,
      additiveRecordField: { retained: true },
    };
    const { storage, chromeStub } = createChromeStub({ [USAGE_STORAGE_KEY]: [legacy] });
    vi.stubGlobal('chrome', chromeStub);

    await recordUsageTurn(makeUsageInput('new-record', { recordedAt: recordedAt + 1 }));

    expect(storage.get(USAGE_STORAGE_KEY)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'legacy',
        source: 'deepseek-web',
        chatSessionId: null,
        assistantMessageId: null,
        modelType: null,
        tokenSource: 'estimated',
        tps: 0,
        speedSource: 'estimated',
        elapsedMs: 0,
        messageCount: 2,
        additiveRecordField: { retained: true },
      }),
    ]));
  });

  it.each([
    ['future envelope', { version: 2, records: [] }],
    ['corrupt row', [{ id: 'broken' }]],
    ['invalid day format', [makeUsageRecord('bad-day'), { ...makeUsageRecord('bad-day-2'), day: 'bogus' }]],
    ['invalid calendar day', [{ ...makeUsageRecord('bad-calendar-day'), day: '2026-99-99' }]],
    ['duplicate ids', [makeUsageRecord('duplicate'), makeUsageRecord('duplicate')]],
  ])('rejects %s on read, write, and clear without replacing it', async (_label, original) => {
    const { storage, chromeStub } = createChromeStub({ [USAGE_STORAGE_KEY]: original });
    vi.stubGlobal('chrome', chromeStub);

    await expect(getUsageRecords()).rejects.toBeInstanceOf(UsageStorageContractError);
    await expect(recordUsageTurn(makeUsageInput('new'))).rejects.toBeInstanceOf(UsageStorageContractError);
    await expect(clearUsageRecords()).rejects.toBeInstanceOf(UsageStorageContractError);
    expect(chromeStub.storage.local.set).not.toHaveBeenCalled();
    expect(chromeStub.storage.local.remove).not.toHaveBeenCalled();
    expect(storage.get(USAGE_STORAGE_KEY)).toBe(original);
  });

  it('orders clear with writes and continues after a failed operation', async () => {
    const { storage, chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);

    await Promise.all([
      recordUsageTurn(makeUsageInput('before-clear')),
      clearUsageRecords(),
    ]);
    expect(storage.has(USAGE_STORAGE_KEY)).toBe(false);

    storage.set(USAGE_STORAGE_KEY, { version: 99 });
    await expect(getUsageRecords()).rejects.toBeInstanceOf(UsageStorageContractError);
    storage.delete(USAGE_STORAGE_KEY);
    await expect(recordUsageTurn(makeUsageInput('after-failure'))).resolves.toMatchObject({
      id: 'after-failure',
    });
  });
});

describe('Tool History whole-key mutation authority', () => {
  it('retains every concurrent append and preserves released additive fields', async () => {
    const existing = {
      ...makeToolHistoryRecord('existing', 1),
      additiveRecordField: { retained: true },
    };
    const { storage, chromeStub } = createChromeStub({
      [TOOL_HISTORY_STORAGE_KEY]: [existing],
    });
    vi.stubGlobal('chrome', chromeStub);

    await Promise.all(Array.from({ length: 12 }, (_, index) => (
      appendToolCallHistory(makeToolCall(index), makeToolResult(index), 'manual_chat')
    )));

    const history = await getToolCallHistory();
    expect(history).toHaveLength(13);
    expect(new Set(history.map((record) => record.id)).size).toBe(13);
    expect(history.find((record) => record.id === 'existing')).toMatchObject({
      additiveRecordField: { retained: true },
    });
    expect(storage.get(TOOL_HISTORY_STORAGE_KEY)).toHaveLength(13);
  });

  it('keeps the newest released rows when legacy history is not pre-sorted', async () => {
    const legacy = Array.from({ length: 200 }, (_, index) => (
      makeToolHistoryRecord(`legacy-${index}`, index + 1)
    ));
    const { storage, chromeStub } = createChromeStub({
      [TOOL_HISTORY_STORAGE_KEY]: legacy,
    });
    vi.stubGlobal('chrome', chromeStub);

    const appended = await appendToolCallHistory(
      makeToolCall(101),
      makeToolResult(101),
      'manual_chat',
    );
    const stored = storage.get(TOOL_HISTORY_STORAGE_KEY) as Array<{ id: string }>;

    expect(stored).toHaveLength(100);
    expect(stored[0].id).toBe(appended.id);
    expect(stored.map((record) => record.id)).toContain('legacy-199');
    expect(stored.map((record) => record.id)).not.toContain('legacy-100');
    expect(stored.map((record) => record.id)).not.toContain('legacy-0');
  });

  it.each([
    ['future envelope', { version: 2, records: [] }],
    ['corrupt row', [{ id: 'broken' }]],
    ['duplicate ids', [makeToolHistoryRecord('duplicate', 1), makeToolHistoryRecord('duplicate', 2)]],
  ])('rejects %s on read, append, and clear without replacing it', async (_label, original) => {
    const { storage, chromeStub } = createChromeStub({ [TOOL_HISTORY_STORAGE_KEY]: original });
    vi.stubGlobal('chrome', chromeStub);

    await expect(getToolCallHistory()).rejects.toBeInstanceOf(ToolHistoryStorageContractError);
    await expect(appendToolCallHistory(makeToolCall(1), makeToolResult(1), 'manual_chat'))
      .rejects.toBeInstanceOf(ToolHistoryStorageContractError);
    await expect(clearToolCallHistory()).rejects.toBeInstanceOf(ToolHistoryStorageContractError);
    expect(chromeStub.storage.local.set).not.toHaveBeenCalled();
    expect(chromeStub.storage.local.remove).not.toHaveBeenCalled();
    expect(storage.get(TOOL_HISTORY_STORAGE_KEY)).toBe(original);
  });

  it('orders clear with appends and continues after a failed operation', async () => {
    const { storage, chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);

    await Promise.all([
      appendToolCallHistory(makeToolCall(1), makeToolResult(1), 'manual_chat'),
      clearToolCallHistory(),
    ]);
    expect(storage.has(TOOL_HISTORY_STORAGE_KEY)).toBe(false);

    storage.set(TOOL_HISTORY_STORAGE_KEY, { version: 99 });
    await expect(getToolCallHistory()).rejects.toBeInstanceOf(ToolHistoryStorageContractError);
    storage.delete(TOOL_HISTORY_STORAGE_KEY);
    await expect(appendToolCallHistory(makeToolCall(2), makeToolResult(2), 'manual_chat'))
      .resolves.toMatchObject({ source: 'manual_chat' });
  });
});

describe('whole-key authority isolation and restart', () => {
  it('does not let a blocked Usage operation stall Tool History', async () => {
    const { storage, chromeStub } = createChromeStub();
    let releaseUsage!: () => void;
    const usageGate = new Promise<void>((resolve) => {
      releaseUsage = resolve;
    });
    let usageReadStarted!: () => void;
    const usageRead = new Promise<void>((resolve) => {
      usageReadStarted = resolve;
    });
    chromeStub.storage.local.get.mockImplementation(async (key: string) => {
      if (key === USAGE_STORAGE_KEY) {
        usageReadStarted();
        await usageGate;
      }
      return { [key]: storage.get(key) };
    });
    vi.stubGlobal('chrome', chromeStub);

    const blockedUsage = recordUsageTurn(makeUsageInput('blocked'));
    await usageRead;
    await expect(appendToolCallHistory(makeToolCall(1), makeToolResult(1), 'manual_chat'))
      .resolves.toMatchObject({ source: 'manual_chat' });
    expect(storage.get(TOOL_HISTORY_STORAGE_KEY)).toHaveLength(1);

    releaseUsage();
    await blockedUsage;
  });

  it('reads the exact persisted Usage and Tool History state after restart without rewriting it', async () => {
    const { storage, chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    await recordUsageTurn(makeUsageInput('restart-usage'));
    const toolRecord = await appendToolCallHistory(
      makeToolCall(1),
      makeToolResult(1),
      'manual_chat',
    );
    const writesBeforeRestart = chromeStub.storage.local.set.mock.calls.length;

    vi.resetModules();
    const restartedUsage = await import('../core/usage/store');
    const restartedHistory = await import('../core/tool/history');

    await expect(restartedUsage.getUsageRecords()).resolves.toMatchObject([{ id: 'restart-usage' }]);
    await expect(restartedHistory.getToolCallHistory()).resolves.toMatchObject([{ id: toolRecord.id }]);
    expect(chromeStub.storage.local.set).toHaveBeenCalledTimes(writesBeforeRestart);
    expect(storage.get(USAGE_STORAGE_KEY)).toHaveLength(1);
    expect(storage.get(TOOL_HISTORY_STORAGE_KEY)).toHaveLength(1);
  });
});

function makeUsageInput(id: string, overrides: Partial<UsageTurnInput> = {}): UsageTurnInput {
  return {
    id,
    recordedAt: Date.now(),
    source: 'deepseek-web',
    chatSessionId: null,
    assistantMessageId: null,
    modelType: null,
    totalTokens: 100,
    tokenSource: 'estimated',
    tps: 10,
    speedSource: 'estimated',
    elapsedMs: 1_000,
    messageCount: 2,
    ...overrides,
  };
}

function makeUsageRecord(id: string): UsageTurnRecord {
  const input = makeUsageInput(id);
  return {
    ...input,
    recordedAt: input.recordedAt!,
    day: '2026-07-14',
    chatSessionId: input.chatSessionId ?? null,
    assistantMessageId: input.assistantMessageId ?? null,
    modelType: input.modelType ?? null,
    messageCount: input.messageCount ?? 2,
  };
}

function makeToolCall(index: number): ToolCall {
  return {
    name: `tool_${index}`,
    payload: { index },
    raw: `<tool_${index}>{"index":${index}}</tool_${index}>`,
  };
}

function makeToolResult(index: number): ToolResult {
  return {
    ok: true,
    summary: `result ${index}`,
    detail: `detail ${index}`,
  };
}

function makeToolHistoryRecord(id: string, createdAt: number) {
  return {
    id,
    call: makeToolCall(createdAt),
    result: makeToolResult(createdAt),
    source: 'manual_chat' as const,
    createdAt,
  };
}

function createChromeStub(initial: Record<string, unknown> = {}) {
  const storage = new Map<string, unknown>(Object.entries(initial));
  return {
    storage,
    chromeStub: {
      storage: {
        local: {
          QUOTA_BYTES: 10_485_760,
          get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) storage.set(key, value);
          }),
          remove: vi.fn(async (key: string) => {
            storage.delete(key);
          }),
        },
      },
    },
  };
}
