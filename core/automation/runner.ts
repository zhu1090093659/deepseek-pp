import type {
  DeepSeekAutomationClient,
  DeepSeekRequestContext,
  ModelTurn,
} from '../deepseek/automation-client-port';
import {
  DeepSeekAuthError,
  DeepSeekPayloadError,
  DeepSeekPowError,
  DeepSeekSessionError,
} from '../deepseek/errors';
import { extractToolCalls } from '../interceptor/tool-parser';
import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { buildPromptAugmentation } from '../prompt';
import { DEFAULT_TOOL_DESCRIPTORS } from '../tool';
import { clampText, createToolExecutionRecord, runToolContinuationLoop } from '../tool-loop/engine';
import type { ToolCall, ToolExecutionRecord, ToolResult } from '../types';
import { NetworkPolicyError } from '../network/request-policy';
import { createAutomationRunnerFailure } from './messages';
import {
  AutomationExecutionStoppedError,
  type AutomationExecutionContext,
} from './execution';
import type {
  AutomationRunnerRequest,
  AutomationRunnerResult,
  AutomationRunnerSuccess,
  AutomationFailurePhase,
} from './types';

const AUTOMATION_MCP_CONTINUATION_LIMIT = 3;
const AUTOMATION_MISSING_TOKEN_MESSAGE =
  'DeepSeek login token is missing. Refresh chat.deepseek.com or sign in again, then retry the automation.';

class AutomationToolOutcomeAmbiguousError extends Error {
  constructor(toolName: string) {
    super(`Automation tool ${toolName} finished without a confirmed external outcome.`);
    this.name = 'AutomationToolOutcomeAmbiguousError';
  }
}

export interface AutomationRunnerOptions {
  deepSeekClient: DeepSeekAutomationClient;
  executeToolCall?: (
    call: ToolCall,
    execution: { signal?: AbortSignal; idempotencyKey: string },
  ) => Promise<ToolResult>;
  clientHeaders?: Record<string, string>;
  execution?: AutomationExecutionContext;
}

export async function runDeepSeekAutomation(
  request: AutomationRunnerRequest,
  options: AutomationRunnerOptions,
): Promise<AutomationRunnerResult> {
  let chatSessionId = request.chatSessionId;
  let parentMessageId: number | null = null;
  const locale = request.locale ?? DEFAULT_LOCALE;
  let externalOutcome: 'not_started' | 'ambiguous' = 'not_started';
  const { deepSeekClient } = options;
  const requestContext: DeepSeekRequestContext = options.execution
    ? { signal: options.execution.signal }
    : { deadlineAt: request.deadlineAt };

  try {
    options.execution?.assertActive();
    parentMessageId = deepSeekClient.normalizeMessageId(request.parentMessageId, 'parent_message_id');
    const clientHeaders = options.clientHeaders ?? deepSeekClient.createClientHeaders({
      missingTokenMessage: AUTOMATION_MISSING_TOKEN_MESSAGE,
    });
    if (chatSessionId === null) {
      externalOutcome = 'ambiguous';
      chatSessionId = await deepSeekClient.createChatSession(clientHeaders, requestContext);
      options.execution?.assertActive();
    }
    const { augmented: prompt } = buildPromptAugmentation(request.prompt, {
      memories: request.promptContext?.memories ?? [],
      presetContent: request.promptContext?.presetContent ?? null,
      projectContext: request.promptContext?.projectContext ?? null,
      thinkingEnabled: request.promptOptions.thinkingEnabled,
      toolDescriptors: request.promptContext?.toolDescriptors ?? DEFAULT_TOOL_DESCRIPTORS,
      locale,
    });
    let stream = await submitAutomationPrompt(
      request,
      chatSessionId,
      parentMessageId,
      prompt,
      clientHeaders,
      options.execution,
      deepSeekClient,
      requestContext,
      () => { externalOutcome = 'ambiguous'; },
    );
    options.execution?.assertActive();
    const assistantMessageId = stream.responseMessageId;
    if (assistantMessageId === null) {
      return createAutomationRunnerFailure(
        { ...request, chatSessionId, parentMessageId },
        'deepseek_completion_missing_message_id',
        'DeepSeek completion finished without a response message id.',
        'completion',
        false,
        Date.now(),
        { externalOutcome: 'ambiguous', retrySafe: false },
      );
    }

    const toolLoop = await runAutomationToolLoop(
      request,
      options,
      chatSessionId,
      assistantMessageId,
      stream.assistantText,
      clientHeaders,
      locale,
      deepSeekClient,
      requestContext,
    );
    stream = toolLoop.stream;
    options.execution?.assertActive();

    const completedAt = Date.now();
    const finalAssistantMessageId = stream.responseMessageId ?? assistantMessageId;
    const history = await readAutomationHistorySnapshot(
      chatSessionId,
      finalAssistantMessageId,
      clientHeaders,
      options.execution,
      deepSeekClient,
      requestContext,
    );
    options.execution?.assertActive();
    const nextParentMessageId = history?.parentMessageId ?? finalAssistantMessageId;
    const result: AutomationRunnerSuccess = {
      ok: true,
      chatSessionId,
      sessionUrl: deepSeekClient.buildSessionUrl(chatSessionId),
      parentMessageId: nextParentMessageId,
      assistantMessageId: history?.assistantMessageId ?? finalAssistantMessageId,
      assistantText: stream.assistantText,
      toolExecutions: toolLoop.executions,
      history,
      completedAt,
    };
    return result;
  } catch (err) {
    if (options.execution?.signal.aborted) options.execution.assertActive();
    if (err instanceof AutomationExecutionStoppedError) throw err;
    const isAuthError = err instanceof DeepSeekAuthError;
    const isPowError = err instanceof DeepSeekPowError;
    const isSessionError = err instanceof DeepSeekSessionError;
    const isPayloadError = err instanceof DeepSeekPayloadError;
    const isNetworkError = err instanceof NetworkPolicyError;
    const isAmbiguousToolError = err instanceof AutomationToolOutcomeAmbiguousError;
    const isRetryablePayloadError = isPayloadError && err.retryable;
    const retrySafe = externalOutcome === 'not_started' && (
      isPowError || (isNetworkError && err.phase === 'pow' && err.retryable)
    );
    const networkFailurePhase = isNetworkError
      ? normalizeAutomationNetworkPhase(err.phase)
      : null;
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
              : isNetworkError
                ? `deepseek_${err.code}`
              : isAmbiguousToolError
                ? 'automation_tool_outcome_ambiguous'
              : 'deepseek_runner_failed',
      err instanceof Error ? err.message : String(err),
      isAuthError
        ? 'auth'
        : isPowError
          ? 'pow'
          : isSessionError
            ? 'session'
            : isPayloadError
              ? 'completion'
              : networkFailurePhase ?? 'runner',
      retrySafe && !isAuthError && (!isPayloadError || isRetryablePayloadError),
      Date.now(),
      { externalOutcome, retrySafe },
    );
  }
}

async function readAutomationHistorySnapshot(
  chatSessionId: string,
  assistantMessageId: number,
  clientHeaders: Record<string, string>,
  execution: AutomationExecutionContext | undefined,
  deepSeekClient: DeepSeekAutomationClient,
  requestContext: DeepSeekRequestContext,
) {
  try {
    return await deepSeekClient.readHistorySnapshot(
      chatSessionId,
      assistantMessageId,
      clientHeaders,
      requestContext,
    );
  } catch {
    execution?.assertActive();
    return null;
  }
}

async function submitAutomationPrompt(
  request: AutomationRunnerRequest,
  chatSessionId: string,
  parentMessageId: number | null,
  prompt: string,
  clientHeaders: Record<string, string>,
  execution: AutomationExecutionContext | undefined,
  deepSeekClient: DeepSeekAutomationClient,
  requestContext: DeepSeekRequestContext,
  onDispatch?: () => void,
): Promise<ModelTurn> {
  execution?.assertActive();
  const powHeaders = await deepSeekClient.createPowHeaders(clientHeaders, requestContext);
  execution?.assertActive();
  return deepSeekClient.submitPrompt({
    chatSessionId,
    parentMessageId,
    modelType: request.promptOptions.modelType,
    prompt,
    refFileIds: request.promptOptions.refFileIds,
    thinkingEnabled: request.promptOptions.thinkingEnabled,
    searchEnabled: request.promptOptions.searchEnabled,
    clientHeaders,
    powHeaders,
  }, onDispatch ? { ...requestContext, onDispatch } : requestContext);
}

async function runAutomationToolLoop(
  request: AutomationRunnerRequest,
  options: AutomationRunnerOptions,
  chatSessionId: string,
  assistantMessageId: number,
  assistantText: string,
  clientHeaders: Record<string, string>,
  locale: SupportedLocale,
  deepSeekClient: DeepSeekAutomationClient,
  requestContext: DeepSeekRequestContext,
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
    async executeToolCall(call, parentMessageId, position) {
      const idempotencyKey = options.execution?.createIdempotencyKey(
        `tool:${parentMessageId}:${position.depth}:${position.callIndex}`,
      ) ?? `automation:${request.runId}:tool:${parentMessageId}:${position.depth}:${position.callIndex}`;
      options.execution?.assertActive();
      const executionCall: ToolCall = {
        ...call,
        id: call.id ?? idempotencyKey,
        source: {
          trigger: 'automation',
          automationId: request.automationId,
          automationRunId: request.runId,
          chatSessionId,
          messageId: parentMessageId,
        },
      };
      const result = await options.executeToolCall!(
        executionCall,
        { signal: options.execution?.signal, idempotencyKey },
      );
      options.execution?.assertActive();
      if (
        !result.ok &&
        result.error?.details?.externalOutcome === 'ambiguous'
      ) {
        throw new AutomationToolOutcomeAmbiguousError(executionCall.name);
      }
      return createToolExecutionRecord(executionCall, result, {
        detailMaxLength: 4000,
        outputMaxLength: 8000,
      });
    },
    buildContinuationPrompt: (executions) => buildAutomationToolContinuationPrompt(executions, locale),
    submitContinuation: (prompt, parentMessageId) => submitAutomationPrompt(
      request,
      chatSessionId,
      parentMessageId,
      prompt,
      clientHeaders,
      options.execution,
      deepSeekClient,
      requestContext,
    ),
    signal: options.execution?.signal,
    assertActive: () => options.execution?.assertActive(),
  });

  return { stream: loop.turn, executions: loop.executions };
}

function normalizeAutomationNetworkPhase(phase: string | null): AutomationFailurePhase {
  if (phase === 'session' || phase === 'pow' || phase === 'completion' || phase === 'history') {
    return phase;
  }
  return 'runner';
}

export function buildAutomationToolContinuationPrompt(
  executions: ToolExecutionRecord[],
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
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
    translate(locale, 'prompt.automation.continuationIntro'),
    translate(locale, 'prompt.automation.continuationEnough'),
    '',
    '<tool_results>',
    JSON.stringify(results, null, 2),
    '</tool_results>',
  ].join('\n');
}
