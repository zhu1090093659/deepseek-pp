import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InlineAgentStartPayload } from '../core/inline-agent/types';
import type { ToolExecutionRecord } from '../core/types';

const adapterMocks = vi.hoisted(() => ({
  createPowHeaders: vi.fn(),
  submitPromptStreaming: vi.fn(),
}));

vi.mock('../core/deepseek/adapter', () => ({
  createClientHeaders: () => ({ Authorization: 'Bearer test-token' }),
  createPowHeaders: adapterMocks.createPowHeaders,
  submitPromptStreaming: adapterMocks.submitPromptStreaming,
}));

const { runInlineAgentLoop } = await import('../core/inline-agent/loop');

describe('runInlineAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterMocks.createPowHeaders.mockResolvedValue({ 'X-DS-PoW-Response': 'pow-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses a natural no-tool answer instead of injecting a final-answer round', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Done after tool result.');
      return {
        assistantText: '',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: 'Done after tool result.',
      totalTools: 1,
    }));
  });

  it('pauses instead of presenting pending nudge text as the final answer', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('I will call search next.');
        return {
          assistantText: '',
          responseMessageId: 102,
          requestMessageId: 101,
          finished: true,
        };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('I still need to call search next.');
        return {
          assistantText: '',
          responseMessageId: 104,
          requestMessageId: 103,
          finished: true,
        };
      });

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(7000);
    await run;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: expect.stringContaining('paused after 25 automated tool-continuation rounds'),
      totalTools: 1,
    }));
    expect(post).not.toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: 'I still need to call search next.',
    }));
  });
});

function createPayload(): InlineAgentStartPayload {
  return {
    loopId: 'loop-1',
    chatSessionId: 'chat-1',
    parentMessageId: 100,
    originalPrompt: 'Use the tool and summarize the result.',
    agentTaskPrompt: 'Use the tool and summarize the result.',
    toolExecutions: [SUCCESS_EXECUTION],
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
    toolDescriptors: [],
    locale: 'en',
  };
}

const SUCCESS_EXECUTION: ToolExecutionRecord = {
  name: 'web_search',
  provider: {
    kind: 'local',
    id: 'web',
    displayName: 'DeepSeek++ Web Search',
    transport: 'in_process',
  },
  result: {
    ok: true,
    summary: 'Search completed',
    output: [{ title: 'Result', url: 'https://example.com' }],
  },
};
