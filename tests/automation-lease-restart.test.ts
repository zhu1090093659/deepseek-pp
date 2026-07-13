import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOMATION_RUN_TIMEOUT_MS,
  scanDueAutomations,
} from '../core/automation/scheduler';
import {
  appendAutomationRun,
  claimAutomationRun,
  createAutomation,
  finalizeAutomationRun,
  getAutomationById,
  getAutomationRunById,
  updateAutomationRuntime,
} from '../core/automation/store';
import type {
  Automation,
  AutomationRun,
  AutomationRunnerRequest,
  AutomationRunnerResult,
} from '../core/automation/types';

function createChromeStub() {
  const storage = new Map<string, unknown>();
  return {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          for (const [key, storedValue] of Object.entries(value)) storage.set(key, storedValue);
        }),
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('automation durable lease and restart recovery', () => {
  it('atomically grants only one running claim across concurrent callers', async () => {
    vi.stubGlobal('chrome', createChromeStub());
    const automation = await createScheduledAutomation();
    const startedAt = 1_000_000;

    const claims = await Promise.all([
      claimAutomationRun(claimInput(automation, 'run-a', startedAt, null, 'manual')),
      claimAutomationRun(claimInput(automation, 'run-b', startedAt, null, 'manual')),
    ]);

    expect(claims.filter((claim) => claim.kind === 'claimed')).toHaveLength(1);
    expect(claims.filter((claim) => claim.kind === 'active_run')).toHaveLength(1);
  });

  it('treats a fresh persisted running row as the lease after service-worker restart', async () => {
    vi.stubGlobal('chrome', createChromeStub());
    const now = Date.parse('2026-07-13T08:00:00Z');
    const automation = await createScheduledAutomation();
    await updateAutomationRuntime(automation.id, { nextRunAt: now });
    await appendAutomationRun(makePersistedRun({
      id: 'legacy-random-run-id',
      automationId: automation.id,
      scheduledFor: now,
      startedAt: now - 1_000,
    }));
    const executor = vi.fn();

    const result = await scanDueAutomations(executor, now);

    expect(result.locked).toBe(1);
    expect(result.started).toBe(0);
    expect(executor).not.toHaveBeenCalled();
    expect((await getAutomationRunById('legacy-random-run-id'))?.status).toBe('running');
  });

  it('closes a legacy scheduled retry lease and advances without replaying it', async () => {
    vi.stubGlobal('chrome', createChromeStub());
    const now = Date.parse('2026-07-13T08:00:00Z');
    const automation = await createScheduledAutomation();
    await updateAutomationRuntime(automation.id, { nextRunAt: now });
    await appendAutomationRun(makePersistedRun({
      id: 'legacy-stale-run-id',
      automationId: automation.id,
      trigger: 'retry',
      scheduledFor: now,
      startedAt: now - AUTOMATION_RUN_TIMEOUT_MS - 1,
    }));
    const executor = vi.fn();

    const result = await scanDueAutomations(executor, now);

    expect(result.started).toBe(0);
    expect(executor).not.toHaveBeenCalled();
    expect(await getAutomationRunById('legacy-stale-run-id')).toMatchObject({
      status: 'failed',
      result: {
        ok: false,
        error: {
          code: 'automation_run_interrupted',
          retryable: false,
        },
      },
      error: {
        code: 'automation_run_interrupted',
        retryable: false,
        details: { externalOutcome: 'ambiguous', retrySafe: false },
      },
    });
    expect((await getAutomationById(automation.id))?.nextRunAt).toBeGreaterThan(now);
  });

  it('recovers a historical queued orphan instead of blocking the automation forever', async () => {
    vi.stubGlobal('chrome', createChromeStub());
    const now = Date.parse('2026-07-13T08:00:00Z');
    const automation = await createScheduledAutomation();
    await updateAutomationRuntime(automation.id, { nextRunAt: now });
    await appendAutomationRun(makePersistedRun({
      id: 'legacy-queued-run-id',
      automationId: automation.id,
      status: 'queued',
      scheduledFor: now,
      createdAt: now - AUTOMATION_RUN_TIMEOUT_MS - 1,
      startedAt: null,
    }));
    const executor = vi.fn();

    const result = await scanDueAutomations(executor, now);

    expect(result.started).toBe(0);
    expect(executor).not.toHaveBeenCalled();
    expect(await getAutomationRunById('legacy-queued-run-id')).toMatchObject({
      status: 'failed',
      result: {
        ok: false,
        error: { code: 'automation_run_interrupted' },
      },
    });
    expect((await getAutomationById(automation.id))?.nextRunAt).toBeGreaterThan(now);
  });

  it('fences a late executor result after the durable run is already terminal', async () => {
    vi.stubGlobal('chrome', createChromeStub());
    const automation = await createScheduledAutomation();
    const claim = await claimAutomationRun(claimInput(automation, 'run-fenced', 4_000_000, null, 'manual'));
    expect(claim.kind).toBe('claimed');

    const timeoutResult = failureResult(claim.kind === 'claimed' ? claim.run.request! : null);
    const terminal = await finalizeAutomationRun({
      runId: 'run-fenced',
      automationId: automation.id,
      status: 'timeout',
      result: timeoutResult,
      runtimePatch: () => ({ lastRunAt: timeoutResult.completedAt, lastError: timeoutResult.error }),
    });
    const lateSuccess = successResult(4_000_200);
    const rejected = await finalizeAutomationRun({
      runId: 'run-fenced',
      automationId: automation.id,
      status: 'succeeded',
      result: lateSuccess,
      runtimePatch: () => ({
        deepseek: {
          chatSessionId: lateSuccess.chatSessionId,
          parentMessageId: lateSuccess.parentMessageId,
          sessionUrl: lateSuccess.sessionUrl,
          lastHistorySyncedAt: null,
        },
      }),
    });

    expect(terminal?.status).toBe('timeout');
    expect(rejected).toBeNull();
    expect((await getAutomationRunById('run-fenced'))?.status).toBe('timeout');
    expect((await getAutomationById(automation.id))?.deepseek.chatSessionId).toBeNull();
  });

  it('repairs a stale occurrence without rolling back newer manual runtime state', async () => {
    vi.stubGlobal('chrome', createChromeStub());
    const now = Date.parse('2026-07-13T08:00:00Z');
    const scheduledFor = now - 60_000;
    const oldCompletedAt = now - 50_000;
    const newerCompletedAt = now - 1_000;
    const automation = await createScheduledAutomation();
    await updateAutomationRuntime(automation.id, {
      nextRunAt: scheduledFor,
      lastRunAt: newerCompletedAt,
      lastError: null,
      deepseek: {
        chatSessionId: 'newer-chat',
        parentMessageId: 88,
        sessionUrl: 'https://chat.deepseek.com/a/chat/s/newer-chat',
        lastHistorySyncedAt: newerCompletedAt,
      },
    });
    const oldResult = successResult(oldCompletedAt);
    await appendAutomationRun(makePersistedRun({
      id: 'old-terminal-occurrence',
      automationId: automation.id,
      trigger: 'retry',
      status: 'succeeded',
      scheduledFor,
      result: oldResult,
      completedAt: oldCompletedAt,
    }));
    const executor = vi.fn();

    await scanDueAutomations(executor, now);

    expect(executor).not.toHaveBeenCalled();
    expect(await getAutomationById(automation.id)).toMatchObject({
      lastRunAt: newerCompletedAt,
      lastError: null,
      deepseek: {
        chatSessionId: 'newer-chat',
        parentMessageId: 88,
      },
    });
    expect((await getAutomationById(automation.id))?.nextRunAt).toBeGreaterThan(now);
  });

  it('normalizes historical runner requests that predate persisted deadlines', async () => {
    vi.stubGlobal('chrome', createChromeStub());
    const requestedAt = 8_000_000;
    await chrome.storage.local.set({
      deepseek_pp_automations: {
        version: 1,
        automations: [],
        runs: [{
          ...makePersistedRun({ id: 'legacy-request' }),
          request: {
            runId: 'legacy-request',
            automationId: 'automation',
            prompt: 'Legacy request',
            trigger: 'manual',
            chatSessionId: null,
            parentMessageId: null,
            promptOptions: {
              modelType: null,
              searchEnabled: false,
              thinkingEnabled: false,
              refFileIds: [],
            },
            requestedAt,
          },
        }],
      },
    });

    expect((await getAutomationRunById('legacy-request'))?.request?.deadlineAt)
      .toBe(requestedAt + AUTOMATION_RUN_TIMEOUT_MS);
  });

  it('uses the persisted deadline when deciding whether a restarted lease is stale', async () => {
    vi.stubGlobal('chrome', createChromeStub());
    const now = 12_000_000;
    const automation = await createScheduledAutomation();
    await appendAutomationRun(makePersistedRun({
      id: 'custom-deadline',
      automationId: automation.id,
      startedAt: now - AUTOMATION_RUN_TIMEOUT_MS,
      request: {
        ...claimInput(automation, 'custom-deadline', now - 1_000, null, 'manual')
          .createRequest(automation),
        deadlineAt: now + 1_000,
      },
    }));

    const result = await scanDueAutomations(vi.fn(), now);

    expect(result.started).toBe(0);
    expect((await getAutomationRunById('custom-deadline'))?.status).toBe('running');
  });
});

async function createScheduledAutomation(): Promise<Automation> {
  return createAutomation({
    name: 'Scheduled',
    prompt: 'Run safely.',
    schedule: {
      kind: 'rrule',
      expression: 'FREQ=MINUTELY;INTERVAL=15',
      timezone: 'UTC',
      enabled: true,
      minimumIntervalMinutes: 15,
    },
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
  });
}

function claimInput(
  automation: Automation,
  runId: string,
  startedAt: number,
  scheduledFor: number | null,
  trigger: 'manual' | 'schedule',
) {
  return {
    runId,
    automationId: automation.id,
    trigger,
    scheduledFor,
    startedAt,
    createRequest: (current: Automation): AutomationRunnerRequest => ({
      runId,
      automationId: current.id,
      deadlineAt: startedAt + AUTOMATION_RUN_TIMEOUT_MS,
      prompt: current.prompt,
      trigger,
      chatSessionId: current.deepseek.chatSessionId,
      parentMessageId: current.deepseek.parentMessageId,
      promptOptions: current.promptOptions,
      requestedAt: startedAt,
    }),
  };
}

function makePersistedRun(overrides: Partial<AutomationRun>): AutomationRun {
  return {
    id: 'run',
    automationId: 'automation',
    trigger: 'schedule',
    status: 'running',
    scheduledFor: null,
    attempt: 1,
    request: null,
    result: null,
    error: null,
    createdAt: 1,
    startedAt: 1,
    completedAt: null,
    updatedAt: 1,
    ...overrides,
  };
}

function successResult(completedAt: number): Extract<AutomationRunnerResult, { ok: true }> {
  return {
    ok: true,
    chatSessionId: 'late-chat',
    sessionUrl: 'https://chat.deepseek.com/a/chat/s/late-chat',
    parentMessageId: 9,
    assistantMessageId: 9,
    assistantText: 'late',
    history: null,
    completedAt,
  };
}

function failureResult(
  request: AutomationRunnerRequest | null,
): Extract<AutomationRunnerResult, { ok: false }> {
  return {
    ok: false,
    chatSessionId: request?.chatSessionId ?? null,
    parentMessageId: request?.parentMessageId ?? null,
    completedAt: 4_000_100,
    error: {
      code: 'automation_run_timeout',
      message: 'timeout',
      phase: 'runner',
      retryable: false,
      at: 4_000_100,
      details: { externalOutcome: 'ambiguous', retrySafe: false },
    },
  };
}
