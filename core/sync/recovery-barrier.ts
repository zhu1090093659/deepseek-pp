export interface SyncRecoveryResultLike {
  recovered: boolean;
}

export interface SyncRecoveryBarrierOptions<TRecovery extends SyncRecoveryResultLike> {
  recover(): Promise<TRecovery>;
  notifyReady(result: TRecovery): Promise<void>;
  onRecoveryFailure?(error: unknown): void;
  onNotificationFailure?(error: unknown): void;
}

export interface SyncRecoveryBarrier {
  ensureReady(): Promise<void>;
  trackApply<T>(operation: Promise<T>): Promise<T>;
}

export function createSyncRecoveryBarrier<TRecovery extends SyncRecoveryResultLike>(
  options: SyncRecoveryBarrierOptions<TRecovery>,
): SyncRecoveryBarrier {
  let ready: Promise<void> | null = null;

  async function notifyAfterRecoveryCheck(result: TRecovery): Promise<void> {
    try {
      await options.notifyReady(result);
    } catch (error) {
      options.onNotificationFailure?.(error);
    }
  }

  function installRecoveryAttempt(attempt: Promise<void>): Promise<void> {
    ready = attempt;
    void attempt.catch((error) => {
      options.onRecoveryFailure?.(error);
      if (ready === attempt) ready = null;
    });
    return attempt;
  }

  async function recover(): Promise<void> {
    const result = await options.recover();
    await notifyAfterRecoveryCheck(result);
  }

  return {
    ensureReady() {
      return ready ?? installRecoveryAttempt(recover());
    },
    trackApply<T>(operation: Promise<T>): Promise<T> {
      const applyBarrier = operation.then(
        () => undefined,
        () => recover(),
      );
      installRecoveryAttempt(applyBarrier);
      return operation;
    },
  };
}
