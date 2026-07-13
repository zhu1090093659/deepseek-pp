import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOMATION_RETRY_DELAY_MS,
  cancelActiveAutomationRun,
  hasActiveAutomationRun,
  runAutomation,
  scanDueAutomations,
} from '../core/automation/scheduler';
import {
  createAutomation,
  deleteAutomation,
  getAutomationById,
  getAutomationRunById,
  setAutomationStatus,
  updateAutomation,
} from '../core/automation/store';
import type {
  Automation,
  AutomationRunnerRequest,
  AutomationRunnerResult,
} from '../core/automation/types';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('automation execution authority', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00Z'));
    vi.stubGlobal('chrome', createChromeStub().chromeStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts at the deadline but retains the lease until the executor actually settles', async () => {
    const automation = await createTestAutomation();
    const started = deferred<void>();
    const finished = deferred<AutomationRunnerResult>();
    let observedSignal: AbortSignal | undefined;
    const executor = vi.fn(async (request, execution) => {
      observedSignal = execution.signal;
      started.resolve();
      return finished.promise;
    });

    const pendingRun = runAutomation({
      automationId: automation.id,
      trigger: 'manual',
      scheduledFor: null,
      timeoutMs: 100,
      executor,
    });
    await started.promise;

    await vi.advanceTimersByTimeAsync(100);
    expect(observedSignal?.aborted).toBe(true);
    expect(hasActiveAutomationRun(automation.id)).toBe(true);
    expect(await runAutomation({
      automationId: automation.id,
      trigger: 'manual',
      scheduledFor: null,
      timeoutMs: 100,
      executor,
    })).toBeNull();

    finished.resolve(successResult(executor.mock.calls[0][0], Date.now()));
    const completed = await pendingRun;

    expect(completed?.status).toBe('timeout');
    expect(completed?.error?.code).toBe('automation_run_timeout');
    expect(hasActiveAutomationRun(automation.id)).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
    expect((await getAutomationById(automation.id))?.deepseek.chatSessionId).toBeNull();
  });

  it('does not let a concurrent alarm reconcile a timed-out executor before it settles', async () => {
    const automation = await createTestAutomation();
    const started = deferred<void>();
    const finished = deferred<AutomationRunnerResult>();
    let runId = '';
    const executor = vi.fn(async (request) => {
      runId = request.runId;
      started.resolve();
      return finished.promise;
    });
    const pendingRun = runAutomation({
      automationId: automation.id,
      trigger: 'manual',
      scheduledFor: null,
      timeoutMs: 100,
      executor,
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(100);

    await scanDueAutomations(executor, Date.now());

    expect((await getAutomationRunById(runId))?.status).toBe('running');
    expect(hasActiveAutomationRun(automation.id)).toBe(true);
    finished.resolve(successResult(executor.mock.calls[0][0], Date.now()));
    expect((await pendingRun)?.status).toBe('timeout');
    expect((await getAutomationRunById(runId))?.status).toBe('timeout');
  });

  it('keeps the logical idempotency key stable across an explicitly safe retry', async () => {
    const automation = await createTestAutomation();
    const keys: string[] = [];
    const executor = vi.fn(async (request, execution): Promise<AutomationRunnerResult> => {
      keys.push(execution.createIdempotencyKey('prompt:initial'));
      if (execution.attempt === 1) {
        return failureResult(request, 'preflight_unavailable', true, {
          externalOutcome: 'not_started',
          retrySafe: true,
        });
      }
      return successResult(request, Date.now());
    });

    const pendingRun = runAutomation({
      automationId: automation.id,
      trigger: 'manual',
      scheduledFor: null,
      timeoutMs: 30_000,
      executor,
    });
    await vi.advanceTimersByTimeAsync(AUTOMATION_RETRY_DELAY_MS);
    const completed = await pendingRun;

    expect(completed?.status).toBe('succeeded');
    expect(completed?.attempt).toBe(2);
    expect(completed?.trigger).toBe('retry');
    expect(executor).toHaveBeenCalledTimes(2);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('does not replay an ambiguous external failure even when its provider marks it retryable', async () => {
    const automation = await createTestAutomation();
    const executor = vi.fn(async (request): Promise<AutomationRunnerResult> => failureResult(
      request,
      'completion_response_lost',
      true,
      { externalOutcome: 'ambiguous', retrySafe: false },
    ));

    const completed = await runAutomation({
      automationId: automation.id,
      trigger: 'manual',
      scheduledFor: null,
      timeoutMs: 30_000,
      executor,
    });

    expect(completed?.status).toBe('failed');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing', undefined],
    ['confirmed', 'confirmed'],
    ['unknown', 'future-outcome'],
  ])('does not retry a retrySafe result with %s external outcome', async (_label, externalOutcome) => {
    const automation = await createTestAutomation();
    const details: Record<string, unknown> = { retrySafe: true };
    if (externalOutcome !== undefined) details.externalOutcome = externalOutcome;
    const executor = vi.fn(async (request): Promise<AutomationRunnerResult> => failureResult(
      request,
      'unsafe_retry_classification',
      true,
      details,
    ));

    const completed = await runAutomation({
      automationId: automation.id,
      trigger: 'manual',
      scheduledFor: null,
      timeoutMs: 30_000,
      executor,
    });

    expect(completed?.status).toBe('failed');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('uses one stable scheduled occurrence identity and never executes it twice', async () => {
    const automation = await createTestAutomation();
    const scheduledFor = Date.now();
    const executor = vi.fn(async (request): Promise<AutomationRunnerResult> =>
      successResult(request, Date.now()));

    const first = await runAutomation({
      automationId: automation.id,
      trigger: 'schedule',
      scheduledFor,
      executor,
    });
    const duplicate = await runAutomation({
      automationId: automation.id,
      trigger: 'schedule',
      scheduledFor,
      executor,
    });

    expect(first?.id).toBe(`schedule:${automation.id}:${scheduledFor}`);
    expect(duplicate?.id).toBe(first?.id);
    expect(executor).toHaveBeenCalledTimes(1);
    expect((await getAutomationRunById(first!.id))?.status).toBe('succeeded');
  });

  it('supports internal cancellation without releasing authority before settlement', async () => {
    const automation = await createTestAutomation();
    const started = deferred<void>();
    const finished = deferred<AutomationRunnerResult>();
    const executor = vi.fn(async (request, execution) => {
      started.resolve();
      await finished.promise;
      execution.assertActive();
      return successResult(request, Date.now());
    });

    const pendingRun = runAutomation({
      automationId: automation.id,
      trigger: 'manual',
      scheduledFor: null,
      executor,
    });
    await started.promise;
    expect(cancelActiveAutomationRun(automation.id)).toBe(true);
    expect(hasActiveAutomationRun(automation.id)).toBe(true);

    finished.resolve(successResult(executor.mock.calls[0][0], Date.now()));
    const completed = await pendingRun;

    expect(completed?.status).toBe('cancelled');
    expect(completed?.error?.code).toBe('automation_run_cancelled');
    expect(hasActiveAutomationRun(automation.id)).toBe(false);
  });

  it('keeps edit and pause changes scoped to future runs while the claimed request stays immutable', async () => {
    const automation = await createScheduledAutomation();
    const started = deferred<void>();
    const finished = deferred<void>();
    const claimedRequests: AutomationRunnerRequest[] = [];
    const executor = vi.fn(async (request): Promise<AutomationRunnerResult> => {
      claimedRequests.push(request);
      started.resolve();
      await finished.promise;
      return successResult(request, Date.now());
    });

    const pendingRun = runAutomation({
      automationId: automation.id,
      trigger: 'schedule',
      scheduledFor: Date.now(),
      executor,
    });
    await started.promise;
    await updateAutomation(automation.id, { prompt: 'Use this only next time.' });
    await setAutomationStatus(automation.id, 'paused');

    expect(hasActiveAutomationRun(automation.id)).toBe(true);
    expect(claimedRequests[0]?.prompt).toBe('Run once.');
    finished.resolve();
    await pendingRun;

    expect(await getAutomationById(automation.id)).toMatchObject({
      prompt: 'Use this only next time.',
      status: 'paused',
      nextRunAt: null,
    });
  });

  it('does not recreate deleted automation state when the cancelled executor settles late', async () => {
    const automation = await createTestAutomation();
    const started = deferred<void>();
    const finished = deferred<void>();
    const executor = vi.fn(async (request): Promise<AutomationRunnerResult> => {
      started.resolve();
      await finished.promise;
      return successResult(request, Date.now());
    });

    const pendingRun = runAutomation({
      automationId: automation.id,
      trigger: 'manual',
      scheduledFor: null,
      executor,
    });
    await started.promise;
    expect(cancelActiveAutomationRun(automation.id)).toBe(true);
    await deleteAutomation(automation.id);
    expect(hasActiveAutomationRun(automation.id)).toBe(true);

    finished.resolve();
    const completed = await pendingRun;

    expect(completed?.status).toBe('cancelled');
    expect(await getAutomationById(automation.id)).toBeNull();
    expect(await getAutomationRunById(completed!.id)).toBeNull();
    expect(hasActiveAutomationRun(automation.id)).toBe(false);
  });
});

async function createTestAutomation(): Promise<Automation> {
  return createAutomation({
    name: 'Automation',
    prompt: 'Run once.',
    schedule: {
      kind: 'manual',
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
  });
}

async function createScheduledAutomation(): Promise<Automation> {
  return createAutomation({
    name: 'Scheduled automation',
    prompt: 'Run once.',
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

function successResult(
  request: AutomationRunnerRequest,
  completedAt: number,
): AutomationRunnerResult {
  return {
    ok: true,
    chatSessionId: 'chat-1',
    sessionUrl: 'https://chat.deepseek.com/a/chat/s/chat-1',
    parentMessageId: 1,
    assistantMessageId: 1,
    assistantText: 'done',
    history: null,
    completedAt,
  };
}

function failureResult(
  request: AutomationRunnerRequest,
  code: string,
  retryable: boolean,
  details: Record<string, unknown>,
): AutomationRunnerResult {
  return {
    ok: false,
    chatSessionId: request.chatSessionId,
    parentMessageId: request.parentMessageId,
    completedAt: Date.now(),
    error: {
      code,
      message: code,
      phase: 'runner',
      retryable,
      at: Date.now(),
      details,
    },
  };
}
