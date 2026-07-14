import type {
  Automation,
  AutomationCreateInput,
  AutomationId,
  AutomationRun,
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
import {
  AUTOMATION_STORAGE_KEY,
  decodeAutomationStorageState,
  encodeAutomationStorageState,
  type AutomationStorageState,
} from './storage-codec';
import { createSerialOperationQueue } from '../persistence/serial-operation-queue';

const DEFAULT_RUN_HISTORY_LIMIT = 100;

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

const automationOperations = createSerialOperationQueue();

export async function getAllAutomations(): Promise<Automation[]> {
  return automationOperations.run(async () => {
    const state = await readStateAlreadyOwned();
    return [...state.automations].sort((a, b) => b.updatedAt - a.updatedAt);
  });
}

export async function getAutomationById(id: AutomationId): Promise<Automation | null> {
  return automationOperations.run(async () => {
    const state = await readStateAlreadyOwned();
    return state.automations.find((automation) => automation.id === id) ?? null;
  });
}

export async function createAutomation(input: AutomationCreateInput): Promise<Automation> {
  return mutateState((state) => {
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
  return automationOperations.run(async () => {
    const state = await readStateAlreadyOwned();
    const limit = options.limit ?? DEFAULT_RUN_HISTORY_LIMIT;
    return state.runs
      .filter((run) => run.automationId === options.automationId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  });
}

export async function getAutomationRunById(id: AutomationRunId): Promise<AutomationRun | null> {
  return automationOperations.run(async () => {
    const state = await readStateAlreadyOwned();
    return state.runs.find((run) => run.id === id) ?? null;
  });
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

async function readStateAlreadyOwned(): Promise<AutomationStorageState> {
  const data = await chrome.storage.local.get(AUTOMATION_STORAGE_KEY) as Record<string, unknown>;
  return decodeAutomationStorageState(data[AUTOMATION_STORAGE_KEY]);
}

async function writeState(state: AutomationStorageState): Promise<void> {
  await chrome.storage.local.set({
    [AUTOMATION_STORAGE_KEY]: encodeAutomationStorageState(state),
  });
}

async function mutateState<TResult>(
  mutation: (state: AutomationStorageState) => {
    nextState: AutomationStorageState;
    result: TResult;
    changed: boolean;
  },
): Promise<TResult> {
  return automationOperations.run(async () => {
    const state = await readStateAlreadyOwned();
    const outcome = mutation(state);
    if (outcome.changed) await writeState(outcome.nextState);
    return outcome.result;
  });
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
