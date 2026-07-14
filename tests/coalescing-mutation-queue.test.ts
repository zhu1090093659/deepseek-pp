import { describe, expect, it, vi } from 'vitest';
import { createCoalescingMutationQueue } from '../core/persistence/coalescing-mutation-queue';

describe('coalescing mutation queue', () => {
  it('flushes adjacent mutations once and resolves results in FIFO order', async () => {
    const flush = vi.fn(async (inputs: readonly number[]) => inputs.map((input) => input * 10));
    const queue = createCoalescingMutationQueue(flush);

    await expect(Promise.all([
      queue.mutate(1),
      queue.mutate(2),
      queue.mutate(3),
    ])).resolves.toEqual([10, 20, 30]);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('seals an open batch at a read or clear barrier', async () => {
    const events: string[] = [];
    const queue = createCoalescingMutationQueue<number, number>(async (inputs) => {
      events.push(`flush:${inputs.join(',')}`);
      return inputs;
    });

    const first = queue.mutate(1);
    const second = queue.mutate(2);
    const barrier = queue.barrier(async () => {
      events.push('barrier');
      return 'observed';
    });
    const third = queue.mutate(3);

    await expect(Promise.all([first, second, barrier, third]))
      .resolves.toEqual([1, 2, 'observed', 3]);
    expect(events).toEqual(['flush:1,2', 'barrier', 'flush:3']);
  });

  it('starts a new batch for mutations that arrive after a physical flush begins', async () => {
    let releaseFirstFlush!: () => void;
    const firstFlushGate = new Promise<void>((resolve) => {
      releaseFirstFlush = resolve;
    });
    let markFirstFlushStarted!: () => void;
    const firstFlushStarted = new Promise<void>((resolve) => {
      markFirstFlushStarted = resolve;
    });
    const flush = vi.fn(async (inputs: readonly number[]) => {
      if (inputs[0] === 1) {
        markFirstFlushStarted();
        await firstFlushGate;
      }
      return inputs;
    });
    const queue = createCoalescingMutationQueue(flush);

    const first = queue.mutate(1);
    await firstFlushStarted;
    const second = queue.mutate(2);
    releaseFirstFlush();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(flush.mock.calls.map(([inputs]) => inputs)).toEqual([[1], [2]]);
  });

  it('rejects every member of a failed batch and accepts later work', async () => {
    const failure = new Error('physical write failed');
    const flush = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockImplementation(async (inputs: readonly number[]) => inputs);
    const queue = createCoalescingMutationQueue<number, number>(flush);

    const failed = await Promise.allSettled([queue.mutate(1), queue.mutate(2)]);
    expect(failed).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    await expect(queue.mutate(3)).resolves.toBe(3);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
