import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAutomation,
  getAutomationRunById,
  reconcileStaleRuns,
} from '../core/automation/store';
import type { AutomationRun } from '../core/automation/types';

const STORAGE_KEY = 'deepseek_pp_automations';

function createChromeStub() {
  const storage = new Map<string, unknown>();
  return {
    storage,
    chromeStub: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
          set: vi.fn(async (value: Record<string, unknown>) => {
            for (const [key, storedValue] of Object.entries(value)) storage.set(key, storedValue);
          }),
        },
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedRun(run: AutomationRun): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  const current = data[STORAGE_KEY] as {
    version: 1;
    automations: unknown[];
    runs: AutomationRun[];
  } | undefined;
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      version: 1,
      automations: current?.automations ?? [],
      runs: [run, ...(current?.runs ?? []).filter((stored) => stored.id !== run.id)],
    },
  });
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  const now = Date.now();
  return {
    id: 'run-1',
    automationId: 'auto-1',
    trigger: 'schedule',
    status: 'running',
    scheduledFor: now,
    attempt: 1,
    request: null,
    result: null,
    error: null,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

describe('reconcileStaleRuns', () => {
  it('marks a stale running run as failed with an interrupted error', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    // Seed an automation so the run has a parent, then the run.
    await createAutomation({
      name: 'A',
      prompt: 'p',
      schedule: { kind: 'cron', expression: '* * * * *', timezone: 'UTC', enabled: true, minimumIntervalMinutes: 0 },
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
    });
    const startedAt = 1_000_000;
    await seedRun(makeRun({ id: 'run-stale', startedAt }));

    const thresholdMs = 180_000;
    const reconciled = await reconcileStaleRuns(thresholdMs, startedAt + thresholdMs + 1);

    expect(reconciled).toBe(1);
    const run = await getAutomationRunById('run-stale');
    expect(run?.status).toBe('failed');
    expect(run?.error).toMatchObject({
      code: 'automation_run_interrupted',
      phase: 'runner',
      retryable: false,
      details: {
        externalOutcome: 'ambiguous',
        retrySafe: false,
      },
    });
    expect(run?.completedAt).toBe(startedAt + thresholdMs);
  });

  it('leaves a fresh running run untouched', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    const startedAt = 1_000_000;
    await seedRun(makeRun({ id: 'run-fresh', startedAt }));

    const reconciled = await reconcileStaleRuns(180_000, startedAt + 5_000);

    expect(reconciled).toBe(0);
    const run = await getAutomationRunById('run-fresh');
    expect(run?.status).toBe('running');
    expect(run?.error).toBeNull();
  });

  it('does not touch already-finished runs', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    const oldStartedAt = 1_000_000;
    await seedRun(makeRun({ id: 'run-done', status: 'succeeded', startedAt: oldStartedAt, completedAt: oldStartedAt + 1000 }));
    await seedRun(makeRun({ id: 'run-failed', status: 'failed', startedAt: oldStartedAt }));

    const reconciled = await reconcileStaleRuns(180_000, oldStartedAt + 1_000_000);

    expect(reconciled).toBe(0);
    expect((await getAutomationRunById('run-done'))?.status).toBe('succeeded');
    expect((await getAutomationRunById('run-failed'))?.status).toBe('failed');
  });

  it('ignores running runs with a null startedAt', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    await seedRun(makeRun({ id: 'run-no-start', startedAt: null }));

    const reconciled = await reconcileStaleRuns(180_000, Date.now());

    expect(reconciled).toBe(0);
    expect((await getAutomationRunById('run-no-start'))?.status).toBe('running');
  });

  it('writes nothing when there are no stale runs', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    const freshStartedAt = Date.now();
    await seedRun(makeRun({ id: 'run-fresh2', startedAt: freshStartedAt }));

    const setCallsBefore = (chromeStub.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;
    await reconcileStaleRuns(180_000, freshStartedAt + 1_000);
    const setCallsAfter = (chromeStub.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(setCallsAfter).toBe(setCallsBefore); // reconcile wrote nothing
  });
});
