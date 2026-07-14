import { indexedDbSyncLocalApplyJournal } from './apply-journal';
import { createSyncLocalApplyCoordinator } from './local-apply';
import { browserSyncLocalStatePort } from './local-state-browser';
import {
  clearRequiredLocalStateRecovery,
  recoverRequiredLocalStateAlreadyLocked,
  requireLocalStateRecovery,
  withSyncLocalStateLock,
  withSyncLocalStateRecoveryLock,
} from '../persistence/local-state-lock';
import type { SyncDataSnapshot } from './snapshot';

const coordinator = createSyncLocalApplyCoordinator(
  browserSyncLocalStatePort,
  indexedDbSyncLocalApplyJournal,
);

async function recoverCoordinatorAlreadyLocked(): Promise<void> {
  await coordinator.recover();
}

export function stageAndApplySyncSnapshotLocally(
  stage: () => Promise<SyncDataSnapshot>,
): Promise<SyncDataSnapshot> {
  return withSyncLocalStateLock(async () => {
    const snapshot = await stage();
    await runCoordinatorOperation(() => coordinator.apply(snapshot));
    return snapshot;
  });
}

export function runLocalStateMutationWithRecovery<T>(
  stage: () => Promise<() => Promise<T>>,
): Promise<T> {
  return withSyncLocalStateLock(async () => {
    await coordinator.recover();
    const operation = await stage();
    return runCoordinatorOperation(() => coordinator.runMutation(operation));
  });
}

export function recoverPendingSyncLocalApply() {
  return withSyncLocalStateRecoveryLock(async () => {
    try {
      const result = await coordinator.recover();
      clearRequiredLocalStateRecovery(recoverCoordinatorAlreadyLocked);
      return result;
    } catch (error) {
      requireLocalStateRecovery(recoverCoordinatorAlreadyLocked);
      throw error;
    }
  });
}

async function runCoordinatorOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (applyError) {
    requireLocalStateRecovery(recoverCoordinatorAlreadyLocked);
    try {
      await recoverRequiredLocalStateAlreadyLocked();
    } catch (recoveryError) {
      throw new AggregateError(
        [applyError, recoveryError],
        'Local-state mutation failed and required recovery remains pending',
      );
    }
    throw applyError;
  }
}
