import { describe, expect, it, vi } from 'vitest';
import type { RuntimeMessageContext } from '../core/messaging/runtime-boundary';
import {
  TYPED_RUNTIME_COMMAND_TYPES,
  createRuntimeCommandRegistry,
  type RuntimeCommandHandler,
} from '../core/messaging/runtime-command-registry';
import type {
  LocalStateMutationStage,
} from '../core/persistence/local-state-mutation';
import {
  createSyncLocalApplyCoordinator,
  type SyncLocalApplyJournalPort,
  type SyncLocalStatePort,
  type SyncUndoPreimageV1,
} from '../core/sync/local-apply';
import { createSyncRecoveryBarrier } from '../core/sync/recovery-barrier';
import {
  createTrackedLocalStateMutationRunner,
} from '../entrypoints/background/local-state-mutation-runner';
import {
  createPersistenceMutationBindings,
} from '../entrypoints/background/persistence-mutation-bindings';
import {
  createProjectRuntimeHandlers,
  type ProjectRuntimeHandlerDependencies,
} from '../entrypoints/background/project-handlers';

const context: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'extension_context',
  senderUrl: 'chrome-extension://extension-id/sidepanel.html',
  senderOrigin: 'chrome-extension://extension-id',
  tabId: 17,
  documentSessionId: 'document-1',
};

describe('background persistence recovery composition', () => {
  it('recovers a failed typed project deletion from its durable journal after restart', async () => {
    const state = createProjectDeletionState();
    const firstCoordinator = createSyncLocalApplyCoordinator(state.port, state.journal, {
      now: () => 10,
      createOperationId: () => 'delete-project-first',
    });
    const firstBarrier = createSyncRecoveryBarrier({
      recover: firstCoordinator.recover,
      notifyReady: async () => undefined,
    });
    const firstRunner = createTrackedLocalStateMutationRunner({
      runWithRecovery: createRunWithRecovery(firstCoordinator),
      trackApply: (operation) => firstBarrier.trackApply(operation),
    });
    const firstNotifications: string[] = [];
    const firstRegistry = createProjectDeletionRegistry(
      createProjectDeletionDependencies(state, firstRunner, firstNotifications),
    );

    await expect(firstRegistry.dispatch({
      type: 'DELETE_PROJECT_CONTEXT',
      payload: { projectId: 'project-1' },
    }, context)).rejects.toThrow('Local-state mutation failed and recovery remains pending');
    await expect(firstBarrier.ensureReady()).rejects.toThrow('journal clear blocked');

    expect(state.projectPresent).toBe(true);
    expect(state.currentJournal).not.toBeNull();
    expect(firstNotifications).toEqual([]);

    state.clearBlocked = false;
    state.failMutation = false;
    const restartCoordinator = createSyncLocalApplyCoordinator(state.port, state.journal, {
      now: () => 20,
      createOperationId: () => 'delete-project-restart',
    });
    const restartEvents: string[] = [];
    const restartBarrier = createSyncRecoveryBarrier({
      recover: restartCoordinator.recover,
      notifyReady: async (result) => {
        restartEvents.push(result.recovered ? 'recovered' : 'ready');
      },
    });
    const restartRunner = createTrackedLocalStateMutationRunner({
      runWithRecovery: createRunWithRecovery(restartCoordinator),
      trackApply: (operation) => restartBarrier.trackApply(operation),
    });
    const restartRegistry = createProjectDeletionRegistry(
      createProjectDeletionDependencies(state, restartRunner, restartEvents),
    );

    await restartBarrier.ensureReady();
    expect(state.projectPresent).toBe(true);
    expect(state.currentJournal).toBeNull();
    expect(restartEvents).toEqual(['recovered']);

    await expect(restartRegistry.dispatch({
      type: 'DELETE_PROJECT_CONTEXT',
      payload: { projectId: 'project-1' },
    }, context)).resolves.toEqual({ ok: true, deletedMemories: 2 });

    expect(state.projectPresent).toBe(false);
    expect(state.currentJournal).toBeNull();
    expect(restartEvents).toEqual(['recovered', 'project-notify', 'state-notify']);
  });
});

function createProjectDeletionRegistry(
  dependencies: ProjectRuntimeHandlerDependencies,
) {
  const projectHandler = createProjectRuntimeHandlers(dependencies)
    .find((handler) => handler.type === 'DELETE_PROJECT_CONTEXT');
  if (!projectHandler) throw new Error('DELETE_PROJECT_CONTEXT handler is missing');

  const typedHandlers = TYPED_RUNTIME_COMMAND_TYPES.map((type) => (
    type === 'DELETE_PROJECT_CONTEXT'
      ? projectHandler
      : {
          type,
          handle: async () => null,
        } as RuntimeCommandHandler
  ));
  return createRuntimeCommandRegistry({
    typedHandlers,
  });
}

function createProjectDeletionDependencies(
  state: ProjectDeletionState,
  runLocalStateMutation: <T>(stage: LocalStateMutationStage<T>) => Promise<T>,
  notifications: string[],
): ProjectRuntimeHandlerDependencies {
  const mutations = createPersistenceMutationBindings({
    runLocalStateMutation,
    stageDeleteProjectContextAndMemoriesAlreadyLocked: async (projectId) => {
      expect(projectId).toBe('project-1');
      return async () => {
        state.projectPresent = false;
        if (state.failMutation) throw new Error('project delete write failed');
        return 2;
      };
    },
    stageDeleteSkillAlreadyLocked: unusedMutationStage,
    stageDeleteSkillSourceAlreadyLocked: unusedMutationStage,
    stageDeletePresetAlreadyLocked: unusedMutationStage,
    importGitHubSkillSource: async () => unusedDependency(),
    importLocalSkillSource: async () => unusedDependency(),
    updateGitHubSkillSource: async () => unusedDependency(),
    executeLocalSkillImporterToolCall: async () => unusedDependency(),
  });

  return {
    getProjectContextState: async () => unusedDependency(),
    createProjectContext: async () => unusedDependency(),
    updateProjectContext: async () => unusedDependency(),
    deleteProjectContext: mutations.deleteProjectContext,
    addConversationToProject: async () => unusedDependency(),
    removeConversationFromProject: async () => unusedDependency(),
    setPendingProjectContext: async () => unusedDependency(),
    getCurrentDeepSeekConversation: async () => unusedDependency(),
    bindPendingProjectConversation: async () => unusedDependency(),
    refreshProjectConversation: async () => unusedDependency(),
    getProjectForConversation: async () => unusedDependency(),
    getProjectPromptContextForConversation: async () => unusedDependency(),
    formatProjectPromptContext: () => unusedDependency(),
    getArtifact: async () => unusedDependency(),
    notifyCommittedProjectContextUpdate: vi.fn(async () => {
      notifications.push('project-notify');
    }),
    notifyCommittedStateUpdate: vi.fn(async () => {
      notifications.push('state-notify');
    }),
  };
}

function createRunWithRecovery(
  coordinator: ReturnType<typeof createSyncLocalApplyCoordinator>,
) {
  return async <T>(stage: LocalStateMutationStage<T>): Promise<T> => {
    await coordinator.recover();
    const operation = await stage();
    try {
      return await coordinator.runMutation(operation);
    } catch (applyError) {
      try {
        await coordinator.recover();
      } catch (recoveryError) {
        throw new AggregateError(
          [applyError, recoveryError],
          'Local-state mutation failed and recovery remains pending',
        );
      }
      throw applyError;
    }
  };
}

interface ProjectDeletionState {
  projectPresent: boolean;
  failMutation: boolean;
  clearBlocked: boolean;
  currentJournal: unknown | null;
  port: SyncLocalStatePort;
  journal: SyncLocalApplyJournalPort;
}

function createProjectDeletionState(): ProjectDeletionState {
  const state = {
    projectPresent: true,
    failMutation: true,
    clearBlocked: true,
    currentJournal: null as unknown | null,
  };
  const result: ProjectDeletionState = {
    ...state,
    port: {
      captureUndoPreimage: async () => createUndoPreimage(result.projectPresent),
      stage: () => unusedDependency(),
      applyStep: async () => unusedDependency(),
      restoreStep: async (step, before) => {
        if (step !== 'projectContext') return;
        const value = before.storage.projectContext.value as { projectPresent?: unknown };
        result.projectPresent = value.projectPresent === true;
      },
    },
    journal: {
      readCurrent: async () => result.currentJournal,
      writeCurrent: async (record) => {
        result.currentJournal = record;
      },
      clearCurrent: async () => {
        if (result.clearBlocked) throw new Error('journal clear blocked');
        result.currentJournal = null;
      },
    },
  };
  return result;
}

function createUndoPreimage(projectPresent: boolean): SyncUndoPreimageV1 {
  return {
    memoryRecords: [],
    storage: {
      skills: { present: false },
      skillSources: { present: false },
      presets: { present: false },
      activePreset: { present: false },
      projectContext: { present: true, value: { projectPresent } },
      savedItems: { present: false },
    },
  };
}

async function unusedMutationStage(): Promise<() => Promise<void>> {
  return async () => unusedDependency();
}

function unusedDependency(): never {
  throw new Error('Unexpected test dependency call');
}
