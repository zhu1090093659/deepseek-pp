import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Automation, AutomationRun } from '../core/automation/types';
import { BACKGROUND_RUNTIME_PAYLOAD_DECODERS } from '../core/messaging/background-runtime-request-codec';
import type { RuntimeMessageContext } from '../core/messaging/runtime-boundary';
import {
  getRuntimeCommandOwner,
  type RuntimeCommandHandler,
} from '../core/messaging/runtime-command-registry';
import { SyncConfigConflictError } from '../core/sync/config';
import {
  createBackgroundRuntimeHandlers,
  type BackgroundRuntimeHandlerDependencies,
} from '../entrypoints/background/background-runtime-handlers';

const R44_COMMANDS = [
  'RECORD_USAGE_TURN',
  'GET_USAGE_SUMMARY',
  'CLEAR_USAGE_STATS',
  'GET_SYNC_CONFIG',
  'SAVE_SYNC_CONFIG',
  'WEBDAV_TEST',
  'SYNC_AUTHORIZE',
  'WEBDAV_UPLOAD_LOCAL',
  'WEBDAV_DOWNLOAD_REMOTE',
  'GET_AUTOMATIONS',
  'GET_AUTOMATION_RUNS',
  'CREATE_AUTOMATION',
  'UPDATE_AUTOMATION',
  'SET_AUTOMATION_STATUS',
  'DELETE_AUTOMATION',
  'RUN_AUTOMATION_NOW',
  'SCENARIOS_UPDATED',
] as const;

const R44_PAYLOAD_COMMANDS = [
  'RECORD_USAGE_TURN',
  'GET_USAGE_SUMMARY',
  'SAVE_SYNC_CONFIG',
  'WEBDAV_TEST',
  'SYNC_AUTHORIZE',
  'WEBDAV_UPLOAD_LOCAL',
  'WEBDAV_DOWNLOAD_REMOTE',
  'GET_AUTOMATION_RUNS',
  'CREATE_AUTOMATION',
  'UPDATE_AUTOMATION',
  'SET_AUTOMATION_STATUS',
  'DELETE_AUTOMATION',
  'RUN_AUTOMATION_NOW',
  'SCENARIOS_UPDATED',
] as const;

const context: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'extension_context',
  senderUrl: 'chrome-extension://extension-id/sidepanel.html',
  senderOrigin: 'chrome-extension://extension-id',
  documentSessionId: 'document-1',
  tabId: 17,
};

describe('R4.4 background runtime closure', () => {
  it('owns exactly the final 17 handlers and 13 receiving decoders', () => {
    const handlers = createBackgroundRuntimeHandlers(createDependencies());
    expect(handlers.map((handler) => handler.type).sort()).toEqual([...R44_COMMANDS].sort());
    expect(Object.keys(BACKGROUND_RUNTIME_PAYLOAD_DECODERS).sort())
      .toEqual([...R44_PAYLOAD_COMMANDS].sort());
    for (const type of R44_COMMANDS) expect(getRuntimeCommandOwner(type)).toBe('typed-handler');

    const background = readFileSync('entrypoints/background.ts', 'utf8');
    expect(background).not.toContain('handleLegacyMessage');
    for (const type of R44_COMMANDS) expect(background).not.toContain(`case '${type}'`);
  });

  it('rejects malformed usage before storage and preserves normalized range behavior', async () => {
    const dependencies = createDependencies();
    const handlers = createBackgroundRuntimeHandlers(dependencies);
    await expect(dispatch(handlers, {
      type: 'RECORD_USAGE_TURN',
      payload: { id: '', totalTokens: 1 },
    })).rejects.toThrow('Usage turn id is required');
    expect(dependencies.usage.recordUsageTurn).not.toHaveBeenCalled();

    await dispatch(handlers, { type: 'GET_USAGE_SUMMARY', payload: { rangeDays: 7 } });
    expect(dependencies.usage.getUsageSummary).toHaveBeenCalledWith(7);
    await dispatch(handlers, { type: 'GET_USAGE_SUMMARY', payload: { rangeDays: 999 } });
    expect(dependencies.usage.getUsageSummary).toHaveBeenLastCalledWith(30);
  });

  it('decodes sync targets once and preserves classified conflict responses', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.sync.coordinator.save)
      .mockRejectedValue(new SyncConfigConflictError(null, null, 'changed'));
    const handlers = createBackgroundRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'SAVE_SYNC_CONFIG',
      payload: syncTarget(),
    })).resolves.toEqual({
      ok: false,
      error: 'changed',
      code: 'sync_config_conflict',
    });
    expect(dependencies.sync.coordinator.save).toHaveBeenCalledWith({
      config: expect.objectContaining({
        ...syncTarget().config,
        schemaVersion: 1,
        revision: 0,
      }),
      expectedRevision: null,
    });

    await expect(dispatch(handlers, {
      type: 'WEBDAV_UPLOAD_LOCAL',
      payload: { config: { provider: 'unknown' }, expectedRevision: null },
    })).rejects.toThrow();
    expect(dependencies.sync.coordinator.upload).not.toHaveBeenCalled();
  });

  it('notifies downloaded state only through the committed coordinator callback', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.sync.coordinator.download).mockImplementation(async (_target, notify) => {
      await notify?.({ counts: syncCounts(), projectContextChanged: true, savedItemsChanged: false });
      return { ok: true, lastSyncAt: 7, counts: syncCounts(), revision: 2 };
    });
    const handlers = createBackgroundRuntimeHandlers(dependencies);

    await dispatch(handlers, { type: 'WEBDAV_DOWNLOAD_REMOTE', payload: syncTarget() });
    expect(dependencies.sync.notifyDownloadedState).toHaveBeenCalledWith({
      counts: syncCounts(),
      projectContextChanged: true,
      savedItemsChanged: false,
    }, context);
  });

  it('runs automation mutation, schedule refresh, and broadcast in order', async () => {
    const events: string[] = [];
    const dependencies = createDependencies();
    vi.mocked(dependencies.automation.createAutomation).mockImplementation(async () => {
      events.push('create');
      return automation('created');
    });
    vi.mocked(dependencies.automation.refreshAutomationNextRunAt).mockImplementation(async () => {
      events.push('refresh');
      return automation('refreshed');
    });
    vi.mocked(dependencies.automation.broadcastAutomationUpdate).mockImplementation(async () => {
      events.push('broadcast');
    });
    const handlers = createBackgroundRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'CREATE_AUTOMATION',
      payload: automationInput(),
    })).resolves.toMatchObject({ id: 'refreshed' });
    expect(events).toEqual(['create', 'refresh', 'broadcast']);
  });

  it('rejects malformed automation before mutation and cancels before delete broadcasts', async () => {
    const dependencies = createDependencies();
    const handlers = createBackgroundRuntimeHandlers(dependencies);
    await expect(dispatch(handlers, {
      type: 'CREATE_AUTOMATION',
      payload: { name: 'name', prompt: 'prompt', schedule: null },
    })).rejects.toThrow('Automation schedule must be a plain object');
    expect(dependencies.automation.createAutomation).not.toHaveBeenCalled();

    await expect(dispatch(handlers, {
      type: 'UPDATE_AUTOMATION',
      payload: { id: 'automation-1', patch: { id: 'replacement-id' } },
    })).rejects.toThrow('Automation patch contains an unsupported field: id');
    expect(dependencies.automation.updateAutomation).not.toHaveBeenCalled();

    await expect(dispatch(handlers, {
      type: 'SET_AUTOMATION_STATUS',
      payload: { id: 'automation-1', status: 'unknown' },
    })).resolves.toEqual({ ok: false, error: 'invalid_automation_status' });
    expect(dependencies.automation.setAutomationStatus).not.toHaveBeenCalled();

    const events: string[] = [];
    vi.mocked(dependencies.automation.cancelActiveAutomationRun).mockImplementation(() => {
      events.push('cancel');
    });
    vi.mocked(dependencies.automation.deleteAutomation).mockImplementation(async () => {
      events.push('delete');
    });
    vi.mocked(dependencies.automation.broadcastAutomationUpdate).mockImplementation(async () => {
      events.push('automations');
    });
    vi.mocked(dependencies.automation.broadcastAutomationRunsUpdate).mockImplementation(async () => {
      events.push('runs');
    });
    await dispatch(handlers, { type: 'DELETE_AUTOMATION', payload: { id: 'automation-1' } });
    expect(events).toEqual(['cancel', 'delete', 'automations', 'runs']);
  });

  it('waits for scenario menu refresh and surfaces refresh failure', async () => {
    const dependencies = createDependencies();
    const handlers = createBackgroundRuntimeHandlers(dependencies);
    await expect(dispatch(handlers, { type: 'SCENARIOS_UPDATED' }))
      .resolves.toEqual({ ok: true });
    vi.mocked(dependencies.scenario.refreshScenarioMenus)
      .mockRejectedValueOnce(new Error('menu failed'));
    await expect(dispatch(handlers, { type: 'SCENARIOS_UPDATED' }))
      .rejects.toThrow('menu failed');

    await expect(dispatch(handlers, {
      type: 'SCENARIOS_UPDATED',
      payload: { operation: 'add', label: 'Custom', template: 'Use {text}' },
    })).resolves.toEqual({ ok: true, scenarios: [] });
    expect(dependencies.scenario.addCustomScenario)
      .toHaveBeenCalledWith('Custom', 'Use {text}');

    await expect(dispatch(handlers, {
      type: 'SCENARIOS_UPDATED',
      payload: { operation: 'delete', id: 'custom-1', unsupported: true },
    })).rejects.toThrow('contains an unsupported field: unsupported');
    expect(dependencies.scenario.deleteScenario).not.toHaveBeenCalled();
  });
});

function createDependencies(): BackgroundRuntimeHandlerDependencies {
  const record = usageRecord();
  return {
    usage: {
      recordUsageTurn: vi.fn(async () => record),
      getUsageSummary: vi.fn(async (rangeDays) => ({
        rangeDays,
        generatedAt: 1,
        totalTokens: 0,
        sessionCount: 0,
        messageCount: 0,
        turnCount: 0,
        activeDays: 0,
        currentStreak: 0,
        serverTokenRecordCount: 0,
        mostUsedModel: null,
        days: [],
        heatmap: [],
        modelUsage: [],
      })),
      clearUsageRecords: vi.fn(async () => undefined),
    },
    sync: {
      coordinator: {
        getConfig: vi.fn(async () => null),
        save: vi.fn(async () => ({ ok: true as const, revision: 1 })),
        test: vi.fn(async () => ({ ok: true as const, revision: 1 })),
        authorize: vi.fn(async () => ({ ok: true as const, refreshToken: 'token', revision: 1 })),
        upload: vi.fn(async () => ({ ok: true as const, lastSyncAt: 1, counts: syncCounts(), revision: 1 })),
        download: vi.fn(async () => ({ ok: true as const, lastSyncAt: 1, counts: syncCounts(), revision: 1 })),
      },
      notifyDownloadedState: vi.fn(async () => undefined),
    },
    automation: {
      getAllAutomations: vi.fn(async () => []),
      getAutomationRuns: vi.fn(async () => []),
      createAutomation: vi.fn(async () => automation('created')),
      updateAutomation: vi.fn(async () => automation('updated')),
      setAutomationStatus: vi.fn(async () => automation('status')),
      deleteAutomation: vi.fn(async () => undefined),
      refreshAutomationNextRunAt: vi.fn(async () => automation('refreshed')),
      cancelActiveAutomationRun: vi.fn(),
      runAutomationNow: vi.fn(async () => automationRun()),
      broadcastAutomationUpdate: vi.fn(async () => undefined),
      broadcastAutomationRunsUpdate: vi.fn(async () => undefined),
    },
    scenario: {
      getAllScenarios: vi.fn(async () => []),
      saveScenario: vi.fn(async () => undefined),
      addCustomScenario: vi.fn(async () => ({
        id: 'custom-1',
        label: 'Custom',
        template: 'Use {text}',
        builtIn: false,
        enabled: true,
      })),
      deleteScenario: vi.fn(async () => undefined),
      refreshScenarioMenus: vi.fn(async () => undefined),
    },
  };
}

async function dispatch(
  handlers: readonly RuntimeCommandHandler[],
  message: { type: string; payload?: unknown },
) {
  const handler = handlers.find((candidate) => candidate.type === message.type);
  if (!handler) throw new Error(`Missing handler: ${message.type}`);
  return handler.handle(message, context);
}

function syncTarget() {
  return {
    config: {
      provider: 'webdav' as const,
      url: 'https://dav.example.test',
      username: 'user',
      password: 'pass',
      remotePath: 'DeepSeekPP',
      lastSyncAt: null,
    },
    expectedRevision: null,
  };
}

function syncCounts() {
  return {
    memories: 0,
    skills: 0,
    presets: 0,
    projects: 0,
    projectConversations: 0,
    savedItems: 0,
  };
}

function automationInput() {
  return {
    name: 'Daily review',
    prompt: 'Review today',
    schedule: {
      kind: 'manual' as const,
      expression: null,
      timezone: 'UTC',
      enabled: false,
      minimumIntervalMinutes: 15,
    },
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
  };
}

function automation(id: string): Automation {
  return {
    ...automationInput(),
    id,
    status: 'active',
    deepseek: {
      chatSessionId: null,
      parentMessageId: null,
      sessionUrl: null,
      lastHistorySyncedAt: null,
    },
    createdAt: 1,
    updatedAt: 1,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    version: 1,
  };
}

function automationRun(): AutomationRun {
  return {
    id: 'run-1',
    automationId: 'automation-1',
    trigger: 'manual',
    status: 'succeeded',
    scheduledFor: null,
    attempt: 1,
    request: null,
    result: null,
    error: null,
    createdAt: 1,
    startedAt: 1,
    completedAt: 1,
    updatedAt: 1,
  };
}

function usageRecord() {
  return {
    id: 'usage-1',
    recordedAt: 1,
    day: '1970-01-01',
    source: 'deepseek-web' as const,
    chatSessionId: null,
    assistantMessageId: null,
    modelType: null,
    totalTokens: 1,
    tokenSource: 'estimated' as const,
    tps: 1,
    speedSource: 'estimated' as const,
    elapsedMs: 1,
    messageCount: 2,
  };
}
