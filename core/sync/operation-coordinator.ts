import type { SyncCommandTarget, SyncCounts } from '../types';
import { createSerialOperationQueue } from '../persistence/serial-operation-queue';
import {
  SyncConfigCommitIndeterminateError,
  SyncConfigConflictError,
  createSyncCommandTarget,
  type SyncConfigStore,
  type VersionedOAuthSyncConfig,
  type VersionedSyncConfig,
} from './config';

export interface SyncDownloadResult {
  counts: SyncCounts;
  projectContextChanged: boolean;
  savedItemsChanged: boolean;
}

export interface SyncOperationEffects {
  test(config: VersionedSyncConfig): Promise<void>;
  authorize(config: VersionedOAuthSyncConfig): Promise<string>;
  upload(config: VersionedSyncConfig): Promise<SyncCounts>;
  download(config: VersionedSyncConfig): Promise<SyncDownloadResult>;
  authorizationNotRequiredMessage?: () => string;
  now?: () => number;
}

export interface SyncOperationCoordinator {
  getConfig(): Promise<VersionedSyncConfig | null>;
  save(target: SyncCommandTarget): Promise<{ ok: true; revision: number }>;
  test(target: SyncCommandTarget): Promise<{ ok: true; revision: number }>;
  authorize(target: SyncCommandTarget): Promise<{ ok: true; refreshToken: string; revision: number }>;
  upload(target: SyncCommandTarget): Promise<{ ok: true; lastSyncAt: number; counts: SyncCounts; revision: number }>;
  download(
    target: SyncCommandTarget,
    notifyCommitted?: (result: SyncDownloadResult) => Promise<void>,
  ): Promise<{ ok: true; lastSyncAt: number; counts: SyncCounts; revision: number }>;
}

export interface SyncCommandErrorResponse {
  ok: false;
  error: string;
  code:
    | 'sync_config_conflict'
    | 'sync_config_commit_indeterminate'
    | 'sync_operation_effect_completed_config_persist_failed'
    | 'sync_operation_failed_after_config_commit';
  revision?: number;
  lastSyncAt?: number | null;
  reloadConfig?: true;
  effectCompleted?: true;
}

class SyncOperationAfterConfigCommitError extends Error {
  readonly code = 'sync_operation_failed_after_config_commit' as const;

  constructor(
    error: unknown,
    readonly revision: number,
    readonly lastSyncAt: number | null,
    readonly effectCompleted = false,
  ) {
    super(error instanceof Error ? error.message : String(error));
    this.name = 'SyncOperationAfterConfigCommitError';
  }
}

class SyncOperationAfterEffectPersistenceError extends Error {
  readonly code = 'sync_operation_effect_completed_config_persist_failed' as const;

  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error));
    this.name = 'SyncOperationAfterEffectPersistenceError';
  }
}

export function createSyncOperationCoordinator(
  store: SyncConfigStore,
  effects: SyncOperationEffects,
): SyncOperationCoordinator {
  const operations = createSerialOperationQueue();

  const runAfterConfigCommit = async <T>(
    target: SyncCommandTarget,
    operation: (config: VersionedSyncConfig, revision: number) => Promise<T>,
  ): Promise<T> => {
    const stored = await store.replace(target);
    try {
      return await operation(stored.config, stored.revision);
    } catch (error) {
      if (
        error instanceof SyncConfigCommitIndeterminateError
        || error instanceof SyncOperationAfterConfigCommitError
        || error instanceof SyncOperationAfterEffectPersistenceError
      ) throw error;
      throw new SyncOperationAfterConfigCommitError(
        error,
        stored.revision,
        stored.config.lastSyncAt,
      );
    }
  };

  const persistAfterEffect = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      throw new SyncOperationAfterEffectPersistenceError(error);
    }
  };

  const updateLastSyncAfterEffect = (revision: number, lastSyncAt: number) => (
    persistAfterEffect(() => store.updateLastSyncAt(revision, lastSyncAt))
  );

  return Object.freeze({
    getConfig: () => operations.run(async () => (await store.read())?.config ?? null),
    save(target: SyncCommandTarget) {
      const confirmedTarget = snapshotSyncCommandTarget(target);
      return operations.run(async () => {
        const stored = await store.replace(confirmedTarget);
        return { ok: true as const, revision: stored.revision };
      });
    },
    test(target: SyncCommandTarget) {
      const confirmedTarget = snapshotSyncCommandTarget(target);
      return operations.run(() => runAfterConfigCommit(confirmedTarget, async (config, revision) => {
        await effects.test(config);
        return { ok: true as const, revision };
      }));
    },
    authorize(target: SyncCommandTarget) {
      const confirmedTarget = snapshotSyncCommandTarget(target);
      return operations.run(async () => {
        await store.assertExpectedRevision(confirmedTarget.expectedRevision);
        if (confirmedTarget.config.provider === 'webdav') {
          throw new Error(
            effects.authorizationNotRequiredMessage?.()
              ?? 'WebDAV sync does not require OAuth authorization',
          );
        }
        const refreshToken = await effects.authorize(
          confirmedTarget.config as VersionedOAuthSyncConfig,
        );
        const authorizedTarget = createSyncCommandTarget(
          { ...confirmedTarget.config, refreshToken },
          confirmedTarget.expectedRevision,
        );
        const stored = await persistAfterEffect(() => store.replace(authorizedTarget));
        return { ok: true as const, refreshToken, revision: stored.revision };
      });
    },
    upload(target: SyncCommandTarget) {
      const confirmedTarget = snapshotSyncCommandTarget(target);
      return operations.run(() => runAfterConfigCommit(confirmedTarget, async (config, revision) => {
        const counts = await effects.upload(config);
        const lastSyncAt = effects.now?.() ?? Date.now();
        const updated = await updateLastSyncAfterEffect(revision, lastSyncAt);
        return { ok: true as const, lastSyncAt, counts, revision: updated.revision };
      }));
    },
    download(
      target: SyncCommandTarget,
      notifyCommitted?: (result: SyncDownloadResult) => Promise<void>,
    ) {
      const confirmedTarget = snapshotSyncCommandTarget(target);
      return operations.run(() => runAfterConfigCommit(confirmedTarget, async (config, revision) => {
        const result = await effects.download(config);
        const lastSyncAt = effects.now?.() ?? Date.now();
        const updated = await updateLastSyncAfterEffect(revision, lastSyncAt);
        try {
          await notifyCommitted?.(result);
        } catch (error) {
          throw new SyncOperationAfterConfigCommitError(
            error,
            updated.revision,
            updated.config.lastSyncAt,
            true,
          );
        }
        return { ok: true as const, lastSyncAt, counts: result.counts, revision: updated.revision };
      }));
    },
  });
}

function snapshotSyncCommandTarget(target: SyncCommandTarget): SyncCommandTarget {
  return {
    config: { ...target.config },
    expectedRevision: target.expectedRevision,
  };
}

export function createSyncCommandErrorResponse(error: unknown): SyncCommandErrorResponse | null {
  if (error instanceof SyncConfigConflictError) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
    };
  }
  if (error instanceof SyncConfigCommitIndeterminateError) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
      reloadConfig: true,
    };
  }
  if (error instanceof SyncOperationAfterEffectPersistenceError) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
      reloadConfig: true,
      effectCompleted: true,
    };
  }
  if (error instanceof SyncOperationAfterConfigCommitError) {
    const response: SyncCommandErrorResponse = {
      ok: false,
      error: error.message,
      code: error.code,
      revision: error.revision,
      lastSyncAt: error.lastSyncAt,
    };
    if (error.effectCompleted) response.effectCompleted = true;
    return response;
  }
  return null;
}
