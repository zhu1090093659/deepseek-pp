import { describe, expect, it } from 'vitest';
import { createSerialOperationQueue } from '../core/persistence/serial-operation-queue';

describe('serial operation queue', () => {
  it('runs operations in call order and survives a rejected operation', async () => {
    const queue = createSerialOperationQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:fail');
      throw new Error('expected failure');
    });
    const second = queue.run(async () => {
      events.push('second');
      return 2;
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await expect(first).rejects.toThrow('expected failure');
    await expect(second).resolves.toBe(2);
    expect(events).toEqual(['first:start', 'first:fail', 'second']);
  });

  it('does not serialize independent queue instances', async () => {
    const firstQueue = createSerialOperationQueue();
    const secondQueue = createSerialOperationQueue();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const blocked = firstQueue.run(() => firstGate);
    await expect(secondQueue.run(async () => 'independent')).resolves.toBe('independent');
    releaseFirst();
    await blocked;
  });
});
