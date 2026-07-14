const MAX_TRACKED_USAGE_PROGRESS = 200;

export interface UsageProgressWriteCoordinator {
  persist(
    requestId: string,
    signature: string,
    write: () => Promise<void>,
  ): Promise<boolean>;
}

/**
 * Deduplicates completed stream snapshots while keeping a failed signature
 * retryable. The signature is released only by the write that still owns it,
 * so an older rejection cannot erase a newer completion for the same request.
 */
export function createUsageProgressWriteCoordinator(): UsageProgressWriteCoordinator {
  const signatures = new Map<string, string>();

  return Object.freeze({
    async persist(
      requestId: string,
      signature: string,
      write: () => Promise<void>,
    ): Promise<boolean> {
      if (signatures.get(requestId) === signature) return false;
      signatures.set(requestId, signature);
      if (signatures.size > MAX_TRACKED_USAGE_PROGRESS) {
        const firstKey = signatures.keys().next().value;
        if (typeof firstKey === 'string') signatures.delete(firstKey);
      }

      try {
        await write();
        return true;
      } catch (error) {
        if (signatures.get(requestId) === signature) signatures.delete(requestId);
        throw error;
      }
    },
  });
}
