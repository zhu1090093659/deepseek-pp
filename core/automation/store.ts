import type {
  Automation,
  AutomationCreateInput,
  AutomationId,
  AutomationRun,
  AutomationRunCreateInput,
  AutomationRunId,
  AutomationRunListOptions,
  AutomationRunUpdateInput,
  AutomationRuntimeUpdate,
  AutomationStatus,
  AutomationUpdateInput,
} from './types';

const STORAGE_KEY = 'deepseek_pp_automations';
const STORAGE_VERSION = 1;
const DEFAULT_RUN_HISTORY_LIMIT = 100;

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

export async function getAllAutomations(): Promise<Automation[]> {
  const state = await readState();
  return [...state.automations].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAutomationById(id: AutomationId): Promise<Automation | null> {
  const state = await readState();
  return state.automations.find((automation) => automation.id === id) ?? null;
}

export async function createAutomation(input: AutomationCreateInput): Promise<Automation> {
  const state = await readState();
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

  await writeState({
    ...state,
    automations: [automation, ...state.automations],
  });
  return automation;
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
  const state = await readState();
  await writeState({
    ...state,
    automations: state.automations.filter((automation) => automation.id !== id),
    runs: state.runs.filter((run) => run.automationId !== id),
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

export async function appendAutomationRun(run: AutomationRun): Promise<void> {
  const state = await readState();
  const runs = [run, ...state.runs.filter((stored) => stored.id !== run.id)];
  await writeState({
    ...state,
    runs: pruneRunHistory(runs),
  });
}

export async function updateAutomationRun(
  id: AutomationRunId,
  patch: AutomationRunUpdateInput,
): Promise<AutomationRun | null> {
  const state = await readState();
  let updatedRun: AutomationRun | null = null;
  const runs = state.runs.map((run) => {
    if (run.id !== id) return run;
    updatedRun = {
      ...run,
      ...patch,
      updatedAt: Date.now(),
    };
    return updatedRun;
  });

  if (!updatedRun) return null;
  await writeState({ ...state, runs });
  return updatedRun;
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
 * Marks `running` automation runs whose `startedAt` predates `thresholdMs` as
 * failed. This recovers from a service-worker termination mid-run, which would
 * otherwise leave orphaned `running` rows that never complete and would let the
 * next scan re-run the same automation. Returns the count of runs reconciled.
 *
 * Safe to call repeatedly — only stale `running` rows are touched.
 */
export async function reconcileStaleRuns(
  thresholdMs: number,
  now: number = Date.now(),
): Promise<number> {
  const state = await readState();
  let reconciled = 0;
  let changed = false;
  const runs = state.runs.map((run) => {
    if (run.status !== 'running' || run.startedAt == null) return run;
    if (now - run.startedAt < thresholdMs) return run;

    changed = true;
    reconciled += 1;
    const completedAt = run.startedAt + thresholdMs;
    return {
      ...run,
      status: 'failed' as const,
      completedAt,
      error: {
        code: 'automation_run_interrupted',
        message: 'Service worker was terminated while the run was in progress.',
        phase: 'runner' as const,
        retryable: true,
        at: now,
        details: { startedAt: run.startedAt, completedAt },
      },
      updatedAt: now,
    };
  });

  if (changed) {
    await writeState({ ...state, runs });
  }
  return reconciled;
}

async function patchAutomation(
  id: AutomationId,
  patch: AutomationUpdateInput | AutomationRuntimeUpdate,
): Promise<Automation | null> {
  const state = await readState();
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

  if (!updatedAutomation) return null;
  await writeState({ ...state, automations });
  return updatedAutomation;
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
        parentMessageId: normalizeStoredMessageId(run.request.parentMessageId),
      }
      : null,
    result: normalizeRunResult(run.result),
  };
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
