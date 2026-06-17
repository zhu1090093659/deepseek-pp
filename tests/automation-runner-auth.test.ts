import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationRunnerRequest } from '../core/automation/types';

const authErrors = vi.hoisted(() => {
  class DeepSeekAuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DeepSeekAuthError';
    }
  }
  return { DeepSeekAuthError };
});

const adapterMocks = vi.hoisted(() => ({
  createChatSession: vi.fn(),
  createPowHeaders: vi.fn(),
  readHistorySnapshot: vi.fn(),
  submitPrompt: vi.fn(),
  createClientHeaders: vi.fn(),
}));

vi.mock('../core/deepseek/adapter', () => {
  class DeepSeekPowError extends Error {}
  class DeepSeekSessionError extends Error {}
  class DeepSeekPayloadError extends Error {
    readonly retryable: boolean;

    constructor(message: string, options?: { retryable?: boolean }) {
      super(message);
      this.retryable = options?.retryable ?? false;
    }
  }

  return {
    DeepSeekAuthError: authErrors.DeepSeekAuthError,
    DeepSeekPowError,
    DeepSeekSessionError,
    DeepSeekPayloadError,
    buildDeepSeekSessionUrl: (chatSessionId: string) => `https://chat.deepseek.com/a/chat/s/${chatSessionId}`,
    createChatSession: adapterMocks.createChatSession,
    createClientHeaders: adapterMocks.createClientHeaders,
    createPowHeaders: adapterMocks.createPowHeaders,
    normalizeMessageId: () => null,
    readHistorySnapshot: adapterMocks.readHistorySnapshot,
    submitPrompt: adapterMocks.submitPrompt,
  };
});

const { runDeepSeekAutomation } = await import('../core/automation/runner');

describe('runDeepSeekAutomation auth handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterMocks.createClientHeaders.mockImplementation(() => {
      throw new authErrors.DeepSeekAuthError('DeepSeek login token is missing.');
    });
  });

  it('fails with auth metadata when client headers are not injected', async () => {
    const result = await runDeepSeekAutomation(createRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: 'deepseek_auth_token_missing',
      phase: 'auth',
      retryable: false,
    });
    expect(adapterMocks.createChatSession).not.toHaveBeenCalled();
  });

  it('passes injected headers through to history verification', async () => {
    adapterMocks.createPowHeaders.mockResolvedValue({ 'X-DS-PoW-Response': 'pow-1' });
    adapterMocks.createChatSession.mockResolvedValue('session-1');
    adapterMocks.submitPrompt.mockResolvedValue({
      assistantText: 'Done.',
      responseMessageId: 101,
      requestMessageId: 100,
      finished: true,
    });
    adapterMocks.readHistorySnapshot.mockResolvedValue({
      chatSessionId: 'session-1',
      parentMessageId: 100,
      assistantMessageId: 101,
      messageCount: 2,
      verifiedAt: Date.now(),
    });

    const clientHeaders = { Authorization: 'Bearer injected-token' };
    const result = await runDeepSeekAutomation(createRequest(), { clientHeaders });

    expect(result.ok).toBe(true);
    expect(adapterMocks.createClientHeaders).not.toHaveBeenCalled();
    expect(adapterMocks.readHistorySnapshot).toHaveBeenCalledWith(
      'session-1',
      101,
      { clientHeaders },
    );
  });
});

function createRequest(): AutomationRunnerRequest {
  return {
    runId: 'run-1',
    automationId: 'automation-1',
    prompt: 'Say hello.',
    trigger: 'manual',
    chatSessionId: null,
    parentMessageId: null,
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
    requestedAt: 1,
  };
}