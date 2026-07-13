import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationRunnerRequest } from '../core/automation/types';
import type { ToolDescriptor, ToolResult } from '../core/types';

const adapterMocks = vi.hoisted(() => ({
  createChatSession: vi.fn(),
  createPowHeaders: vi.fn(),
  readHistorySnapshot: vi.fn(),
  submitPrompt: vi.fn(),
}));

vi.mock('../core/deepseek/adapter', () => {
  class DeepSeekAuthError extends Error {}
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
    DeepSeekAuthError,
    DeepSeekPowError,
    DeepSeekSessionError,
    DeepSeekPayloadError,
    buildDeepSeekSessionUrl: (chatSessionId: string) => `https://chat.deepseek.com/a/chat/s/${chatSessionId}`,
    createChatSession: adapterMocks.createChatSession,
    createClientHeaders: () => ({ Authorization: 'Bearer test-token' }),
    createPowHeaders: adapterMocks.createPowHeaders,
    normalizeMessageId: (value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    },
    readHistorySnapshot: adapterMocks.readHistorySnapshot,
    submitPrompt: adapterMocks.submitPrompt,
  };
});

const { runDeepSeekAutomation } = await import('../core/automation/runner');

const MCP_ECHO_DESCRIPTOR: ToolDescriptor = {
  id: 'mcp:mock:echo',
  provider: {
    kind: 'mcp',
    id: 'mock',
    displayName: 'Mock MCP',
    transport: 'streamable_http',
  },
  name: 'echo',
  invocationName: 'mcp_mock_echo',
  title: 'Echo',
  description: 'Return the text argument.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
    },
    required: ['text'],
  },
  execution: {
    mode: 'auto',
    enabled: true,
    risk: 'medium',
  },
};

describe('runDeepSeekAutomation PoW handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let powCount = 0;
    adapterMocks.createChatSession.mockResolvedValue('session-1');
    adapterMocks.createPowHeaders.mockImplementation(async () => {
      powCount += 1;
      return { 'X-DS-PoW-Response': `pow-${powCount}` };
    });
    adapterMocks.readHistorySnapshot.mockResolvedValue(null);
  });

  it('creates fresh PoW headers for the initial completion and each tool continuation', async () => {
    adapterMocks.submitPrompt
      .mockResolvedValueOnce({
        assistantText: 'Need data.\n<mcp_mock_echo>{"text":"first"}</mcp_mock_echo>',
        responseMessageId: 101,
        requestMessageId: 100,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Done after tool result.',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      });

    const executeToolCall = vi.fn(async (): Promise<ToolResult> => ({
      ok: true,
      summary: 'MCP tool executed',
      output: { echoed: 'first' },
    }));

    const result = await runDeepSeekAutomation(createRequest(), { executeToolCall });

    expect(result.ok).toBe(true);
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(adapterMocks.createPowHeaders).toHaveBeenCalledTimes(2);
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(2);
    expect(adapterMocks.submitPrompt.mock.calls[0][0]).toMatchObject({
      chatSessionId: 'session-1',
      parentMessageId: null,
      powHeaders: { 'X-DS-PoW-Response': 'pow-1' },
    });
    expect(adapterMocks.submitPrompt.mock.calls[1][0]).toMatchObject({
      chatSessionId: 'session-1',
      parentMessageId: 101,
      powHeaders: { 'X-DS-PoW-Response': 'pow-2' },
    });
  });
});

function createRequest(): AutomationRunnerRequest {
  return {
    runId: 'run-1',
    automationId: 'automation-1',
    deadlineAt: Number.MAX_SAFE_INTEGER,
    prompt: 'Use the mock tool, then finish.',
    trigger: 'manual',
    chatSessionId: null,
    parentMessageId: null,
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
    promptContext: {
      toolDescriptors: [MCP_ECHO_DESCRIPTOR],
    },
    requestedAt: 1,
  };
}
