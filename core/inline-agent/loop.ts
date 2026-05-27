import {
  createClientHeaders,
  createPowHeaders,
  submitPromptStreaming,
  type ModelTurn,
  type SubmitPromptInput,
} from '../deepseek/adapter';
import { extractToolCalls, stripToolCalls } from '../interceptor/tool-parser';
import type { ToolCall, ToolDescriptor, ToolExecutionRecord } from '../types';
import type { ToolParsingInput } from '../tool/invocation';
import {
  buildContinuationPrompt,
  buildFinalizationPrompt,
  buildNudgePrompt,
  extractTaskCompleteSignal,
  shouldNudge,
} from './prompt';
import {
  INLINE_AGENT_MAX_NUDGES,
  INLINE_AGENT_MAX_STEPS,
  INLINE_AGENT_STEP_TIMEOUT_MS,
  type InlineAgentLoopCompleteMsg,
  type InlineAgentLoopErrorMsg,
  type InlineAgentStartPayload,
  type InlineAgentStepCompleteMsg,
  type InlineAgentStreamChunkMsg,
  type InlineAgentToolDetectedMsg,
} from './types';

type PostFn = (type: string, data: unknown) => void;
type ExecuteToolFn = (call: ToolCall) => Promise<ToolExecutionRecord>;

export interface InlineAgentLoopDeps {
  post: PostFn;
  executeTool: ExecuteToolFn;
  signal: AbortSignal;
}

export async function runInlineAgentLoop(
  payload: InlineAgentStartPayload,
  deps: InlineAgentLoopDeps,
): Promise<void> {
  const { post, executeTool, signal } = deps;
  const { loopId, chatSessionId, toolDescriptors, promptOptions } = payload;
  const parsingInput: ToolParsingInput = { descriptors: toolDescriptors };

  let parentMessageId: number | null = payload.parentMessageId;
  let allExecutions: ToolExecutionRecord[] = [...payload.toolExecutions];
  let nudgeCount = 0;
  let totalSteps = 0;
  let totalTools = allExecutions.length;

  try {
    const clientHeaders = createClientHeaders();
    let powHeaders = await createPowHeaders(clientHeaders);

    for (let step = 0; step < INLINE_AGENT_MAX_STEPS; step++) {
      if (signal.aborted) break;

      const prompt = buildContinuationPrompt(payload.originalPrompt, allExecutions);

      post('AGENT_STEP_STARTED', { loopId, stepIndex: step });

      const input: SubmitPromptInput = {
        chatSessionId,
        parentMessageId,
        modelType: promptOptions.modelType,
        prompt,
        refFileIds: promptOptions.refFileIds,
        thinkingEnabled: promptOptions.thinkingEnabled,
        searchEnabled: promptOptions.searchEnabled,
        clientHeaders,
        powHeaders,
      };

      let notifiedToolCount = 0;
      const stepTimeout = createStepSignal(signal);
      const turn: ModelTurn = await submitPromptStreaming(input, {
        onTextChunk(text, fullText) {
          const stripped = stripToolCalls(fullText, parsingInput);
          post('AGENT_STREAM_CHUNK', {
            loopId,
            stepIndex: step,
            text,
            fullText: stripped,
          } satisfies InlineAgentStreamChunkMsg);

          const calls = extractToolCalls(fullText, parsingInput);
          for (let i = notifiedToolCount; i < calls.length; i++) {
            post('AGENT_TOOL_DETECTED', {
              loopId,
              stepIndex: step,
              call: calls[i],
            } satisfies InlineAgentToolDetectedMsg);
          }
          notifiedToolCount = calls.length;
        },
      }, stepTimeout.signal);
      stepTimeout.clear();

      if (signal.aborted) break;

      parentMessageId = turn.responseMessageId;
      if (parentMessageId == null) {
        totalSteps = step + 1;
        break;
      }
      const toolCalls = extractToolCalls(turn.assistantText, parsingInput);
      const visibleText = stripToolCalls(turn.assistantText, parsingInput);

      if (extractTaskCompleteSignal(turn.assistantText)) {
        const stepExecutions: ToolExecutionRecord[] = [];
        post('AGENT_STEP_COMPLETE', {
          loopId,
          stepIndex: step,
          responseMessageId: turn.responseMessageId,
          toolExecutions: stepExecutions,
        } satisfies InlineAgentStepCompleteMsg);
        totalSteps = step + 1;
        break;
      }

      if (toolCalls.length === 0) {
        if (!shouldNudge(payload.originalPrompt, allExecutions, visibleText, nudgeCount)) {
          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: step,
            responseMessageId: turn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps = step + 1;
          break;
        }

        nudgeCount++;
        if (nudgeCount > INLINE_AGENT_MAX_NUDGES) {
          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: step,
            responseMessageId: turn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps = step + 1;
          break;
        }

        const nudgePrompt = buildNudgePrompt(payload.originalPrompt, visibleText, allExecutions, nudgeCount);
        const nudgeInput: SubmitPromptInput = {
          ...input,
          prompt: nudgePrompt,
          parentMessageId: turn.responseMessageId,
        };

        powHeaders = await createPowHeaders(clientHeaders);
        nudgeInput.powHeaders = powHeaders;

        const nudgeTimeout = createStepSignal(signal);
        const nudgeTurn = await submitPromptStreaming(nudgeInput, {
          onTextChunk(text, fullText) {
            const stripped = stripToolCalls(fullText, parsingInput);
            post('AGENT_STREAM_CHUNK', {
              loopId,
              stepIndex: step,
              text,
              fullText: stripped,
            } satisfies InlineAgentStreamChunkMsg);
          },
        }, nudgeTimeout.signal);
        nudgeTimeout.clear();

        if (signal.aborted) break;

        parentMessageId = nudgeTurn.responseMessageId;
        const nudgeToolCalls = extractToolCalls(nudgeTurn.assistantText, parsingInput);

        if (nudgeToolCalls.length === 0) {
          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: step,
            responseMessageId: nudgeTurn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps = step + 1;
          break;
        }

        const nudgeExecs = await executeToolCalls(nudgeToolCalls, executeTool, signal);
        allExecutions = [...allExecutions, ...nudgeExecs];
        totalTools += nudgeExecs.length;

        post('AGENT_STEP_COMPLETE', {
          loopId,
          stepIndex: step,
          responseMessageId: nudgeTurn.responseMessageId,
          toolExecutions: nudgeExecs,
        } satisfies InlineAgentStepCompleteMsg);
        totalSteps = step + 1;
        nudgeCount = 0;

        powHeaders = await createPowHeaders(clientHeaders);
        continue;
      }

      nudgeCount = 0;
      const stepExecs = await executeToolCalls(toolCalls, executeTool, signal);
      allExecutions = [...allExecutions, ...stepExecs];
      totalTools += stepExecs.length;

      post('AGENT_STEP_COMPLETE', {
        loopId,
        stepIndex: step,
        responseMessageId: turn.responseMessageId,
        toolExecutions: stepExecs,
      } satisfies InlineAgentStepCompleteMsg);
      totalSteps = step + 1;

      if (signal.aborted) break;
      powHeaders = await createPowHeaders(clientHeaders);
    }

    let finalText = '';
    if (!signal.aborted && totalTools > 0 && totalSteps > 0) {
      try {
        powHeaders = await createPowHeaders(clientHeaders);
        const finalizationPrompt = buildFinalizationPrompt(payload.originalPrompt, allExecutions);
        const finalInput: SubmitPromptInput = {
          chatSessionId,
          parentMessageId,
          modelType: promptOptions.modelType,
          prompt: finalizationPrompt,
          refFileIds: promptOptions.refFileIds,
          thinkingEnabled: promptOptions.thinkingEnabled,
          searchEnabled: promptOptions.searchEnabled,
          clientHeaders,
          powHeaders,
        };

        post('AGENT_STEP_STARTED', { loopId, stepIndex: totalSteps });
        const finalTurn = await submitPromptStreaming(finalInput, {
          onTextChunk(_text, fullText) {
            post('AGENT_STREAM_CHUNK', {
              loopId,
              stepIndex: totalSteps,
              text: _text,
              fullText,
            } satisfies InlineAgentStreamChunkMsg);
          },
        }, signal);

        finalText = finalTurn.assistantText;
        post('AGENT_STEP_COMPLETE', {
          loopId,
          stepIndex: totalSteps,
          responseMessageId: finalTurn.responseMessageId,
          toolExecutions: [],
        } satisfies InlineAgentStepCompleteMsg);
        totalSteps++;
      } catch {
        // Finalization is best-effort; loop still completes
      }
    }

    post('AGENT_LOOP_COMPLETE', {
      loopId,
      totalSteps,
      totalTools,
      finalText,
    } satisfies InlineAgentLoopCompleteMsg);
  } catch (err) {
    if (signal.aborted) {
      post('AGENT_LOOP_COMPLETE', {
        loopId,
        totalSteps,
        totalTools,
        finalText: '',
      } satisfies InlineAgentLoopCompleteMsg);
      return;
    }

    post('AGENT_LOOP_ERROR', {
      loopId,
      stepIndex: totalSteps,
      error: err instanceof Error ? err.message : String(err),
    } satisfies InlineAgentLoopErrorMsg);
  }
}

async function executeToolCalls(
  calls: ToolCall[],
  executeTool: ExecuteToolFn,
  signal: AbortSignal,
): Promise<ToolExecutionRecord[]> {
  const results: ToolExecutionRecord[] = [];
  for (const call of calls) {
    if (signal.aborted) break;
    const record = await executeTool(call);
    results.push(record);
  }
  return results;
}

function createStepSignal(parentSignal: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INLINE_AGENT_STEP_TIMEOUT_MS);
  const onParentAbort = () => controller.abort();
  parentSignal.addEventListener('abort', onParentAbort, { once: true });
  const clear = () => {
    clearTimeout(timeout);
    parentSignal.removeEventListener('abort', onParentAbort);
  };
  return { signal: controller.signal, clear };
}
