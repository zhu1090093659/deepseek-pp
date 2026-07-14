export interface SerialOperationQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Creates one non-reentrant FIFO for a single ownership boundary.
 *
 * Callers must create one queue per store or service. A shared process-wide
 * queue would couple unrelated persistence keys and hide their real ordering.
 */
export function createSerialOperationQueue(): SerialOperationQueue {
  let tail: Promise<void> = Promise.resolve();

  return Object.freeze({
    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation, operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  });
}
