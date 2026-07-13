import type {
  Automation,
  AutomationCreateInput,
  AutomationId,
  AutomationRun,
  AutomationRunCreateInput,
  AutomationRunId,
  AutomationRunListOptions,
  AutomationRunnerRequest,
  AutomationRunnerResult,
  AutomationRunStatus,
  AutomationRunUpdateInput,
  AutomationRuntimeUpdate,
  AutomationStatus,
  AutomationUpdateInput,
} from './types';

const STORAGE_KEY = 'deepseek_pp_automations';
const STORAGE_VERSION = 1;
const DEFAULT_RUN_HISTORY_LIMIT = 100;
const LEGACY_AUTOMATION_RUN_TIMEOUT_MS = 180_000;

interface AutomationStorageState {
  version: number;
  automations: Automation[];
  runs: AutomationRun[];
}

const EMPTY_STATE: AutomationStorageState = {
  version: STORAGE_VERSION,
  automations: [],
  runs: [],
};

export type AutomationRunClaimResult =
  | { kind: 'claimed'; automation: Automation; run: AutomationRun }
  | { kind: 'automation_missing'; run: null }
  | { kind: 'active_run'; automation: Automation; run: AutomationRun }
  | { kind: 'occurrence_exists'; automation: Automation; run: AutomationRun };

interface ClaimAutomationRunInput {
  runId: AutomationRunId;
  automationId: AutomationId;
  trigger: AutomationRun['trigger'];
  scheduledFor: number | null;
  startedAt: number;
  createRequest: (automation: Automation) => AutomationRunnerRequest;
}

interface FinalizeAutomationRunInput {
  runId: AutomationRunId;
  automationId: AutomationId;
  status: AutomationRunStatus;
  result: AutomationRunnerResult;
  runtimePatch: (automation: Automation) => AutomationRuntimeUpdate;
}

interface ReconcileStaleRunsOptions {
  protectedRunIds?: ReadonlySet<AutomationRunId>;
  runtimePatch?: (automation: Automation, run: AutomationRun) => AutomationRuntimeUpdate;
}

let stateMutation = Promise.resolve();

export async function getAllAutomations(): Promise<Automation[]> {
  const state = await readState();
  return [...state.automations].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAutomationById(id: AutomationId): Promise<Automation | null> {
  const state = await readState();
  return state.automations.find((automation) => automation.id === id) ?? null;
}

export async function createAutomation(input: AutomationCreateInput): Promise<Automation> {
  const now = Date.now();
  const automation: Automation = {
    ...input,
    id: crypto.randomUUID(),
    status: 'active',
    deepseek: {
      chatSessionId: null,
      parentMessageId: null,
      sessionUrl: null,
      lastHistorySyncedAt: null,
    },
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    version: 1,
  };

  return mutateState((state) => {
    return {
      nextState: {
        ...state,
        automations: [automation, ...state.automations],
      },
      result: automation,
      changed: true,
    };
  });
}

export async function updateAutomation(
  id: AutomationId,
  patch: AutomationUpdateInput,
): Promise<Automation | null> {
  return patchAutomation(id, patch);
}

export async function updateAutomationRuntime(
  id: AutomationId,
  patch: AutomationRuntimeUpdate,
): Promise<Automation | null> {
  return patchAutomation(id, patch);
}

export async function setAutomationStatus(
  id: AutomationId,
  status: AutomationStatus,
): Promise<Automation | null> {
  return patchAutomation(id, { status });
}

export async function deleteAutomation(id: AutomationId): Promise<void> {
  await mutateState((state) => {
    const nextAutomations = state.automations.filter((automation) => automation.id !== id);
    const nextRuns = state.runs.filter((run) => run.automationId !== id);
    return {
      nextState: { ...state, automations: nextAutomations, runs: nextRuns },
      result: undefined,
      changed: nextAutomations.length !== state.automations.length || nextRuns.length !== state.runs.length,
    };
  });
}

export async function createAutomationRun(input: AutomationRunCreateInput): Promise<AutomationRun> {
  const now = Date.now();
  const run: AutomationRun = {
    id: input.id ?? crypto.randomUUID(),
    automationId: input.automationId,
    trigger: input.trigger,
    status: 'queued',
    scheduledFor: input.scheduledFor,
    attempt: input.attempt ?? 1,
    request: input.request,
    result: null,
    error: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  };

  await appendAutomationRun(run);
  return run;
}

export async function claimAutomationRun(
  input: ClaimAutomationRunInput,
): Promise<AutomationRunClaimResult> {
  return mutateState<AutomationRunClaimResult>((state) => {
    const automation = state.automations.find((item) => item.id === input.automationId);
    if (!automation) {
      return { nextState: state, result: { kind: 'automation_missing', run: null }, changed: false };
    }

    const activeRun = state.runs.find((run) =>
      run.automationId === input.automationId &&
      (run.status === 'queued' || run.status === 'running')
    );
    if (activeRun) {
      return {
        nextState: state,
        result: { kind: 'active_run', automation, run: activeRun },
        changed: false,
      };
    }

    if (input.trigger === 'schedule' && input.scheduledFor !== null) {
      const existingOccurrence = state.runs.find((run) =>
        run.automationId === input.automationId &&
        run.scheduledFor === input.scheduledFor
      );
      if (existingOccurrence) {
        return {
          nextState: state,
          result: { kind: 'occurrence_exists', automation, run: existingOccurrence },
          changed: false,
        };
      }
    }

    const request = input.createRequest(automation);
    const run: AutomationRun = {
      id: input.runId,
      automationId: automation.id,
      trigger: input.trigger,
      status: 'running',
      scheduledFor: input.scheduledFor,
      attempt: 1,
      request,
      result: null,
      error: null,
      createdAt: input.startedAt,
      startedAt: input.startedAt,
      completedAt: null,
      updatedAt: input.startedAt,
    };
    return {
      nextState: {
        ...state,
        runs: pruneRunHistory([run, ...state.runs]),
      },
      result: { kind: 'claimed', automation, run },
      changed: true,
    };
  });
}

export async function finalizeAutomationRun(
  input: FinalizeAutomationRunInput,
): Promise<AutomationRun | null> {
  return mutateState((state) => {
    const runIndex = state.runs.findIndex((run) =>
      run.id === input.runId &&
      run.automationId === input.automationId &&
      run.status === 'running'
    );
    if (runIndex === -1) {
      return { nextState: state, result: null, changed: false };
    }

    const automationIndex = state.automations.findIndex((automation) => automation.id === input.automationId);
    if (automationIndex === -1) {
      return { nextState: state, result: null, changed: false };
    }

    const now = Date.now();
    const runs = [...state.runs];
    const updatedRun: AutomationRun = {
      ...runs[runIndex],
      status: input.status,
      result: input.result,
      error: input.result.ok ? null : input.result.error,
      completedAt: input.result.completedAt,
      updatedAt: now,
    };
    runs[runIndex] = updatedRun;

    const automations = [...state.automations];
    const currentAutomation = automations[automationIndex];
    automations[automationIndex] = {
      ...currentAutomation,
      ...input.runtimePatch(currentAutomation),
      updatedAt: now,
    };
    return {
      nextState: { ...state, automations, runs },
      result: updatedRun,
      changed: true,
    };
  });
}

export async function appendAutomationRun(run: AutomationRun): Promise<void> {
  await mutateState((state) => {
    const runs = [run, ...state.runs.filter((stored) => stored.id !== run.id)];
    return {
      nextState: { ...state, runs: pruneRunHistory(runs) },
      result: undefined,
      changed: true,
    };
  });
}

export async function updateAutomationRun(
  id: AutomationRunId,
  patch: AutomationRunUpdateInput,
  options?: { expectedStatus?: AutomationRunStatus },
): Promise<AutomationRun | null> {
  return mutateState((state) => {
    let updatedRun: AutomationRun | null = null;
    const runs = state.runs.map((run) => {
      if (run.id !== id) return run;
      if (options?.expectedStatus !== undefined && run.status !== options.expectedStatus) return run;
      updatedRun = {
        ...run,
        ...patch,
        updatedAt: Date.now(),
      };
      return updatedRun;
    });
    return {
      nextState: { ...state, runs },
      result: updatedRun,
      changed: updatedRun !== null,
    };
  });
}

export async function getAutomationRuns(
  options: AutomationRunListOptions,
): Promise<AutomationRun[]> {
  const state = await readState();
  const limit = options.limit ?? DEFAULT_RUN_HISTORY_LIMIT;
  return state.runs
    .filter((run) => run.automationId === options.automationId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function getAutomationRunById(id: AutomationRunId): Promise<AutomationRun | null> {
  const state = await readState();
  return state.runs.find((run) => run.id === id) ?? null;
}

/**
 * Marks stale `queued` or `running` automation runs as failed. This recovers
 * service-worker termination without replaying an occurrence. Callers that
 * still own in-process execution must protect those run IDs until settlement.
 *
 * Safe to call repeatedly — only stale `running` rows are touched.
 */
export async function reconcileStaleRuns(
  thresholdMs: number,
  now: number = Date.now(),
): Promise<number> {
  return (await reconcileStaleRunsDetailed(thresholdMs, now)).length;
}

export async function reconcileStaleRunsDetailed(
  thresholdMs: number,
  now: number = Date.now(),
  options: ReconcileStaleRunsOptions = {},
): Promise<AutomationRun[]> {
  return mutateState((state) => {
    const reconciled: AutomationRun[] = [];
    const runs = state.runs.map((run) => {
      if (run.status !== 'queued' && run.status !== 'running') return run;
      if (options.protectedRunIds?.has(run.id)) return run;
      const executionStartedAt = run.startedAt ?? run.createdAt;
      const deadlineAt = run.request?.deadlineAt ?? executionStartedAt + thresholdMs;
      if (now < deadlineAt) return run;

      const completedAt = deadlineAt;
      const error: AutomationRun['error'] = {
        code: 'automation_run_interrupted',
        message: 'Service worker was terminated before the automation outcome was confirmed.',
        phase: 'runner',
        retryable: false,
        at: now,
        details: {
          startedAt: executionStartedAt,
          completedAt,
          externalOutcome: 'ambiguous',
          retrySafe: false,
        },
      };
      const updated: AutomationRun = {
        ...run,
        status: 'failed' as const,
        completedAt,
        result: {
          ok: false,
          chatSessionId: run.request?.chatSessionId ?? null,
          parentMessageId: run.request?.parentMessageId ?? null,
          completedAt,
          error,
        },
        error,
        updatedAt: now,
      };
      reconciled.push(updated);
      return updated;
    });
    const automations = options.runtimePatch && reconciled.length > 0
      ? applyReconciledRuntimePatches(state.automations, reconciled, options.runtimePatch, now)
      : state.automations;
    return {
      nextState: { ...state, automations, runs },
      result: reconciled,
      changed: reconciled.length > 0,
    };
  });
}

function applyReconciledRuntimePatches(
  automations: Automation[],
  runs: AutomationRun[],
  createPatch: (automation: Automation, run: AutomationRun) => AutomationRuntimeUpdate,
  updatedAt: number,
): Automation[] {
  const newestRunByAutomation = new Map<AutomationId, AutomationRun>();
  for (const run of runs) {
    const existing = newestRunByAutomation.get(run.automationId);
    if (!existing || (run.completedAt ?? 0) > (existing.completedAt ?? 0)) {
      newestRunByAutomation.set(run.automationId, run);
    }
  }

  return automations.map((automation) => {
    const run = newestRunByAutomation.get(automation.id);
    if (!run) return automation;
    return {
      ...automation,
      ...createPatch(automation, run),
      updatedAt,
    };
  });
}

async function patchAutomation(
  id: AutomationId,
  patch: AutomationUpdateInput | AutomationRuntimeUpdate,
): Promise<Automation | null> {
  return mutateState((state) => {
    let updatedAutomation: Automation | null = null;
    const automations = state.automations.map((automation) => {
      if (automation.id !== id) return automation;
      updatedAutomation = {
        ...automation,
        ...patch,
        updatedAt: Date.now(),
      };
      return updatedAutomation;
    });
    return {
      nextState: { ...state, automations },
      result: updatedAutomation,
      changed: updatedAutomation !== null,
    };
  });
}

async function readState(): Promise<AutomationStorageState> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  return normalizeState(data[STORAGE_KEY]);
}

async function writeState(state: AutomationStorageState): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      version: STORAGE_VERSION,
      automations: state.automations,
      runs: state.runs,
    },
  });
}

async function mutateState<TResult>(
  mutation: (state: AutomationStorageState) => {
    nextState: AutomationStorageState;
    result: TResult;
    changed: boolean;
  },
): Promise<TResult> {
  const operation = stateMutation.then(async () => {
    const state = await readState();
    const outcome = mutation(state);
    if (outcome.changed) await writeState(outcome.nextState);
    return outcome.result;
  });
  stateMutation = operation.then(() => undefined, () => undefined);
  return operation;
}

function normalizeState(raw: unknown): AutomationStorageState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE };

  const value = raw as Partial<AutomationStorageState>;
  return {
    version: typeof value.version === 'number' ? value.version : STORAGE_VERSION,
    automations: Array.isArray(value.automations)
      ? value.automations.map(normalizeAutomation).filter((item): item is Automation => item !== null)
      : [],
    runs: Array.isArray(value.runs)
      ? value.runs.map(normalizeAutomationRun).filter((item): item is AutomationRun => item !== null)
      : [],
  };
}

function normalizeAutomation(raw: unknown): Automation | null {
  if (!raw || typeof raw !== 'object') return null;

  const automation = raw as Automation;
  const deepseek = automation.deepseek ?? {
    chatSessionId: null,
    parentMessageId: null,
    sessionUrl: null,
    lastHistorySyncedAt: null,
  };

  return {
    ...automation,
    deepseek: {
      ...deepseek,
      parentMessageId: normalizeStoredMessageId(deepseek.parentMessageId),
    },
  };
}

function normalizeAutomationRun(raw: unknown): AutomationRun | null {
  if (!raw || typeof raw !== 'object') return null;

  const run = raw as AutomationRun;
  return {
    ...run,
    request: run.request
      ? {
        ...run.request,
        deadlineAt: normalizeStoredDeadline(
          run.request.deadlineAt,
          run.request.requestedAt,
          run.startedAt ?? run.createdAt,
        ),
        parentMessageId: normalizeStoredMessageId(run.request.parentMessageId),
      }
      : null,
    result: normalizeRunResult(run.result),
  };
}

function normalizeStoredDeadline(value: unknown, requestedAt: unknown, fallbackAt: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const normalizedRequestedAt = typeof requestedAt === 'number' && Number.isFinite(requestedAt)
    ? requestedAt
    : fallbackAt;
  return normalizedRequestedAt + LEGACY_AUTOMATION_RUN_TIMEOUT_MS;
}

function normalizeRunResult(result: AutomationRun['result']): AutomationRun['result'] {
  if (!result) return null;
  if (result.ok) {
    return {
      ...result,
      parentMessageId: normalizeStoredMessageId(result.parentMessageId) ?? 0,
      assistantMessageId: normalizeStoredMessageId(result.assistantMessageId),
      history: result.history
        ? {
          ...result.history,
          parentMessageId: normalizeStoredMessageId(result.history.parentMessageId),
          assistantMessageId: normalizeStoredMessageId(result.history.assistantMessageId),
        }
        : null,
    };
  }

  return {
    ...result,
    parentMessageId: normalizeStoredMessageId(result.parentMessageId),
  };
}

function normalizeStoredMessageId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xFFFFFFFF) return parsed;
  }
  return null;
}

function pruneRunHistory(runs: AutomationRun[]): AutomationRun[] {
  const grouped = new Map<AutomationId, AutomationRun[]>();
  for (const run of runs) {
    const group = grouped.get(run.automationId) ?? [];
    group.push(run);
    grouped.set(run.automationId, group);
  }

  return [...grouped.values()].flatMap((group) =>
    group
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, DEFAULT_RUN_HISTORY_LIMIT),
  );
}
