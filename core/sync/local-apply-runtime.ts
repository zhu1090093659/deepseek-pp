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
    try {
      await coordinator.apply(snapshot);
    } catch (applyError) {
      requireLocalStateRecovery(recoverCoordinatorAlreadyLocked);
      try {
        await recoverRequiredLocalStateAlreadyLocked();
      } catch (recoveryError) {
        throw new AggregateError(
          [applyError, recoveryError],
          'Sync local apply failed and required recovery remains pending',
        );
      }
      throw applyError;
    }
    return snapshot;
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
