import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOMATION_STORAGE_KEY,
  AutomationStorageContractError,
  decodeAutomationStorageState,
} from '../core/automation/storage-codec';
import {
  createAutomation,
  getAllAutomations,
  setAutomationStatus,
} from '../core/automation/store';
import type { Automation, AutomationCreateInput, AutomationRun } from '../core/automation/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('automation storage contract', () => {
  it('treats only a missing key as empty and performs no eager write', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);

    await expect(getAllAutomations()).resolves.toEqual([]);
    expect(chromeStub.storage.local.set).not.toHaveBeenCalled();
  });

  it('projects released aliases while preserving additive fields', () => {
    const requestedAt = 1_000_000;
    const rawAutomation = {
      ...makeAutomation(),
      deepseek: undefined,
      additiveAutomationField: { retained: true },
    };
    delete rawAutomation.deepseek;
    const decoded = decodeAutomationStorageState({
      version: 1,
      additiveRootField: 'retained',
      automations: [rawAutomation],
      runs: [makeRun({
        status: 'succeeded',
        request: {
          runId: 'run-1',
          automationId: 'auto-1',
          prompt: 'Run',
          trigger: 'manual',
          chatSessionId: null,
          parentMessageId: '42',
          promptOptions: makeAutomation().promptOptions,
          requestedAt,
        } as never,
        result: {
          ok: true,
          chatSessionId: 'chat-1',
          sessionUrl: null,
          parentMessageId: '',
          assistantMessageId: '',
          assistantText: 'done',
          history: {
            chatSessionId: 'chat-1',
            parentMessageId: '8',
            assistantMessageId: null,
            messageCount: 2,
            verifiedAt: requestedAt + 10,
          },
          completedAt: requestedAt + 10,
        } as never,
        completedAt: requestedAt + 10,
      })],
    });

    expect(decoded.additiveRootField).toBe('retained');
    expect((decoded.automations[0] as Automation & { additiveAutomationField: unknown }).additiveAutomationField)
      .toEqual({ retained: true });
    expect(decoded.automations[0].deepseek).toEqual({
      chatSessionId: null,
      parentMessageId: null,
      sessionUrl: null,
      lastHistorySyncedAt: null,
    });
    expect(decoded.runs[0].request).toMatchObject({
      deadlineAt: requestedAt + 180_000,
      parentMessageId: 42,
    });
    expect(decoded.runs[0].result).toMatchObject({
      parentMessageId: 0,
      assistantMessageId: null,
      history: { parentMessageId: 8 },
    });
  });

  it('preserves root and record additions through an authorized mutation', async () => {
    const original = {
      version: 1,
      additiveRootField: { retained: true },
      automations: [{ ...makeAutomation(), additiveAutomationField: 'retained' }],
      runs: [],
    };
    const { storage, chromeStub } = createChromeStub({ [AUTOMATION_STORAGE_KEY]: original });
    vi.stubGlobal('chrome', chromeStub);

    await setAutomationStatus('auto-1', 'paused');

    expect(storage.get(AUTOMATION_STORAGE_KEY)).toMatchObject({
      version: 1,
      additiveRootField: { retained: true },
      automations: [{
        id: 'auto-1',
        status: 'paused',
        additiveAutomationField: 'retained',
      }],
    });
  });

  it.each([
    ['future root', { version: 2, automations: [], runs: [] }, 'automation_storage_version_unsupported'],
    ['future record', {
      version: 1,
      automations: [{ ...makeAutomation(), version: 2 }],
      runs: [],
    }, 'automation_storage_version_unsupported'],
    ['missing version', { automations: [], runs: [] }, 'automation_storage_corrupt'],
    ['corrupt rows', { version: 1, automations: [{ id: 'broken' }], runs: [] }, 'automation_storage_corrupt'],
    ['duplicate ids', {
      version: 1,
      automations: [makeAutomation(), makeAutomation()],
      runs: [],
    }, 'automation_storage_corrupt'],
  ])('rejects %s without overwriting the original value', async (_label, original, expectedCode) => {
    const { storage, chromeStub } = createChromeStub({ [AUTOMATION_STORAGE_KEY]: original });
    vi.stubGlobal('chrome', chromeStub);

    const read = getAllAutomations();
    await expect(read).rejects.toMatchObject({
      name: AutomationStorageContractError.name,
      code: expectedCode,
    });
    await expect(createAutomation(makeCreateInput('new'))).rejects.toMatchObject({ code: expectedCode });
    expect(chromeStub.storage.local.set).not.toHaveBeenCalled();
    expect(storage.get(AUTOMATION_STORAGE_KEY)).toBe(original);
  });

  it('accepts historical orphan runs created by the pre-serialization writer race', () => {
    const run = makeRun();

    expect(decodeAutomationStorageState({
      version: 1,
      automations: [],
      runs: [run],
    }).runs).toEqual([run]);
  });

  it('serializes concurrent mutations and reads the exact state after module restart', async () => {
    const { storage, chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);

    const created = await Promise.all([
      createAutomation(makeCreateInput('first')),
      createAutomation(makeCreateInput('second')),
    ]);
    expect(new Set(created.map((automation) => automation.id)).size).toBe(2);
    expect((storage.get(AUTOMATION_STORAGE_KEY) as { automations: Automation[] }).automations)
      .toHaveLength(2);

    const writesBeforeRestart = chromeStub.storage.local.set.mock.calls.length;
    vi.resetModules();
    const restartedStore = await import('../core/automation/store');
    const afterRestart = await restartedStore.getAllAutomations();

    expect(afterRestart.map((automation) => automation.id).sort())
      .toEqual(created.map((automation) => automation.id).sort());
    expect(chromeStub.storage.local.set).toHaveBeenCalledTimes(writesBeforeRestart);
  });
});

function makeAutomation(): Automation {
  return {
    id: 'auto-1',
    name: 'Automation',
    prompt: 'Run safely.',
    status: 'active',
    schedule: {
      kind: 'manual',
      expression: null,
      timezone: 'UTC',
      enabled: false,
      minimumIntervalMinutes: 0,
    },
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
    deepseek: {
      chatSessionId: null,
      parentMessageId: null,
      sessionUrl: null,
      lastHistorySyncedAt: null,
    },
    createdAt: 1_000,
    updatedAt: 1_000,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    version: 1,
  };
}

function makeCreateInput(name: string): AutomationCreateInput {
  const automation = makeAutomation();
  return {
    name,
    prompt: automation.prompt,
    schedule: automation.schedule,
    promptOptions: automation.promptOptions,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-1',
    automationId: 'auto-1',
    trigger: 'manual',
    status: 'running',
    scheduledFor: null,
    attempt: 1,
    request: null,
    result: null,
    error: null,
    createdAt: 1_000_000,
    startedAt: 1_000_000,
    completedAt: null,
    updatedAt: 1_000_000,
    ...overrides,
  };
}

function createChromeStub(initial: Record<string, unknown> = {}) {
  const storage = new Map<string, unknown>(Object.entries(initial));
  return {
    storage,
    chromeStub: {
      storage: {
        local: {
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
