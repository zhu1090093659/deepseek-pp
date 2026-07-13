import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutomationExecutionStoppedError,
  createAutomationExecutionContext,
} from '../core/automation/execution';
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
    buildDeepSeekSessionUrl: (id: string) => `https://chat.deepseek.com/a/chat/s/${id}`,
    createChatSession: adapterMocks.createChatSession,
    createClientHeaders: () => ({ Authorization: 'Bearer test-token' }),
    createPowHeaders: adapterMocks.createPowHeaders,
    normalizeMessageId: (value: unknown) => typeof value === 'number' ? value : null,
    readHistorySnapshot: adapterMocks.readHistorySnapshot,
    submitPrompt: adapterMocks.submitPrompt,
  };
});

const { runDeepSeekAutomation } = await import('../core/automation/runner');
const { DeepSeekPayloadError, DeepSeekPowError } = await import('../core/deepseek/adapter');

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
  description: 'Echo input.',
  inputSchema: { type: 'object' },
  execution: { mode: 'auto', enabled: true, risk: 'medium' },
};

describe('automation runner execution context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterMocks.createChatSession.mockResolvedValue('session-1');
    adapterMocks.createPowHeaders.mockResolvedValue({ 'X-DS-PoW-Response': 'pow' });
    adapterMocks.readHistorySnapshot.mockResolvedValue(null);
  });

  it('propagates one signal through session, PoW, completion stream, and history', async () => {
    adapterMocks.submitPrompt.mockResolvedValue(modelTurn('done', 101));
    const controller = new AbortController();
    const execution = createExecution(controller);

    const result = await runDeepSeekAutomation(createRequest({ chatSessionId: null }), {
      execution,
      executeToolCall: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(adapterMocks.createChatSession.mock.calls[0][1]).toBe(controller.signal);
    expect(adapterMocks.createPowHeaders.mock.calls[0][2]).toBe(controller.signal);
    expect(adapterMocks.submitPrompt.mock.calls[0][1]).toBe(controller.signal);
    expect(adapterMocks.readHistorySnapshot.mock.calls[0][3]).toBe(controller.signal);
  });

  it('stops between tool calls and never submits a continuation after cancellation', async () => {
    adapterMocks.submitPrompt.mockResolvedValue(modelTurn([
      '<mcp_mock_echo>{"text":"first"}</mcp_mock_echo>',
      '<mcp_mock_echo>{"text":"second"}</mcp_mock_echo>',
    ].join('\n'), 101));
    const controller = new AbortController();
    const execution = createExecution(controller);
    const executeToolCall = vi.fn(async (_call, toolExecution): Promise<ToolResult> => {
      controller.abort(new AutomationExecutionStoppedError('cancelled', 'cancelled in test'));
      expect(toolExecution.signal).toBe(controller.signal);
      return { ok: true, summary: 'executed once' };
    });

    await expect(runDeepSeekAutomation(createRequest(), {
      execution,
      executeToolCall,
    })).rejects.toMatchObject({ kind: 'cancelled' });

    expect(executeToolCall).toHaveBeenCalledTimes(1);
    const [call, toolExecution] = executeToolCall.mock.calls[0];
    expect(call.id).toBe('automation:run-1:tool:101:0:0');
    expect(toolExecution.idempotencyKey).toBe(call.id);
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not let best-effort history verification swallow cancellation', async () => {
    adapterMocks.submitPrompt.mockResolvedValue(modelTurn('done', 101));
    const controller = new AbortController();
    const execution = createExecution(controller);
    adapterMocks.readHistorySnapshot.mockImplementation(async () => {
      controller.abort(new AutomationExecutionStoppedError('timeout', 'history deadline'));
      throw new DOMException('Aborted', 'AbortError');
    });

    await expect(runDeepSeekAutomation(createRequest(), { execution }))
      .rejects.toMatchObject({ kind: 'timeout' });
  });

  it('marks a post-dispatch completion failure ambiguous and non-retryable', async () => {
    adapterMocks.submitPrompt.mockRejectedValue(new DeepSeekPayloadError('response lost', { retryable: true }));

    const result = await runDeepSeekAutomation(createRequest());

    expect(result).toMatchObject({
      ok: false,
      error: {
        retryable: false,
        details: { externalOutcome: 'ambiguous', retrySafe: false },
      },
    });
  });

  it('allows only a pre-dispatch PoW failure to request a safe retry', async () => {
    adapterMocks.createPowHeaders.mockRejectedValue(new DeepSeekPowError('pow unavailable'));

    const result = await runDeepSeekAutomation(createRequest());

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'deepseek_pow_failed',
        retryable: true,
        details: { externalOutcome: 'not_started', retrySafe: true },
      },
    });
    expect(adapterMocks.submitPrompt).not.toHaveBeenCalled();
  });

  it('terminates instead of asking the model to repeat an ambiguously completed tool call', async () => {
    adapterMocks.submitPrompt.mockResolvedValue(modelTurn(
      '<mcp_mock_echo>{"text":"once"}</mcp_mock_echo>',
      101,
    ));
    const executeToolCall = vi.fn(async (): Promise<ToolResult> => ({
      ok: false,
      summary: 'response lost',
      error: {
        code: 'mcp_tool_call_failed',
        message: 'response lost after dispatch',
        retryable: true,
        details: { externalOutcome: 'ambiguous', retrySafe: false },
      },
    }));

    const result = await runDeepSeekAutomation(createRequest(), { executeToolCall });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'automation_tool_outcome_ambiguous',
        retryable: false,
        details: { externalOutcome: 'ambiguous', retrySafe: false },
      },
    });
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('preserves continuation for a confirmed MCP tool error', async () => {
    adapterMocks.submitPrompt
      .mockResolvedValueOnce(modelTurn(
        '<mcp_mock_echo>{"text":"invalid"}</mcp_mock_echo>',
        101,
      ))
      .mockResolvedValueOnce(modelTurn('Handled the tool error.', 102));
    const executeToolCall = vi.fn(async (): Promise<ToolResult> => ({
      ok: false,
      summary: 'tool rejected input',
      error: {
        code: 'mcp_tool_result_error',
        message: 'invalid input',
        retryable: false,
        details: { externalOutcome: 'confirmed', retrySafe: false },
      },
    }));

    const result = await runDeepSeekAutomation(createRequest(), { executeToolCall });

    expect(result.ok).toBe(true);
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(2);
  });
});

function createExecution(controller: AbortController) {
  return createAutomationExecutionContext({
    runId: 'run-1',
    automationId: 'automation-1',
    deadlineAt: Date.now() + 60_000,
    attempt: 1,
    signal: controller.signal,
    isLeaseCurrent: () => true,
  });
}

function createRequest(overrides: Partial<AutomationRunnerRequest> = {}): AutomationRunnerRequest {
  return {
    runId: 'run-1',
    automationId: 'automation-1',
    deadlineAt: Date.now() + 60_000,
    prompt: 'Use tools and finish.',
    trigger: 'manual',
    chatSessionId: 'session-1',
    parentMessageId: null,
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
    promptContext: { toolDescriptors: [MCP_ECHO_DESCRIPTOR] },
    requestedAt: Date.now(),
    ...overrides,
  };
}

function modelTurn(assistantText: string, responseMessageId: number) {
  return {
    assistantText,
    responseMessageId,
    requestMessageId: responseMessageId - 1,
    finished: true,
  };
}
