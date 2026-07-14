import { describe, expect, it, vi } from 'vitest';
import { notifyContentAuthStatusChanged } from '../entrypoints/content/auth-status-notifier';

describe('Content auth status notifier', () => {
  it('reports successful delivery', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const invalidateExtensionContext = vi.fn();
    const reportError = vi.fn();

    await expect(notifyContentAuthStatusChanged({
      send,
      isExtensionInvalidatedError: () => false,
      invalidateExtensionContext,
      reportError,
    })).resolves.toBe(true);

    expect(send).toHaveBeenCalledOnce();
    expect(invalidateExtensionContext).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('routes extension invalidation to lifecycle teardown without duplicate reporting', async () => {
    const failure = new Error('Extension context invalidated.');
    const invalidateExtensionContext = vi.fn();
    const reportError = vi.fn();

    await expect(notifyContentAuthStatusChanged({
      send: vi.fn().mockRejectedValue(failure),
      isExtensionInvalidatedError: (error) => error === failure,
      invalidateExtensionContext,
      reportError,
    })).resolves.toBe(false);

    expect(invalidateExtensionContext).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('surfaces ordinary transport failures at the content boundary', async () => {
    const failure = new Error('Background did not accept the message.');
    const invalidateExtensionContext = vi.fn();
    const reportError = vi.fn();

    await expect(notifyContentAuthStatusChanged({
      send: vi.fn().mockRejectedValue(failure),
      isExtensionInvalidatedError: () => false,
      invalidateExtensionContext,
      reportError,
    })).resolves.toBe(false);

    expect(invalidateExtensionContext).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(failure);
  });
});
