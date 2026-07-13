export interface LatestSyncLease {
  commit(action: () => void): boolean;
}

export interface LatestSyncGate {
  begin(): LatestSyncLease;
}

/** Allows only the newest asynchronous synchronization attempt to mutate state. */
export function createLatestSyncGate(): LatestSyncGate {
  let currentEpoch = 0;
  return {
    begin() {
      const epoch = ++currentEpoch;
      return {
        commit(action) {
          if (epoch !== currentEpoch) return false;
          action();
          return true;
        },
      };
    },
  };
}
