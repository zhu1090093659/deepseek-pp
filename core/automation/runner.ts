import {
  DeepSeekAuthError,
  DeepSeekPayloadError,
  DeepSeekPowError,
  DeepSeekSessionError,
  buildDeepSeekSessionUrl,
  createChatSession,
  createClientHeaders,
  createPowHeaders,
  normalizeMessageId,
  readHistorySnapshot,
  submitPrompt,
  type ModelTurn,
} from '../deepseek/adapter';
import { extractToolCalls } from '../interceptor/tool-parser';
import { buildPromptAugmentation } from '../prompt';
import { DEFAULT_TOOL_DESCRIPTORS } from '../tool';
import { clampText, createToolExecutionRecord, runToolContinuationLoop } from '../tool-loop/engine';
import type { ToolCall, ToolExecutionRecord, ToolResult } from '../types';
import { createAutomationRunnerFailure } from './messages';
import type {
  AutomationRunnerRequest,
  AutomationRunnerResult,
  AutomationRunnerSuccess,
} from './types';

const AUTOMATION_MCP_CONTINUATION_LIMIT = 3;
const AUTOMATION_MISSING_TOKEN_MESSAGE =
  'DeepSeek login token is missing. Refresh chat.deepseek.com or sign in again, then retry the automation.';

export interface AutomationRunnerOptions {
  executeToolCall?: (call: ToolCall) => Promise<ToolResult>;
}

export async function runDeepSeekAutomation(
  request: AutomationRunnerRequest,
  options?: AutomationRunnerOptions,
): Promise<AutomationRunnerResult> {
  let chatSessionId = request.chatSessionId;
  let parentMessageId: number | null = null;

  try {
    parentMessageId = normalizeMessageId(request.parentMessageId, 'parent_message_id');
    const clientHeaders = createClientHeaders({ missingTokenMessage: AUTOMATION_MISSING_TOKEN_MESSAGE });
    chatSessionId ??= await createChatSession(clientHeaders);
    const headers = await createPowHeaders(clientHeaders);
    const { augmented: prompt } = buildPromptAugmentation(request.prompt, {
      memories: request.promptContext?.memories ?? [],
      presetContent: request.promptContext?.presetContent ?? null,
      thinkingEnabled: request.promptOptions.thinkingEnabled,
      toolDescriptors: request.promptContext?.toolDescriptors ?? DEFAULT_TOOL_DESCRIPTORS,
    });
    let stream = await submitAutomationPrompt(
      request,
      chatSessionId,
      parentMessageId,
      prompt,
      clientHeaders,
      headers,
    );
    const assistantMessageId = stream.responseMessageId;
    if (assistantMessageId === null) {
      return createAutomationRunnerFailure(
        { ...request, chatSessionId, parentMessageId },
        'deepseek_completion_missing_message_id',
        'DeepSeek completion finished without a response message id.',
        'completion',
        true,
      );
    }

    const toolLoop = await runAutomationToolLoop(
      request,
      options,
      chatSessionId,
      assistantMessageId,
      stream.assistantText,
      clientHeaders,
      headers,
    );
    stream = toolLoop.stream;

    const completedAt = Date.now();
    const finalAssistantMessageId = stream.responseMessageId ?? assistantMessageId;
    const history = await readHistorySnapshot(chatSessionId, finalAssistantMessageId).catch(() => null);
    const nextParentMessageId = history?.parentMessageId ?? finalAssistantMessageId;
    const result: AutomationRunnerSuccess = {
      ok: true,
      chatSessionId,
      sessionUrl: buildDeepSeekSessionUrl(chatSessionId),
      parentMessageId: nextParentMessageId,
      assistantMessageId: history?.assistantMessageId ?? finalAssistantMessageId,
      assistantText: stream.assistantText,
      toolExecutions: toolLoop.executions,
      history,
      completedAt,
    };
    return result;
  } catch (err) {
    const isAuthError = err instanceof DeepSeekAuthError;
    const isPowError = err instanceof DeepSeekPowError;
    const isSessionError = err instanceof DeepSeekSessionError;
    const isPayloadError = err instanceof DeepSeekPayloadError;
    const isRetryablePayloadError = isPayloadError && err.retryable;
    return createAutomationRunnerFailure(
      { ...request, chatSessionId, parentMessageId },
      isAuthError
        ? 'deepseek_auth_token_missing'
        : isPowError
          ? 'deepseek_pow_failed'
          : isSessionError
            ? 'deepseek_session_create_failed'
            : isPayloadError
              ? 'deepseek_payload_invalid'
              : 'deepseek_runner_failed',
      err instanceof Error ? err.message : String(err),
      isAuthError ? 'auth' : isPowError ? 'pow' : isSessionError ? 'session' : isPayloadError ? 'completion' : 'runner',
      !isAuthError && (!isPayloadError || isRetryablePayloadError),
    );
  }
}

async function submitAutomationPrompt(
  request: AutomationRunnerRequest,
  chatSessionId: string,
  parentMessageId: number | null,
  prompt: string,
  clientHeaders: Record<string, string>,
  powHeaders: Record<string, string>,
): Promise<ModelTurn> {
  return submitPrompt({
    chatSessionId,
    parentMessageId,
    modelType: request.promptOptions.modelType,
    prompt,
    refFileIds: request.promptOptions.refFileIds,
    thinkingEnabled: request.promptOptions.thinkingEnabled,
    searchEnabled: request.promptOptions.searchEnabled,
    clientHeaders,
    powHeaders,
  });
}

async function runAutomationToolLoop(
  request: AutomationRunnerRequest,
  options: AutomationRunnerOptions | undefined,
  chatSessionId: string,
  assistantMessageId: number,
  assistantText: string,
  clientHeaders: Record<string, string>,
  powHeaders: Record<string, string>,
): Promise<{ stream: ModelTurn; executions: ToolExecutionRecord[] }> {
  const initialTurn: ModelTurn = {
    assistantText,
    responseMessageId: assistantMessageId,
    requestMessageId: null,
    finished: true,
  };

  if (!options?.executeToolCall) return { stream: initialTurn, executions: [] };

  const loop = await runToolContinuationLoop({
    initialTurn,
    maxDepth: AUTOMATION_MCP_CONTINUATION_LIMIT,
    getAssistantText: (turn) => turn.assistantText,
    getParentMessageId: (turn) => turn.responseMessageId,
    extractToolCalls: (text) => extractToolCalls(text, {
      descriptors: request.promptContext?.toolDescriptors ?? DEFAULT_TOOL_DESCRIPTORS,
    }).filter((call) => call.provider?.kind === 'mcp' || call.provider?.id === 'web'),
    async executeToolCall(call, parentMessageId) {
      const result = await options.executeToolCall!({
        ...call,
        source: {
          trigger: 'automation',
          automationId: request.automationId,
          automationRunId: request.runId,
          chatSessionId,
          messageId: parentMessageId,
        },
      });
      return createToolExecutionRecord(call, result, {
        detailMaxLength: 4000,
        outputMaxLength: 8000,
      });
    },
    buildContinuationPrompt: buildAutomationToolContinuationPrompt,
    submitContinuation: (prompt, parentMessageId) => submitAutomationPrompt(
      request,
      chatSessionId,
      parentMessageId,
      prompt,
      clientHeaders,
      powHeaders,
    ),
  });

  return { stream: loop.turn, executions: loop.executions };
}

function buildAutomationToolContinuationPrompt(executions: ToolExecutionRecord[]): string {
  const results = executions.map((execution) => ({
    tool: execution.name,
    provider: execution.provider?.displayName,
    ok: execution.result.ok,
    summary: execution.result.summary,
    detail: clampText(execution.result.detail, 4000),
    output: clampText(
      execution.result.output === undefined ? undefined : JSON.stringify(execution.result.output),
      8000,
    ),
    truncated: execution.result.truncated === true,
  }));

  return [
    '以下是自动化任务刚刚执行的 MCP 工具结果。请基于这些结果继续完成自动化任务。',
    '如果结果已经足够，请输出最终结论；只有确实需要更多信息时才继续调用工具。',
    '',
    '<tool_results>',
    JSON.stringify(results, null, 2),
    '</tool_results>',
  ].join('\n');
}
