import { describe, expect, it, vi } from 'vitest';
import { createUsageProgressWriteCoordinator } from '../core/usage/progress-write-coordinator';

describe('Usage progress write coordinator', () => {
  it('deduplicates a confirmed signature and releases it after failure for retry', async () => {
    const coordinator = createUsageProgressWriteCoordinator();
    const failure = new Error('storage rejected the turn');
    const write = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);

    await expect(coordinator.persist('request-1', 'signature-a', write)).rejects.toBe(failure);
    await expect(coordinator.persist('request-1', 'signature-a', write)).resolves.toBe(true);
    await expect(coordinator.persist('request-1', 'signature-a', write)).resolves.toBe(false);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('does not let an older rejection release a newer signature', async () => {
    const coordinator = createUsageProgressWriteCoordinator();
    let rejectOld!: (error: unknown) => void;
    const oldWrite = new Promise<void>((_resolve, reject) => {
      rejectOld = reject;
    });
    const failure = new Error('old write failed');

    const old = coordinator.persist('request-1', 'signature-old', () => oldWrite);
    await expect(coordinator.persist(
      'request-1',
      'signature-new',
      async () => undefined,
    )).resolves.toBe(true);
    rejectOld(failure);
    await expect(old).rejects.toBe(failure);

    const duplicateWrite = vi.fn(async () => undefined);
    await expect(coordinator.persist(
      'request-1',
      'signature-new',
      duplicateWrite,
    )).resolves.toBe(false);
    expect(duplicateWrite).not.toHaveBeenCalled();
  });
});
