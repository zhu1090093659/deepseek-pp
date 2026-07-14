import { describe, expect, it, vi } from 'vitest';
import { refreshDeepSeekAuthFromTabs } from '../entrypoints/background/deepseek-auth-refresh';

describe('DeepSeek auth refresh tab delivery', () => {
  it('skips an expected missing receiver and succeeds on the next live tab', async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce({ hasToken: true });
    const reportError = vi.fn();

    await expect(refreshDeepSeekAuthFromTabs(
      [{ id: 11 }, { id: 12 }],
      { sendMessage, reportError },
    )).resolves.toBe(true);

    expect(sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([11, 12]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('reports every unexpected rejection and rejects when no tab refresh succeeds', async () => {
    const first = new Error('permission boundary failed');
    const second = new Error('runtime transport failed');
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second);
    const reportError = vi.fn();

    const error = await refreshDeepSeekAuthFromTabs(
      [{ id: 21 }, { id: 22 }],
      { sendMessage, reportError },
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([first, second]);
    expect(reportError.mock.calls).toEqual([
      ['auth_refresh_tab_delivery_failed', first],
      ['auth_refresh_tab_delivery_failed', second],
    ]);
  });

  it('keeps earlier unexpected failures visible even when a later tab succeeds', async () => {
    const unexpected = new Error('first tab failed unexpectedly');
    const reportError = vi.fn();

    await expect(refreshDeepSeekAuthFromTabs(
      [{ id: 31 }, { id: 32 }],
      {
        sendMessage: vi.fn()
          .mockRejectedValueOnce(unexpected)
          .mockResolvedValueOnce({ hasToken: true }),
        reportError,
      },
    )).resolves.toBe(true);

    expect(reportError).toHaveBeenCalledWith('auth_refresh_tab_delivery_failed', unexpected);
  });
});
