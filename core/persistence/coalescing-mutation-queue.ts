import { createSerialOperationQueue } from './serial-operation-queue';

interface PendingMutation<Input, Output> {
  input: Input;
  resolve: (value: Output) => void;
  reject: (reason: unknown) => void;
}

interface MutationBatch<Input, Output> {
  pending: Array<PendingMutation<Input, Output>>;
}

export interface CoalescingMutationQueue<Input, Output> {
  mutate(input: Input): Promise<Output>;
  barrier<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Coalesces adjacent, unobserved mutations while preserving one store-local FIFO.
 * Reads and clears are barriers, and a batch is sealed before its first await,
 * so work arriving later cannot cross an already-observed operation boundary.
 */
export function createCoalescingMutationQueue<Input, Output>(
  flush: (inputs: readonly Input[]) => Promise<readonly Output[]>,
): CoalescingMutationQueue<Input, Output> {
  const operations = createSerialOperationQueue();
  let openBatch: MutationBatch<Input, Output> | null = null;

  const settleBatch = async (batch: MutationBatch<Input, Output>): Promise<void> => {
    if (openBatch === batch) openBatch = null;
    try {
      const outputs = await flush(batch.pending.map(({ input }) => input));
      if (outputs.length !== batch.pending.length) {
        throw new Error('Coalesced mutation output count does not match input count');
      }
      batch.pending.forEach((pending, index) => pending.resolve(outputs[index]));
    } catch (error) {
      batch.pending.forEach((pending) => pending.reject(error));
    }
  };

  const createBatch = (): MutationBatch<Input, Output> => {
    const batch: MutationBatch<Input, Output> = { pending: [] };
    openBatch = batch;
    void operations.run(() => settleBatch(batch));
    return batch;
  };

  return Object.freeze({
    mutate(input: Input): Promise<Output> {
      const batch = openBatch ?? createBatch();
      return new Promise<Output>((resolve, reject) => {
        batch.pending.push({ input, resolve, reject });
      });
    },
    barrier<T>(operation: () => Promise<T>): Promise<T> {
      openBatch = null;
      return operations.run(operation);
    },
  });
}
