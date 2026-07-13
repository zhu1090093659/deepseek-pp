let localStateTail: Promise<void> = Promise.resolve();
let requiredRecovery: (() => Promise<void>) | null = null;

export function requireLocalStateRecovery(recover: () => Promise<void>): void {
  requiredRecovery = recover;
}

export function clearRequiredLocalStateRecovery(recover: () => Promise<void>): void {
  if (requiredRecovery === recover) requiredRecovery = null;
}

export async function recoverRequiredLocalStateAlreadyLocked(): Promise<void> {
  const recover = requiredRecovery;
  if (!recover) return;
  await recover();
  clearRequiredLocalStateRecovery(recover);
}

export function withSyncLocalStateLock<T>(operation: () => Promise<T>): Promise<T> {
  return enqueueLocalStateOperation(async () => {
    await recoverRequiredLocalStateAlreadyLocked();
    return operation();
  });
}

export function withSyncLocalStateRecoveryLock<T>(operation: () => Promise<T>): Promise<T> {
  return enqueueLocalStateOperation(operation);
}

function enqueueLocalStateOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = async () => {
    return operation();
  };
  const result = localStateTail.then(run, run);
  localStateTail = result.then(() => undefined, () => undefined);
  return result;
}
