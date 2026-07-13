import { describe, expect, it, vi } from 'vitest';
import { createSyncRecoveryBarrier } from '../core/sync/recovery-barrier';

describe('sync recovery barrier', () => {
  it('retries durable recovery after a transient failure', async () => {
    const recover = vi.fn()
      .mockRejectedValueOnce(new Error('transient recovery failure'))
      .mockResolvedValueOnce({ recovered: false });
    const onRecoveryFailure = vi.fn();
    const barrier = createSyncRecoveryBarrier({
      recover,
      notifyRecovered: vi.fn(),
      onRecoveryFailure,
    });

    await expect(barrier.ensureReady()).rejects.toThrow('transient recovery failure');
    await expect(barrier.ensureReady()).resolves.toBeUndefined();
    expect(recover).toHaveBeenCalledTimes(2);
    expect(onRecoveryFailure).toHaveBeenCalledOnce();
  });

  it('does not poison readiness when the post-recovery broadcast fails', async () => {
    const notificationError = new Error('broadcast failed');
    const onNotificationFailure = vi.fn();
    const recover = vi.fn().mockResolvedValue({ recovered: true });
    const notifyRecovered = vi.fn().mockRejectedValue(notificationError);
    const barrier = createSyncRecoveryBarrier({
      recover,
      notifyRecovered,
      onNotificationFailure,
    });

    await expect(barrier.ensureReady()).resolves.toBeUndefined();
    await Promise.resolve();
    await expect(barrier.ensureReady()).resolves.toBeUndefined();
    expect(recover).toHaveBeenCalledOnce();
    expect(onNotificationFailure).toHaveBeenCalledWith(notificationError);
  });

  it('blocks later dispatch on recovery after a failed apply', async () => {
    let finishRecovery!: (result: { recovered: boolean }) => void;
    const recover = vi.fn(() => new Promise<{ recovered: boolean }>((resolve) => {
      finishRecovery = resolve;
    }));
    const barrier = createSyncRecoveryBarrier({
      recover,
      notifyRecovered: vi.fn().mockResolvedValue(undefined),
    });

    const apply = barrier.trackApply(Promise.reject(new Error('apply failed')));
    await expect(apply).rejects.toThrow('apply failed');
    const dispatch = vi.fn();
    const waitingDispatch = barrier.ensureReady().then(dispatch);
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();

    finishRecovery({ recovered: true });
    await waitingDispatch;
    expect(dispatch).toHaveBeenCalledOnce();
  });
});
