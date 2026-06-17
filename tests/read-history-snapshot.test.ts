import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHistorySnapshot } from '../core/deepseek/adapter';

describe('readHistorySnapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses injected client headers and base URL in background-safe mode', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe('https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-1');
      return new Response(JSON.stringify({
        data: {
          biz_data: {
            chat_messages: [
              { message_id: 100, parent_id: null, message_role: 'user' },
              { message_id: 101, parent_id: 100, message_role: 'assistant' },
            ],
          },
        },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const snapshot = await readHistorySnapshot('session-1', 101, {
      clientHeaders: { Authorization: 'Bearer injected-token' },
      baseUrl: 'https://chat.deepseek.com',
    });

    expect(snapshot).toMatchObject({
      chatSessionId: 'session-1',
      parentMessageId: 101,
      assistantMessageId: 101,
      messageCount: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer injected-token',
        }),
      }),
    );
  });
});